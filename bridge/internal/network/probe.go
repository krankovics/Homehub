package network

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"homehub/bridge/internal/config"
)

type Status struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	Online    bool    `json:"online"`
	IP        string  `json:"ip"`
	MAC       string  `json:"mac"`
	LatencyMs float64 `json:"latencyMs"`
	AdminURL  string  `json:"adminUrl"`
	Note      string  `json:"note"`
}

var scanMu sync.Mutex
var lastScan time.Time

func normMAC(v string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(v), "-", ":"))
}

func arpTable() map[string]string {
	out := map[string]string{}
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
		ip, mac := fields[0], normMAC(fields[3])
		if mac != "" && mac != "00:00:00:00:00:00" {
			out[mac] = ip
		}
	}
	return out
}

func warmARP(subnet string) {
	scanMu.Lock()
	defer scanMu.Unlock()
	if time.Since(lastScan) < 5*time.Minute {
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
	network := make(net.IP, 4)
	for i := 0; i < 4; i++ {
		network[i] = base[i] & mask[i]
	}
	ones, bits := mask.Size()
	if bits != 32 || ones < 24 {
		return
	}
	total := 1 << uint(32-ones)
	if total > 256 {
		total = 256
	}
	sem := make(chan struct{}, 32)
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
}

func probeHost(ip string, ports []int) (bool, float64, int) {
	if len(ports) == 0 {
		ports = []int{80, 443}
	}
	best := time.Duration(1<<63 - 1)
	found := 0
	for _, p := range ports {
		start := time.Now()
		c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, p), 700*time.Millisecond)
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
	arp := arpTable()
	unresolved := false
	for _, d := range cfg.Network.Devices {
		if strings.TrimSpace(d.IP) == "" && strings.TrimSpace(d.MAC) != "" && arp[normMAC(d.MAC)] == "" {
			unresolved = true
		}
	}
	if unresolved && strings.TrimSpace(cfg.Network.Subnet) != "" {
		warmARP(cfg.Network.Subnet)
		arp = arpTable()
	}

	out := make([]Status, 0, len(cfg.Network.Devices))
	for _, d := range cfg.Network.Devices {
		ip := strings.TrimSpace(d.IP)
		mac := normMAC(d.MAC)
		if ip == "" && mac != "" {
			ip = arp[mac]
		}
		st := Status{ID: d.ID, Name: d.Name, Kind: d.Kind, IP: ip, MAC: mac, AdminURL: d.AdminURL}
		if st.AdminURL == "" && ip != "" {
			st.AdminURL = "http://" + ip
		}
		if ip == "" {
			st.Note = "IP még nem jelent meg az ARP táblában"
			out = append(out, st)
			continue
		}
		online, latency, port := probeHost(ip, d.ProbePorts)
		st.Online, st.LatencyMs = online, latency
		if online {
			st.Note = fmt.Sprintf("TCP/%d elérhető", port)
		} else {
			st.Note = "IP ismert, de a webes szolgáltatás nem válaszolt"
		}
		out = append(out, st)
	}
	return out
}
