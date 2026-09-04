package vacuum

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync/atomic"
	"time"

	"homehub/bridge/internal/config"
)

type Metric struct {
	Name  string      `json:"name"`
	Value interface{} `json:"value"`
	Unit  string      `json:"unit,omitempty"`
}

type Status struct {
	Configured   bool     `json:"configured"`
	Online       bool     `json:"online"`
	ControlReady bool     `json:"controlReady"`
	Name         string   `json:"name"`
	Model        string   `json:"model"`
	IP           string   `json:"ip"`
	State        string   `json:"state,omitempty"`
	Battery      *int     `json:"battery,omitempty"`
	AreaM2       *float64 `json:"areaM2,omitempty"`
	DurationSec  *int     `json:"durationSec,omitempty"`
	Metrics      []Metric `json:"metrics,omitempty"`
	Note         string   `json:"note"`
	UpdatedAt    string   `json:"updatedAt"`
}

type helloInfo struct {
	DeviceID uint32
	Stamp    uint32
}

type rpcClient struct {
	addr  string
	token []byte
	id    helloInfo
}

var requestID uint32 = 1000

func Probe(cfg config.Config) Status {
	c := cfg.XiaomiVacuum
	st := Status{Configured: c.Enabled, Name: c.Name, Model: c.Model, IP: c.IP, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	if st.Name == "" {
		st.Name = "Xiaomi Robot Vacuum E10"
	}
	if st.Model == "" {
		st.Model = "xiaomi.vacuum.b112"
	}
	if !c.Enabled {
		st.Note = "Xiaomi Home integráció nincs bekapcsolva a WD Bridge configban."
		return st
	}
	if strings.TrimSpace(c.IP) == "" {
		st.Note = "A porszívó IP-címe még nincs megadva."
		return st
	}
	hi, err := hello(c.IP, 1200*time.Millisecond)
	if err != nil {
		st.Note = "A porszívó nem válaszol a helyi Xiaomi miIO portra."
		return st
	}
	st.Online = true
	token, tokenErr := decodeToken(c.Token)
	st.ControlReady = tokenErr == nil && actionsReady(c)
	if tokenErr != nil || len(c.Properties) == 0 {
		st.Note = "Online. A részletes állapothoz Xiaomi token és MIoT property mapping szükséges."
		return st
	}
	client := rpcClient{addr: net.JoinHostPort(c.IP, "54321"), token: token, id: hi}
	metrics, err := readProperties(client, c)
	if err != nil {
		st.Note = "Online, de az MIoT állapotlekérdezés nem sikerült: " + shortErr(err)
		return st
	}
	st.Metrics = metrics
	for _, m := range metrics {
		switch strings.ToLower(m.Name) {
		case "state", "status":
			st.State = mappedState(c.StateMap, m.Value)
		case "battery", "battery_percent", "battery_percentage":
			if n, ok := number(m.Value); ok {
				v := int(n)
				if v >= 0 && v <= 100 {
					st.Battery = &v
				}
			}
		case "area", "area_m2", "clean_area":
			if n, ok := number(m.Value); ok {
				st.AreaM2 = &n
			}
		case "duration", "duration_sec", "clean_time":
			if n, ok := number(m.Value); ok {
				v := int(n)
				st.DurationSec = &v
			}
		}
	}
	if st.State == "" {
		st.State = "Online"
	}
	if st.ControlReady {
		st.Note = "Xiaomi Home helyi vezérlés aktív a WD Bridge-en."
	} else {
		st.Note = "Állapot olvasható; a vezérlőakciókhoz MIoT action mapping szükséges."
	}
	return st
}

func Command(cfg config.Config, action string) (string, error) {
	c := cfg.XiaomiVacuum
	if !c.Enabled {
		return "", errors.New("xiaomi vacuum integration disabled")
	}
	token, err := decodeToken(c.Token)
	if err != nil {
		return "", err
	}
	hi, err := hello(c.IP, 1500*time.Millisecond)
	if err != nil {
		return "", err
	}
	a, ok := actionConfig(c, action)
	if !ok || a.SIID <= 0 || a.AIID <= 0 {
		return "", fmt.Errorf("vacuum action %s is not mapped", action)
	}
	client := rpcClient{addr: net.JoinHostPort(c.IP, "54321"), token: token, id: hi}
	params := map[string]interface{}{"did": c.Model, "siid": a.SIID, "aiid": a.AIID, "in": []interface{}{}}
	if _, err := client.call("action", params); err != nil {
		return "", err
	}
	return fmt.Sprintf("vacuum %s command sent", action), nil
}

func actionsReady(c config.XiaomiVacuumConfig) bool {
	return c.Actions.Start.SIID > 0 && c.Actions.Start.AIID > 0 && c.Actions.Pause.SIID > 0 && c.Actions.Pause.AIID > 0 && c.Actions.Stop.SIID > 0 && c.Actions.Stop.AIID > 0 && c.Actions.Dock.SIID > 0 && c.Actions.Dock.AIID > 0
}
func actionConfig(c config.XiaomiVacuumConfig, action string) (config.XiaomiMiotAction, bool) {
	switch action {
	case "start":
		return c.Actions.Start, true
	case "pause":
		return c.Actions.Pause, true
	case "stop":
		return c.Actions.Stop, true
	case "dock":
		return c.Actions.Dock, true
	default:
		return config.XiaomiMiotAction{}, false
	}
}

func readProperties(client rpcClient, c config.XiaomiVacuumConfig) ([]Metric, error) {
	params := make([]map[string]interface{}, 0, len(c.Properties))
	for _, p := range c.Properties {
		params = append(params, map[string]interface{}{"did": p.Name, "siid": p.SIID, "piid": p.PIID})
	}
	result, err := client.call("get_properties", params)
	if err != nil {
		return nil, err
	}
	arr, ok := result.([]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected get_properties result")
	}
	out := make([]Metric, 0, len(arr))
	for i, item := range arr {
		if i >= len(c.Properties) {
			break
		}
		obj, _ := item.(map[string]interface{})
		value := obj["value"]
		p := c.Properties[i]
		if n, ok := number(value); ok && p.Scale != 0 && p.Scale != 1 {
			value = n * p.Scale
		}
		out = append(out, Metric{Name: p.Name, Value: value, Unit: p.Unit})
	}
	return out, nil
}

func hello(ip string, timeout time.Duration) (helloInfo, error) {
	addr, err := net.ResolveUDPAddr("udp", net.JoinHostPort(ip, "54321"))
	if err != nil {
		return helloInfo{}, err
	}
	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		return helloInfo{}, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	packet := bytes.Repeat([]byte{0xff}, 32)
	packet[0] = 0x21
	packet[1] = 0x31
	packet[2] = 0x00
	packet[3] = 0x20
	if _, err := conn.Write(packet); err != nil {
		return helloInfo{}, err
	}
	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil {
		return helloInfo{}, err
	}
	if n < 32 || buf[0] != 0x21 || buf[1] != 0x31 {
		return helloInfo{}, errors.New("invalid miIO hello response")
	}
	return helloInfo{DeviceID: binary.BigEndian.Uint32(buf[8:12]), Stamp: binary.BigEndian.Uint32(buf[12:16])}, nil
}

func decodeToken(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("xiaomi token missing")
	}
	b, err := hex.DecodeString(raw)
	if err != nil || len(b) != 16 {
		return nil, errors.New("xiaomi token must be 32 hex characters")
	}
	return b, nil
}

func (c rpcClient) call(method string, params interface{}) (interface{}, error) {
	id := atomic.AddUint32(&requestID, 1)
	payload, _ := json.Marshal(map[string]interface{}{"id": id, "method": method, "params": params})
	key := md5.Sum(c.token)
	ivSrc := append(append([]byte{}, key[:]...), c.token...)
	iv := md5.Sum(ivSrc)
	encrypted, err := encryptCBC(key[:], iv[:], payload)
	if err != nil {
		return nil, err
	}
	header := make([]byte, 16)
	header[0] = 0x21
	header[1] = 0x31
	binary.BigEndian.PutUint16(header[2:4], uint16(32+len(encrypted)))
	binary.BigEndian.PutUint32(header[8:12], c.id.DeviceID)
	binary.BigEndian.PutUint32(header[12:16], uint32(time.Now().Unix()))
	checksumInput := append(append(append([]byte{}, header...), c.token...), encrypted...)
	sum := md5.Sum(checksumInput)
	packet := append(append(header, sum[:]...), encrypted...)
	addr, err := net.ResolveUDPAddr("udp", c.addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2200 * time.Millisecond))
	if _, err := conn.Write(packet); err != nil {
		return nil, err
	}
	buf := make([]byte, 8192)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	if n < 32 {
		return nil, errors.New("short miIO response")
	}
	plain, err := decryptCBC(key[:], iv[:], buf[32:n])
	if err != nil {
		return nil, err
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(bytes.TrimRight(plain, "\x00"), &resp); err != nil {
		return nil, err
	}
	if e, ok := resp["error"]; ok && e != nil {
		return nil, fmt.Errorf("miIO error: %v", e)
	}
	return resp["result"], nil
}

func encryptCBC(key, iv, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	padded := pkcs7(plain, block.BlockSize())
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return out, nil
}
func decryptCBC(key, iv, data []byte) ([]byte, error) {
	if len(data)%aes.BlockSize != 0 {
		return nil, errors.New("invalid encrypted response")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	out := make([]byte, len(data))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, data)
	return unpad(out)
}
func pkcs7(b []byte, size int) []byte {
	n := size - len(b)%size
	return append(b, bytes.Repeat([]byte{byte(n)}, n)...)
}
func unpad(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, errors.New("empty response")
	}
	n := int(b[len(b)-1])
	if n <= 0 || n > aes.BlockSize || n > len(b) {
		return nil, errors.New("invalid padding")
	}
	for _, v := range b[len(b)-n:] {
		if int(v) != n {
			return nil, errors.New("invalid padding")
		}
	}
	return b[:len(b)-n], nil
}
func mappedState(m map[string]string, v interface{}) string {
	raw := fmt.Sprint(v)
	if x, ok := m[raw]; ok {
		return x
	}
	return raw
}
func number(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		n, e := x.Float64()
		return n, e == nil
	}
	return 0, false
}
func shortErr(err error) string {
	s := err.Error()
	if len(s) > 140 {
		return s[:140]
	}
	return s
}
