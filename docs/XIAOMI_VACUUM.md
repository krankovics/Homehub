# Xiaomi Robot Vacuum E10 / Xiaomi Home integráció

A HomeHub v0.14.0 a Xiaomi porszívót **helyileg**, a WD My Cloudon futó Bridge-en keresztül kezeli. A Render szervernek nincs szüksége Xiaomi tokenre, és a porszívó helyi LAN-forgalma nem megy át az interneten.

## Miért kell külön connector?

A Xiaomi Robot Vacuum E10 nem Tuya / Smart Life eszköz. A Xiaomi Home alkalmazás a Xiaomi saját miIO / MIoT protokollját használja. Emiatt a HomeHubban vizuálisan ugyanazon a Smart Home tabon szerepel, de technikailag külön connector mögött fut.

## Első lépés: IP-cím

A router/Archer klienslistában keresd a `xiaomi-vacuum-b112...` eszközt, és rögzíts neki DHCP reservationt. A Bridge configban ezt add meg:

```json
"ip": "192.168.1.X"
```

## Második lépés: helyi Xiaomi token

A porszívó helyi miIO tokenje 16 byte, a configban 32 hex karakterként szerepel. A tokent ne küldd Renderre és ne commitold GitHubba. Csak a WD-n lévő:

```text
/DataVolume/homehub/config.json
```

fájlban tárold.

## Harmadik lépés: MIoT mapping

Az E10 konkrét firmware-éhez tartozó SIID/PIID/AIID értékeket kell megadni. A release szándékosan `0` / üres értékekkel érkezik, mert hibás action ID-val nem küldünk vezérlőparancsot a készüléknek.

Példa struktúra:

```json
"xiaomiVacuum": {
  "enabled": true,
  "name": "Xiaomi Robot Vacuum E10",
  "model": "xiaomi.vacuum.b112",
  "ip": "192.168.1.X",
  "token": "32_HEX_KARAKTER",
  "properties": [
    {"name":"state","siid":0,"piid":0,"unit":"","scale":1},
    {"name":"battery","siid":0,"piid":0,"unit":"%","scale":1},
    {"name":"area_m2","siid":0,"piid":0,"unit":"m²","scale":1},
    {"name":"duration_sec","siid":0,"piid":0,"unit":"s","scale":1}
  ],
  "actions": {
    "start": {"siid":0,"aiid":0},
    "pause": {"siid":0,"aiid":0},
    "stop": {"siid":0,"aiid":0},
    "dock": {"siid":0,"aiid":0}
  },
  "stateMap": {
    "0":"Ismeretlen"
  }
}
```

A `0` értékeket a valódi modell-specifikációval kell lecserélni.

## Bridge ellenőrzés

WD-n:

```bash
/DataVolume/homehub/homehub-bridge -config /DataVolume/homehub/config.json -check
```

A logban új sor jelenik meg:

```text
XIAOMI VACUUM: configured=true online=true controlReady=false ...
```

- `online=true`: a porszívó válaszol a helyi miIO UDP/54321 portra.
- `controlReady=true`: token + property/action mapping rendelkezésre áll.

## Biztonság

A HomeHub csak akkor aktiválja a Start / Pause / Stop / Dock gombokat, ha a Bridge `controlReady=true` állapotot jelent. Így egy hiányos vagy bizonytalan konfiguráció nem indít véletlen parancsot.
