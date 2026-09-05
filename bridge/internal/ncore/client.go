package ncore

import (
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const defaultBaseURL = "https://ncore.pro"

var (
	blockStartRE = regexp.MustCompile(`(?is)<div\b[^>]*class=["'][^"']*\bbox_torrent\b[^"']*["'][^>]*>`)
	detailAnchorRE = regexp.MustCompile(`(?is)<a\b([^>]*href=["'][^"']*(?:action=details(?:&amp;|&)id=|details\.php\?id=)([0-9]+)[^"']*["'][^>]*)>`)
	titleAttrRE = regexp.MustCompile(`(?is)\btitle=["']([^"']+)["']`)
	categoryRE = regexp.MustCompile(`(?is)torrents\.php\?tipus=([a-z0-9_]+)`)
	dateRE = regexp.MustCompile(`(?is)<div\b[^>]*class=["'][^"']*\bbox_feltoltve2\b[^"']*["'][^>]*>(.*?)</div>`)
	sizeRE = regexp.MustCompile(`(?is)<div\b[^>]*class=["'][^"']*\bbox_meret2\b[^"']*["'][^>]*>(.*?)</div>`)
	seedRE = regexp.MustCompile(`(?is)<div\b[^>]*class=["'][^"']*\bbox_s2\b[^"']*["'][^>]*>.*?>([0-9]+)</a>.*?</div>`)
	leechRE = regexp.MustCompile(`(?is)<div\b[^>]*class=["'][^"']*\bbox_l2\b[^"']*["'][^>]*>.*?>([0-9]+)</a>.*?</div>`)
	passkeyRE = regexp.MustCompile(`(?is)rss\.php\?key=([a-z0-9]+)`)
)

type Result struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Size          string `json:"size"`
	Seeds         int    `json:"seeds"`
	Leech         int    `json:"leech"`
	Category      string `json:"category"`
	CategoryLabel string `json:"categoryLabel"`
	UploadedAt    string `json:"uploadedAt"`
	DetailURL     string `json:"detailUrl"`
	DownloadReady bool   `json:"downloadReady"`
	Source        string `json:"source"`
}

type Client struct {
	BaseURL string
	Cookie  string
	UA      string
	http    *http.Client
}

func New(cookie, userAgent string) *Client {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
	}
	return &Client{
		BaseURL: defaultBaseURL,
		Cookie:  strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(cookie, "\r", ""), "\n", "")),
		UA:      ua,
		http: &http.Client{
			Timeout: 25 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 8 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		},
	}
}

func (c *Client) request(rawURL string) ([]byte, string, int, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", 0, err
	}
	req.Header.Set("User-Agent", c.UA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "hu-HU,hu;q=0.9,en;q=0.7")
	req.Header.Set("Cache-Control", "no-cache")
	if c.Cookie != "" {
		req.Header.Set("Cookie", c.Cookie)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", 0, fmt.Errorf("ncore_http: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 24*1024*1024))
	if err != nil {
		return nil, resp.Request.URL.String(), resp.StatusCode, err
	}
	return body, resp.Request.URL.String(), resp.StatusCode, nil
}

func pageError(body []byte, finalURL string, status int) error {
	text := strings.ToLower(string(body[:min(len(body), 20000)]))
	if status < 200 || status >= 300 {
		return fmt.Errorf("ncore_http_%d", status)
	}
	if strings.Contains(text, "just a moment") || strings.Contains(text, "cf-chl-") || strings.Contains(text, "attention required") || strings.Contains(text, "cloudflare") {
		return fmt.Errorf("ncore_cloudflare")
	}
	if strings.Contains(strings.ToLower(finalURL), "login.php") || strings.Contains(text, `<title>ncore</title>`) || strings.Contains(text, `name="nev"`) || strings.Contains(text, `name='nev'`) {
		return fmt.Errorf("ncore_session_expired")
	}
	return nil
}

func cleanText(v string) string {
	v = regexp.MustCompile(`(?is)<br\s*/?>`).ReplaceAllString(v, " ")
	v = regexp.MustCompile(`(?is)<[^>]+>`).ReplaceAllString(v, " ")
	return strings.Join(strings.Fields(html.UnescapeString(v)), " ")
}

func categoryValues(category string) string {
	switch category {
	case "movies":
		return "xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd"
	case "tv":
		return "xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser"
	default:
		return "xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd,xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser,mp3_hun,mp3,lossless_hun,lossless,clip,game_iso,game_rip,console,iso,misc,mobil,ebook_hun,ebook"
	}
}

func categoryInfo(code string) (string, string) {
	labels := map[string]string{
		"xvid_hun": "Film (HUN SD)", "xvid": "Film (ENG SD)", "dvd_hun": "Film (HUN DVD)", "dvd": "Film (ENG DVD)",
		"dvd9_hun": "Film (HUN DVD9)", "dvd9": "Film (ENG DVD9)", "hd_hun": "Film (HUN HD)", "hd": "Film (ENG HD)",
		"xvidser_hun": "Sorozat (HUN SD)", "xvidser": "Sorozat (ENG SD)", "dvdser_hun": "Sorozat (HUN DVD)", "dvdser": "Sorozat (ENG DVD)",
		"hdser_hun": "Sorozat (HUN HD)", "hdser": "Sorozat (ENG HD)", "mp3_hun": "Zene (HUN MP3)", "mp3": "Zene (MP3)",
		"lossless_hun": "Zene (HUN Lossless)", "lossless": "Zene (Lossless)", "clip": "Klip", "game_iso": "Játék ISO", "game_rip": "Játék RIP",
		"console": "Konzol", "iso": "Szoftver ISO", "misc": "Szoftver", "mobil": "Mobil", "ebook_hun": "E-book HUN", "ebook": "E-book",
	}
	label := labels[code]
	if label == "" {
		label = code
	}
	kind := "all"
	if strings.Contains(code, "ser") {
		kind = "tv"
	} else if strings.HasPrefix(code, "xvid") || strings.HasPrefix(code, "dvd") || strings.HasPrefix(code, "hd") {
		kind = "movies"
	}
	return kind, label
}

func blockValue(re *regexp.Regexp, block string) string {
	m := re.FindStringSubmatch(block)
	if len(m) < 2 {
		return ""
	}
	return cleanText(m[1])
}

func intValue(re *regexp.Regexp, block string) int {
	v := blockValue(re, block)
	n, _ := strconv.Atoi(v)
	return n
}

func splitBlocks(body string) []string {
	locs := blockStartRE.FindAllStringIndex(body, -1)
	out := make([]string, 0, len(locs))
	for i, loc := range locs {
		end := len(body)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		out = append(out, body[loc[0]:end])
	}
	return out
}

func (c *Client) Search(query, category string, limit int) ([]Result, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 {
		return nil, fmt.Errorf("search_too_short")
	}
	if c.Cookie == "" {
		return nil, fmt.Errorf("ncore_bridge_credentials_missing")
	}
	if limit <= 0 || limit > 50 {
		limit = 25
	}
	u, _ := url.Parse(c.BaseURL + "/torrents.php")
	q := u.Query()
	q.Set("miszerint", "seeders")
	q.Set("hogyan", "DESC")
	q.Set("tipus", "kivalasztottak_kozott")
	q.Set("mire", query)
	q.Set("miben", "name")
	q.Set("kivalasztott_tipus", categoryValues(category))
	q.Set("oldal", "1")
	u.RawQuery = q.Encode()
	body, finalURL, status, err := c.request(u.String())
	if err != nil {
		return nil, err
	}
	if err := pageError(body, finalURL, status); err != nil {
		return nil, err
	}

	results := make([]Result, 0, limit)
	seen := map[string]bool{}
	for _, block := range splitBlocks(string(body)) {
		anchor := detailAnchorRE.FindStringSubmatch(block)
		if len(anchor) < 3 {
			continue
		}
		id := anchor[2]
		if seen[id] {
			continue
		}
		tm := titleAttrRE.FindStringSubmatch(anchor[1])
		if len(tm) < 2 {
			continue
		}
		title := cleanText(tm[1])
		if title == "" {
			continue
		}
		code := ""
		if cm := categoryRE.FindStringSubmatch(block); len(cm) > 1 {
			code = cm[1]
		}
		kind, label := categoryInfo(code)
		results = append(results, Result{
			ID: id, Title: title, Size: blockValue(sizeRE, block), Seeds: intValue(seedRE, block), Leech: intValue(leechRE, block),
			Category: kind, CategoryLabel: label, UploadedAt: blockValue(dateRE, block),
			DetailURL: c.BaseURL + "/torrents.php?action=details&id=" + url.QueryEscape(id), DownloadReady: true, Source: "wd-bridge",
		})
		seen[id] = true
		if len(results) >= limit {
			break
		}
	}
	return results, nil
}

func (c *Client) passkey() (string, error) {
	body, finalURL, status, err := c.request(c.BaseURL + "/index.php")
	if err != nil {
		return "", err
	}
	if err := pageError(body, finalURL, status); err != nil {
		return "", err
	}
	m := passkeyRE.FindStringSubmatch(string(body))
	if len(m) < 2 || strings.TrimSpace(m[1]) == "" {
		return "", fmt.Errorf("ncore_passkey_missing")
	}
	return m[1], nil
}

func validTorrent(data []byte, contentType string) bool {
	if len(data) < 20 || len(data) > 20*1024*1024 {
		return false
	}
	head := strings.ToLower(string(data[:min(len(data), 2000)]))
	if strings.Contains(strings.ToLower(contentType), "text/html") || strings.Contains(head, "cloudflare") || strings.Contains(head, "just a moment") || strings.Contains(head, "login.php") {
		return false
	}
	return data[0] == 'd'
}

func (c *Client) downloadURL(rawURL string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.UA)
	req.Header.Set("Accept", "application/x-bittorrent,application/octet-stream,*/*;q=0.5")
	if c.Cookie != "" {
		req.Header.Set("Cookie", c.Cookie)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ncore_http: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ncore_download_http_%d", resp.StatusCode)
	}
	if !validTorrent(data, resp.Header.Get("Content-Type")) {
		text := strings.ToLower(string(data[:min(len(data), 2000)]))
		if strings.Contains(text, "cloudflare") || strings.Contains(text, "just a moment") || strings.Contains(text, "cf-chl-") {
			return nil, fmt.Errorf("ncore_cloudflare")
		}
		if strings.Contains(text, "login.php") || strings.Contains(text, `<title>ncore</title>`) {
			return nil, fmt.Errorf("ncore_session_expired")
		}
		return nil, fmt.Errorf("ncore_invalid_torrent_file")
	}
	return data, nil
}

func (c *Client) Download(id string) ([]byte, error) {
	if c.Cookie == "" {
		return nil, fmt.Errorf("ncore_bridge_credentials_missing")
	}
	if _, err := strconv.ParseInt(id, 10, 64); err != nil {
		return nil, fmt.Errorf("invalid_torrent_id")
	}
	key, err := c.passkey()
	if err != nil {
		return nil, err
	}
	candidates := []string{
		fmt.Sprintf("%s/rss_dl.php/id=%s/key=%s", c.BaseURL, url.PathEscape(id), url.PathEscape(key)),
		fmt.Sprintf("%s/torrents.php?action=download&id=%s&key=%s", c.BaseURL, url.QueryEscape(id), url.QueryEscape(key)),
		fmt.Sprintf("%s/download.php?id=%s&key=%s", c.BaseURL, url.QueryEscape(id), url.QueryEscape(key)),
	}
	var last error
	for _, candidate := range candidates {
		data, err := c.downloadURL(candidate)
		if err == nil {
			return data, nil
		}
		last = err
		if err.Error() == "ncore_cloudflare" || err.Error() == "ncore_session_expired" {
			return nil, err
		}
	}
	if last == nil {
		last = fmt.Errorf("ncore_download_failed")
	}
	return nil, last
}
