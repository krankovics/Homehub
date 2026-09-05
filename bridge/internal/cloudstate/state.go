package cloudstate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Settings struct {
	AutoCopyEnabled     bool   `json:"autoCopyEnabled"`
	AutoCopyDestination string `json:"autoCopyDestination"`
}

type File struct {
	Settings        *Settings       `json:"settings,omitempty"`
	PersistentState json.RawMessage `json:"persistentState,omitempty"`
}

func Load(path string) File {
	var f File
	b, err := os.ReadFile(path)
	if err != nil {
		return f
	}
	_ = json.Unmarshal(b, &f)
	return f
}

func Save(path string, f File) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	// Keep three automatic generations before replacing the WD persistent state.
	// This makes accidental cloud-side regressions recoverable after a Render deploy.
	for i := 3; i >= 2; i-- {
		old := fmt.Sprintf("%s.prev%d", path, i-1)
		next := fmt.Sprintf("%s.prev%d", path, i)
		if _, err := os.Stat(old); err == nil {
			_ = os.Rename(old, next)
		}
	}
	if _, err := os.Stat(path); err == nil {
		if old, e := os.ReadFile(path); e == nil {
			_ = os.WriteFile(path+".prev1", old, 0600)
		}
	}
	return os.Rename(tmp, path)
}
