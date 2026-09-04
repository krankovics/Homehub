package network

import "testing"

func TestExtractEasySmartArrays(t *testing.T) {
    html := `<script>var max_port_num = 8; var all_info = {state:[1,1,1,1,1,1,1,1],spd_cfg:[1,1,1,1,1,1,1,1],spd_act:[6,3,6,0,0,3,0,6],fc_cfg:[0,0,0,0,0,0,0,0],fc_act:[0,0,0,0,0,0,0,0],trunk_info:[0,0,0,0,0,0,0,0]};</script>`
    if got := extractMaxPorts(html); got != 8 { t.Fatalf("ports=%d", got) }
    speeds := extractIntArray(html, "spd_act")
    if len(speeds) != 8 || speeds[0] != 6 || speeds[1] != 3 || speeds[7] != 6 { t.Fatalf("speeds=%v", speeds) }
    mbps, duplex, label := speedDetails(speeds[1])
    if mbps != 10 || duplex != "full" || label != "10MF" { t.Fatalf("speed=%d %s %s", mbps, duplex, label) }
}

func TestExtractSystemInfo(t *testing.T) {
    html := `<script>var info_ds={descriStr:["TL-SG108E"],gatewayStr:["192.168.1.1"],firmwareStr:["1.0.0 Build 20211209 Rel.52369"],hardwareStr:["TL-SG108E 6.0"]};</script>`
    if got := extractStringArrayFirst(html, "hardwareStr"); got != "TL-SG108E 6.0" { t.Fatalf("hardware=%q", got) }
}
