# HomeHub személyes webes hozzáférés

A v0.21-ben a Household/People profil és a webes user ugyanahhoz a személyhez kapcsolódik.

## Biztonsági modell

- Az admin globális hitelesítése a `APP_PASSWORD` környezeti változóból történik.
- Személyes jelszó plaintext formában nem kerül state-be, logba vagy frontend válaszba.
- A személyes jelszó 16 bájtos random salt + Node `scrypt` 32 bájtos hash formában tárolódik.
- A frontend csak `hasPassword: true/false` metaadatot kap.
- Az `admin` login név foglalt.
- Sikertelen loginokra IP-alapú 15 perces rate limit van: 8 próbálkozás után blokkol.
- A session cookie HttpOnly, SameSite=Strict és HTTPS-en Secure.

## Jogosultságok

A személyekhez külön menülista tárolódik. A navigáció csak az engedélyezett elemeket mutatja, és a fő modul API-k is ellenőrzik a hozzájuk tartozó jogosultságot.

Személy létrehozása/szerkesztése/törlése, profilkép módosítása és webes hozzáférés kezelése csak admin sessionből lehetséges.
