# HomeHub v0.22.1 telepítés

A v0.22.1 csak szerver/web hotfix. A WD My Cloud bridge frissítése nem szükséges.

## GitHub / Render

```powershell
git add .
git commit -m "HomeHub v0.22.1 iOS PWA safe area hotfix"
git push origin main
```

Render deploy után: `https://homehub-2riv.onrender.com/api/health`

Elvárt verzió: `0.22.1`.

## iPhone

A service worker cache neve megváltozott `homehub-v0.22.1` értékre. Deploy után zárd be teljesen a Főképernyőről indított HomeHubot, majd indítsd újra. Ha még a régi layout maradna, távolítsd el egyszer a PWA-t a Főképernyőről, nyisd meg Safari-ban az oldalt, majd add újra a Főképernyőhöz.
