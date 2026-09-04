package network

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"homehub/bridge/internal/config"
)

type SwitchPort struct {
	Port        int    `json:"port"`
	Label       string `json:"label,omitempty"`
	Enabled     bool   `json:"enabled"`
	LinkUp      bool   `json:"linkUp"`
	SpeedMbps   int    `json:"speedMbps"`
	Duplex      string `json:"duplex"`
	ConfigSpeed string `json:"configSpeed"`
	FlowControl bool   `json:"flowControl"`
	TxPackets   uint64 `json:"txPackets,omitempty"`
	RxPackets   uint64 `json:"rxPackets,omitempty"`
	Health      string `json:"health"`
}

type ManagedStatus struct {
	Adapter               string       `json:"adapter"`
	CredentialsConfigured bool         `json:"credentialsConfigured"`
	AuthOK                bool         `json:"authOk"`
	Model                 string       `json:"model,omitempty"`
	Hardware              string       `json:"hardware,omitempty"`
	Firmware              string       `json:"firmware,omitempty"`
	Gateway               string       `json:"gateway,omitempty"`
	Ports                 []SwitchPort `json:"ports,omitempty"`
	Error                 string       `json:"error,omitempty"`
	UpdatedAt             string       `json:"updatedAt"`
}

var (
	errTypeRE   = regexp.MustCompile(`errType\s*=\s*(\d+)`)
	simpleNumRE = func(name string) *regexp.Regexp {
		return regexp.MustCompile(`(?m)\bvar\s+` + regexp.QuoteMeta(name) + `\s*=\s*(\d+)`)
	}
)

func extractIntArray(html, key string) []int {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?s)\b` + regexp.QuoteMeta(key) + `\s*:\s*\[([^\]]*)\]`),
		regexp.MustCompile(`(?s)\b` + regexp.QuoteMeta(key) + `\s*:\s*new\s+Array\(([^)]*)\)`),
	}
	for _, re := range patterns {
		m := re.FindStringSubmatch(html)
		if len(m) != 2 {
			continue
		}
		parts := strings.Split(m[1], ",")
		out := make([]int, 0, len(parts))
		for _, p := range parts {
			p = strings.Trim(strings.TrimSpace(p), `"'`)
			if p == "" {
				out = append(out, 0)
				continue
			}
			if strings.HasPrefix(strings.ToLower(p), "0x") {
				if v, err := strconv.ParseInt(p[2:], 16, 64); err == nil {
					out = append(out, int(v))
					continue
				}
			}
			v, _ := strconv.Atoi(p)
			out = append(out, v)
		}
		return out
	}
	return nil
}

func extractUint64Array(html, key string) []uint64 {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?s)\b` + regexp.QuoteMeta(key) + `\s*:\s*\[([^\]]*)\]`),
		regexp.MustCompile(`(?s)\b` + regexp.QuoteMeta(key) + `\s*:\s*new\s+Array\(([^)]*)\)`),
	}
	for _, re := range patterns {
		m := re.FindStringSubmatch(html)
		if len(m) != 2 {
			continue
		}
		parts := strings.Split(m[1], ",")
		out := make([]uint64, 0, len(parts))
		for _, part := range parts {
			part = strings.Trim(strings.TrimSpace(part), `"'`)
			v, _ := strconv.ParseUint(part, 10, 64)
			out = append(out, v)
		}
		return out
	}
	return nil
}

func extractStringArrayFirst(html, key string) string {
	re := regexp.MustCompile(`(?s)\b` + regexp.QuoteMeta(key) + `\s*:\s*\[\s*["']([^"']*)["']`)
	if m := re.FindStringSubmatch(html); len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func extractMaxPorts(html string) int {
	if m := simpleNumRE("max_port_num").FindStringSubmatch(html); len(m) == 2 {
		if n, err := strconv.Atoi(m[1]); err == nil && n > 0 && n <= 64 {
			return n
		}
	}
	return 8
}

func speedDetails(code int) (mbps int, duplex, label string) {
	switch code {
	case 1:
		return 0, "auto", "Auto"
	case 2:
		return 10, "half", "10MH"
	case 3:
		return 10, "full", "10MF"
	case 4:
		return 100, "half", "100MH"
	case 5:
		return 100, "full", "100MF"
	case 6:
		return 1000, "full", "1000MF"
	default:
		return 0, "", "Link Down"
	}
}

func httpText(c *http.Client, method, target string, form url.Values) (string, error) {
	var req *http.Request
	var err error
	if method == http.MethodPost {
		req, err = http.NewRequest(method, target, strings.NewReader(form.Encode()))
		if err == nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
	} else {
		req, err = http.NewRequest(method, target, nil)
	}
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "HomeHub-Bridge/0.17")
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	return string(b), err
}

func readEasySmart(host string, cred config.NetworkCredential, portNames map[string]string) *ManagedStatus {
	result := &ManagedStatus{Adapter: "tplink-easy-smart", UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	result.CredentialsConfigured = strings.TrimSpace(cred.Username) != "" && cred.Password != ""
	if !result.CredentialsConfigured {
		result.Error = "Helyi admin hitelesítés nincs beállítva a network-secrets.json fájlban"
		return result
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 2500 * time.Millisecond, Jar: jar}
	base := "http://" + strings.TrimSpace(host) + "/"
	login, err := httpText(client, http.MethodPost, base+"logon.cgi", url.Values{
		"username": {cred.Username}, "password": {cred.Password}, "logon": {"Login"},
	})
	if err != nil {
		result.Error = "Switch login kapcsolat: " + err.Error()
		return result
	}
	if m := errTypeRE.FindStringSubmatch(login); len(m) == 2 && m[1] != "0" {
		result.Error = "Switch login sikertelen (errType=" + m[1] + ")"
		return result
	}

	sys, err := httpText(client, http.MethodGet, base+"SystemInfoRpm.htm", nil)
	if err != nil || strings.Contains(sys, "logon.cgi") {
		if err != nil {
			result.Error = "SystemInfo: " + err.Error()
		} else {
			result.Error = "Switch session nem aktív"
		}
		return result
	}
	result.AuthOK = true
	result.Model = extractStringArrayFirst(sys, "descriStr")
	result.Hardware = extractStringArrayFirst(sys, "hardwareStr")
	result.Firmware = extractStringArrayFirst(sys, "firmwareStr")
	result.Gateway = extractStringArrayFirst(sys, "gatewayStr")

	ps, err := httpText(client, http.MethodGet, base+"PortSettingRpm.htm", nil)
	if err != nil {
		result.Error = "PortSetting: " + err.Error()
		return result
	}
	n := extractMaxPorts(ps)
	state := extractIntArray(ps, "state")
	spdCfg := extractIntArray(ps, "spd_cfg")
	spdAct := extractIntArray(ps, "spd_act")
	fcAct := extractIntArray(ps, "fc_act")

	var pkts []uint64
	if stats, e := httpText(client, http.MethodGet, base+"PortStatisticsRpm.htm", nil); e == nil {
		pkts = extractUint64Array(stats, "pkts")
	}

	result.Ports = make([]SwitchPort, 0, n)
	for i := 0; i < n; i++ {
		get := func(a []int) int {
			if i < len(a) {
				return a[i]
			}
			return 0
		}
		enabled := get(state) != 0
		actCode := get(spdAct)
		mbps, duplex, _ := speedDetails(actCode)
		_, _, cfgLabel := speedDetails(get(spdCfg))
		p := SwitchPort{Port: i + 1, Enabled: enabled, LinkUp: actCode != 0, SpeedMbps: mbps, Duplex: duplex, ConfigSpeed: cfgLabel, FlowControl: get(fcAct) != 0}
		if portNames != nil {
			p.Label = strings.TrimSpace(portNames[strconv.Itoa(i+1)])
		}
		if len(pkts) > i*2 {
			p.TxPackets = pkts[i*2]
		}
		if len(pkts) > i*2+1 {
			p.RxPackets = pkts[i*2+1]
		}
		switch {
		case !enabled:
			p.Health = "disabled"
		case !p.LinkUp:
			p.Health = "down"
		case mbps >= 1000:
			p.Health = "good"
		case mbps > 0:
			p.Health = "slow"
		default:
			p.Health = "unknown"
		}
		result.Ports = append(result.Ports, p)
	}
	return result
}
