# People, Presence és Home Timeline

## Jelenléti modell

A HomeHub jelenlétet hálózati megfigyelésből becsül. Ez nem GPS és nem személyazonosítás. Egy személy profiljához hálózati eszközazonosítók rendelhetők.

Ajánlott modell:

- telefon: `primary`;
- okosóra / második személyes mobil: `secondary`;
- laptop / asztali gép: `stationary`.

Ha a Bridge nem képes megfigyelni egy elsődleges eszköz hálózati szegmensét, a rendszer `uncertain` állapotot használ, nem `away` állapotot.

## Timeline adattípusok

A szerver 90 napig, maximum 10 000 eseményt tart meg. A persistent backup a WD Bridge-en keresztül a `/DataVolume/homehub/server-state.json` fájlba tükröződik.

Az API:

`GET /api/history?category=network&limit=500`

Támogatott kategóriák: `presence`, `network`, `security`, `smart`, `energy`, `automation`, `system`.

## Profilképek

A web kliens nagyobb képet 320 px körüli JPEG képpé alakít, majd `POST /api/people/:id/avatar` végpontra küldi. A kis normalizált kép a személy persistent rekordjának része, így a WD állapotmentésből helyreállítható.

## AI

Az AI kontextus az utolsó 72 óra legfeljebb 700 timeline eseményét tartalmazza. Ez szándékos méretkorlát. Hosszabb időszak elemzéséhez később célzott history-query tool ajánlott a teljes eseménytár promptba helyezése helyett.
