# HomeHub v0.10.0

Otthoni vezérlőközpont a jelenlegi setuphoz: Shuttle OMNINAS KD20 + WD My Cloud + Technicolor/TP-Link hálózat + Smart Life/Tuya + USB nyomtató.

## v0.10.0 újdonságok

### Új, tabos kezelőfelület

A korábbi hosszú egyoldalas dashboard helyett hat külön nézet van:

1. **Áttekintés** – fő státuszok és gyors összefoglalók
2. **Letöltések** – magnet/.torrent, torrentlista, WD másolás, manuális törlés
3. **Smart Life** – Tuya eszközök, klíma, szenzorok, kapcsolók, jelenetek
4. **Hálózat** – fizikai topológia + élő Bridge mérések
5. **Nyomtató** – KD20 USB Print Server
6. **Beállítások** – automatikus másolás, célmappa, rendszerállapot

A kiválasztott tab URL hash-ben marad meg (`#downloads`, `#smart`, `#network` stb.), ezért frissítés után is ugyanoda tér vissza a PWA.

### UI/UX javítás

- Smart Life kártyák nem csúsznak egymásra.
- Hosszú eszköznevek maximum két sorosak.
- A vezérlők saját, stabil action area-t kaptak.
- Auto-fit grid desktopon, tableten és mobilon.
- Mobilon minden kapcsoló, input és gomb teljes szélességen, törés nélkül jelenik meg.
- Smart Life kategóriaszűrők: Összes, Kapcsoló, Szenzor, Klíma, Világítás, Kapu, Eszköz.
- Szenzorok olvasási nézetben maradnak; célhőmérséklet csak klímán jelenik meg.
- `battery_state=high/middle/low` értékek is értelmezett akkumulátorszintként jelennek meg.

### Valódi otthoni hálózati topológia

A Hálózat tab a jelenlegi fizikai struktúrát rajzolja ki:

```text
Internet
└── Technicolor FGA2233
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
    │               ├── RE315 #1
    │               └── RE315 #2
    ├── Port 3
    │   └── KD20 / oldnas
    └── Port 4
        └── WD My Cloud
```

A D-Link GO-SW-5G és TP-Link LiteWave LS105G nem menedzselhető, ezért passzív topológiai elemként látszanak. A mögöttük lévő gépek élő státusza külön mérhető.

### Több élő hálózati eszköz a Bridge-ben

A v0.10 Bridge a régi `/DataVolume/homehub/config.json` lecserélése nélkül automatikusan hozzáadja, ha még hiányoznak:

- TL-SG108E – `192.168.1.49`
- KD20 / oldnas – `192.168.1.12`
- WD My Cloud – `192.168.1.180`
- DESKTOP-E6K3SEK – `192.168.1.25`
- DorkaPC – `192.168.1.210`
- davidgaming – `192.168.1.138`
- Krankovics-MBP – `192.168.1.114`

A korábbi Technicolor, Archer C6, RE220 és 2× RE315 beállítások megmaradnak.

## Megmaradt funkciók

- Transmission RPC a KD20-on
- magnet link és `.torrent` feltöltés
- torrentlista, sebesség, ETA
- manuális WD-re másolás
- automatikus KD20 → WD másolás
- másolási progressz, sebesség, ETA
- manuális torrenttörlés:
  - csak torrent eltávolítása
  - torrent + KD20 fájlok törlése
- WD-re másolt példány törlésnél érintetlen marad
- külön Bridge heartbeat
- WD-n tartós HomeHub állapot
- Render kiesésétől független helyi automatikus másolás
- Smart Life/Tuya vezérlés
- kapu jellegű műveletek megerősítéssel
- KD20 USB nyomtatómegosztás
- PWA

## Render frissítés

A v0.10.0 teljes tartalmával frissítsd ugyanazt a Git repositoryt, amelyről a HomeHub Render service deployol.

A korábbi Environment változók maradnak, többek között:

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

Windows PowerShellből, a kicsomagolt `bridge` könyvtárban:

```powershell
scp -O -o HostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-bridge-v010
```

Belépés:

```powershell
ssh -o HostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

A WD-n egyenként:

```bash
/etc/init.d/homehub-bridge stop
rm -f /DataVolume/homehub/homehub-bridge
cp /DataVolume/homehub-bridge-v010 /DataVolume/homehub/homehub-bridge
chmod 755 /DataVolume/homehub/homehub-bridge
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge start
/etc/init.d/homehub-bridge status
```

Elvárt verzió:

```text
homehub-bridge 0.10.0 linux/arm
```

A meglévő `/DataVolume/homehub/config.json` fájlt **nem kell lecserélni**.

## Ellenőrzés

```bash
/etc/init.d/homehub-bridge status
tail -n 40 /DataVolume/homehub/homehub.log
```

A HomeHub weben az új felső tabsor jelenik meg. A Hálózat tabon a topológia mellett az `Élő eszközállapot` blokkban a Bridge által felismert eszközök látszanak.

## Build ellenőrzés

- Bridge: `go test ./...` sikeres
- ARMv7 Bridge újrafordítva, statikusan linkelt Linux/ARM EABI5 bináris
- frontend és server TypeScript forrás szintaktikai ellenőrzése sikeres
