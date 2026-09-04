# HomeHub v0.16.0 release

## Fő újdonság

WD My Cloud **Médiatár** iPhone streaminggel és offline letöltéssel.

### Benne van

- új `Média` tab a HomeHub PWA-ban;
- WD `/DataVolume/shares/Public/Filmek` automatikus indexelése a jelenlegi setupnál;
- keresés, mappaszűrés és rendezés;
- MP4/M4V/MOV natív iPhone jelölés;
- MKV/AVI/WebM/TS/M2TS/MPEG támogatás Infuse/VLC használathoz;
- Range request támogatás, így a helyi stream tekerhető;
- külön offline download endpoint;
- 24 órás HMAC-aláírt LAN linkek;
- path traversal védelem és videókiterjesztés allowlist;
- a filmek nem mennek át a Render szerveren;
- teljes médiaindex csak a Média tab megnyitásakor töltődik a PWA-ba;
- Bridge → Render médiaindex csak változáskor, illetve periodikusan frissül;
- v0.15 config kompatibilitás: a meglévő `/DataVolume/homehub/config.json` használható változtatás nélkül.

## Élesítés

### 1. Render / HomeHub server + web

A v0.16.0 csomagot deployold a jelenlegi HomeHub service-re a meglévő Render env változókkal. Új kötelező Render env nincs.

### 2. WD Bridge frissítés

A Média funkcióhoz az új ARMv7 Bridge szükséges. A meglévő config megtartásához:

```sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

A script nem írja felül a `/DataVolume/homehub/config.json` fájlt.

### 3. Ellenőrzés

Otthoni hálózatról:

```text
http://192.168.1.180:8788/health
```

Várt válasz:

```json
{"ok":true,"service":"homehub-media"}
```

Ezután a HomeHubban nyisd meg a **Média** tabot.

## iPhone

- iPhone legyen ugyanazon az otthoni Wi-Fi-n;
- `Lejátszás`: közvetlen WD → iPhone stream;
- `Offline letöltés`: a fájl letöltése iPhone-ra/Fájlokba;
- MKV/AVI esetén Infuse vagy VLC ajánlott.

## Validáció

- `go test ./...`: PASS
- Linux amd64 Bridge build: PASS
- Linux ARMv7 Bridge build: PASS
- Bridge version check: `0.16.0`
- TypeScript/TSX syntaktikai validáció: PASS
- JSON konfigurációs példák: PASS
- ZIP integritás: release csomagoláskor ellenőrizve
