# HomeHub v0.9.1

Otthoni vezérlőközpont a jelenlegi setuphoz:

- Shuttle OMNINAS KD20 + Transmission
- WD My Cloud OS 3 / ARMv7 Bridge
- KD20 → WD automatikus másolás, progresszel
- KD20 USB Print Server állapot
- Technicolor FGA2233, Archer C6, RE220, 2× RE315
- Smart Life / Tuya Central Europe
- PWA / Render webfelület

## v0.9.1 hotfix + v0.9 újdonságok

### v0.9.1 hotfix

- Külön 20 másodperces bridge heartbeat fut a hosszú SMB másolásoktól, LAN probe-októl és parancsoktól függetlenül.
- A Render külön `/api/bridge/heartbeat` végponton frissíti a jelenlétet, ezért egy hosszú másolás alatt sem szabad tévesen offline-ra váltania.
- A PWA cache verzió frissült; a service worker `updateViaCache: "none"` módban frissül, az app shell és a `sw.js` no-cache fejlécet kap.
- Offline állapotnál a fejléc kiírja az utolsó Bridge kapcsolat óta eltelt időt.


### Torrent

- manuális **Törlés** minden torrentnél
- két külön, megerősítést igénylő művelet:
  - csak a torrent eltávolítása a Transmissionből, a KD20 fájlok megtartásával
  - torrent + KD20 helyi fájlok törlése
- a WD My Cloudra már átmásolt példányt egyik törlés sem érinti
- seedelési állapot megjelenítése

### Render / tartósság

- Bridge felhős polling alapérték: **30 mp**
- Render bridge-stale ablak: **90 mp**
- a HomeHub tartós állapotának WD-s backupja:
  - `/DataVolume/homehub/server-state.json`
- a Bridge minden sikeres szinkron után elmenti a szerver beállításait, másolási állapotait és parancsállapotát
- Render restart/deploy után a WD visszatölti a tartós állapotot
- Render kiesése alatt a már ismert automatikus KD20 → WD másolási beállítás helyben tovább működik
- az AutoCopy saját állapota továbbra is:
  - `/DataVolume/homehub/autocopy-state.json`

### Hálózat

- az online állapot már nem kizárólag a webadmin TCP portjától függ
- ping + ARP + TCP admin-port ellenőrzés
- külön `online` és `adminOnline` állapot
- az Archer C6 akkor is online-ként jelenhet meg, ha a webadmin nem válaszol
- RE220 / RE315 MAC → IP felderítéshez sűrűbb ARP warm-up

### Smart Life

- szenzorokon nincs több értelmetlen hőmérséklet-beállító mező
- szigorúbb akkumulátor százalék felismerés
- külön szenzor, kapcsoló, világítás, klíma, kapu és általános eszköz kártya
- klímánál dinamikus:
  - be/ki
  - célhőmérséklet
  - üzemmód
  - ventilátorfokozat, ha a Tuya specifikáció publikálja
- Tap-to-Run jelenetek lekérése a Smart Home `home` scene API-val, voice API fallbackkel
- kapu/zár jellegű műveletek továbbra is kézi megerősítést kérnek

### Mobil / PWA

- kisebb kijelzőn újratördelt Smart Life és torrent vezérlők
- törlési műveletek külön biztonsági modalban

## Render environment

```text
APP_PASSWORD=...
BRIDGE_TOKEN=...
COOKIE_SECRET=...
TUYA_ACCESS_ID=...
TUYA_ACCESS_SECRET=...
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_REFRESH_MS=15000
BRIDGE_STALE_MS=90000
```

`TUYA_ACCESS_SECRET`-et ne tedd Gitbe.

## WD Bridge frissítés v0.9.1-re

Windows PowerShell, a kicsomagolt `bridge` mappában:

```powershell
scp -O -o HostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-bridge-v09
ssh -o HostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

WD My Cloud SSH-ban:

```sh
/etc/init.d/homehub-bridge stop
rm -f /DataVolume/homehub/homehub-bridge
cp /DataVolume/homehub-bridge-v09 /DataVolume/homehub/homehub-bridge
chmod 755 /DataVolume/homehub/homehub-bridge
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge start
/etc/init.d/homehub-bridge status
```

Várt verzió:

```text
homehub-bridge 0.9.1 linux/arm
```

A régi `config.json` használható. Ha `pollSeconds` még `3`, a v0.9 automatikusan 30 másodpercre migrálja futás közben. Új telepítésnél a példa config már 30-at tartalmaz.

## Tartós állapot ellenőrzése

Az első sikeres v0.9 szerver + Bridge szinkron után:

```sh
ls -lh /DataVolume/homehub/server-state.json
cat /DataVolume/homehub/server-state.json
```

A fájlban nem tárolunk Smart Life secretet vagy HomeHub belépési jelszót. A Bridge token a meglévő `config.json`-ban marad, 600-as jogosultsággal ajánlott.

## Build

Bridge:

```sh
cd bridge
go test ./...
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/homehub-bridge-linux-armv7 ./cmd/homehub-bridge
```

Web/server:

```sh
npm install
npm run build
```
