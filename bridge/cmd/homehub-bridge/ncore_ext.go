package main

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"homehub/bridge/internal/api"
	"homehub/bridge/internal/config"
	"homehub/bridge/internal/ncore"
	"homehub/bridge/internal/transmission"
	"homehub/bridge/internal/vault"
)

const ncoreBridgeVersion = "0.24.0"

func ncoreConfigPath() string {
	for i, arg := range os.Args {
		if arg == "-config" && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
		if strings.HasPrefix(arg, "-config=") {
			return strings.TrimPrefix(arg, "-config=")
		}
	}
	return "./config.json"
}

func ncoreDaemonMode() bool {
	for _, arg := range os.Args[1:] {
		name := strings.SplitN(arg, "=", 2)[0]
		switch name {
		case "-version", "--version", "-check", "-list", "-copy-torrent", "-watch-local", "-vault-status", "-once":
			return false
		}
	}
	return true
}

func ncoreCredential(cfg config.Config) (vault.Credential, bool) {
	if !cfg.Vault.Enabled {
		return vault.Credential{}, false
	}
	vlt, err := vault.OpenOrCreate(vault.Config{
		Enabled: true, File: cfg.Vault.File, KeyFile: cfg.Vault.KeyFile, PinFile: cfg.Vault.PinFile,
		SessionMinutes: cfg.Vault.SessionMinutes,
	})
	if err != nil {
		return vault.Credential{}, false
	}
	cred, ok := vlt.Get("ncore")
	if !ok || strings.TrimSpace(cred.Password) == "" {
		return vault.Credential{}, false
	}
	return cred, true
}

func payloadString(cmd api.Command, key string) string {
	v, _ := cmd.Payload[key].(string)
	return strings.TrimSpace(v)
}

func payloadInt(cmd api.Command, key string, fallback int) int {
	v, ok := cmd.Payload[key]
	if !ok {
		return fallback
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		if x, err := strconv.Atoi(n); err == nil {
			return x
		}
	}
	return fallback
}

func handleNcoreBridgeCommand(cfg config.Config, cmd api.Command, cred vault.Credential) (string, bool) {
	ua := ""
	// The Vault username field is optional. If a browser User-Agent is stored
	// there, use it; otherwise the nCore client uses a safe modern default.
	if strings.HasPrefix(strings.TrimSpace(cred.Username), "Mozilla/") {
		ua = strings.TrimSpace(cred.Username)
	}
	client := ncore.New(cred.Password, ua)

	switch cmd.Type {
	case "ncore.search":
		query := payloadString(cmd, "query")
		category := payloadString(cmd, "category")
		limit := payloadInt(cmd, "limit", 25)
		results, err := client.Search(query, category, limit)
		if err != nil {
			return err.Error(), false
		}
		data, err := json.Marshal(map[string]any{
			"results": results,
			"mode": "wd-bridge",
			"bridgeVersion": ncoreBridgeVersion,
		})
		if err != nil {
			return "ncore_result_encode_failed", false
		}
		return string(data), true

	case "ncore.download":
		id := payloadString(cmd, "id")
		if id == "" {
			return "invalid_torrent_id", false
		}
		data, err := client.Download(id)
		if err != nil {
			return err.Error(), false
		}
		effective := effectiveNetworkConfig(cfg)
		tr := transmission.New(effective.KD20.RPCURL, effective.KD20.Username, effective.KD20.Password)
		if err := tr.AddMetainfo(base64.StdEncoding.EncodeToString(data)); err != nil {
			return "kd20_add_failed: " + err.Error(), false
		}
		return `{"ok":true,"mode":"wd-bridge","message":"torrent added to KD20"}`, true
	default:
		return "unknown_ncore_command", false
	}
}

func runNcoreBridgeLoop(cfg config.Config) {
	cloud := api.New(cfg.ServerURL, cfg.Token, cfg.ServerTLSInsecure)
	log.Printf("NCORE: WD bridge extension %s starting", ncoreBridgeVersion)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		cred, configured := ncoreCredential(cfg)
		cmds, err := cloud.NcoreCommands(cfg.BridgeID, ncoreBridgeVersion, configured)
		if err != nil {
			// Render may still be deploying the matching API. Keep this quiet enough
			// not to bury the normal bridge log.
			log.Printf("NCORE broker: %v", err)
		} else {
			for _, cmd := range cmds {
				log.Printf("NCORE COMMAND START id=%s type=%s", cmd.ID, cmd.Type)
				if !configured {
					_ = cloud.NcoreComplete(cmd.ID, false, "ncore_bridge_credentials_missing")
					continue
				}
				msg, ok := handleNcoreBridgeCommand(cfg, cmd, cred)
				if err := cloud.NcoreComplete(cmd.ID, ok, msg); err != nil {
					log.Printf("NCORE complete id=%s: %v", cmd.ID, err)
				} else if ok {
					log.Printf("NCORE COMMAND OK id=%s type=%s", cmd.ID, cmd.Type)
				} else {
					log.Printf("NCORE COMMAND ERROR id=%s type=%s: %s", cmd.ID, cmd.Type, msg)
				}
			}
		}
		<-ticker.C
	}
}

func init() {
	if !ncoreDaemonMode() {
		return
	}
	go func() {
		// Let main() finish its normal startup first. This extension deliberately
		// uses the same config but an independent short-lived broker loop.
		time.Sleep(1500 * time.Millisecond)
		cfg, err := config.Load(ncoreConfigPath(), true)
		if err != nil {
			log.Printf("NCORE: config: %v", err)
			return
		}
		runNcoreBridgeLoop(cfg)
	}()
}
