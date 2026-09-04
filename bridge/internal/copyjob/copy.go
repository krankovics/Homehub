package copyjob

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"homehub/bridge/internal/config"
	"homehub/bridge/internal/transmission"
)

const cifsMagic = 0xFF534D42

type Progress struct {
	CopiedBytes      int64   `json:"copiedBytes"`
	TotalBytes       int64   `json:"totalBytes"`
	CurrentFile      string  `json:"currentFile,omitempty"`
	FileCopiedBytes  int64   `json:"fileCopiedBytes,omitempty"`
	FileTotalBytes   int64   `json:"fileTotalBytes,omitempty"`
	SpeedBytesPerSec float64 `json:"speedBytesPerSec"`
	EtaSeconds       int64   `json:"etaSeconds"`
	Percent          float64 `json:"percent"`
}

type ProgressFunc func(Progress)

func unescapeMountField(v string) string {
	replacer := strings.NewReplacer(`\\040`, " ", `\\011`, "\t", `\\012`, "\n", `\\134`, `\\`)
	return replacer.Replace(v)
}

func mountedSource(path string) (string, bool) {
	want := filepath.Clean(path)
	if f, err := os.Open("/proc/mounts"); err == nil {
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) < 3 {
				continue
			}
			mountPoint := filepath.Clean(unescapeMountField(fields[1]))
			fsType := fields[2]
			if mountPoint == want && (fsType == "cifs" || fsType == "smbfs") {
				return unescapeMountField(fields[0]), true
			}
		}
	}
	return "", false
}

func mountedAt(path string) bool {
	if _, ok := mountedSource(path); ok {
		return true
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return false
	}
	return uint64(st.Type) == cifsMagic
}

func EnsureMounted(cfg config.Config) error {
	if err := os.MkdirAll(cfg.KD20.SMBMount, 0755); err != nil {
		return err
	}
	remote := fmt.Sprintf("//%s/%s", cfg.KD20.SMBHost, cfg.KD20.SMBShare)
	if source, ok := mountedSource(cfg.KD20.SMBMount); ok {
		if strings.EqualFold(strings.TrimRight(source, "/"), strings.TrimRight(remote, "/")) {
			return nil
		}
		// v0.17: the KD20 may have received a new DHCP lease. Do not keep a
		// stale CIFS mount pinned to the old address.
		out, err := exec.Command("umount", cfg.KD20.SMBMount).CombinedOutput()
		if err != nil {
			return fmt.Errorf("unmount stale KD20 SMB %s (%s): %w: %s", source, remote, err, strings.TrimSpace(string(out)))
		}
	} else if mountedAt(cfg.KD20.SMBMount) {
		return nil
	}

	options := []string{"ro", "iocharset=utf8"}
	if strings.TrimSpace(cfg.KD20.SMBUser) == "" || strings.EqualFold(strings.TrimSpace(cfg.KD20.SMBUser), "guest") {
		options = append(options, "guest")
	} else {
		cred, err := os.CreateTemp("/tmp", "homehub-cifs-credentials-*")
		if err != nil {
			return err
		}
		credPath := cred.Name()
		defer os.Remove(credPath)
		if err := cred.Chmod(0600); err != nil {
			cred.Close()
			return err
		}
		if _, err := fmt.Fprintf(cred, "username=%s\npassword=%s\n", cfg.KD20.SMBUser, cfg.KD20.SMBPassword); err != nil {
			cred.Close()
			return err
		}
		cred.Close()
		options = append(options, "credentials="+credPath)
	}
	if strings.TrimSpace(cfg.KD20.SMBOptions) != "" {
		for _, opt := range strings.Split(cfg.KD20.SMBOptions, ",") {
			if strings.TrimSpace(opt) != "" {
				options = append(options, strings.TrimSpace(opt))
			}
		}
	}
	cmd := exec.Command("mount", "-t", "cifs", remote, cfg.KD20.SMBMount, "-o", strings.Join(options, ","))
	out, err := cmd.CombinedOutput()
	if err != nil {
		if mountedAt(cfg.KD20.SMBMount) {
			return nil
		}
		return fmt.Errorf("mount KD20 SMB failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if !mountedAt(cfg.KD20.SMBMount) {
		return fmt.Errorf("KD20 SMB mount command succeeded but %s is not detected as a CIFS mount", cfg.KD20.SMBMount)
	}
	return nil
}

func SourcePreview(cfg config.Config, limit int) ([]string, error) {
	if err := EnsureMounted(cfg); err != nil {
		return nil, err
	}
	root := filepath.Join(cfg.KD20.SMBMount, filepath.FromSlash(cfg.KD20.SMBBase))
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read KD20 source %s: %w", root, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		suffix := ""
		if e.IsDir() {
			suffix = "/"
		}
		names = append(names, e.Name()+suffix)
	}
	sort.Strings(names)
	if limit > 0 && len(names) > limit {
		names = names[:limit]
	}
	return names, nil
}

func safeRelative(v string) (string, error) {
	v = strings.TrimSpace(strings.ReplaceAll(v, "\\", "/"))
	v = strings.TrimPrefix(v, "/")
	clean := filepath.Clean(filepath.FromSlash(v))
	if clean == "." {
		return "", nil
	}
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("unsafe relative path %q", v)
	}
	return clean, nil
}

func fsFree(path string) (uint64, error) {
	var s syscall.Statfs_t
	if err := syscall.Statfs(path, &s); err != nil {
		return 0, err
	}
	return s.Bavail * uint64(s.Bsize), nil
}

func parseMode(v string, fallback os.FileMode) os.FileMode {
	v = strings.TrimSpace(v)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseUint(v, 8, 32)
	if err != nil {
		return fallback
	}
	return os.FileMode(n)
}

func applyWdPermissions(cfg config.Config, path string, isDir bool) error {
	mode := parseMode(cfg.WD.FileMode, 0664)
	if isDir {
		mode = parseMode(cfg.WD.DirMode, 0775)
	}
	if err := os.Chmod(path, mode); err != nil {
		return err
	}
	owner, group := strings.TrimSpace(cfg.WD.Owner), strings.TrimSpace(cfg.WD.Group)
	if owner == "" && group == "" {
		return nil
	}
	spec := owner
	if group != "" {
		spec += ":" + group
	}
	out, err := exec.Command("chown", spec, path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("chown %s %s: %w: %s", spec, path, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func ensureWdDir(cfg config.Config, root, path string) error {
	if err := os.MkdirAll(path, parseMode(cfg.WD.DirMode, 0775)); err != nil {
		return err
	}
	root = filepath.Clean(root)
	cur := filepath.Clean(path)
	for {
		if cur == root || !strings.HasPrefix(cur, root+string(os.PathSeparator)) {
			break
		}
		if err := applyWdPermissions(cfg, cur, true); err != nil {
			return err
		}
		next := filepath.Dir(cur)
		if next == cur {
			break
		}
		cur = next
	}
	return nil
}

func Run(cfg config.Config, t transmission.Torrent, destination string, progress ProgressFunc) (string, error) {
	if err := EnsureMounted(cfg); err != nil {
		return "", err
	}

	relDest, err := safeRelative(destination)
	if err != nil {
		return "", err
	}
	destRoot := cfg.WD.MediaRoot
	if relDest != "" {
		destRoot = filepath.Join(destRoot, relDest)
	}
	if err := os.MkdirAll(destRoot, parseMode(cfg.WD.DirMode, 0775)); err != nil {
		return "", err
	}

	var required int64
	for _, f := range t.Files {
		if f.Length > 0 {
			required += f.Length
		}
	}
	free, err := fsFree(destRoot)
	if err != nil {
		return "", err
	}
	if free < uint64(required)+cfg.WD.ReserveBytes {
		return "", fmt.Errorf("not enough WD free space: need %d bytes plus %d-byte reserve, have %d", required, cfg.WD.ReserveBytes, free)
	}

	started := time.Now()
	lastEmit := time.Time{}
	var completed int64
	emit := func(force bool, current string, fileCopied, fileTotal int64) {
		if progress == nil {
			return
		}
		now := time.Now()
		if !force && !lastEmit.IsZero() && now.Sub(lastEmit) < 2*time.Second {
			return
		}
		lastEmit = now
		elapsed := now.Sub(started).Seconds()
		speed := float64(0)
		if elapsed > 0 {
			speed = float64(completed) / elapsed
		}
		eta := int64(0)
		if speed > 1 && required > completed {
			eta = int64(float64(required-completed) / speed)
		}
		pct := float64(0)
		if required > 0 {
			pct = float64(completed) / float64(required)
		}
		if pct > 1 {
			pct = 1
		}
		progress(Progress{CopiedBytes: completed, TotalBytes: required, CurrentFile: current, FileCopiedBytes: fileCopied, FileTotalBytes: fileTotal, SpeedBytesPerSec: speed, EtaSeconds: eta, Percent: pct})
	}
	emit(true, "", 0, 0)

	var copied int64
	var skipped int
	buf := make([]byte, 1024*1024)
	for _, f := range t.Files {
		rel, err := safeRelative(f.Name)
		if err != nil || rel == "" {
			if err == nil {
				err = fmt.Errorf("empty torrent path")
			}
			return "", err
		}
		srcPath := filepath.Join(cfg.KD20.SMBMount, filepath.FromSlash(cfg.KD20.SMBBase), rel)
		dstPath := filepath.Join(destRoot, rel)
		if err := ensureWdDir(cfg, destRoot, filepath.Dir(dstPath)); err != nil {
			return "", err
		}

		if st, err := os.Stat(dstPath); err == nil {
			if st.Size() == f.Length {
				if err := applyWdPermissions(cfg, dstPath, false); err != nil {
					return "", err
				}
				skipped++
				completed += f.Length
				emit(true, f.Name, f.Length, f.Length)
				continue
			}
			return "", fmt.Errorf("destination exists with different size: %s", dstPath)
		}

		src, err := os.Open(srcPath)
		if err != nil {
			return "", fmt.Errorf("open source %s: %w", srcPath, err)
		}
		tmpPath := dstPath + ".homehub-part"
		dst, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, parseMode(cfg.WD.FileMode, 0664))
		if err != nil {
			src.Close()
			return "", err
		}

		var fileCopied int64
		for {
			nr, readErr := src.Read(buf)
			if nr > 0 {
				nw, writeErr := dst.Write(buf[:nr])
				if writeErr != nil {
					dst.Close()
					src.Close()
					return "", writeErr
				}
				if nw != nr {
					dst.Close()
					src.Close()
					return "", io.ErrShortWrite
				}
				fileCopied += int64(nw)
				completed += int64(nw)
				emit(false, f.Name, fileCopied, f.Length)
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				dst.Close()
				src.Close()
				return "", readErr
			}
		}
		syncErr := dst.Sync()
		closeErr := dst.Close()
		src.Close()
		if syncErr != nil {
			return "", syncErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if f.Length > 0 && fileCopied != f.Length {
			return "", fmt.Errorf("size mismatch copying %s: got %d expected %d", f.Name, fileCopied, f.Length)
		}
		if err := os.Rename(tmpPath, dstPath); err != nil {
			return "", err
		}
		if err := applyWdPermissions(cfg, dstPath, false); err != nil {
			return "", err
		}
		copied += fileCopied
		emit(true, f.Name, fileCopied, f.Length)
	}
	emit(true, "", 0, 0)
	return fmt.Sprintf("copied %d bytes to %s (%d existing files skipped)", copied, destRoot, skipped), nil
}
