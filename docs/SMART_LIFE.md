# Smart Life / Tuya v0.12.0

A HomeHub a Tuya Central Europe Cloud API-t használja.

Render environment:

```text
TUYA_ACCESS_ID=...
TUYA_ACCESS_SECRET=...
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_REFRESH_MS=15000
```

A secret ne kerüljön Gitbe vagy a WD Bridge configjába.

## Control Instruction Mode

A v0.12.0 három ismert termékprofilnál a Tuya **DP Instruction** kódjait használja. A Tuya Developer Platformon a Homehub Cloud Projectben ezeknél a termékeknél a `DP Instruction` mód legyen kiválasztva:

- myGate / gatePRO
- feyree Portable charger
- 新风分体机-NEW / Air Conditioner

Deploy után a Render újraindul, így a korábban cache-elt specification lista is frissen töltődik.

## myGate / gatePRO

Ismert DP Instruction mapping:

```text
door_sensor_state  -> kapuállapot
light_1            -> világítás állapottartó Boolean (Be/Ki)
stop_1             -> stop impulzus
pedestrian_1       -> személybejáró impulzus
start_1            -> start impulzus
open_1             -> nyitás impulzus
close_1            -> zárás impulzus
keep_open          -> nyitva tartás állapot
pause_time         -> automata zárási idő
operative_mode_1   -> üzemmód
alarms             -> figyelmeztetés / riasztás
```

A v0.16.1-től az Open / Close / Start / Stop / Pedestrian műveleteket impulzusos DP-ként kezeljük, ezekhez csak `true` parancs megy. A `light_1` külön állapottartó Boolean: a HomeHub az aktuális állapot alapján `true` vagy `false` értéket küld, így a világítás be- és kikapcsolható.

A kapuállapot magyar mappingje:

```text
Closed            -> Zárt
Opening           -> Nyílik
Partially Opened  -> Részben nyitva
Opened            -> Nyitva
Closing           -> Záródik
```

Nyitás, zárás, start és személybejáró külön felhasználói megerősítést kér. A Stop és Világítás közvetlen művelet.

## feyree Portable charger

A profil felismeri többek között ezeket a DP-ket:

```text
work_statesvg
work_modesvg
switchsvg
charge_energy_oncesvg
A_Voltage / B_Voltage / C_Voltage
A_Current / B_Current / C_Current
DeviceKw
DeviceTemp / DeviceTemp2
DeviceKwh
DeviceMaxSetA
SetDelayTime
SetDefineTime
Ctime
PE
ChargingOperation
cp
```

A részletes panelen megjelenik az állapot, feszültség, áram, teljesítmény, energia, CP és fázisadatok, amennyiben a Tuya státuszban ténylegesen rendelkezésre állnak. A v0.16.1 a tényleges töltést elsősorban a mért áram/teljesítményből állapítja meg, mert egyes Feyree firmware-ek töltés közben is `charger free` work_state értéket küldenek. Az ismert elektromos DP-k mértékegységét a HomeHub a DP jelentése alapján is korrigálja, ha a Tuya status specification hibás unitot közöl.

Áramerősséget és időzítést a HomeHub csak akkor enged módosítani, ha az adott DP-hez a Tuya API function specificationt is ad, és abból ismert a típus/tartomány. A `Set16A`, `Set32A`, `Set40A`, `Set50A`, `set60a`, `set80a` kódokat a HomeHub nem aktiválja találomra.

## 新风分体机-NEW / Air Conditioner

Ismert DP-k:

```text
Powersvg                -> ki/be
temp_setsvg             -> célhőmérséklet
temp_currentsvg         -> aktuális hőmérséklet
modesvg                 -> üzemmód
windspeed               -> ventilátor
humidity_currentsvg     -> páratartalom
up_down_sweep           -> fel/le swing
left_right_sweep        -> bal/jobb swing
sleep                    -> sleep
fresh_air                -> friss levegő
pm25                     -> PM2.5
airquality               -> levegőminőség
freshair_filter          -> szűrő
dirty_filter             -> szűrő szennyezettség
energy / kwh             -> energia
work_time / run_time     -> üzemidő
Fault / fault2           -> hiba
SN_SW_ver                -> firmware
```

A célhőmérséklet, mód, ventilátor és swing csak a Tuya API által publikált típus/range alapján válik vezérelhetővé. A HomeHub nem talál ki enum értékeket vagy hőmérséklet-tartományt.

## Szerveroldali DP-védelem

A `/api/smart-home/devices/:id/command` végpont v0.12.0-től ellenőrzi, hogy a kért DP szerepel-e az adott eszköz publikált/ismert function listájában, és ahol van specification, validálja a Boolean, Enum és numerikus értékeket is.

Diagnosztikához bejelentkezés után elérhető:

```text
GET /api/smart-home/devices/{device_id}/debug
```

Ez kiadja az aktuális raw status, functions és statusSpec adatokat secret nélkül.

## Jelenetek

A HomeHub először a Smart Home Scene API-t használja, majd fallbackeket próbál. Kapu, garázs, ajtó, lock/zár nevű jelenetek kézi megerősítést kérnek.
