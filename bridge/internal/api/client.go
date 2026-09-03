package api

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

func New(base, token string, insecureTLS bool) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // explicitly opt-in only for legacy test environments
	}
	return &Client{
		Base: strings.TrimRight(base, "/"), Token: token,
		http: &http.Client{Timeout: 30 * time.Second, Transport: transport},
	}
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
	u := c.Base + path
	req, err := http.NewRequest(method, u, body)
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
func (c *Client) Snapshot(s any) error { return c.do(http.MethodPost, "/api/bridge/snapshot", s, nil) }
func (c *Client) Commands(bridgeID string) ([]Command, error) {
	var x []Command
	err := c.do(http.MethodGet, "/api/bridge/commands?bridgeId="+url.QueryEscape(bridgeID), nil, &x)
	return x, err
}

func (c *Client) Progress(id string, p any) error {
	return c.do(http.MethodPost, "/api/bridge/commands/"+url.PathEscape(id)+"/progress", p, nil)
}
func (c *Client) Complete(id string, ok bool, msg string) error {
	return c.do(http.MethodPost, "/api/bridge/commands/"+url.PathEscape(id)+"/complete", map[string]any{"ok": ok, "message": msg}, nil)
}
