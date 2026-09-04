package network

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"homehub/bridge/internal/config"
)

type Status struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	Online       bool           `json:"online"`
	AdminOnline  bool           `json:"adminOnline"`
	IP           string         `json:"ip"`
	ConfiguredIP string         `json:"configuredIp,omitempty"`
	IPSource     string         `json:"ipSource,omitempty"`
	IPChanged    bool           `json:"ipChanged,omitempty"`
	MAC          string         `json:"mac"`
	LatencyMs    float64        `json:"latencyMs"`
	AdminURL     string         `json:"adminUrl"`
	Note         string         `json:"note"`
	Managed      *ManagedStatus `json:"managed,omitempty"`
}

var scanMu sync.Mutex
var lastScan time.Time
var pingTimeRE = regexp.MustCompile(`time[=<]([0-9.]+)\s*ms`)

func normMAC(v string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(v), "-", ":"))
}

type arpEntry struct {
	IP, MAC  string
	Complete bool
}

func arpEntries() []arpEntry {
	out := []arpEntry{}
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		return out
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	first := true
	for s.Scan() {
		if first {
			first = false
			continue
		}
		fields := strings.Fields(s.Text())
		if len(fields) < 4 {
			continue
		}
		mac := normMAC(fields[3])
		if mac == "" || mac == "00:00:00:00:00:00" {
			continue
		}
		flags, _ := strconv.ParseInt(strings.TrimPrefix(fields[2], "0x"), 16, 64)
		out = append(out, arpEntry{IP: fields[0], MAC: mac, Complete: flags&0x2 != 0})
	}
	return out
}
func findARP(entries []arpEntry, mac, ip string) (arpEntry, bool) {
	mac = normMAC(mac)
	for _, e := range entries {
		if mac != "" && e.MAC == mac {
			return e, true
		}
	}
	for _, e := range entries {
		if ip != "" && e.IP == ip {
			return e, true
		}
	}
	return arpEntry{}, false
}

func warmARP(subnet string) {
	scanMu.Lock()
	defer scanMu.Unlock()
	if time.Since(lastScan) < 60*time.Second {
		return
	}
	lastScan = time.Now()
	ip, ipnet, err := net.ParseCIDR(subnet)
	if err != nil {
		return
	}
	base := ip.To4()
	mask := ipnet.Mask
	if base == nil || len(mask) != 4 {
		return
	}
	ones, bits := mask.Size()
	if bits != 32 || ones < 24 {
		return
	}
	network := make(net.IP, 4)
	for i := 0; i < 4; i++ {
		network[i] = base[i] & mask[i]
	}
	total := 1 << uint(32-ones)
	if total > 256 {
		total = 256
	}
	sem := make(chan struct{}, 48)
	var wg sync.WaitGroup
	for n := 1; n < total-1; n++ {
		host := net.IPv4(network[0], network[1], network[2], byte(n)).String()
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			c, _ := net.DialTimeout("tcp", net.JoinHostPort(host, "80"), 120*time.Millisecond)
			if c != nil {
				c.Close()
			}
		}()
	}
	wg.Wait()
	time.Sleep(150 * time.Millisecond)
}

func pingHost(ip string) (bool, float64) {
	cmd := exec.Command("ping", "-c", "1", "-W", "1", ip)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, 0
	}
	m := pingTimeRE.FindStringSubmatch(string(out))
	if len(m) == 2 {
		if v, e := strconv.ParseFloat(m[1], 64); e == nil {
			return true, v
		}
	}
	return true, 0
}
func probeAdmin(ip string, ports []int) (bool, float64, int) {
	if len(ports) == 0 {
		ports = []int{80, 443}
	}
	best := time.Duration(1<<63 - 1)
	found := 0
	for _, p := range ports {
		start := time.Now()
		c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, p), 500*time.Millisecond)
		if err != nil {
			continue
		}
		d := time.Since(start)
		c.Close()
		if d < best {
			best = d
			found = p
		}
	}
	if found == 0 {
		return false, 0, 0
	}
	return true, float64(best.Microseconds()) / 1000.0, found
}

func Probe(cfg config.Config) []Status {
	if !cfg.Network.Enabled {
		return nil
	}
	entries := arpEntries()
	// v0.14: always refresh the local /24 ARP view (rate-limited in warmARP),
	// so automations can detect previously unknown devices, not only configured nodes.
	if strings.TrimSpace(cfg.Network.Subnet) != "" {
		warmARP(cfg.Network.Subnet)
		entries = arpEntries()
	}
	out := make([]Status, 0, len(cfg.Network.Devices))
	knownMAC := map[string]bool{}
	knownIP := map[string]bool{}
	for _, d := range cfg.Network.Devices {
		configuredIP := strings.TrimSpace(d.IP)
		ip := configuredIP
		mac := normMAC(d.MAC)
		ipSource := "config"
		if mac != "" {
			knownMAC[mac] = true
			// v0.17: MAC identity wins over a stale DHCP address. This lets the
			// Bridge recover automatically after router/DHCP restarts.
			if e, ok := findARP(entries, mac, ""); ok && e.Complete && e.IP != "" {
				ip = e.IP
				ipSource = "arp-mac"
			}
		}
		if ip != "" {
			knownIP[ip] = true
		}
		if configuredIP != "" {
			knownIP[configuredIP] = true
		}
		st := Status{ID: d.ID, Name: d.Name, Kind: d.Kind, IP: ip, ConfiguredIP: configuredIP, IPSource: ipSource, IPChanged: configuredIP != "" && ip != "" && configuredIP != ip, MAC: mac, AdminURL: d.AdminURL}
		if ip != "" && (st.AdminURL == "" || st.IPChanged) {
			st.AdminURL = "http://" + ip
		}
		if ip == "" {
			st.Note = "IP még nem található a helyi ARP táblában"
			out = append(out, st)
			continue
		}
		arp, hasARP := findARP(entries, mac, ip)
		pingOK, pingMs := pingHost(ip)
		adminOK, adminMs, port := probeAdmin(ip, d.ProbePorts)
		st.AdminOnline = adminOK
		st.Online = pingOK || adminOK || (hasARP && arp.Complete)
		if pingOK {
			st.LatencyMs = pingMs
		} else if adminOK {
			st.LatencyMs = adminMs
		}
		switch {
		case pingOK && adminOK:
			st.Note = fmt.Sprintf("Ping OK · admin TCP/%d elérhető", port)
		case pingOK:
			st.Note = "Ping OK · webadmin nem válaszol"
		case adminOK:
			st.Note = fmt.Sprintf("Admin TCP/%d elérhető", port)
		case hasARP && arp.Complete:
			st.Note = "ARP alapján jelen van · ping/webadmin nem válaszol"
		default:
			st.Note = "Nem válaszol pingre vagy ismert admin portra"
		}
		if st.IPChanged {
			st.Note = fmt.Sprintf("IP változott: %s → %s · %s", configuredIP, ip, st.Note)
		}
		if st.Online && strings.EqualFold(strings.TrimSpace(d.Adapter), "tplink-easy-smart") {
			st.Managed = readEasySmart(ip, cfg.NetworkCredentials[d.ID], d.PortNames)
		}
		out = append(out, st)
	}
	// Append active ARP neighbours that are not in the configured inventory.
	// These entries are intentionally lightweight: they enable "new device" alerts
	// without pretending we know whether a client is wired or Wi-Fi.
	for _, e := range entries {
		if !e.Complete || e.MAC == "" || knownMAC[e.MAC] || knownIP[e.IP] {
			continue
		}
		id := "discovered-" + strings.ReplaceAll(e.MAC, ":", "")
		out = append(out, Status{
			ID: id, Name: "Ismeretlen hálózati eszköz", Kind: "discovered", Online: true,
			IP: e.IP, MAC: e.MAC, Note: "Automatikusan észlelve az ARP táblában",
		})
	}
	return out
}

// ResolveDeviceIP returns the current LAN address for a configured device.
// A MAC match from ARP takes precedence over the configured IP so DHCP
// changes can heal without editing HomeHub configuration.
func ResolveDeviceIP(cfg config.Config, deviceID string) string {
	if strings.TrimSpace(cfg.Network.Subnet) != "" {
		warmARP(cfg.Network.Subnet)
	}
	entries := arpEntries()
	for _, d := range cfg.Network.Devices {
		if d.ID != deviceID {
			continue
		}
		mac := normMAC(d.MAC)
		if mac != "" {
			if e, ok := findARP(entries, mac, ""); ok && e.Complete && e.IP != "" {
				return e.IP
			}
		}
		return strings.TrimSpace(d.IP)
	}
	return ""
}

// LocalIPv4 returns a non-loopback local address inside the configured subnet.
func LocalIPv4(subnet string) string {
	_, ipnet, err := net.ParseCIDR(strings.TrimSpace(subnet))
	if err != nil {
		return ""
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		var ip net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip4 := ip.To4(); ip4 != nil && !ip4.IsLoopback() && ipnet.Contains(ip4) {
			return ip4.String()
		}
	}
	return ""
}
