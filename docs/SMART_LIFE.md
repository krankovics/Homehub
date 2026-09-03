# Smart Life / Tuya v0.9

A HomeHub a Tuya Central Europe Cloud API-t használja.

Render environment:

```text
TUYA_ACCESS_ID=...
TUYA_ACCESS_SECRET=...
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_REFRESH_MS=15000
```

A secret ne kerüljön Gitbe vagy a WD Bridge configjába.

## Eszközök

A kártyák a Tuya által publikált státusz- és function-specifikációból épülnek fel. A v0.9 külön kezeli:

- hőmérséklet/páratartalom szenzor
- kapcsoló / konnektor
- világítás
- klíma
- kapu/zár jellegű eszköz
- ismeretlen/generikus eszköz

Szenzorra nem kerül vezérlőmező. Klímánál csak a ténylegesen publikált célhőmérséklet, mód és ventilátorvezérlés jelenik meg.

## Jelenetek

A HomeHub először a Smart Home Scene API-t használja:

- `GET /v1.1/homes/{home_id}/scenes`
- fallback: `GET /v1.0/homes/{home_id}/scenes`
- futtatás: `POST /v1.0/homes/{home_id}/scenes/{scene_id}/trigger`

Ha a device-listában nincs `home_id`, a tokenhez tartozó `uid` alapján lekéri a home-listát. Végső fallbackként megmarad a korábbi voice scene API.

Kapu, garázs, ajtó, lock/zár nevű jelenetek és eszközök kézi megerősítést kérnek.

## v0.11 speciális eszközpanelek

- `gatePRO`: dinamikus Start / Stop / Személybejáró / Nyitás / Zárás / Világítás műveletek, Tuya functions alapján.
- `feyree Portable charger`: EV-töltő panel feszültség, áram, teljesítmény, energia, CP és beállítható current/delay/time mezőkkel.
- A funkciók nincsenek vakon hardcode-olva egyetlen DP ID-ra; code-pattern + specification alapján kerülnek feloldásra.
