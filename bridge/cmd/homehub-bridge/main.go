package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"

	"homehub/bridge/internal/api"
	"homehub/bridge/internal/cloudstate"
	"homehub/bridge/internal/config"
	"homehub/bridge/internal/copyjob"
	"homehub/bridge/internal/media"
	"homehub/bridge/internal/network"
	"homehub/bridge/internal/printer"
	"homehub/bridge/internal/transmission"
	"homehub/bridge/internal/vacuum"
	"homehub/bridge/internal/vault"
)

const version = "0.19.0"

type snapshot struct {
	BridgeID  string `json:"bridgeId"`
	Timestamp string `json:"timestamp"`
	KD20      struct {
		Online   bool                   `json:"online"`
		RPCURL   string                 `json:"rpcUrl"`
		Torrents []transmission.Torrent `json:"torrents"`
	} `json:"kd20"`
	WD struct {
		Online     bool   `json:"online"`
		FreeBytes  uint64 `json:"freeBytes"`
		TotalBytes uint64 `json:"totalBytes"`
		MediaRoot  string `json:"mediaRoot"`
	} `json:"wd"`
	Printer         printer.Status                `json:"printer"`
	Network         []network.Status              `json:"network,omitempty"`
	Vacuum          vacuum.Status                 `json:"vacuum"`
	Media           *media.Snapshot               `json:"media,omitempty"`
	Vault           *vault.PublicStatus           `json:"vault,omitempty"`
	PersistentState json.RawMessage               `json:"persistentState,omitempty"`
	LocalCopies     map[string]copyjob.CopyRecord `json:"localCopies,omitempty"`
}

func mediaConfig(cfg config.Config, vlt *vault.Service) media.Config {
	roots := make([]media.Root, 0, len(cfg.Media.Roots))
	for _, r := range cfg.Media.Roots {
		roots = append(roots, media.Root{ID: r.ID, Name: r.Name, Path: r.Path})
	}
	return media.Config{
		Enabled: cfg.Media.Enabled, Listen: cfg.Media.Listen, PublicBaseURL: cfg.Media.PublicBaseURL,
		Secret: cfg.Media.Secret, MediaRoot: cfg.WD.MediaRoot, Roots: roots, MaxItems: cfg.Media.MaxItems, Vault: vlt,
	}
}

var lastMediaScanAt time.Time
var lastMediaSentAt time.Time
var lastMediaFingerprint string

func mediaFingerprint(s media.Snapshot) string {
	h := sha256.New()
	fmt.Fprintf(h, "%t|%t|%s|%d|%t|%s\n", s.Enabled, s.Online, s.PublicBaseURL, s.Count, s.Truncated, s.Error)
	for _, item := range s.Items {
		fmt.Fprintf(h, "%s|%d|%s\n", item.RelativePath, item.SizeBytes, item.ModifiedAt)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func mediaForSnapshot(cfg config.Config) *media.Snapshot {
	now := time.Now()
	if !lastMediaScanAt.IsZero() && now.Sub(lastMediaScanAt) < 60*time.Second {
		return nil
	}
	lastMediaScanAt = now
	s := media.Scan(mediaConfig(cfg, nil))
	fp := mediaFingerprint(s)
	if fp == lastMediaFingerprint && !lastMediaSentAt.IsZero() && now.Sub(lastMediaSentAt) < 5*time.Minute {
		return nil
	}
	lastMediaFingerprint = fp
	lastMediaSentAt = now
	return &s
}

func fsStats(path string) (free, total uint64, ok bool) {
	var s syscall.Statfs_t
	if err := syscall.Statfs(path, &s); err != nil {
		return 0, 0, false
	}
	return s.Bavail * uint64(s.Bsize), s.Blocks * uint64(s.Bsize), true
}

func replaceURLHost(raw, ip string) string {
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(ip) == "" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return raw
	}
	if port := u.Port(); port != "" {
		u.Host = net.JoinHostPort(ip, port)
	} else {
		u.Host = ip
	}
	return u.String()
}

// effectiveNetworkConfig resolves infrastructure by stable MAC identity before
// every cloud cycle. Fixed DHCP reservations are still recommended, but a
// router restart or changed lease no longer leaves the KD20/media endpoints
// pinned to an obsolete address.
func effectiveNetworkConfig(cfg config.Config) config.Config {
	out := cfg
	oldKD := strings.TrimSpace(cfg.KD20.SMBHost)
	if ip := network.ResolveDeviceIP(cfg, "kd20"); ip != "" {
		out.KD20.SMBHost = ip
		out.KD20.RPCURL = replaceURLHost(cfg.KD20.RPCURL, ip)
		if strings.TrimSpace(cfg.Printer.Host) == "" || strings.TrimSpace(cfg.Printer.Host) == oldKD {
			out.Printer.Host = ip
		}
		if strings.TrimSpace(cfg.Printer.AdminURL) == "" || (oldKD != "" && strings.Contains(cfg.Printer.AdminURL, oldKD)) {
			out.Printer.AdminURL = replaceURLHost(cfg.Printer.AdminURL, ip)
		}
	}
	// The media service runs on the WD itself. If the WD receives a new DHCP
	// lease, publish signed links with its current local address.
	if ip := network.LocalIPv4(cfg.Network.Subnet); ip != "" {
		out.Media.PublicBaseURL = replaceURLHost(cfg.Media.PublicBaseURL, ip)
	}
	return out
}

func vaultInventory(cfg config.Config) []vault.InventoryItem {
	items := make([]vault.InventoryItem, 0, len(cfg.Network.Devices)+2)
	for _, d := range cfg.Network.Devices {
		switch d.Kind {
		case "gateway", "router", "extender", "switch", "nas":
			items = append(items, vault.InventoryItem{ID: d.ID, Label: d.Name, Kind: d.Kind, AdminURL: d.AdminURL, IP: d.IP})
		}
	}
	// KD20 and WD are already network inventory entries in the current home setup,
	// but these guards make the vault useful with older/custom configs too.
	has := func(id string) bool {
		for _, i := range items {
			if i.ID == id {
				return true
			}
		}
		return false
	}
	if !has("kd20") {
		items = append(items, vault.InventoryItem{ID: "kd20", Label: "KD20 / oldnas", Kind: "nas", AdminURL: "http://" + cfg.KD20.SMBHost, IP: cfg.KD20.SMBHost})
	}
	if !has("wd-my-cloud") {
		base := strings.TrimRight(cfg.Media.PublicBaseURL, "/")
		ip := network.LocalIPv4(cfg.Network.Subnet)
		items = append(items, vault.InventoryItem{ID: "wd-my-cloud", Label: "WD My Cloud", Kind: "nas", AdminURL: "http://" + ip, IP: ip})
		_ = base
	}
	return items
}

func prepareVault(cfg *config.Config) *vault.Service {
	if cfg == nil || !cfg.Vault.Enabled {
		return nil
	}
	localBase := strings.TrimRight(cfg.Media.PublicBaseURL, "/")
	if localBase == "" {
		if ip := network.LocalIPv4(cfg.Network.Subnet); ip != "" {
			localBase = "http://" + ip + ":8788"
		}
	}
	vlt, err := vault.OpenOrCreate(vault.Config{Enabled: true, File: cfg.Vault.File, KeyFile: cfg.Vault.KeyFile, PinFile: cfg.Vault.PinFile, SessionMinutes: cfg.Vault.SessionMinutes, LocalBaseURL: localBase})
	if err != nil {
		log.Printf("VAULT: %v", err)
		return nil
	}
	vlt.SetInventory(vaultInventory(*cfg))
	// v0.18 migrates the old plaintext network-secrets.json into the encrypted vault.
	// The plaintext file is removed only after a successful encrypted save.
	legacy := map[string]vault.Credential{}
	for id, c := range cfg.NetworkCredentials {
		if strings.TrimSpace(c.Username) == "" && strings.TrimSpace(c.Password) == "" {
			continue
		}
		legacy[id] = vault.Credential{ID: id, Username: c.Username, Password: c.Password}
	}
	if n, err := vlt.ImportLegacy(legacy); err != nil {
		log.Printf("VAULT legacy migration: %v", err)
	} else if len(legacy) > 0 {
		current := vlt.Entries()
		fullyImported := true
		for id, c := range legacy {
			got, ok := current[id]
			if !ok || got.Username != c.Username || got.Password != c.Password {
				fullyImported = false
				break
			}
		}
		if fullyImported {
			if err := os.Remove(cfg.Network.SecretsFile); err != nil && !os.IsNotExist(err) {
				log.Printf("VAULT migrated %d credential(s), legacy cleanup: %v", n, err)
			} else {
				log.Printf("VAULT legacy plaintext secrets removed after verified migration (%d new)", n)
			}
		}
	}
	if cfg.NetworkCredentials == nil {
		cfg.NetworkCredentials = map[string]config.NetworkCredential{}
	}
	for id, c := range vlt.Entries() {
		cfg.NetworkCredentials[id] = config.NetworkCredential{Username: c.Username, Password: c.Password}
	}
	return vlt
}

func main() {
	cfgPath := flag.String("config", "./config.json", "config file")
	check := flag.Bool("check", false, "check WD/KD20 connectivity and exit")
	once := flag.Bool("once", false, "send one cloud snapshot / process commands once and exit")
	list := flag.Bool("list", false, "list KD20 torrents and exit")
	copyID := flag.Int("copy-torrent", 0, "copy one completed torrent ID to WD and exit")
	destination := flag.String("destination", "", "WD destination relative to mediaRoot")
	watchLocal := flag.Bool("watch-local", false, "run local completed-torrent auto-copy loop without cloud")
	showVersion := flag.Bool("version", false, "print version and exit")
	vaultStatus := flag.Bool("vault-status", false, "print local credentials vault status and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("homehub-bridge %s %s/%s\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}

	localMode := *check || *list || *copyID > 0 || *watchLocal || *vaultStatus
	cfg, err := config.Load(*cfgPath, !localMode)
	if err != nil {
		log.Fatal(err)
	}
	vlt := prepareVault(&cfg)
	if *vaultStatus {
		if vlt == nil {
			log.Printf("VAULT: unavailable")
			return
		}
		st := vlt.PublicStatus()
		log.Printf("VAULT: initialized=%t pinConfigured=%t entries=%d localUrl=%s", st.Initialized, st.PINConfigured, len(st.Entries), st.LocalURL)
		for _, e := range st.Entries {
			log.Printf("VAULT ENTRY: id=%s label=%q saved=%t username=%q hasPassword=%t admin=%s", e.ID, e.Label, e.Saved, e.Username, e.HasPassword, e.AdminURL)
		}
		return
	}
	localEffective := effectiveNetworkConfig(cfg)
	tr := transmission.New(localEffective.KD20.RPCURL, localEffective.KD20.Username, localEffective.KD20.Password)

	if *check {
		runCheck(localEffective, tr)
		return
	}
	if *list {
		runList(tr)
		return
	}
	if *copyID > 0 {
		dest := *destination
		if dest == "" {
			dest = localEffective.AutoCopy.Destination
		}
		t, err := tr.Detail(*copyID)
		if err != nil {
			log.Fatal(err)
		}
		if t.PercentDone < 1 {
			log.Fatalf("torrent %d is not complete (%.1f%%)", t.ID, t.PercentDone*100)
		}
		msg, err := copyjob.Run(localEffective, t, dest, nil)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("COPY OK: %s", msg)
		return
	}
	if *watchLocal {
		log.Printf("HomeHub bridge %s local watcher starting; destination=%s state=%s", version, localEffective.AutoCopy.Destination, localEffective.AutoCopy.StateFile)
		for {
			effective := effectiveNetworkConfig(cfg)
			tr = transmission.New(effective.KD20.RPCURL, effective.KD20.Username, effective.KD20.Password)
			runAutoCopy(effective, tr)
			time.Sleep(time.Duration(cfg.PollSeconds) * time.Second)
		}
	}

	if !*once {
		media.StartServer(mediaConfig(cfg, vlt))
	}

	cloud := api.New(cfg.ServerURL, cfg.Token, cfg.ServerTLSInsecure)
	log.Printf("HomeHub bridge %s (%s) starting", cfg.BridgeID, version)

	// Presence reporting must not be blocked by slow LAN probes, SMB copies,
	// or command execution.
	go func() {
		const heartbeatEvery = 20 * time.Second
		ticker := time.NewTicker(heartbeatEvery)
		defer ticker.Stop()
		for {
			if err := cloud.Heartbeat(cfg.BridgeID, version); err != nil {
				log.Printf("heartbeat: %v", err)
			}
			<-ticker.C
		}
	}()

	for {
		runOnce(cfg, cloud, vlt)
		if *once {
			return
		}
		time.Sleep(time.Duration(cfg.PollSeconds) * time.Second)
	}
}

func runCheck(cfg config.Config, tr *transmission.Client) {
	failed := false
	log.Printf("HomeHub bridge %s check on %s/%s", version, runtime.GOOS, runtime.GOARCH)
	if free, total, ok := fsStats(cfg.WD.MediaRoot); ok {
		log.Printf("WD OK: %s free=%d total=%d", cfg.WD.MediaRoot, free, total)
	} else {
		log.Printf("WD ERROR: cannot stat %s", cfg.WD.MediaRoot)
		failed = true
	}
	if ts, err := tr.List(); err != nil {
		log.Printf("KD20 RPC ERROR: %v", err)
		failed = true
	} else {
		log.Printf("KD20 RPC OK: %d torrents", len(ts))
	}
	if names, err := copyjob.SourcePreview(cfg, 20); err != nil {
		log.Printf("KD20 SMB ERROR: %v", err)
		failed = true
	} else {
		log.Printf("KD20 SMB OK: first entries: %v", names)
	}
	ps := printer.Probe(cfg)
	log.Printf("KD20 PRINTER: configured=%t online=%t ports=%v protocol=%s", ps.Configured, ps.Online, ps.DetectedPorts, ps.Protocol)
	for _, ns := range network.Probe(cfg) {
		log.Printf("NETWORK: %s kind=%s online=%t ip=%s latency=%.1fms", ns.Name, ns.Kind, ns.Online, ns.IP, ns.LatencyMs)
	}
	vs := vacuum.Probe(cfg)
	log.Printf("XIAOMI VACUUM: configured=%t online=%t controlReady=%t ip=%s note=%s", vs.Configured, vs.Online, vs.ControlReady, vs.IP, vs.Note)
	ms := media.Scan(mediaConfig(cfg, nil))
	log.Printf("MEDIA: enabled=%t online=%t items=%d url=%s error=%s", ms.Enabled, ms.Online, ms.Count, ms.PublicBaseURL, ms.Error)
	if failed {
		os.Exit(2)
	}
}

func runList(tr *transmission.Client) {
	ts, err := tr.List()
	if err != nil {
		log.Fatal(err)
	}
	if len(ts) == 0 {
		fmt.Println("No torrents.")
		return
	}
	fmt.Printf("%-5s %-8s %-12s %s\n", "ID", "DONE", "STATUS", "NAME")
	for _, t := range ts {
		fmt.Printf("%-5d %6.1f%% %-12d %s\n", t.ID, t.PercentDone*100, t.Status, t.Name)
	}
}

func runAutoCopy(cfg config.Config, tr *transmission.Client) {
	ts, err := tr.List()
	if err != nil {
		log.Printf("autocopy list: %v", err)
		return
	}
	st, err := copyjob.LoadState(cfg.AutoCopy.StateFile)
	if err != nil {
		log.Printf("autocopy state: %v", err)
		return
	}
	changed := false
	for _, t := range ts {
		if t.PercentDone < 1 || t.HashString == "" {
			continue
		}
		if _, ok := st.Copied[t.HashString]; ok {
			continue
		}
		detail, err := tr.Detail(t.ID)
		if err != nil {
			log.Printf("autocopy detail %d: %v", t.ID, err)
			continue
		}
		log.Printf("AUTOCOPY START: id=%d name=%q -> %s", detail.ID, detail.Name, cfg.AutoCopy.Destination)
		msg, err := copyjob.Run(cfg, detail, cfg.AutoCopy.Destination, nil)
		if err != nil {
			log.Printf("AUTOCOPY ERROR id=%d: %v", detail.ID, err)
			continue
		}
		copyjob.MarkCopied(&st, detail.HashString, detail.Name, cfg.AutoCopy.Destination)
		changed = true
		log.Printf("AUTOCOPY OK id=%d: %s", detail.ID, msg)
	}
	if changed {
		if err := copyjob.SaveState(cfg.AutoCopy.StateFile, st); err != nil {
			log.Printf("autocopy save state: %v", err)
		}
	}
}

func runOnce(cfg config.Config, cloud *api.Client, vlt *vault.Service) {
	localState := cloudstate.Load(cfg.CloudStateFile)
	effective := effectiveNetworkConfig(cfg)
	tr := transmission.New(effective.KD20.RPCURL, effective.KD20.Username, effective.KD20.Password)
	if localState.Settings != nil {
		effective.AutoCopy.Enabled = localState.Settings.AutoCopyEnabled
		if localState.Settings.AutoCopyDestination != "" {
			effective.AutoCopy.Destination = localState.Settings.AutoCopyDestination
		}
	}
	if effective.AutoCopy.Enabled {
		runAutoCopy(effective, tr)
	}
	ts, terr := tr.List()
	var s snapshot
	s.BridgeID = cfg.BridgeID
	s.Timestamp = time.Now().UTC().Format(time.RFC3339)
	s.KD20.RPCURL = effective.KD20.RPCURL
	s.KD20.Online = terr == nil
	if terr == nil {
		s.KD20.Torrents = ts
	} else {
		log.Printf("KD20: %v", terr)
	}
	s.WD.MediaRoot = effective.WD.MediaRoot
	s.WD.FreeBytes, s.WD.TotalBytes, s.WD.Online = fsStats(effective.WD.MediaRoot)
	s.Printer = printer.Probe(effective)
	s.Network = network.Probe(effective)
	s.Vacuum = vacuum.Probe(effective)
	s.Media = mediaForSnapshot(effective)
	if vlt != nil {
		st := vlt.PublicStatus()
		s.Vault = &st
	}
	s.PersistentState = localState.PersistentState
	if copyState, err := copyjob.LoadState(effective.AutoCopy.StateFile); err == nil {
		s.LocalCopies = copyState.Copied
	}
	resp, err := cloud.Snapshot(s)
	if err != nil {
		log.Printf("snapshot: %v", err)
	} else {
		state := cloudstate.File{
			Settings:        &cloudstate.Settings{AutoCopyEnabled: resp.Settings.AutoCopyEnabled, AutoCopyDestination: resp.Settings.AutoCopyDestination},
			PersistentState: resp.PersistentState,
		}
		if err := cloudstate.Save(cfg.CloudStateFile, state); err != nil {
			log.Printf("cloud state save: %v", err)
		}
	}
	cmds, err := cloud.Commands(cfg.BridgeID)
	if err != nil {
		log.Printf("commands: %v", err)
		return
	}
	for _, cmd := range cmds {
		log.Printf("COMMAND START id=%s type=%s", cmd.ID, cmd.Type)
		msg, ok := handle(effective, tr, cmd, func(p copyjob.Progress) {
			if err := cloud.Progress(cmd.ID, p); err != nil {
				log.Printf("progress id=%s: %v", cmd.ID, err)
			}
		})
		if ok {
			log.Printf("COMMAND OK id=%s type=%s: %s", cmd.ID, cmd.Type, msg)
		} else {
			log.Printf("COMMAND ERROR id=%s type=%s: %s", cmd.ID, cmd.Type, msg)
		}
		completeResp, err := cloud.Complete(cmd.ID, ok, msg)
		if err != nil {
			log.Printf("complete: %v", err)
		} else {
			state := cloudstate.File{Settings: &cloudstate.Settings{AutoCopyEnabled: completeResp.Settings.AutoCopyEnabled, AutoCopyDestination: completeResp.Settings.AutoCopyDestination}, PersistentState: completeResp.PersistentState}
			if err := cloudstate.Save(cfg.CloudStateFile, state); err != nil {
				log.Printf("cloud state save after command: %v", err)
			}
		}
	}
}

func handle(cfg config.Config, tr *transmission.Client, cmd api.Command, progress copyjob.ProgressFunc) (string, bool) {
	switch cmd.Type {
	case "torrent.addMagnet":
		m, _ := cmd.Payload["magnet"].(string)
		if err := tr.AddMagnet(m); err != nil {
			return err.Error(), false
		}
		return "magnet added", true
	case "torrent.addFile":
		m, _ := cmd.Payload["metainfo"].(string)
		if err := tr.AddMetainfo(m); err != nil {
			return err.Error(), false
		}
		return "torrent file added", true
	case "torrent.remove":
		idFloat, ok := cmd.Payload["torrentId"].(float64)
		if !ok {
			return "missing torrentId", false
		}
		deleteData, _ := cmd.Payload["deleteData"].(bool)
		if err := tr.Remove(int(idFloat), deleteData); err != nil {
			return err.Error(), false
		}
		if deleteData {
			return "torrent and KD20 local data removed", true
		}
		return "torrent removed; KD20 local data kept", true
	case "vacuum.start", "vacuum.pause", "vacuum.stop", "vacuum.dock":
		action := strings.TrimPrefix(cmd.Type, "vacuum.")
		msg, err := vacuum.Command(cfg, action)
		if err != nil {
			return err.Error(), false
		}
		return msg, true
	case "torrent.copyToWd":
		idFloat, ok := cmd.Payload["torrentId"].(float64)
		if !ok {
			return "missing torrentId", false
		}
		dest, _ := cmd.Payload["destination"].(string)
		t, err := tr.Detail(int(idFloat))
		if err != nil {
			return err.Error(), false
		}
		if t.PercentDone < 1 {
			return "torrent not complete", false
		}
		msg, err := copyjob.Run(cfg, t, dest, progress)
		if err != nil {
			return err.Error(), false
		}
		return msg, true
	default:
		return fmt.Sprintf("unknown command %s", cmd.Type), false
	}
}

func init() { log.SetOutput(os.Stdout); log.SetFlags(log.LstdFlags | log.Lmicroseconds) }
