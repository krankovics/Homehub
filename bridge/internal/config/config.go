package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	BridgeID          string `json:"bridgeId"`
	ServerURL         string `json:"serverUrl"`
	Token             string `json:"token"`
	ServerTLSInsecure bool   `json:"serverTlsInsecure"`
	PollSeconds       int    `json:"pollSeconds"`
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
	Network struct {
		Enabled bool   `json:"enabled"`
		Subnet  string `json:"subnet"`
		Devices []struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			Kind       string `json:"kind"`
			IP         string `json:"ip"`
			MAC        string `json:"mac"`
			AdminURL   string `json:"adminUrl"`
			ProbePorts []int  `json:"probePorts"`
		} `json:"devices"`
	} `json:"network"`
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
	if c.PollSeconds <= 0 {
		c.PollSeconds = 3
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
	if len(c.Network.Devices) == 0 {
		c.Network.Enabled = true
		type target = struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			Kind       string `json:"kind"`
			IP         string `json:"ip"`
			MAC        string `json:"mac"`
			AdminURL   string `json:"adminUrl"`
			ProbePorts []int  `json:"probePorts"`
		}
		c.Network.Devices = []target{
			{ID: "technicolor-fga2233", Name: "Technicolor FGA2233", Kind: "gateway", IP: "192.168.1.1", AdminURL: "http://192.168.1.1", ProbePorts: []int{80, 443}},
			{ID: "archer-c6", Name: "Archer C6", Kind: "router", IP: "192.168.1.129", MAC: "5C-62-8B-95-64-EA", AdminURL: "http://192.168.1.129", ProbePorts: []int{80, 443}},
			{ID: "re220", Name: "TP-Link RE220", Kind: "extender", MAC: "B4-B0-24-EF-3C-12", ProbePorts: []int{80, 443}},
			{ID: "re315-1", Name: "TP-Link RE315 #1", Kind: "extender", MAC: "DC-62-79-DD-93-86", ProbePorts: []int{80, 443}},
			{ID: "re315-2", Name: "TP-Link RE315 #2", Kind: "extender", MAC: "0C-EF-15-1B-FE-CE", ProbePorts: []int{80, 443}},
		}
	}
	for i := range c.Network.Devices {
		if len(c.Network.Devices[i].ProbePorts) == 0 {
			c.Network.Devices[i].ProbePorts = []int{80, 443}
		}
	}
	return c, nil
}
