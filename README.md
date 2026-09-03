
## v0.8.2 Render build hotfix

- Javítva a TypeScript `TS18048` build hiba a Smart Life kártyánál.
- A web kliens most biztonságos üres Smart Home állapotot használ addig is, amíg a `/api/state` még nem tartalmaz Tuya adatot.
- A WD-n futó Bridge-et nem kell frissíteni: a 0.8.0 bridge kompatibilis ezzel a web/server hotfixszel.

# HomeHub MVP v0.8

PWA + Render API + WD My Cloud ARMv7 Bridge a jelenlegi otthoni setuphoz: Shuttle OMNINAS KD20, WD My Cloud, USB nyomtató, Technicolor/TP-Link hálózat és Smart Life/Tuya.

## v0.8 újdonságok

- **Smart Life / Tuya Cloud adapter** a Render szerveren.
- A kapcsolt Smart Life-fiók összes eszközét dinamikusan lekéri, nem kell Device ID-ket kézzel felvenni.
- Szenzorok: hőmérséklet, páratartalom és elérhető akkumulátoradatok.
- Smart Plug / Socket / kapcsolók: ki-be vezérlés.
- Klíma: ki-be, célhőmérséklet és mód, ha az adott Tuya eszköz publikálja ezeket a DP-ket.
- Smart Life jelenetek megjelenítése és indítása, ha a projekt API-jogosultsága engedi.
- Kapu/zár/garage/gate jellegű vezérlésekhez kötelező kézi megerősítés; automatikus kapunyitás nincs.
- **Hálózat modul** a WD Bridge-ben: Technicolor FGA2233, Archer C6, RE220 és 2× RE315 online/offline, IP, MAC, válaszidő és admin shortcut.
- MAC alapján ismert extenderek IP-címének ARP-alapú felderítése.
- Megmarad minden v0.7 funkció: torrentek, magnet + `.torrent`, automatikus KD20 → WD másolás progresszel, USB Print Server monitorozás.

## Valós környezet

- KD20: `192.168.1.12`
- WD My Cloud: `192.168.1.180`, OS3 `04.06.00-111`, ARMv7
- Technicolor FGA2233: `192.168.1.1`
- Archer C6: `192.168.1.129`
- RE220 + 2× RE315: MAC alapján felderítve
- Tuya: Central Europe Data Center

## Render: új environment változók

A meglévő `APP_PASSWORD`, `BRIDGE_TOKEN`, `COOKIE_SECRET` marad.

Add hozzá:

```text
TUYA_ACCESS_ID=<Tuya Access ID / Client ID>
TUYA_ACCESS_SECRET=<Tuya Access Secret / Client Secret>
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_REFRESH_MS=15000
```

A `TUYA_ACCESS_SECRET` kizárólag Render secret legyen. Ne kerüljön Gitbe és ne kerüljön a WD-re.

Részletesen: `docs/SMART_LIFE.md`.

## WD Bridge hálózati config

A `bridge/config.wdmycloud.example.json` tartalmazza a jelenlegi router/extender listát. A már telepített `/DataVolume/homehub/config.json` fájlt nem kell módosítani: ha nincs benne `network` blokk, a v0.8 Bridge automatikusan betölti a jelenlegi Technicolor/Archer/RE220/RE315 alaplistát. Később természetesen felülírható saját konfigurációval.

Részletesen: `docs/NETWORK.md`.

## Bridge frissítés

Windowsból töltsd fel:

```powershell
scp -O -o HostKeyAlgorithms=+ssh-rsa .\bridge\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-bridge-v08
```

WD-n:

```sh
/etc/init.d/homehub-bridge stop
rm -f /DataVolume/homehub/homehub-bridge
cp /DataVolume/homehub-bridge-v08 /DataVolume/homehub/homehub-bridge
chmod 755 /DataVolume/homehub/homehub-bridge
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge start
/etc/init.d/homehub-bridge status
```

Elvárt verzió:

```text
homehub-bridge 0.8.0 linux/arm
```

## Tuya API

A HomeHub a Tuya Cloud HMAC-SHA256 hitelesítését használja, tokent kér, majd a kapcsolt App user device listát olvassa. A device control a standard Tuya command API-n történik. A kliens a modern Cloud signature algoritmust használja, és kompatibilitási fallbacket tartalmaz a régebbi signature módszerhez.

Ha `1106 Invalid permission` hiba jelenik meg, ellenőrizd a Tuya projekt `Authorization / Service API` részét.

## Build

Web/server:

```sh
npm install
npm run build
```

Bridge:

```sh
cd bridge
make build
```


## v0.8.2 Render build hotfix

- Fixes Express 5 route parameter typing (`string | string[]`) in the server build.
- Normalizes all route params before using them as IDs or Record keys.
- No WD Bridge upgrade is required when moving from 0.8.0/0.8.1 server UI to this hotfix.
