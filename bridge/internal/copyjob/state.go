package copyjob

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type CopyRecord struct {
	Hash        string `json:"hash"`
	Name        string `json:"name"`
	Destination string `json:"destination"`
	CopiedAt    string `json:"copiedAt"`
}

type CopyState struct {
	Copied map[string]CopyRecord `json:"copied"`
}

func LoadState(path string) (CopyState, error) {
	st := CopyState{Copied: map[string]CopyRecord{}}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	if len(b) == 0 {
		return st, nil
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return st, err
	}
	if st.Copied == nil {
		st.Copied = map[string]CopyRecord{}
	}
	return st, nil
}

func SaveState(path string, st CopyState) error {
	if st.Copied == nil {
		st.Copied = map[string]CopyRecord{}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func MarkCopied(st *CopyState, hash, name, destination string) {
	if st.Copied == nil {
		st.Copied = map[string]CopyRecord{}
	}
	st.Copied[hash] = CopyRecord{Hash: hash, Name: name, Destination: destination, CopiedAt: time.Now().UTC().Format(time.RFC3339)}
}
