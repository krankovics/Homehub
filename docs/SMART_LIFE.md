# Smart Life / Tuya integráció

A HomeHub v0.8 a Tuya Cloud API-t használja. A Smart Life-fiókot a Tuya Developer Platformon a Cloud Projecthez kell linkelni.

## Render environment változók

- `TUYA_ACCESS_ID`: a Cloud Project Access ID / Client ID
- `TUYA_ACCESS_SECRET`: a Cloud Project Access Secret / Client Secret
- `TUYA_API_ENDPOINT`: Central Europe esetén `https://openapi.tuyaeu.com`
- `TUYA_REFRESH_MS`: alapértelmezetten `15000`

A Client Secretet ne tedd Gitbe és ne írd a Bridge configba. Csak Render secretként add meg.

## Mit tud a v0.8?

- A Smart Life-fiókhoz kapcsolt eszközök automatikus lekérése, lapozással.
- Online/offline állapot és a Tuya DP status mezők megjelenítése.
- Hőmérséklet/páratartalom szenzorok automatikus felismerése.
- Smart Plug / Smart Socket / kapcsolók ki-be vezérlése.
- Klíma ki-be, célhőmérséklet és mód vezérlése, ha az eszköz ezeket a standard Tuya DP-ket publikálja.
- Smart Life jelenetek lekérése és kézi indítása, ha a projekthez engedélyezett a Scene/Voice API.
- Kapu, zár, garage/gate nevű eszköz vagy jelenet csak külön megerősítéssel futtatható.

## API jogosultság

Ha a HomeHub `Tuya 1106: Invalid permission` hibát jelez, a Tuya Cloud Project `Authorization` / `Service API` részén engedélyezni kell a projekt számára az IoT Core / Smart Home Device Management és a használt Smart Home Device Control API-kat. Jelenetekhez a scene/voice API jogosultság is szükséges lehet.

## Biztonság

A HomeHub nem küldi a Tuya Access Secretet a WD My Cloud Bridge-re. A Tuya API-hívások kizárólag a Renderen futó szerverről mennek.
