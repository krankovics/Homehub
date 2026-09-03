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
	} `json:"wd"`
	AutoCopy struct {
		Enabled     bool   `json:"enabled"`
		Destination string `json:"destination"`
		StateFile   string `json:"stateFile"`
	} `json:"autoCopy"`
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
		c.WD.ReserveBytes = 10 * 1024 * 1024 * 1024 // keep at least 10 GiB free
	}
	if strings.TrimSpace(c.AutoCopy.Destination) == "" {
		c.AutoCopy.Destination = "Filmek"
	}
	if strings.TrimSpace(c.AutoCopy.StateFile) == "" {
		c.AutoCopy.StateFile = "/DataVolume/homehub/autocopy-state.json"
	}
	return c, nil
}
