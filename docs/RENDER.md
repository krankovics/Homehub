# Render telepítés

A HomeHub web/PWA egyetlen Dockeres Render Web Service-ként fut.

## 1. Projekt Git repositoryba

A teljes `homehub-mvp-v0.5` könyvtár kerüljön egy GitHub/GitLab repository gyökerébe.

## 2. Render Blueprint

Renderben: New -> Blueprint -> repository kiválasztása. A gyökérben lévő `render.yaml` létrehozza a `homehub` web service-t.

A deploy előtt két titkos értéket kér:

- `APP_PASSWORD`: ezzel lépsz be a HomeHub webes felületére.
- `BRIDGE_TOKEN`: hosszú véletlen token. Pontosan ugyanez kerül a WD Bridge `config.json` fájljába.

A `COOKIE_SECRET`-et Render generálja.

## 3. URL

Sikeres deploy után például:

`https://homehub-xxxx.onrender.com`

A `/api/health` bejelentkezés nélkül is elérhető.

## 4. Fontos a Free csomagnál

A `/tmp` állapot ideiglenes. Render újraindításkor a HomeHub UI beállításai és parancselőzménye elveszhet, de a NAS fájlokhoz nem nyúl. A Bridge új snapshotot küld, ezért az eszközállapot visszaáll. Tartós cloud state-hez később persistent disk vagy adatbázis tehető alá.
