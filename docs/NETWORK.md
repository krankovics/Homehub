# HomeHub hálózat – v0.10

## SSID-k

- `krankovics2` – Technicolor FGA2233 Wi-Fi
- `krankovics` – Archer C6 + RE220 + RE315 #1 + RE315 #2 mesh/extender ág

## Fizikai topológia

```text
Technicolor FGA2233
├─ Wi-Fi krankovics2 → Krankovics-MBP
├─ Port 1 → DESKTOP-E6K3SEK
├─ Port 2 → TL-SG108E
│  ├─ DorkaPC
│  ├─ D-Link GO-SW-5G → TP-Link LiteWave LS105G → davidgaming
│  └─ Archer C6 → krankovics → RE220 + RE315 #1 + RE315 #2
├─ Port 3 → KD20 / oldnas
└─ Port 4 → WD My Cloud
```

## Ismert menedzselhető / mérhető eszközök

| ID | Eszköz | IP | MAC |
|---|---|---|---|
| technicolor-fga2233 | Technicolor FGA2233 | 192.168.1.1 | - |
| archer-c6 | Archer C6 | 192.168.1.129 | 5c:62:8b:95:64:eb |
| tl-sg108e | TL-SG108E | 192.168.1.49 | 78:8c:b5:5f:7f:04 |
| re220 | TP-Link RE220 | discovery | b4:b0:24:ef:3c:12 |
| re315-1 | TP-Link RE315 #1 | discovery | dc:62:79:dd:93:86 |
| re315-2 | TP-Link RE315 #2 | discovery | 0c:ef:15:1b:fe:ce |
| kd20 | KD20 / oldnas | 192.168.1.12 | 80:ee:73:49:89:0c |
| wd-my-cloud | WD My Cloud | 192.168.1.180 | 00:90:a9:d2:bb:ea |
| desktop-e6k3sek | DESKTOP-E6K3SEK | 192.168.1.25 | 30:56:0f:22:f7:b9 |
| dorkapc | DorkaPC | 192.168.1.210 | cc:28:aa:35:db:1d |
| davidgaming | davidgaming | 192.168.1.138 | 30:c5:99:7f:9b:50 |
| krankovics-mbp | Krankovics-MBP | 192.168.1.114 | c4:b3:01:c5:0b:8d |

A D-Link GO-SW-5G és TP-Link LiteWave LS105G unmanaged switchek, ezért a Bridge nem tud tőlük saját státuszt vagy portadatot lekérni. A topológiai nézetben ettől függetlenül megjelennek.
