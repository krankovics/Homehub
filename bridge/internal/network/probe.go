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
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Online      bool    `json:"online"`
	AdminOnline bool    `json:"adminOnline"`
	IP          string  `json:"ip"`
	MAC         string  `json:"mac"`
	LatencyMs   float64 `json:"latencyMs"`
	AdminURL    string  `json:"adminUrl"`
	Note        string  `json:"note"`
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
	unresolved := false
	for _, d := range cfg.Network.Devices {
		if strings.TrimSpace(d.IP) == "" && strings.TrimSpace(d.MAC) != "" {
			if _, ok := findARP(entries, d.MAC, ""); !ok {
				unresolved = true
			}
		}
	}
	if unresolved && strings.TrimSpace(cfg.Network.Subnet) != "" {
		warmARP(cfg.Network.Subnet)
		entries = arpEntries()
	}
	out := make([]Status, 0, len(cfg.Network.Devices))
	for _, d := range cfg.Network.Devices {
		ip := strings.TrimSpace(d.IP)
		mac := normMAC(d.MAC)
		if ip == "" && mac != "" {
			if e, ok := findARP(entries, mac, ""); ok {
				ip = e.IP
			}
		}
		st := Status{ID: d.ID, Name: d.Name, Kind: d.Kind, IP: ip, MAC: mac, AdminURL: d.AdminURL}
		if st.AdminURL == "" && ip != "" {
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
		out = append(out, st)
	}
	return out
}
