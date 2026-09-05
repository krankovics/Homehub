# HomeHub nCore Browser Companion

A Companion a teljes nCore katalógus keresését a saját, normál Chrome/Edge nCore munkamenetben végzi. Nem másol Cookie-t a HomeHubba, nem futtat Cloudflare-megkerülést, és nem igényel külön Render tokent.

## Telepítés Chrome / Edge

1. Csomagold ki a `homehub-ncore-companion-0.1.0.zip` fájlt egy állandó mappába.
2. Chrome: `chrome://extensions`, Edge: `edge://extensions`.
3. Kapcsold be a Fejlesztői módot.
4. Válaszd a `Kicsomagolt bővítmény betöltése` / `Load unpacked` lehetőséget.
5. Tallózd be a kicsomagolt `browser-companion` mappát.
6. Nyiss meg egy `https://ncore.pro/` fület és jelentkezz be normál módon.
7. Nyisd meg a HomeHubot: `https://homehub-2riv.onrender.com/`.

Ha a Companion aktív, a HomeHub Letöltések oldalon az nCore státusz `Böngészős nCore 0.1.0 · teljes katalógus` lesz.

A teljes keresés és a torrent lekérése a böngésző nCore fülén történik. A HomeHub oldal csak a találati metaadatokat, illetve a kiválasztott `.torrent` fájlt kapja meg a meglévő KD20 feltöltési folyamathoz.

## Használat

Az nCore fület hagyd nyitva. Nem kell aktív fülnek lennie. Ha kijelentkezel vagy az nCore Cloudflare ellenőrzést mutat, fejezd be a normál böngészős belépést/ellenőrzést, majd próbáld újra a HomeHub keresést.

A bővítmény kizárólag a `ncore.pro` és a `homehub-2riv.onrender.com` oldalakon fut.
