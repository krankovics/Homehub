package printer

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"homehub/bridge/internal/config"
)

type Status struct {
	Configured    bool   `json:"configured"`
	Online        bool   `json:"online"`
	Host          string `json:"host"`
	AdminURL      string `json:"adminUrl"`
	DetectedPorts []int  `json:"detectedPorts"`
	Protocol      string `json:"protocol"`
	Note          string `json:"note"`
}

func Probe(cfg config.Config) Status {
	host := strings.TrimSpace(cfg.Printer.Host)
	if host == "" {
		host = cfg.KD20.SMBHost
	}
	adminURL := strings.TrimSpace(cfg.Printer.AdminURL)
	if adminURL == "" && host != "" {
		adminURL = "http://" + host
	}
	st := Status{Configured: cfg.Printer.Enabled, Host: host, AdminURL: adminURL}
	if !cfg.Printer.Enabled || host == "" {
		st.Note = "A KD20 nyomtatómodul nincs engedélyezve a Bridge konfigurációban."
		return st
	}
	ports := cfg.Printer.ProbePorts
	if len(ports) == 0 {
		ports = []int{9100, 515, 631}
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, p := range ports {
		p := p
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, p), 700*time.Millisecond)
			if err != nil {
				return
			}
			c.Close()
			mu.Lock()
			st.DetectedPorts = append(st.DetectedPorts, p)
			mu.Unlock()
		}()
	}
	wg.Wait()
	sort.Ints(st.DetectedPorts)
	st.Online = len(st.DetectedPorts) > 0
	for _, p := range st.DetectedPorts {
		switch p {
		case 9100:
			st.Protocol = "RAW / JetDirect"
		case 515:
			if st.Protocol == "" {
				st.Protocol = "LPR/LPD"
			}
		case 631:
			if st.Protocol == "" {
				st.Protocol = "IPP"
			}
		}
	}
	if st.Online {
		st.Note = "A KD20 hálózati nyomtatószolgáltatása elérhető."
	} else {
		st.Note = "Nem észleltem RAW/LPR/IPP portot. Dugd a nyomtatót USB-re, majd KD20 → USB → Printer Setting alatt engedélyezd."
	}
	return st
}
