# WD My Cloud Bridge, OS 3 / ARMv7

Tesztelt környezet: WD My Cloud 2 TB, firmware 04.06.00-111, armv7l.

## Konfiguráció

A `bridge/config.wdmycloud.example.json` fájlban állítsd be:

- `serverUrl`: a Render URL, pl. `https://homehub-xxxx.onrender.com`
- `token`: pontosan a Render `BRIDGE_TOKEN`

A KD20 beállításai már a jelenlegi hálózathoz vannak igazítva:

- Transmission RPC: `192.168.1.12:9091/transmission/rpc`
- SMB: `//192.168.1.12/disk`
- torrent könyvtár: `contents`
- SMB1/NTLM: `vers=1.0,sec=ntlm,nounix`

## Cloud kapcsolat tesztelése

A WD-n:

```sh
/DataVolume/homehub-bridge -once -config /DataVolume/config.json
```

Siker esetén nem jelenik meg `snapshot:` vagy `commands:` hiba, a HomeHub webes felület pedig néhány másodpercen belül online Bridge-et mutat.

Ha kizárólag `x509: certificate signed by unknown authority` hiba jelentkezik a régi WD CA-tára miatt, ideiglenes diagnosztikához a configban `serverTlsInsecure: true` használható. Ez kikapcsolja a szerver tanúsítvány-ellenőrzését, ezért tartós használatra nem ajánlott.

## Automatikus indulás

Miután a `-once` teszt működik, az `install-wd-os3.sh` telepíti a Bridge-et `/DataVolume/homehub` alá és létrehozza az init scriptet.

## v0.16 Média szerver

A v0.16 Bridge helyi HTTP médiaszervert is indít. A jelenlegi WD címmel az alapértelmezett endpoint:

```text
http://192.168.1.180:8788/health
```

A filmek lejátszási és offline letöltési URL-jei csak a helyi hálózaton működnek, és HMAC-aláírással + lejárati idővel védettek. A nagy filmfájlok nem kerülnek a Renderre.

Meglévő v0.15 telepítés frissítése a config felülírása nélkül:

```sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

Ez a `/DataVolume/homehub/config.json` fájlt változatlanul hagyja. Ha a régi configban nincs `media` blokk, a Bridge automatikusan a `Filmek` célmappát és a WD ismert LAN-címét használja.
