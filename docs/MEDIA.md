# HomeHub Media v0.16.0

A Média modul a WD My Cloudon futó HomeHub Bridge része. A cél, hogy a filmek iPhone-ról böngészhetők, helyben streamelhetők és offline letölthetők legyenek úgy, hogy a több GB-os fájlok ne menjenek át a Renderen.

## Alapértelmezett működés

A meglévő setupnál:

- WD My Cloud: `192.168.1.180`
- WD media root: `/DataVolume/shares/Public`
- filmek: `/DataVolume/shares/Public/Filmek`
- helyi media server: `http://192.168.1.180:8788`

Régi config fájlnál a v0.16 a Média modult automatikusan bekapcsolja, a `media.secret` értékét a meglévő Bridge tokenből veszi, és a `media.roots` első elemeként az `autoCopy.destination` mappát használja.

## Opcionális explicit config

```json
"media": {
  "enabled": true,
  "listen": "0.0.0.0:8788",
  "publicBaseUrl": "http://192.168.1.180:8788",
  "secret": "CHANGE-ME-LONG-RANDOM-SECRET",
  "maxItems": 2500,
  "roots": [
    { "id": "movies", "name": "Filmek", "path": "Filmek" }
  ]
}
```

A `roots[].path` mindig a `wd.mediaRoot` alatti relatív útvonal. `..` könyvtárbejárás nem engedélyezett.

## iPhone

A **Lejátszás** gomb top-level helyi URL-t nyit a WD Bridge-en. MP4, M4V és MOV formátumnál az iOS/Safari natív lejátszó használható. MKV, AVI és más konténer esetén Infuse vagy VLC ajánlott.

Az **Offline letöltés** gomb attachment választ küld. iOS-en a fájl a Safari letöltések/Fájlok app felé menthető, és később hálózat nélkül is megnyitható. A tényleges lejátszhatóság az iPhone-on lévő app és a videó/audio codec támogatásától függ.

## Biztonság

- a média endpoint csak a WD Bridge helyi HTTP szerverén fut;
- minden film URL tartalmaz lejárati időt és HMAC-SHA256 aláírást;
- az alapértelmezett lejárat 24 óra;
- a Bridge ellenőrzi, hogy a kért fájl a `wd.mediaRoot` alatt maradjon;
- csak engedélyezett videókiterjesztések szolgálhatók ki;
- `http.ServeContent` kezeli a Range requesteket és a seeket;
- a filmfájl nem kerül feltöltésre a Renderre.

## Támogatott videókiterjesztések

`mp4`, `m4v`, `mov`, `mkv`, `avi`, `webm`, `ts`, `m2ts`, `mpeg`, `mpg`.

## Hálózati feltétel

Az iPhone-nak el kell érnie a WD My Cloud `8788/TCP` portját. A jelenlegi otthoni setupban ez ugyanazon LAN/Wi-Fi használatát jelenti. Távoli, internet felőli lejátszást ez a verzió szándékosan nem nyit meg.
