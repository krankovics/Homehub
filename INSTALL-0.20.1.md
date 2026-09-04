# HomeHub v0.20.1 telepítési útmutató

Ez egy frontend/server verziófrissítés. A WD My Cloud Bridge v0.20.0 változatlanul kompatibilis, ezért nem kell új ARM binárist telepíteni.

## 1. GitHub

Csomagold ki a `homehub-mvp-v0.20.1.zip` fájlt, és a repository tartalmát frissítsd vele.

```powershell
git add .
git commit -m "HomeHub v0.20.1 Concept v18 UI"
git push origin main
```

## 2. Render

Várd meg az automatikus deployt. A health endpointnál ezt várjuk:

```json
{"ok":true,"version":"0.20.1"}
```

## 3. Böngésző/PWA cache

A service worker cache neve `homehub-v0.20.1`, így frissítés után az új felület automatikusan átveszi a régi cache helyét. Ha egy eszközön még a régi UI látszik, zárd be és nyisd meg újra a PWA-t, vagy frissíts kemény újratöltéssel.

## 4. WD Bridge

Nem kell frissíteni. Ellenőrzésként továbbra is elfogadott:

```sh
/DataVolume/homehub/homehub-bridge -version
```

Várt eredmény:

```text
homehub-bridge 0.20.0 linux/arm
```
