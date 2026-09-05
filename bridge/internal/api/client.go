package api

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	Base, Token string
	http        *http.Client
}

type Command struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

type Settings struct {
	AutoCopyEnabled     bool   `json:"autoCopyEnabled"`
	AutoCopyDestination string `json:"autoCopyDestination"`
}

type SnapshotResponse struct {
	OK              bool            `json:"ok"`
	Settings        Settings        `json:"settings"`
	PersistentState json.RawMessage `json:"persistentState,omitempty"`
}

func New(base, token string, insecureTLS bool) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Client{Base: strings.TrimRight(base, "/"), Token: token, http: &http.Client{Timeout: 30 * time.Second, Transport: transport}}
}
func (c *Client) do(method, path string, in, out any) error {
	var body *bytes.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, c.Base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("server HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
func (c *Client) Heartbeat(bridgeID, version string) error {
	return c.do(http.MethodPost, "/api/bridge/heartbeat", map[string]any{
		"bridgeId":  bridgeID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"version":   version,
	}, nil)
}
func (c *Client) Snapshot(s any) (SnapshotResponse, error) {
	var out SnapshotResponse
	err := c.do(http.MethodPost, "/api/bridge/snapshot", s, &out)
	return out, err
}
func (c *Client) Commands(bridgeID string) ([]Command, error) {
	var x []Command
	err := c.do(http.MethodGet, "/api/bridge/commands?bridgeId="+url.QueryEscape(bridgeID), nil, &x)
	return x, err
}
func (c *Client) Progress(id string, p any) error {
	return c.do(http.MethodPost, "/api/bridge/commands/"+url.PathEscape(id)+"/progress", p, nil)
}
func (c *Client) Complete(id string, ok bool, msg string) (SnapshotResponse, error) {
	var out SnapshotResponse
	err := c.do(http.MethodPost, "/api/bridge/commands/"+url.PathEscape(id)+"/complete", map[string]any{"ok": ok, "message": msg}, &out)
	return out, err
}

// NcoreCommands polls the short-lived nCore broker embedded in the Render app.
// These commands are intentionally separate from persistent HomeHub commands:
// search results and private tracker actions should not become part of the
// persistent state backup.
func (c *Client) NcoreCommands(bridgeID, version string, configured bool) ([]Command, error) {
	var x []Command
	q := url.Values{}
	q.Set("bridgeId", bridgeID)
	q.Set("version", version)
	q.Set("configured", strconv.FormatBool(configured))
	err := c.do(http.MethodGet, "/api/ncore/bridge/commands?"+q.Encode(), nil, &x)
	return x, err
}

func (c *Client) NcoreComplete(id string, ok bool, msg string) error {
	return c.do(http.MethodPost, "/api/ncore/bridge/commands/"+url.PathEscape(id)+"/complete", map[string]any{"ok": ok, "message": msg}, nil)
}
