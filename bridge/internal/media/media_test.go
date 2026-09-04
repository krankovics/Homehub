package media

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestScanAndSignedRangeServe(t *testing.T) {
	root := t.TempDir()
	movies := filepath.Join(root, "Filmek")
	if err := os.MkdirAll(movies, 0o755); err != nil {
		t.Fatal(err)
	}
	data := []byte("0123456789abcdef")
	movie := filepath.Join(movies, "Teszt Film.mp4")
	if err := os.WriteFile(movie, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movies, "ignore.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := Config{Enabled: true, PublicBaseURL: "http://192.168.1.180:8788", Secret: "test-secret", MediaRoot: root, Roots: []Root{{ID: "movies", Name: "Filmek", Path: "Filmek"}}, MaxItems: 50}
	snap := Scan(c)
	if !snap.Online || snap.Count != 1 || len(snap.Items) != 1 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	item := snap.Items[0]
	if !item.NativePlay || item.Extension != "mp4" {
		t.Fatalf("unexpected item: %+v", item)
	}

	u, err := url.Parse(item.PlayURL)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", u.RequestURI(), nil)
	req.Header.Set("Range", "bytes=2-5")
	rr := httptest.NewRecorder()
	serve(c, rr, req, false)
	if rr.Code != 206 {
		t.Fatalf("expected 206, got %d body=%s", rr.Code, rr.Body.String())
	}
	if rr.Body.String() != "2345" {
		t.Fatalf("unexpected range body %q", rr.Body.String())
	}

	du, _ := url.Parse(signedURL(c, "/media/download", "Filmek/Teszt Film.mp4", time.Now().Add(time.Hour).Unix()))
	dreq := httptest.NewRequest("GET", du.RequestURI(), nil)
	drr := httptest.NewRecorder()
	serve(c, drr, dreq, true)
	if drr.Code != 200 {
		t.Fatalf("download status %d", drr.Code)
	}
	if !strings.HasPrefix(drr.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("missing attachment disposition: %q", drr.Header().Get("Content-Disposition"))
	}
}

func TestRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	c := Config{Enabled: true, Secret: "test-secret", MediaRoot: root}
	rel := "../secret.mp4"
	exp := time.Now().Add(time.Hour).Unix()
	q := url.Values{}
	q.Set("path", rel)
	q.Set("exp", strconv.FormatInt(exp, 10))
	q.Set("sig", signature(c.Secret, rel, exp))
	req := httptest.NewRequest("GET", "/media/play?"+q.Encode(), nil)
	rr := httptest.NewRecorder()
	serve(c, rr, req, false)
	if rr.Code == 200 || rr.Code == 206 {
		t.Fatalf("traversal unexpectedly served")
	}
}
