package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const vaultVersion = 1
const defaultIterations = 120000

type Config struct {
	Enabled        bool
	File           string
	KeyFile        string
	PinFile        string
	SessionMinutes int
	LocalBaseURL   string
}

type Credential struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	AdminURL  string `json:"adminUrl"`
	Note      string `json:"note,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

type InventoryItem struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	AdminURL string `json:"adminUrl"`
	IP       string `json:"ip,omitempty"`
}

type EntryMeta struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Kind        string `json:"kind,omitempty"`
	Username    string `json:"username,omitempty"`
	AdminURL    string `json:"adminUrl,omitempty"`
	IP          string `json:"ip,omitempty"`
	HasPassword bool   `json:"hasPassword"`
	Saved       bool   `json:"saved"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

type PublicStatus struct {
	Enabled       bool        `json:"enabled"`
	Initialized   bool        `json:"initialized"`
	PINConfigured bool        `json:"pinConfigured"`
	LocalURL      string      `json:"localUrl"`
	Entries       []EntryMeta `json:"entries"`
	UpdatedAt     string      `json:"updatedAt"`
	Error         string      `json:"error,omitempty"`
}

type encryptedDisk struct {
	Version    int    `json:"version"`
	UpdatedAt  string `json:"updatedAt"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type payload struct {
	Entries map[string]Credential `json:"entries"`
}

type pinDisk struct {
	Version    int    `json:"version"`
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Iterations int    `json:"iterations"`
	UpdatedAt  string `json:"updatedAt"`
}

type Service struct {
	mu        sync.RWMutex
	cfg       Config
	key       []byte
	entries   map[string]Credential
	inventory map[string]InventoryItem
	sessions  map[string]time.Time
	pin       *pinDisk
	updatedAt string
	initErr   error
}

func OpenOrCreate(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.File) == "" {
		cfg.File = "/DataVolume/homehub/credentials.vault"
	}
	if strings.TrimSpace(cfg.KeyFile) == "" {
		cfg.KeyFile = "/DataVolume/homehub/vault.key"
	}
	if strings.TrimSpace(cfg.PinFile) == "" {
		cfg.PinFile = "/DataVolume/homehub/vault-pin.json"
	}
	if cfg.SessionMinutes <= 0 {
		cfg.SessionMinutes = 10
	}
	s := &Service{cfg: cfg, entries: map[string]Credential{}, inventory: map[string]InventoryItem{}, sessions: map[string]time.Time{}}
	if !cfg.Enabled {
		return s, nil
	}
	if err := os.MkdirAll(filepath.Dir(cfg.File), 0700); err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(cfg.KeyFile)
	if err != nil {
		return nil, err
	}
	s.key = key
	if _, err := os.Stat(cfg.File); errors.Is(err, os.ErrNotExist) {
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else if err := s.loadLocked(); err != nil {
		s.initErr = err
		return s, err
	}
	if b, err := os.ReadFile(cfg.PinFile); err == nil {
		var p pinDisk
		if json.Unmarshal(b, &p) == nil && p.Hash != "" && p.Salt != "" {
			if p.Iterations <= 0 {
				p.Iterations = defaultIterations
			}
			s.pin = &p
		}
	}
	return s, nil
}

func loadOrCreateKey(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil {
		if len(b) == 32 {
			return b, nil
		}
		return nil, fmt.Errorf("vault key has invalid length: %d", len(b))
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := atomicWrite(path, key, 0600); err != nil {
		return nil, err
	}
	return key, nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Chmod(path, mode)
}

func (s *Service) loadLocked() error {
	b, err := os.ReadFile(s.cfg.File)
	if err != nil {
		return err
	}
	var d encryptedDisk
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	nonce, err := base64.StdEncoding.DecodeString(d.Nonce)
	if err != nil {
		return err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(d.Ciphertext)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, []byte("homehub-vault-v1"))
	if err != nil {
		return fmt.Errorf("vault decrypt failed: %w", err)
	}
	var p payload
	if err := json.Unmarshal(plain, &p); err != nil {
		return err
	}
	if p.Entries == nil {
		p.Entries = map[string]Credential{}
	}
	s.entries = p.Entries
	s.updatedAt = d.UpdatedAt
	return nil
}

func (s *Service) saveLocked() error {
	p := payload{Entries: s.entries}
	plain, err := json.Marshal(p)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	cipherText := gcm.Seal(nil, nonce, plain, []byte("homehub-vault-v1"))
	now := time.Now().UTC().Format(time.RFC3339)
	d := encryptedDisk{Version: vaultVersion, UpdatedAt: now, Nonce: base64.StdEncoding.EncodeToString(nonce), Ciphertext: base64.StdEncoding.EncodeToString(cipherText)}
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	if err := atomicWrite(s.cfg.File, b, 0600); err != nil {
		return err
	}
	s.updatedAt = now
	return nil
}

func (s *Service) SetInventory(items []InventoryItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inventory = map[string]InventoryItem{}
	for _, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		if item.ID != "" {
			s.inventory[item.ID] = item
		}
	}
}

func (s *Service) PINConfigured() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pin != nil && s.pin.Hash != ""
}

func pinHash(pin string, salt []byte, iterations int) []byte {
	if iterations <= 0 {
		iterations = defaultIterations
	}
	sum := sha256.Sum256(append(append([]byte{}, salt...), []byte(pin)...))
	buf := sum[:]
	for i := 1; i < iterations; i++ {
		next := sha256.Sum256(append(append([]byte{}, buf...), salt...))
		buf = next[:]
	}
	out := make([]byte, len(buf))
	copy(out, buf)
	return out
}

func (s *Service) SetPIN(pin string) error {
	pin = strings.TrimSpace(pin)
	if len(pin) < 6 {
		return fmt.Errorf("PIN must be at least 6 characters")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	iterations := defaultIterations
	h := pinHash(pin, salt, iterations)
	p := pinDisk{Version: 1, Salt: base64.StdEncoding.EncodeToString(salt), Hash: hex.EncodeToString(h), Iterations: iterations, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := atomicWrite(s.cfg.PinFile, b, 0600); err != nil {
		return err
	}
	s.mu.Lock()
	s.pin = &p
	s.sessions = map[string]time.Time{}
	s.mu.Unlock()
	return nil
}

func (s *Service) verifyPIN(pin string) bool {
	s.mu.RLock()
	p := s.pin
	s.mu.RUnlock()
	if p == nil {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(p.Salt)
	if err != nil {
		return false
	}
	got := pinHash(pin, salt, p.Iterations)
	want, err := hex.DecodeString(p.Hash)
	if err != nil || len(want) != len(got) {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Service) newSession(pin string) (string, bool) {
	if !s.verifyPIN(pin) {
		return "", false
	}
	token := randomToken(32)
	if token == "" {
		return "", false
	}
	s.mu.Lock()
	s.sessions[token] = time.Now().Add(time.Duration(s.cfg.SessionMinutes) * time.Minute)
	s.mu.Unlock()
	return token, true
}

func (s *Service) sessionOK(r *http.Request) bool {
	c, err := r.Cookie("homehub_vault_session")
	if err != nil || c.Value == "" {
		return false
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.sessions[c.Value]
	if !ok || now.After(exp) {
		delete(s.sessions, c.Value)
		return false
	}
	s.sessions[c.Value] = now.Add(time.Duration(s.cfg.SessionMinutes) * time.Minute)
	return true
}

func (s *Service) Entries() map[string]Credential {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Credential, len(s.entries))
	for k, v := range s.entries {
		out[k] = v
	}
	return out
}

func (s *Service) Get(id string) (Credential, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.entries[id]
	return v, ok
}

func (s *Service) Upsert(c Credential, preservePassword bool) error {
	c.ID = strings.TrimSpace(c.ID)
	if c.ID == "" {
		return fmt.Errorf("credential id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.entries[c.ID]; ok {
		if c.Label == "" {
			c.Label = old.Label
		}
		if c.Username == "" {
			c.Username = old.Username
		}
		if c.AdminURL == "" {
			c.AdminURL = old.AdminURL
		}
		if preservePassword && c.Password == "" {
			c.Password = old.Password
		}
	}
	if inv, ok := s.inventory[c.ID]; ok {
		if c.Label == "" {
			c.Label = inv.Label
		}
		if c.AdminURL == "" {
			c.AdminURL = inv.AdminURL
		}
	}
	c.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.entries[c.ID] = c
	return s.saveLocked()
}

func (s *Service) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, id)
	return s.saveLocked()
}

func (s *Service) ImportLegacy(entries map[string]Credential) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for id, c := range entries {
		if _, exists := s.entries[id]; exists {
			continue
		}
		c.ID = id
		if inv, ok := s.inventory[id]; ok {
			if c.Label == "" {
				c.Label = inv.Label
			}
			if c.AdminURL == "" {
				c.AdminURL = inv.AdminURL
			}
		}
		c.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		s.entries[id] = c
		count++
	}
	if count == 0 {
		return 0, nil
	}
	return count, s.saveLocked()
}

func (s *Service) PublicStatus() PublicStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := PublicStatus{Enabled: s.cfg.Enabled, Initialized: len(s.key) == 32 && s.initErr == nil, PINConfigured: s.pin != nil && s.pin.Hash != "", LocalURL: strings.TrimRight(s.cfg.LocalBaseURL, "/") + "/vault", UpdatedAt: s.updatedAt}
	if s.initErr != nil {
		st.Error = s.initErr.Error()
	}
	ids := map[string]bool{}
	for id := range s.inventory {
		ids[id] = true
	}
	for id := range s.entries {
		ids[id] = true
	}
	keys := make([]string, 0, len(ids))
	for id := range ids {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		inv := s.inventory[id]
		c, ok := s.entries[id]
		m := EntryMeta{ID: id, Label: inv.Label, Kind: inv.Kind, AdminURL: inv.AdminURL, IP: inv.IP, Saved: ok}
		if ok {
			if c.Label != "" {
				m.Label = c.Label
			}
			m.Username = c.Username
			if c.AdminURL != "" {
				m.AdminURL = c.AdminURL
			}
			m.HasPassword = c.Password != ""
			m.UpdatedAt = c.UpdatedAt
		}
		if m.Label == "" {
			m.Label = id
		}
		st.Entries = append(st.Entries, m)
	}
	return st
}

func privateIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return true
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return strings.HasPrefix(ip.String(), "fc") || strings.HasPrefix(ip.String(), "fd")
	}
	return ip4[0] == 10 || (ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31) || (ip4[0] == 192 && ip4[1] == 168)
}

func isLocalRequest(r *http.Request) bool {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return privateIP(net.ParseIP(host))
}

func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(out)
}

func (s *Service) Register(mux *http.ServeMux) {
	if !s.cfg.Enabled {
		return
	}
	guard := func(fn http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !isLocalRequest(r) {
				http.Error(w, "local network only", http.StatusForbidden)
				return
			}
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Frame-Options", "DENY")
			fn(w, r)
		}
	}
	mux.HandleFunc("/vault", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/vault" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, vaultHTML())
	}))
	mux.HandleFunc("/vault/api/status", guard(func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, s.PublicStatus())
	}))
	mux.HandleFunc("/vault/api/setup", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		if s.PINConfigured() {
			jsonOut(w, 409, map[string]any{"error": "pin_already_configured"})
			return
		}
		var body struct {
			PIN string `json:"pin"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonOut(w, 400, map[string]any{"error": "invalid_json"})
			return
		}
		if err := s.SetPIN(body.PIN); err != nil {
			jsonOut(w, 400, map[string]any{"error": err.Error()})
			return
		}
		token, ok := s.newSession(body.PIN)
		if ok {
			http.SetCookie(w, &http.Cookie{Name: "homehub_vault_session", Value: token, Path: "/vault", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: s.cfg.SessionMinutes * 60})
		}
		jsonOut(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("/vault/api/login", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var body struct {
			PIN string `json:"pin"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonOut(w, 400, map[string]any{"error": "invalid_json"})
			return
		}
		token, ok := s.newSession(body.PIN)
		if !ok {
			jsonOut(w, 401, map[string]any{"error": "invalid_pin"})
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "homehub_vault_session", Value: token, Path: "/vault", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: s.cfg.SessionMinutes * 60})
		jsonOut(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("/vault/api/logout", guard(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("homehub_vault_session"); err == nil {
			s.mu.Lock()
			delete(s.sessions, c.Value)
			s.mu.Unlock()
		}
		http.SetCookie(w, &http.Cookie{Name: "homehub_vault_session", Value: "", Path: "/vault", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		jsonOut(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("/vault/api/entries", guard(func(w http.ResponseWriter, r *http.Request) {
		if !s.sessionOK(r) {
			jsonOut(w, 401, map[string]any{"error": "auth_required"})
			return
		}
		if r.Method == http.MethodGet {
			jsonOut(w, 200, s.PublicStatus().Entries)
			return
		}
		if r.Method == http.MethodPost {
			var c Credential
			if err := readJSON(r, &c); err != nil {
				jsonOut(w, 400, map[string]any{"error": "invalid_json"})
				return
			}
			if err := s.Upsert(c, true); err != nil {
				jsonOut(w, 400, map[string]any{"error": err.Error()})
				return
			}
			jsonOut(w, 200, map[string]any{"ok": true})
			return
		}
		http.Error(w, "method not allowed", 405)
	}))
	mux.HandleFunc("/vault/api/reveal", guard(func(w http.ResponseWriter, r *http.Request) {
		if !s.sessionOK(r) {
			jsonOut(w, 401, map[string]any{"error": "auth_required"})
			return
		}
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		c, ok := s.Get(id)
		if !ok {
			jsonOut(w, 404, map[string]any{"error": "not_found"})
			return
		}
		jsonOut(w, 200, map[string]any{"id": id, "password": c.Password})
	}))
	mux.HandleFunc("/vault/api/delete", guard(func(w http.ResponseWriter, r *http.Request) {
		if !s.sessionOK(r) {
			jsonOut(w, 401, map[string]any{"error": "auth_required"})
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var body struct {
			ID string `json:"id"`
		}
		if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.ID) == "" {
			jsonOut(w, 400, map[string]any{"error": "invalid_request"})
			return
		}
		if err := s.Delete(body.ID); err != nil {
			jsonOut(w, 500, map[string]any{"error": err.Error()})
			return
		}
		jsonOut(w, 200, map[string]any{"ok": true})
	}))
}

//go:embed vault.html
var embeddedVaultHTML string

func vaultHTML() string { return embeddedVaultHTML }
