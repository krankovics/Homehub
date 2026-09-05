# HomeHub Web Push

A HomeHub Web Push a Renderen futó HTTPS HomeHub címen működik. A helyi `http://192.168.1.180:8788` WD felület nem biztonságos origin, ezért azon Push API előfizetés nem hozható létre.

## Már implementált komponensek

- PWA manifest és standalone Home Screen mód
- Service Worker (`web/public/sw.js`)
- `push` és `notificationclick` események
- felhasználói műveletre induló `Notification.requestPermission()`
- `PushManager.subscribe()` VAPID public key használatával
- személyhez kötött push subscription tárolás
- automatizálási Notification Router és Web Push küldés
- lejárt 404/410 subscription automatikus takarítás

## Render környezeti változók

A szerver a következő változókat olvassa:

```text
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:<kapcsolati email>
```

Új kulcspár generálása a repository gyökeréből:

```bash
cd server
node scripts/generate-vapid.mjs
```

A private key nem kerülhet GitHubba vagy kliensoldali kódba. A public key kliensnek átadható a `/api/notifications/push/public-key` végponton.

## iPhone bekapcsolás

1. Nyisd meg a HTTPS HomeHub címet Safariban.
2. Megosztás → Főképernyőhöz adás.
3. A HomeHubot a Főképernyőről indítsd el.
4. Jelentkezz be személyhez kötött HomeHub fiókkal, nem a technikai admin fiókkal.
5. Beállítások → Push értesítések → Push bekapcsolása.
6. Az iOS engedélykérésénél engedélyezd az értesítéseket.

A HomeHub ezután megjelenik az iOS Értesítések beállításai között.

## PWA frissítés

A 0.24.5 Service Worker hálózat-első stratégiát használ, törli a régi `homehub-*` cache-eket, és verzióváltás után egyszer újratölti a vezérelt PWA ablakot. A Beállítások Push blokkjában található `Webapp frissítése` gomb kézzel is törli a HomeHub cache-eket és frissíti a Service Workert.
