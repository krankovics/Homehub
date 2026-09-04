# HomeHub v0.16.1 release

Hotfix a v0.16.0-ra, a felhasználói eszközállapotok alapján.

## Feyree EV töltő

- A töltési állapot már nem kizárólag a `work_statesvg/work_state` DP-ből készül.
- Ha az A fázis mért árama > 0.5 A vagy a teljesítmény > 0.05 kW, a HomeHub `Töltés folyamatban` állapotot jelez.
- Ha nincs tényleges energiaáramlás, de a `ChargingOperation` engedélyezett, `Töltés engedélyezve` jelenik meg.
- A töltés indítása/leállítása gomb a származtatott tényleges állapotot használja, így aktív töltésnél `Töltés leállítása` jelenik meg akkor is, ha a `switchsvg` státusz hibás vagy késik.
- A status DP-k keresése prioritásossá vált: pontos DP-kód találat megelőzi a generikus részszavas találatot. Ez javítja többek között a `DeviceKwh` és más energia mezők kiválasztását.
- A Feyree ismert elektromos DP-ihez a HomeHub korrigálja a félrevezető Tuya unit metaadatot (V, A, kW, kWh, °C).
- `charge_pct` magyar megjelenítése: `Töltés százalék alapján`.

## myGate / gatePRO

- `light_1` többé nem impulzusos DP-ként van kezelve.
- A világítás gomb az aktuális `light_1` állapot alapján `true` / `false` értéket küld.
- A szerver engedélyezi a `light_1=false` parancsot.
- Open / Close / Start / Stop / Pedestrian továbbra is csak `true` impulzust fogad.
- A kapu részletes panelen külön `Világítás be` / `Világítás ki` állapot jelenik meg.

## Deploy

Ehhez a hotfixhez a Render web/server részének frissítése szükséges. A WD Bridge működése nem változott, de a release-verzió egységessége miatt a csomag v0.16.1 Bridge binárisokat is tartalmaz.
