# nCore kereső a HomeHubban

A 0.23.8-tól a **Letöltések** oldali nCore kereső nem a bejelentkezett weboldalt scrape-eli a Render szerverről. A Render adatközponti IP-jét az nCore Cloudflare ellenőrzése blokkolhatja, ezért a keresés RSS-alapú finder útvonalon működik, a privát nCore passkey pedig kizárólag a torrent letöltéséhez használatos.

## Render Environment

Kötelező:

```text
NCORE_ENABLED=true
NCORE_PASSKEY=<saját nCore passkey>
```

Opcionális:

```text
NCORE_BASE_URL=https://ncore.pro
NCORE_FINDER_URL=https://finderss.it.cx/
NCORE_SEARCH_LIMIT=25
NCORE_TIMEOUT_MS=20000
```

A régi `NCORE_COOKIE` változó már nem szükséges, törölhető. A `NCORE_RSS_KEY` visszafelé kompatibilis alias marad a `NCORE_PASSKEY` számára, de új telepítésnél az `NCORE_PASSKEY` használata javasolt.

## Passkey beszerzése

1. Jelentkezz be az nCore-ba a saját böngésződben.
2. Nyisd meg a **Beállítások / Egyéb** részt.
3. Másold ki a saját passkey értékedet.
4. Render → Environment alatt add hozzá `NCORE_PASSKEY` néven.
5. Mentsd a változót és indíts új deployt/restartot.

A passkey titkos hitelesítési adat. Ne kerüljön GitHubba, logba, képernyőképbe vagy a HomeHub kliensoldalára.

## Működés

- A HomeHub a keresőkifejezést és a kiválasztott Film/Sorozat kategóriákat az RSS findernek küldi.
- A passkey **nem kerül elküldésre a findernek**.
- A finder RSS találataiból a HomeHub csak címet, kategóriát, dátumot és torrent azonosítót ad át a böngészőnek.
- A `Hozzáadás KD20-hoz` gombnál a HomeHub a szerveroldalon fűzi hozzá a passkey-t a torrent letöltési URL-hez, majd a meglévő `/api/torrents/file` útvonalon továbbítja a `.torrent` fájlt a KD20 Transmissionnek.

Ha a keresés működik, de a `.torrent` fájl letöltését az nCore Cloudflare a Render felől külön blokkolja, a következő fallback a letöltési URL WD/KD20 helyi hálózaton történő átadása. Ehhez nem kell a Cloudflare ellenőrzést megkerülni.

## Biztonság

- Az nCore végpontok csak a HomeHub admin session számára érhetők el.
- A passkey nem kerül bele a keresési API válaszaiba.
- A böngésző csak a keresési eredmények metaadatait kapja meg.
- A `.torrent` fájl csak rövid ideig halad át memóriában a szerveren.

A funkciót csak olyan tartalomhoz használd, amelyhez jogszerű hozzáférésed van.
