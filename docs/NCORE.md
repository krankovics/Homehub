# nCore kereső a HomeHubban

A 0.23.6 kiegészítés a **Letöltések** oldalon nCore keresőt jelenít meg. A találatból a `.torrent` fájl közvetlenül a már meglévő HomeHub `/api/torrents/file` útvonalán kerül a KD20 Transmissionhöz.

## Render Environment

Kötelező:

```text
NCORE_ENABLED=true
NCORE_COOKIE=<a bejelentkezett nCore böngésző session Cookie request header értéke>
```

Opcionális:

```text
NCORE_BASE_URL=https://ncore.pro
NCORE_SEARCH_LIMIT=25
NCORE_TIMEOUT_MS=20000
NCORE_RSS_KEY=<opcionális nCore RSS/download key>
```

A `NCORE_COOKIE` titkos hitelesítési adat. Ne kerüljön GitHubba, logba vagy a HomeHub kliensoldalára. Kizárólag Render Environment változóban tárold.

### Cookie beszerzése

1. Jelentkezz be az nCore-ba a saját böngésződben.
2. DevTools → Network.
3. Nyisd meg vagy frissítsd a `torrents.php` oldalt.
4. A kérés `Request Headers` részében keresd meg a `Cookie` fejlécet.
5. A teljes Cookie fejléc **értékét** másold a Render `NCORE_COOKIE` változóba.
6. Mentsd a változót és indíts új deployt/restartot.

Ha a session később lejár, a HomeHub `ncore_session_expired` hibát jelez. Ilyenkor friss Cookie értéket kell megadni Renderben.

## Biztonság

- Az nCore végpontok csak a HomeHub admin session számára érhetők el.
- A Cookie és az RSS key nem kerül bele az API válaszaiba.
- A böngésző csak a keresési eredmény metaadatait kapja meg.
- A `.torrent` fájl rövid ideig memóriában halad át a szerveren, majd a meglévő KD20 feltöltési útvonalra kerül.

A funkciót csak olyan tartalomhoz használd, amelyhez jogszerű hozzáférésed van.
