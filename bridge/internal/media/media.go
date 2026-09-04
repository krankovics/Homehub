package media

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Enabled       bool
	Listen        string
	PublicBaseURL string
	Secret        string
	MediaRoot     string
	Roots         []Root
	MaxItems      int
}

type Root struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type Item struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	Folder       string `json:"folder"`
	SizeBytes    int64  `json:"sizeBytes"`
	ModifiedAt   string `json:"modifiedAt"`
	Extension    string `json:"extension"`
	NativePlay   bool   `json:"nativePlay"`
	PlayURL      string `json:"playUrl"`
	DownloadURL  string `json:"downloadUrl"`
}

type Snapshot struct {
	Enabled       bool   `json:"enabled"`
	Online        bool   `json:"online"`
	PublicBaseURL string `json:"publicBaseUrl"`
	Count         int    `json:"count"`
	Truncated     bool   `json:"truncated"`
	Error         string `json:"error,omitempty"`
	Items         []Item `json:"items"`
	UpdatedAt     string `json:"updatedAt"`
}

var videoExt = map[string]bool{
	".mp4": true, ".m4v": true, ".mov": true, ".mkv": true, ".avi": true,
	".webm": true, ".ts": true, ".m2ts": true, ".mpeg": true, ".mpg": true,
}

var nativeExt = map[string]bool{".mp4": true, ".m4v": true, ".mov": true}

func Scan(c Config) Snapshot {
	out := Snapshot{Enabled: c.Enabled, PublicBaseURL: strings.TrimRight(c.PublicBaseURL, "/"), UpdatedAt: time.Now().UTC().Format(time.RFC3339), Items: []Item{}}
	if !c.Enabled {
		return out
	}
	if strings.TrimSpace(c.MediaRoot) == "" || strings.TrimSpace(c.PublicBaseURL) == "" || strings.TrimSpace(c.Secret) == "" {
		out.Error = "media_not_configured"
		return out
	}
	if _, err := os.Stat(c.MediaRoot); err != nil {
		out.Error = err.Error()
		return out
	}
	out.Online = true
	roots := c.Roots
	if len(roots) == 0 {
		roots = []Root{{ID: "movies", Name: "Filmek", Path: "Filmek"}}
	}
	maxItems := c.MaxItems
	if maxItems <= 0 {
		maxItems = 2500
	}
	expires := time.Now().Add(24 * time.Hour).Unix()
	for _, root := range roots {
		rootRel := cleanRelative(root.Path)
		base := filepath.Join(c.MediaRoot, filepath.FromSlash(rootRel))
		if !within(c.MediaRoot, base) {
			continue
		}
		_ = filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if len(out.Items) >= maxItems {
				out.Truncated = true
				if d.IsDir() && p != base {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if !videoExt[ext] {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			rel, err := filepath.Rel(c.MediaRoot, p)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)
			folder := filepath.ToSlash(filepath.Dir(rel))
			if folder == "." {
				folder = ""
			}
			id := shortID(rel)
			out.Items = append(out.Items, Item{
				ID: id, Name: d.Name(), RelativePath: rel, Folder: folder,
				SizeBytes: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339),
				Extension: strings.TrimPrefix(ext, "."), NativePlay: nativeExt[ext],
				PlayURL:     signedURL(c, "/media/play", rel, expires),
				DownloadURL: signedURL(c, "/media/download", rel, expires),
			})
			return nil
		})
		if len(out.Items) >= maxItems {
			break
		}
	}
	sort.Slice(out.Items, func(i, j int) bool {
		if out.Items[i].ModifiedAt == out.Items[j].ModifiedAt {
			return strings.ToLower(out.Items[i].Name) < strings.ToLower(out.Items[j].Name)
		}
		return out.Items[i].ModifiedAt > out.Items[j].ModifiedAt
	})
	out.Count = len(out.Items)
	return out
}

func StartServer(c Config) {
	if !c.Enabled {
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"homehub-media"}`))
	})
	mux.HandleFunc("/media/play", func(w http.ResponseWriter, r *http.Request) { serve(c, w, r, false) })
	mux.HandleFunc("/media/download", func(w http.ResponseWriter, r *http.Request) { serve(c, w, r, true) })
	listen := c.Listen
	if strings.TrimSpace(listen) == "" {
		listen = "0.0.0.0:8788"
	}
	go func() {
		log.Printf("MEDIA: local server listening on %s (%s)", listen, c.PublicBaseURL)
		if err := http.ListenAndServe(listen, mux); err != nil {
			log.Printf("MEDIA server: %v", err)
		}
	}()
}

func serve(c Config, w http.ResponseWriter, r *http.Request, download bool) {
	rel := cleanRelative(r.URL.Query().Get("path"))
	exp, err := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if err != nil || exp < time.Now().Unix() || rel == "" {
		http.Error(w, "expired or invalid media link", http.StatusForbidden)
		return
	}
	sig := r.URL.Query().Get("sig")
	if !validSignature(c.Secret, rel, exp, sig) {
		http.Error(w, "invalid signature", http.StatusForbidden)
		return
	}
	full := filepath.Join(c.MediaRoot, filepath.FromSlash(rel))
	if !within(c.MediaRoot, full) {
		http.Error(w, "invalid path", http.StatusForbidden)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(filepath.Ext(full))
	if !videoExt[ext] {
		http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
		return
	}
	if mt := mime.TypeByExtension(ext); mt != "" {
		w.Header().Set("Content-Type", mt)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if download {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(st.Name())))
	} else {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", url.PathEscape(st.Name())))
	}
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

func signedURL(c Config, endpoint, rel string, exp int64) string {
	base := strings.TrimRight(c.PublicBaseURL, "/")
	q := url.Values{}
	q.Set("path", rel)
	q.Set("exp", strconv.FormatInt(exp, 10))
	q.Set("sig", signature(c.Secret, rel, exp))
	return base + endpoint + "?" + q.Encode()
}

func signature(secret, rel string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(rel + "\n" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

func validSignature(secret, rel string, exp int64, got string) bool {
	want := signature(secret, rel, exp)
	return hmac.Equal([]byte(want), []byte(got))
}

func shortID(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:8])
}

func cleanRelative(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\\", "/")
	s = strings.TrimPrefix(s, "/")
	c := filepath.ToSlash(filepath.Clean(filepath.FromSlash(s)))
	if c == "." || c == "" || strings.HasPrefix(c, "../") || c == ".." {
		return ""
	}
	return c
}

func within(root, candidate string) bool {
	ar, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	ac, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(ar, ac)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
