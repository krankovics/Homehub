# HomeHub MVP v0.5

Deploy-kész PWA + cloud API + WD My Cloud Bridge a jelenlegi Shuttle OMNINAS KD20 / WD My Cloud setuphoz.

## v0.5 újdonságok

- valódi, jelszóval védett webes felület
- HTTP-only, aláírt session cookie
- külön Bridge token
- Render `render.yaml` és Docker deploy
- Bridge online/offline stale detection
- PWA ikonok és installálható mobilos felület
- magnet link + `.torrent` feltöltés
- KD20 torrentlista és élő sebesség
- kézi KD20 -> WD másolás
- automatikus kész-torrent másolás, KD20 törlése nélkül
- WD szabad hely és foglaltság
- WD OS 3 ARMv7 Bridge
- KD20 Transmission RPC `:9091`
- KD20 `disk/contents` SMB1 + NTLM guest mount

## Jelenlegi valós NAS beállítás

KD20: `192.168.1.12`

WD My Cloud: `192.168.1.180`, OS 3 firmware `04.06.00-111`, ARMv7.

## Build

```sh
npm install
npm run build
```

## Helyi web indítás

```sh
APP_PASSWORD=homehub BRIDGE_TOKEN=dev-token COOKIE_SECRET=dev-secret npm start
```

Majd: `http://localhost:8787`

## Render

Lásd: `docs/RENDER.md`.

## WD Bridge

Lásd: `docs/WD_BRIDGE.md`.
