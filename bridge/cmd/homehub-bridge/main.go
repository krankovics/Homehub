package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"syscall"
	"time"

	"homehub/bridge/internal/api"
	"homehub/bridge/internal/cloudstate"
	"homehub/bridge/internal/config"
	"homehub/bridge/internal/copyjob"
	"homehub/bridge/internal/network"
	"homehub/bridge/internal/printer"
	"homehub/bridge/internal/transmission"
)

const version = "0.9.1"

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
	PersistentState json.RawMessage               `json:"persistentState,omitempty"`
	LocalCopies     map[string]copyjob.CopyRecord `json:"localCopies,omitempty"`
}

func fsStats(path string) (free, total uint64, ok bool) {
	var s syscall.Statfs_t
	if err := syscall.Statfs(path, &s); err != nil {
		return 0, 0, false
	}
	return s.Bavail * uint64(s.Bsize), s.Blocks * uint64(s.Bsize), true
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
	flag.Parse()
	if *showVersion {
		fmt.Printf("homehub-bridge %s %s/%s\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}

	localMode := *check || *list || *copyID > 0 || *watchLocal
	cfg, err := config.Load(*cfgPath, !localMode)
	if err != nil {
		log.Fatal(err)
	}
	tr := transmission.New(cfg.KD20.RPCURL, cfg.KD20.Username, cfg.KD20.Password)

	if *check {
		runCheck(cfg, tr)
		return
	}
	if *list {
		runList(tr)
		return
	}
	if *copyID > 0 {
		dest := *destination
		if dest == "" {
			dest = cfg.AutoCopy.Destination
		}
		t, err := tr.Detail(*copyID)
		if err != nil {
			log.Fatal(err)
		}
		if t.PercentDone < 1 {
			log.Fatalf("torrent %d is not complete (%.1f%%)", t.ID, t.PercentDone*100)
		}
		msg, err := copyjob.Run(cfg, t, dest, nil)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("COPY OK: %s", msg)
		return
	}
	if *watchLocal {
		log.Printf("HomeHub bridge %s local watcher starting; destination=%s state=%s", version, cfg.AutoCopy.Destination, cfg.AutoCopy.StateFile)
		for {
			runAutoCopy(cfg, tr)
			time.Sleep(time.Duration(cfg.PollSeconds) * time.Second)
		}
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
		runOnce(cfg, tr, cloud)
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

func runOnce(cfg config.Config, tr *transmission.Client, cloud *api.Client) {
	localState := cloudstate.Load(cfg.CloudStateFile)
	effective := cfg
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
	s.KD20.RPCURL = cfg.KD20.RPCURL
	s.KD20.Online = terr == nil
	if terr == nil {
		s.KD20.Torrents = ts
	} else {
		log.Printf("KD20: %v", terr)
	}
	s.WD.MediaRoot = cfg.WD.MediaRoot
	s.WD.FreeBytes, s.WD.TotalBytes, s.WD.Online = fsStats(cfg.WD.MediaRoot)
	s.Printer = printer.Probe(cfg)
	s.Network = network.Probe(cfg)
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
