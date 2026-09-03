package transmission

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type Client struct {
	URL, Username, Password string
	http                    *http.Client
	mu                      sync.Mutex
	session                 string
}

type Torrent struct {
	ID           int     `json:"id"`
	HashString   string  `json:"hashString"`
	Name         string  `json:"name"`
	Status       int     `json:"status"`
	PercentDone  float64 `json:"percentDone"`
	RateDownload int64   `json:"rateDownload"`
	RateUpload   int64   `json:"rateUpload"`
	ETA          int64   `json:"eta"`
	DownloadDir  string  `json:"downloadDir"`
	Files        []File  `json:"files,omitempty"`
}

type File struct {
	BytesCompleted int64  `json:"bytesCompleted"`
	Length         int64  `json:"length"`
	Name           string `json:"name"`
}

type rpcResponse struct {
	Arguments json.RawMessage `json:"arguments"`
	Result    string          `json:"result"`
}

func New(url, user, pass string) *Client {
	return &Client{URL: url, Username: user, Password: pass, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) call(method string, args any, out any) error {
	body, _ := json.Marshal(map[string]any{"method": method, "arguments": args})
	for attempt := 0; attempt < 2; attempt++ {
		req, _ := http.NewRequest(http.MethodPost, c.URL, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		c.mu.Lock()
		sid := c.session
		c.mu.Unlock()
		if sid != "" {
			req.Header.Set("X-Transmission-Session-Id", sid)
		}
		if c.Username != "" {
			req.SetBasicAuth(c.Username, c.Password)
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusConflict {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			ns := resp.Header.Get("X-Transmission-Session-Id")
			if ns == "" {
				return fmt.Errorf("Transmission 409 without session id")
			}
			c.mu.Lock()
			c.session = ns
			c.mu.Unlock()
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			b, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("Transmission HTTP %d: %s", resp.StatusCode, string(b))
		}
		var rr rpcResponse
		if err := json.NewDecoder(resp.Body).Decode(&rr); err != nil {
			return err
		}
		if rr.Result != "success" {
			return fmt.Errorf("Transmission RPC: %s", rr.Result)
		}
		if out != nil {
			return json.Unmarshal(rr.Arguments, out)
		}
		return nil
	}
	return fmt.Errorf("Transmission session negotiation failed")
}

func (c *Client) List() ([]Torrent, error) {
	var out struct {
		Torrents []Torrent `json:"torrents"`
	}
	fields := []string{"id", "hashString", "name", "status", "percentDone", "rateDownload", "rateUpload", "eta", "downloadDir"}
	err := c.call("torrent-get", map[string]any{"fields": fields}, &out)
	return out.Torrents, err
}

func (c *Client) Detail(id int) (Torrent, error) {
	var out struct {
		Torrents []Torrent `json:"torrents"`
	}
	fields := []string{"id", "hashString", "name", "status", "percentDone", "rateDownload", "rateUpload", "eta", "downloadDir", "files"}
	err := c.call("torrent-get", map[string]any{"ids": []int{id}, "fields": fields}, &out)
	if err != nil {
		return Torrent{}, err
	}
	if len(out.Torrents) != 1 {
		return Torrent{}, fmt.Errorf("torrent %s not found", strconv.Itoa(id))
	}
	return out.Torrents[0], nil
}

func (c *Client) AddMagnet(magnet string) error {
	return c.call("torrent-add", map[string]any{"filename": magnet}, nil)
}
func (c *Client) AddMetainfo(b64 string) error {
	if _, err := base64.StdEncoding.DecodeString(b64); err != nil {
		return fmt.Errorf("invalid torrent base64: %w", err)
	}
	return c.call("torrent-add", map[string]any{"metainfo": b64}, nil)
}

func (c *Client) Remove(id int, deleteLocalData bool) error {
	return c.call("torrent-remove", map[string]any{"ids": []int{id}, "delete-local-data": deleteLocalData}, nil)
}
