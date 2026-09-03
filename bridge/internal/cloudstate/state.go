package cloudstate

import (
	"encoding/json"
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
	return os.Rename(tmp, path)
}
