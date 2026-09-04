package vault

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVaultEncryptsCredentialsAtRest(t *testing.T) {
	d := t.TempDir()
	v, err := OpenOrCreate(Config{Enabled: true, File: filepath.Join(d, "credentials.vault"), KeyFile: filepath.Join(d, "vault.key"), PinFile: filepath.Join(d, "pin.json"), LocalBaseURL: "http://192.168.1.180:8788"})
	if err != nil {
		t.Fatal(err)
	}
	v.SetInventory([]InventoryItem{{ID: "router", Label: "Router", Kind: "router", AdminURL: "http://192.168.0.1"}})
	if err := v.Upsert(Credential{ID: "router", Username: "admin", Password: "super-secret-password"}, true); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(d, "credentials.vault"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "super-secret-password") || strings.Contains(string(b), "admin") {
		t.Fatalf("vault file contains plaintext credential: %s", string(b))
	}
	v2, err := OpenOrCreate(Config{Enabled: true, File: filepath.Join(d, "credentials.vault"), KeyFile: filepath.Join(d, "vault.key"), PinFile: filepath.Join(d, "pin.json")})
	if err != nil {
		t.Fatal(err)
	}
	c, ok := v2.Get("router")
	if !ok || c.Password != "super-secret-password" {
		t.Fatalf("credential roundtrip failed: %#v", c)
	}
}

func TestPINConfiguration(t *testing.T) {
	d := t.TempDir()
	v, err := OpenOrCreate(Config{Enabled: true, File: filepath.Join(d, "credentials.vault"), KeyFile: filepath.Join(d, "vault.key"), PinFile: filepath.Join(d, "pin.json")})
	if err != nil {
		t.Fatal(err)
	}
	if v.PINConfigured() {
		t.Fatal("PIN should not be configured initially")
	}
	if err := v.SetPIN("123"); err == nil {
		t.Fatal("short PIN must fail")
	}
	if err := v.SetPIN("homehub-123"); err != nil {
		t.Fatal(err)
	}
	if !v.PINConfigured() || !v.verifyPIN("homehub-123") || v.verifyPIN("wrong") {
		t.Fatal("PIN verification failed")
	}
}
