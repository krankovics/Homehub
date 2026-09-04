# HomeHub Akciók / automatizálás v0.14.0

## Működés

Az automatizálási motor a HomeHub szerveren fut. A WD Bridge 20 másodperces heartbeatje és 30 másodperces snapshotja miatt a Render instance aktív marad, a szabálymotor pedig 10 másodpercenként értékeli az aktuális állapotot. A Tuya cache alapértelmezés szerint 15 másodpercenként frissül.

A szabályok és riasztások nem csak a Render ideiglenes fájlrendszerén maradnak: bekerülnek a WD Bridge által visszaszinkronizált `persistentState` objektumba, amely a WD-n `/DataVolume/homehub/server-state.json` alatt tárolódik.

## Trigger típusok

- `tuya.numeric`: numerikus Tuya DP összehasonlítás, opcionális tartós idővel.
- `tuya.state`: Tuya DP állapot egyezés / nem egyezés, opcionális tartós idővel.
- `network.online_window`: kiválasztott hálózati eszköz online egy megadott időablakban.
- `network.new_device`: új, korábban nem látott MAC-cím a helyi ARP nézetben.
- `schedule`: heti időzítés, alapértelmezett `Europe/Budapest` időzónával.

## Action típusok

- `tuya.command`: Tuya DP parancs, például klíma bekapcsolása.
- `vacuum.command`: `start`, `pause`, `stop`, `dock` a WD Bridge-en keresztül.
- `alert`: HomeHub riasztási napló, opcionálisan emaillel.

## Biztonság

A HomeHub automatikusan blokkolja a `myGate` / kapu / garage / lock jellegű eszközök Tuya vezérlő actionjeit. Így egy hibás feltétel nem tud automatikus kapunyitást vagy zárást indítani. Kapuállapot trigger és email alert engedélyezett.

Az új hálózati eszköz szabály első induláskor baseline-t készít az aktuálisan ismert MAC-címekről. Csak a baseline után megjelenő új MAC kap riasztást.

## Email

A beépített SMTP kliens TLS/465 kapcsolatot támogat. Gmail esetén alkalmazásjelszó használata javasolt.

Render Environment:

```text
SMTP_HOST
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER
SMTP_PASS
SMTP_FROM
SMTP_FROM_NAME=HomeHub
ALERT_EMAIL_TO
```

SMTP hiányában az alert továbbra is megjelenik az Akciók tab Értesítések blokkjában, és az email hibastátusza is látszik.

## API

```text
GET    /api/automations
POST   /api/automations
PUT    /api/automations/:id
DELETE /api/automations/:id
POST   /api/automations/:id/run
POST   /api/alerts/:id/read
POST   /api/alerts/read-all
```

## Kész sablonok a UI-ban

1. Hőmérséklet → klíma
2. Nyitva maradt kapu → alert/email
3. Gép online este → alert/email
4. Porszívó ütemezett indítása
5. Új hálózati eszköz → alert/email
6. Esti AI összefoglaló → HomeHub alert és opcionális email
