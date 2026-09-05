# nCore kereső a HomeHubban

A 0.24.0-s irányban a **Letöltések** oldali teljes nCore keresést nem a Render végzi, hanem a WD My Cloudon futó HomeHub Bridge. Ennek oka, hogy a Render adatközponti IP-je Cloudflare ellenőrzést kap, miközben a WD-ről az otthoni internetkapcsolat használható. A régi WD rendszer `wget`/GnuTLS kliensét nem használjuk: a HomeHub Bridge saját Go HTTPS klienssel kapcsolódik az nCore-hoz.

## Render Environment

Kötelező:

```text
NCORE_ENABLED=true
```

Ajánlott tartalék:

```text
NCORE_PASSKEY=<saját nCore passkey>
```

Opcionális:

```text
NCORE_BASE_URL=https://ncore.pro
NCORE_SEARCH_LIMIT=25
NCORE_TIMEOUT_MS=20000
NCORE_BRIDGE_ID=home-1
NCORE_BRIDGE_WAIT_MS=35000
```

Az `NCORE_PASSKEY` csak RSS tartalék keresésre szolgál. A teljes katalógus keresése a WD Bridge-en fut.

## WD Credentials Vault

A teljes kereséshez a WD helyi Vaultban hozz létre egy hozzáférést:

```text
Azonosító: ncore
Név: nCore
Admin URL: https://ncore.pro
Felhasználó: üresen hagyható
Jelszó: a bejelentkezett böngésző nCore kérésének teljes Cookie fejlécértéke
```

A Vault helyi címe a WD-n jellemzően:

```text
http://<WD-IP>:8788/vault
```

Ha a böngésző User-Agentjét is rögzíteni szeretnéd, a `Felhasználó` mezőbe tehető teljes `Mozilla/...` User-Agent. Ha ez üres, a Bridge modern Chrome User-Agentet használ.

A Cookie titkos hitelesítési adat. Ne kerüljön GitHubba, Render Environmentbe, logba vagy chatbe. Ha véletlenül kikerül, jelentkezz ki az nCore-ból és lépj be újra, majd a friss Cookie-t mentsd a Vaultba.

## Működés

1. A HomeHub UI elküldi a keresést a Renderen futó rövid életű nCore brokernek.
2. A WD Bridge körülbelül 2 másodpercenként lekéri az nCore broker parancsait.
3. A Bridge az AES-GCM-mel titkosított helyi Vaultból olvassa ki az `ncore` Cookie-t.
4. A teljes keresést a WD végzi az `ncore.pro/torrents.php` oldalon.
5. A Render csak a találatok metaadatait kapja vissza: torrent ID, cím, kategória, méret, seed/leecher, feltöltési idő.
6. A `Hozzáadás KD20-hoz` gomb egy `ncore.download` parancsot küld a WD Bridge-nek.
7. A Bridge letölti a `.torrent` fájlt az nCore-ról és közvetlenül beadja a KD20 Transmission RPC-nek. A `.torrent` fájl nem halad át a Renderen vagy a böngészőn.

Ha a WD Bridge nincs online vagy az `ncore` Vault-bejegyzés hiányzik, a HomeHub az `NCORE_PASSKEY` megléte esetén a közvetlen nCore RSS feed legfrissebb elemei között tud tartalék keresést végezni. Ez nem teljes katalóguskeresés.

## Hibák

- `ncore_bridge_offline`: a WD Bridge nem érhető el.
- `ncore_bridge_credentials_missing`: nincs `ncore` bejegyzés vagy Cookie a WD Vaultban.
- `ncore_session_expired`: az nCore session lejárt, friss Cookie kell a Vaultba.
- `ncore_cloudflare`: az nCore Cloudflare ellenőrzést kér a WD Bridge felé.
- `ncore_bridge_timeout`: a WD nem válaszolt időben a broker parancsra.
- `kd20_add_failed`: a `.torrent` letöltődött, de a KD20 Transmission nem fogadta el.

## Biztonság

- Az nCore felhasználói végpontok csak HomeHub admin sessionből érhetők el.
- A WD broker végpontok `BRIDGE_TOKEN` Bearer hitelesítést kérnek.
- A Cookie és a passkey nem kerül bele a keresési API válaszaiba.
- A broker parancsok rövid életűek és nem kerülnek a HomeHub tartós állapotmentésébe.
- A `.torrent` fájl WD Bridge módban közvetlenül a WD és a KD20 között halad.

A funkciót csak olyan tartalomhoz használd, amelyhez jogszerű hozzáférésed van.
