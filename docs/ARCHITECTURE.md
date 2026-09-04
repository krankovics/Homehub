# HomeHub architektúra v0.1

## Alapelv

A HomeHub szerver nem próbál közvetlenül belépni a privát 192.168.1.x hálózatba. A helyi bridge indít kifelé HTTPS kéréseket, lekéri a parancsokat, végrehajtja őket, majd visszaküldi az állapotot.

## Eszközadapterek

### KD20
- Transmission RPC: torrent lista, magnet, torrent file, részletes fájllista.
- SMB: a letöltött fájlok olvasása a másoláshoz.

### WD My Cloud
- v0.1-ben a bridge maga a WD-n fut, ezért a célfájlrendszert közvetlenül írja.
- később külön WD adapter adhat tárhely/SMART/backup funkciókat.

## Auto-copy

A szerver snapshot érkezésekor figyeli a `percentDone == 1` torrenteket. Ha még nincs hozzá copy record, egy `torrent.copyToWd` parancsot tesz sorba. A bridge a Transmissionből lekéri a torrent fájllistáját, SMB-n kiolvassa a KD20-ról, és a WD célmappába másolja.

A forrás soha nem törlődik automatikusan.

## v0.7 Copy progress

A Bridge másolás közben 2 másodpercenként progress eventet küld a cloud API-nak. A Render csak metaadatot kap (byte számlálók, sebesség, ETA, fájlnév); a médiafájl továbbra is kizárólag a helyi KD20 → WD LAN útvonalon mozog.

## Printer adapter

A v0.7 printer adapter nem proxyzza a print jobokat a felhőn keresztül. A KD20 gyári USB Print Serverét monitorozza helyi TCP probe-okkal, és a PWA-ban megjeleníti a setup shortcutot/statuszt.

## v0.16 helyi médiaútvonal

A filmfájlok nem a felhős HomeHub szerveren keresztül streamelődnek. A WD Bridge indexeli a konfigurált videómappákat, majd 24 órás aláírt LAN URL-eket ad a HomeHub szervernek. A PWA a teljes médiaindexet csak a Média tab megnyitásakor kéri le. A Bridge változáskor, illetve periodikusan szinkronizálja újra a filmjegyzéket, így a normál 3 másodperces HomeHub state polling nem hordozza a teljes médiakatalógust.
