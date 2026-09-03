# HomeHub v0.11.0

Otthoni vezérlőközpont a jelenlegi setuphoz: Shuttle OMNINAS KD20 + WD My Cloud + Technicolor/TP-Link hálózat + Smart Life/Tuya + USB nyomtató.

## v0.11.0 újdonságok

### gatePRO részletes kapuvezérlés

A Smart Life tabon a `gatePRO` saját vezérlőpanelt kap. A HomeHub a Tuya által ténylegesen publikált funkciókat keresi, ezért csak támogatott művelet aktív.

Tervezett/keresett műveletek:

- Start
- Személybejáró
- Stop
- Nyitás
- Zárás
- Világítás
- kapuállapot
- figyelmeztetés / alarm / fault állapot

A kapu mozgatását végző műveleteknél külön megerősítés szükséges. A világítás kapcsolása nem kap felesleges megerősítést.

### feyree Portable charger részletes EV-töltőpanel

A `feyree Portable charger` automatikusan Autótöltő kategóriába kerül. A részletes panel a Tuya status/functions adatok alapján jeleníti meg, ami ténylegesen elérhető:

- hőmérséklet
- feszültség
- áramerősség
- teljesítmény
- energia
- CP állapot
- töltés indítása / leállítása
- maximális áramerősség
- késleltetett indítás
- töltési idő

Az enum és numerikus Tuya beállításokat külön kezeli: ha a töltő például csak konkrét amperértékeket enged, azok jelennek meg választóként.

### Javított hálózati topológia

A Port 2 ág új, biztonságos tördelést kapott, hogy a kártyák és vonalak ne csússzanak egymásra. A hálózati switch CSS osztályai külön namespace-t kaptak, így nem öröklik a Smart Life ki/be kapcsoló stílusát.

```text
Technicolor FGA2233
├── Wi-Fi: krankovics2
│   └── Krankovics-MBP
├── Port 1
│   └── DESKTOP-E6K3SEK
├── Port 2
│   └── TL-SG108E
│       ├── DorkaPC
│       ├── D-Link GO-SW-5G
│       │   └── TP-Link LiteWave LS105G
│       │       └── davidgaming
│       └── Archer C6
│           └── Wi-Fi / mesh: krankovics
│               ├── RE220
│               ├── RE315 #1  (...:93:86)
│               └── RE315 #2  (...:fe:ce)
├── Port 3
│   └── KD20 / oldnas
└── Port 4
    └── WD My Cloud
```

### Wi-Fi kliensnézet

A v0.11 a TP-Link Tetherből azonosított klienslistát külön panelen is megjeleníti, két csoporttal:

- Archer C6 / `krankovics`: 19 klienses legutóbbi pillanatkép
- RE315 #1 (`dc:62:79:dd:93:86`): 8 klienses legutóbbi pillanatkép

A lista többek között az ESP, `lwip0`, `wlan0`, Xiaomi vacuum, Edina A34, iPhone, Watch és mesh node neveket tartalmazza. Ez a v0.11-ben még **Tetherből felvett pillanatkép**, nem élő Archer API-lekérdezés. A felület ezt egyértelműen jelöli.

### Mobil és desktop UI

- gatePRO akciók reszponzív 3/2/1 oszlopos gridben
- EV töltő mérőszámok külön panelen
- topológia desktopon több hasáb, tableten és mobilon függőleges fa
- hosszú switch- és kliensnevek nem csúsznak össze
- Wi-Fi kliens-chipek automatikusan törnek

## Megmaradt funkciók

- tabos PWA: Áttekintés / Letöltések / Smart Life / Hálózat / Nyomtató / Beállítások
- Transmission RPC a KD20-on
- magnet link és `.torrent` feltöltés
- torrentlista, sebesség, ETA
- manuális WD-re másolás
- automatikus KD20 → WD másolás
- másolási progressz, sebesség, ETA
- manuális torrenttörlés két móddal
- WD-re másolt példány törlésnél érintetlen marad
- külön Bridge heartbeat
- WD-n tartós HomeHub állapot
- Render kiesésétől független helyi automatikus másolás
- Smart Life/Tuya vezérlés és jelenetek
- KD20 USB nyomtatómegosztás

## Render frissítés

A v0.11.0 teljes tartalmával frissítsd ugyanazt a Git repositoryt, amelyről a HomeHub Render service deployol.

A korábbi Environment változók maradnak:

```text
APP_PASSWORD
BRIDGE_TOKEN
COOKIE_SECRET
TUYA_ACCESS_ID
TUYA_ACCESS_SECRET
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_REFRESH_MS=15000
BRIDGE_STALE_MS=90000
```

## WD Bridge frissítés

A v0.11 frontend/server együttműködik a v0.10 Bridge-dzsel is. A csomagban ennek ellenére friss, `0.11.0` ARMv7 Bridge is található.

Windows PowerShellből, a kicsomagolt `bridge` könyvtárban:

```powershell
scp -O -o HostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-bridge-v011
```

Belépés:

```powershell
ssh -o HostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

A WD-n egyenként:

```bash
/etc/init.d/homehub-bridge stop
rm -f /DataVolume/homehub/homehub-bridge
cp /DataVolume/homehub-bridge-v011 /DataVolume/homehub/homehub-bridge
chmod 755 /DataVolume/homehub/homehub-bridge
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge start
/etc/init.d/homehub-bridge status
```

Elvárt verzió:

```text
homehub-bridge 0.11.0 linux/arm
```

A meglévő `/DataVolume/homehub/config.json` fájlt nem kell lecserélni.

## Ellenőrzés

```bash
/etc/init.d/homehub-bridge status
tail -n 40 /DataVolume/homehub/homehub.log
```

A Smart Life tabon a gatePRO és feyree kártyán megjelenik a részletes vezérlés gomb. A Hálózat tabon a javított topológia alatt külön Wi-Fi kliens pillanatkép található.

## Build ellenőrzés

- Bridge: `go test ./...` sikeres
- ARMv7 Bridge újrafordítva, statikusan linkelt Linux/ARM EABI5 bináris
- frontend TSX szintaktikai transzpiláció: sikeres
- Renderen a teljes `npm run build` fut le a tényleges React/Node függőségekkel
