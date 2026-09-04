# HomeHub v0.21.0 telepítési útmutató

A v0.21.0 web/server release. A jelenlegi WD My Cloud Bridge v0.20.0 változatlanul használható.

## 1. GitHub

A ZIP tartalmával frissítsd a Homehub repositoryt:

```powershell
git add .
git commit -m "HomeHub v0.21.0 Responsive UI User Access Automation Audit"
git push origin main
```

## 2. Render

Várd meg az automatikus deployt. Ellenőrzés:

```text
https://homehub-2riv.onrender.com/api/health
```

Várt válasz:

```json
{"ok":true,"version":"0.21.0"}
```

## 3. Első újrabelépés

A v0.21 session cookie felépítése megváltozott. A régi bejelentkezés egyszer érvénytelenné válhat. Admin belépéshez:

- felhasználónév: üresen hagyható vagy `admin`;
- jelszó: a Renderen megadott `APP_PASSWORD`.

## 4. Személyes hozzáférés beállítása

Adminnal lépj az **Emberek** oldalra, majd egy személyen `Szerkesztés`:

1. kapcsold be a **Személyes belépés** kapcsolót;
2. adj egyedi felhasználónevet;
3. első bekapcsoláskor adj legalább 8 karakteres jelszót;
4. jelöld ki a látható menüpontokat;
5. mentsd a profilt.

A jelszó később üresen hagyható, ha nem akarod megváltoztatni. A HomeHub csak scrypt hash-t és random saltot tárol, a jelszót nem.

## 5. Email automatizálásokhoz

Ha az SMTP már be volt állítva, nincs teendő. Egyébként Render Environment:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@example.com
SMTP_FROM_NAME=HomeHub
ALERT_EMAIL_TO=your-email@example.com
```

Az új automatizálásoknál az **Email értesítés lefutáskor** alapból aktív. Lefutáskor az email és az Idővonal tartalmazza:

- a szabály nevét;
- a kiváltó okot / mért értéket;
- a végrehajtott akciót;
- az eredményt és esetleges hibát.

## 6. PWA cache

A service worker cache neve `homehub-v0.21.0`. Ha egy eszköz még a régi UI-t mutatja, zárd be/nyisd újra a PWA-t vagy végezz hard refresh-t.

## 7. WD Bridge

Nem kell frissíteni. Ellenőrizhető:

```sh
/DataVolume/homehub/homehub-bridge -version
```

Elfogadott jelenlegi eredmény:

```text
homehub-bridge 0.20.0 linux/arm
```
