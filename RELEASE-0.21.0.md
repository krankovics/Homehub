# HomeHub v0.21.0 — Responsive UI, User Access & Automation Audit

## Design / reszponzivitás

- Egységes 16 px alapméret és nagyobb desktop tipográfia, hogy nagy felbontáson se legyen mikroszkopikus a felület.
- Új spacing/card/button/input rendszer desktopra, tabletre és mobilra.
- 248 px desktop sidebar, 92 px tablet ikon-sidebar.
- Mobilon fix, 5 elemes gyors alsó navigáció és a fejlécben teljes, jogosultság szerint szűrt menüválasztó.
- A mobil hero külön képszakasz + alatta normál flow-ba rendezett státusz- és Kedvencek blokkok, így nincs vízszintes szétesés.
- Smart Life, People, Timeline, Network, torrent és média oldalak 1 oszlopos mobil tördelése.
- A hálózati topológia mobilon hierarchikus listává esik össze; desktopon megtartja a vizuális topológiát.
- Light mode topológia/switch panelek a világos design tokeneket használják.

## Személyes felhasználók

- A meglévő People profilhoz kapcsolható webes hozzáférés.
- Egyedi login név + legalább 8 karakteres jelszó.
- A jelszó `crypto.scryptSync` hash + random salt formában kerül tárolásra.
- Az `admin` név foglalt; admin belépés továbbra is a Render `APP_PASSWORD` változóját használja.
- Személyenként állítható menüjogok: overview, people, timeline, downloads, media, smart, actions, ai, network, credentials, printer, settings.
- Profil- és hozzáférésmódosítás admin-only.
- A session cookie felhasználóazonosítót és lejáratot tartalmaz, HMAC-aláírással, HttpOnly + SameSite=Strict attribútummal.

## Automatizálások

- Új `notifyEmail` szabálybeállítás, alapérték: bekapcsolva.
- Lefutás után részletes Timeline esemény készül: ok, akciók, hibák, eredmény.
- Numerikus/state triggerek logja tartalmazza a tényleges értéket és a feltételt; `forSeconds` esetén a fennállási időt is.
- Ha nincs külön emailes alert action, a motor automatikus lefutási emailt készít.
- Ha már van emailt küldő explicit alert/AI-summary action, nincs dupla automatikus email.
- SMTP hiányában a HomeHub alert/timeline log továbbra is megmarad.

## Kompatibilitás

- GitHub/Render web + server frissítés szükséges.
- WD Bridge frissítés nem szükséges; a v0.20.0 bridge kompatibilis.
- A session cookie formátuma változott, ezért deploy után a már belépett böngészők egyszer újra bejelentkeznek.
