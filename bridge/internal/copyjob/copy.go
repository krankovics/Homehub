package copyjob

import (
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
    "strings"
    "syscall"

    "homehub/bridge/internal/config"
    "homehub/bridge/internal/transmission"
)

func mounted(path string) bool {
    var st syscall.Statfs_t
    if err := syscall.Statfs(path, &st); err != nil {
        return false
    }
    return uint64(st.Type) == 0xFF534D42
}

func EnsureMounted(cfg config.Config) error {
    if err := os.MkdirAll(cfg.KD20.SMBMount, 0755); err != nil {
        return err
    }
    if mounted(cfg.KD20.SMBMount) {
        return nil
    }

    remote := fmt.Sprintf("//%s/%s", cfg.KD20.SMBHost, cfg.KD20.SMBShare)
    options := []string{"ro", "iocharset=utf8"}

    // Old OMNINAS firmware commonly exposes public shares as SMB guest shares.
    // Using the kernel CIFS guest option is more compatible than an empty
    // credentials file on the WD My Cloud OS 3 CIFS client.
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
        return fmt.Errorf("mount KD20 SMB failed: %w: %s", err, strings.TrimSpace(string(out)))
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
        if e.IsDir() { suffix = "/" }
        names = append(names, e.Name()+suffix)
    }
    sort.Strings(names)
    if limit > 0 && len(names) > limit { names = names[:limit] }
    return names, nil
}

func safeRelative(v string) (string, error) {
    v = strings.TrimSpace(strings.ReplaceAll(v, "\\", "/"))
    v = strings.TrimPrefix(v, "/")
    clean := filepath.Clean(filepath.FromSlash(v))
    if clean == "." { return "", nil }
    if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
        return "", fmt.Errorf("unsafe relative path %q", v)
    }
    return clean, nil
}

func fsFree(path string) (uint64, error) {
    var s syscall.Statfs_t
    if err := syscall.Statfs(path, &s); err != nil { return 0, err }
    return s.Bavail * uint64(s.Bsize), nil
}

func Run(cfg config.Config, t transmission.Torrent, destination string) (string, error) {
    if err := EnsureMounted(cfg); err != nil { return "", err }

    relDest, err := safeRelative(destination)
    if err != nil { return "", err }
    destRoot := cfg.WD.MediaRoot
    if relDest != "" { destRoot = filepath.Join(destRoot, relDest) }
    if err := os.MkdirAll(destRoot, 0755); err != nil { return "", err }

    var required uint64
    for _, f := range t.Files {
        if f.Length > 0 { required += uint64(f.Length) }
    }
    free, err := fsFree(destRoot)
    if err != nil { return "", err }
    if free < required+cfg.WD.ReserveBytes {
        return "", fmt.Errorf("not enough WD free space: need %d bytes plus %d-byte reserve, have %d", required, cfg.WD.ReserveBytes, free)
    }

    var copied int64
    var skipped int
    for _, f := range t.Files {
        rel, err := safeRelative(f.Name)
        if err != nil || rel == "" {
            if err == nil { err = fmt.Errorf("empty torrent path") }
            return "", err
        }
        srcPath := filepath.Join(cfg.KD20.SMBMount, filepath.FromSlash(cfg.KD20.SMBBase), rel)
        dstPath := filepath.Join(destRoot, rel)
        if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil { return "", err }

        if st, err := os.Stat(dstPath); err == nil {
            if st.Size() == f.Length { skipped++; continue }
            return "", fmt.Errorf("destination exists with different size: %s", dstPath)
        }

        src, err := os.Open(srcPath)
        if err != nil { return "", fmt.Errorf("open source %s: %w", srcPath, err) }

        tmpPath := dstPath + ".homehub-part"
        dst, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
        if err != nil { src.Close(); return "", err }
        n, cpErr := io.Copy(dst, src)
        syncErr := dst.Sync()
        closeErr := dst.Close()
        src.Close()
        if cpErr != nil { return "", cpErr }
        if syncErr != nil { return "", syncErr }
        if closeErr != nil { return "", closeErr }
        if f.Length > 0 && n != f.Length {
            return "", fmt.Errorf("size mismatch copying %s: got %d expected %d", f.Name, n, f.Length)
        }
        if err := os.Rename(tmpPath, dstPath); err != nil { return "", err }
        copied += n
    }
    return fmt.Sprintf("copied %d bytes to %s (%d existing files skipped)", copied, destRoot, skipped), nil
}
