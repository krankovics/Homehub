package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type XiaomiMiotProperty struct {
	Name  string  `json:"name"`
	SIID  int     `json:"siid"`
	PIID  int     `json:"piid"`
	Unit  string  `json:"unit"`
	Scale float64 `json:"scale"`
}

type XiaomiMiotAction struct {
	SIID int `json:"siid"`
	AIID int `json:"aiid"`
}

type NetworkCredential struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type NetworkSecrets struct {
	Devices map[string]NetworkCredential `json:"devices"`
}

type XiaomiVacuumConfig struct {
	Enabled    bool                 `json:"enabled"`
	Name       string               `json:"name"`
	Model      string               `json:"model"`
	IP         string               `json:"ip"`
	Token      string               `json:"token"`
	Properties []XiaomiMiotProperty `json:"properties"`
	Actions    struct {
		Start XiaomiMiotAction `json:"start"`
		Pause XiaomiMiotAction `json:"pause"`
		Stop  XiaomiMiotAction `json:"stop"`
		Dock  XiaomiMiotAction `json:"dock"`
	} `json:"actions"`
	StateMap map[string]string `json:"stateMap"`
}

type Config struct {
	BridgeID          string `json:"bridgeId"`
	ServerURL         string `json:"serverUrl"`
	Token             string `json:"token"`
	ServerTLSInsecure bool   `json:"serverTlsInsecure"`
	PollSeconds       int    `json:"pollSeconds"`
	CloudStateFile    string `json:"cloudStateFile"`
	KD20              struct {
		RPCURL      string `json:"rpcUrl"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		SMBHost     string `json:"smbHost"`
		SMBUser     string `json:"smbUser"`
		SMBPassword string `json:"smbPassword"`
		SMBShare    string `json:"smbShare"`
		SMBMount    string `json:"smbMount"`
		SMBBase     string `json:"smbBase"`
		SMBOptions  string `json:"smbOptions"`
	} `json:"kd20"`
	WD struct {
		MediaRoot    string `json:"mediaRoot"`
		ReserveBytes uint64 `json:"reserveBytes"`
		Owner        string `json:"owner"`
		Group        string `json:"group"`
		DirMode      string `json:"dirMode"`
		FileMode     string `json:"fileMode"`
	} `json:"wd"`
	AutoCopy struct {
		Enabled     bool   `json:"enabled"`
		Destination string `json:"destination"`
		StateFile   string `json:"stateFile"`
	} `json:"autoCopy"`
	Printer struct {
		Enabled    bool   `json:"enabled"`
		Host       string `json:"host"`
		AdminURL   string `json:"adminUrl"`
		ProbePorts []int  `json:"probePorts"`
	} `json:"printer"`
	XiaomiVacuum XiaomiVacuumConfig `json:"xiaomiVacuum"`
	Media        struct {
		Enabled       bool   `json:"enabled"`
		Listen        string `json:"listen"`
		PublicBaseURL string `json:"publicBaseUrl"`
		Secret        string `json:"secret"`
		MaxItems      int    `json:"maxItems"`
		Roots         []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"roots"`
	} `json:"media"`
	Network struct {
		Enabled     bool   `json:"enabled"`
		Subnet      string `json:"subnet"`
		SecretsFile string `json:"secretsFile"`
		Devices     []struct {
			ID         string            `json:"id"`
			Name       string            `json:"name"`
			Kind       string            `json:"kind"`
			IP         string            `json:"ip"`
			MAC        string            `json:"mac"`
			AdminURL   string            `json:"adminUrl"`
			ProbePorts []int             `json:"probePorts"`
			Adapter    string            `json:"adapter"`
			PortNames  map[string]string `json:"portNames"`
		} `json:"devices"`
	} `json:"network"`
	NetworkCredentials map[string]NetworkCredential `json:"-"`
}

func Load(path string, requireCloud bool) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if requireCloud && (strings.TrimSpace(c.BridgeID) == "" || strings.TrimSpace(c.ServerURL) == "" || strings.TrimSpace(c.Token) == "") {
		return c, fmt.Errorf("bridgeId, serverUrl and token are required")
	}
	if c.PollSeconds <= 3 {
		c.PollSeconds = 30
	}
	if strings.TrimSpace(c.CloudStateFile) == "" {
		c.CloudStateFile = "/DataVolume/homehub/server-state.json"
	}
	if c.KD20.SMBMount == "" {
		c.KD20.SMBMount = "/tmp/homehub-kd20"
	}
	if strings.TrimSpace(c.KD20.RPCURL) == "" {
		return c, fmt.Errorf("kd20.rpcUrl is required")
	}
	if strings.TrimSpace(c.KD20.SMBHost) == "" || strings.TrimSpace(c.KD20.SMBShare) == "" {
		return c, fmt.Errorf("kd20.smbHost and kd20.smbShare are required")
	}
	if strings.TrimSpace(c.WD.MediaRoot) == "" {
		return c, fmt.Errorf("wd.mediaRoot is required")
	}
	if c.WD.ReserveBytes == 0 {
		c.WD.ReserveBytes = 10 * 1024 * 1024 * 1024
	}
	if strings.TrimSpace(c.WD.Owner) == "" {
		c.WD.Owner = "nobody"
	}
	if strings.TrimSpace(c.WD.Group) == "" {
		c.WD.Group = "share"
	}
	if strings.TrimSpace(c.WD.DirMode) == "" {
		c.WD.DirMode = "0775"
	}
	if strings.TrimSpace(c.WD.FileMode) == "" {
		c.WD.FileMode = "0664"
	}
	if strings.TrimSpace(c.AutoCopy.Destination) == "" {
		c.AutoCopy.Destination = "Filmek"
	}
	if strings.TrimSpace(c.AutoCopy.StateFile) == "" {
		c.AutoCopy.StateFile = "/DataVolume/homehub/autocopy-state.json"
	}
	mediaUnset := !c.Media.Enabled && strings.TrimSpace(c.Media.Listen) == "" && strings.TrimSpace(c.Media.PublicBaseURL) == "" && strings.TrimSpace(c.Media.Secret) == "" && c.Media.MaxItems == 0 && len(c.Media.Roots) == 0
	if mediaUnset {
		c.Media.Enabled = true
	}
	if strings.TrimSpace(c.Media.Listen) == "" {
		c.Media.Listen = "0.0.0.0:8788"
	}
	if strings.TrimSpace(c.Media.Secret) == "" {
		c.Media.Secret = c.Token
	}
	if c.Media.MaxItems <= 0 {
		c.Media.MaxItems = 2500
	}
	if len(c.Media.Roots) == 0 {
		type mediaRoot = struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
		}
		c.Media.Roots = []mediaRoot{{ID: "movies", Name: "Filmek", Path: c.AutoCopy.Destination}}
	}
	printerUnset := strings.TrimSpace(c.Printer.Host) == "" && strings.TrimSpace(c.Printer.AdminURL) == "" && len(c.Printer.ProbePorts) == 0
	if printerUnset {
		c.Printer.Enabled = true
	}
	if strings.TrimSpace(c.Printer.Host) == "" {
		c.Printer.Host = c.KD20.SMBHost
	}
	if strings.TrimSpace(c.Printer.AdminURL) == "" && c.Printer.Host != "" {
		c.Printer.AdminURL = "http://" + c.Printer.Host
	}
	if len(c.Printer.ProbePorts) == 0 {
		c.Printer.ProbePorts = []int{9100, 515, 631}
	}
	if strings.TrimSpace(c.Network.Subnet) == "" {
		c.Network.Subnet = "192.168.1.0/24"
	}
	if strings.TrimSpace(c.Network.SecretsFile) == "" {
		c.Network.SecretsFile = "/DataVolume/homehub/network-secrets.json"
	}
	c.NetworkCredentials = map[string]NetworkCredential{}
	if secretBytes, err := os.ReadFile(c.Network.SecretsFile); err == nil {
		var secrets NetworkSecrets
		if json.Unmarshal(secretBytes, &secrets) == nil && secrets.Devices != nil {
			c.NetworkCredentials = secrets.Devices
		}
	}
	if len(c.Network.Devices) == 0 {
		c.Network.Enabled = true
		type target = struct {
			ID         string            `json:"id"`
			Name       string            `json:"name"`
			Kind       string            `json:"kind"`
			IP         string            `json:"ip"`
			MAC        string            `json:"mac"`
			AdminURL   string            `json:"adminUrl"`
			ProbePorts []int             `json:"probePorts"`
			Adapter    string            `json:"adapter"`
			PortNames  map[string]string `json:"portNames"`
		}
		c.Network.Devices = []target{
			{ID: "technicolor-fga2233", Name: "Technicolor FGA2233", Kind: "gateway", IP: "192.168.1.1", AdminURL: "http://192.168.1.1", ProbePorts: []int{80, 443}},
			{ID: "archer-c6", Name: "Archer C6", Kind: "router", IP: "192.168.1.129", MAC: "5C-62-8B-95-64-EA", AdminURL: "http://192.168.1.129", ProbePorts: []int{80, 443}},
			{ID: "re220", Name: "TP-Link RE220", Kind: "extender", MAC: "B4-B0-24-EF-3C-12", ProbePorts: []int{80, 443}},
			{ID: "re315-1", Name: "TP-Link RE315 #1", Kind: "extender", MAC: "DC-62-79-DD-93-86", ProbePorts: []int{80, 443}},
			{ID: "re315-2", Name: "TP-Link RE315 #2", Kind: "extender", MAC: "0C-EF-15-1B-FE-CE", ProbePorts: []int{80, 443}},
		}
	}
	// Merge the known home topology into older config files too, so an existing
	// /DataVolume/homehub/config.json does not have to be replaced on upgrade.
	type networkTarget = struct {
		ID         string            `json:"id"`
		Name       string            `json:"name"`
		Kind       string            `json:"kind"`
		IP         string            `json:"ip"`
		MAC        string            `json:"mac"`
		AdminURL   string            `json:"adminUrl"`
		ProbePorts []int             `json:"probePorts"`
		Adapter    string            `json:"adapter"`
		PortNames  map[string]string `json:"portNames"`
	}
	hasDevice := func(id string) bool {
		for _, d := range c.Network.Devices {
			if d.ID == id {
				return true
			}
		}
		return false
	}
	ensure := func(d networkTarget) {
		if !hasDevice(d.ID) {
			c.Network.Devices = append(c.Network.Devices, d)
		}
	}
	ensure(networkTarget{ID: "tl-sg108e", Name: "TL-SG108E", Kind: "switch", IP: "192.168.1.49", MAC: "78:8C:B5:5F:7F:04", AdminURL: "http://192.168.1.49", ProbePorts: []int{80, 443}, Adapter: "tplink-easy-smart"})
	ensure(networkTarget{ID: "kd20", Name: "KD20 / oldnas", Kind: "nas", IP: "192.168.1.12", MAC: "80:EE:73:49:89:0C", AdminURL: "http://192.168.1.12", ProbePorts: []int{80, 9091}})
	ensure(networkTarget{ID: "wd-my-cloud", Name: "WD My Cloud", Kind: "nas", IP: "192.168.1.180", MAC: "00:90:A9:D2:BB:EA", AdminURL: "http://192.168.1.180", ProbePorts: []int{80, 22}})
	if strings.TrimSpace(c.Media.PublicBaseURL) == "" {
		for _, d := range c.Network.Devices {
			if d.ID == "wd-my-cloud" && strings.TrimSpace(d.IP) != "" {
				c.Media.PublicBaseURL = "http://" + strings.TrimSpace(d.IP) + ":8788"
				break
			}
		}
	}
	ensure(networkTarget{ID: "desktop-e6k3sek", Name: "DESKTOP-E6K3SEK", Kind: "computer", IP: "192.168.1.25", MAC: "30:56:0F:22:F7:B9"})
	ensure(networkTarget{ID: "dorkapc", Name: "DorkaPC", Kind: "computer", IP: "192.168.1.210", MAC: "CC:28:AA:35:DB:1D"})
	ensure(networkTarget{ID: "davidgaming", Name: "davidgaming", Kind: "computer", IP: "192.168.1.138", MAC: "30:C5:99:7F:9B:50"})
	ensure(networkTarget{ID: "krankovics-mbp", Name: "Krankovics-MBP", Kind: "computer", IP: "192.168.1.114", MAC: "C4:B3:01:C5:0B:8D"})
	if strings.TrimSpace(c.XiaomiVacuum.Name) == "" {
		c.XiaomiVacuum.Name = "Xiaomi Robot Vacuum E10"
	}
	if strings.TrimSpace(c.XiaomiVacuum.Model) == "" {
		c.XiaomiVacuum.Model = "xiaomi.vacuum.b112"
	}
	if c.XiaomiVacuum.StateMap == nil {
		c.XiaomiVacuum.StateMap = map[string]string{}
	}
	for i := range c.Network.Devices {
		if c.Network.Devices[i].ID == "tl-sg108e" && strings.TrimSpace(c.Network.Devices[i].Adapter) == "" {
			c.Network.Devices[i].Adapter = "tplink-easy-smart"
		}
		if len(c.Network.Devices[i].ProbePorts) == 0 {
			c.Network.Devices[i].ProbePorts = []int{80, 443}
		}
	}
	return c, nil
}
