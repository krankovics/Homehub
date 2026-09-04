# HomeHub v0.17.0 – Network Intelligence

A v0.17.0 a v0.16.2 teljes funkcionalitására épül, és a WD My Cloud Bridge-et helyi hálózati megfigyelőponttá bővíti.

## Új funkciók

- TL-SG108E V6.0 read-only helyi admin adapter.
- Élő portstátusz: Link Up/Down, 10/100/1000 Mbps, duplex, flow control, opcionális portnév és statisztika.
- Hálózati Hálózat tab új Network Intelligence nézettel.
- MAC-alapú IP-újrafelderítés ismert infrastruktúra-eszközökhöz.
- KD20 Transmission/SMB/print-server dinamikus újracímzése DHCP-változáskor.
- Stale KD20 CIFS mount felismerése és újramountolása új IP-re.
- WD média LAN URL automatikus aktualizálása a WD aktuális IPv4 címére.
- Hálózati eseménynapló: online/offline, IP-váltás, switch portsebesség/link-váltás.
- Új automatizálási triggerek: `network.offline` és `network.link_below`.
- AI kontextusba bekerülnek a normalizált switchport- és hálózati eseményadatok.
- Helyi `network-secrets.json` credential store, amely nem kerül Renderre vagy a böngészőbe.

## Biztonság

A TL-SG108E adapter kizárólag olvas. Nem küld konfigurációmódosító kérést. A switch jelszava csak a WD `/DataVolume/homehub/network-secrets.json` fájljában van, ajánlott jogosultság: `0600`.

## Kompatibilitás

A meglévő `/DataVolume/homehub/config.json` továbbra is használható. A Bridge betöltéskor hozzáadja a hiányzó ismert hálózati inventory elemeket, és a TL-SG108E-hez automatikusan aktiválja a `tplink-easy-smart` adaptert.

A részletes Archer C6 / RE220 / RE315 / Technicolor Wi-Fi telemetria nincs találomra implementálva: v0.17-ben ezekhez MAC/IP/ping/admin-port monitorozás van. A firmware-specifikus read-only adapterek későbbi bővítésként adhatók hozzá.

## Élesítés

Render: a teljes v0.17.0 source kerüljön a GitHub `main` branchre, majd deploy.

WD Bridge:

```sh
cd /DataVolume/homehub-update
chmod +x homehub-bridge-linux-armv7 upgrade-wd-os3.sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

TL-SG108E részletes portadatok bekapcsolása:

```sh
chmod +x configure-network-secrets.sh
sh configure-network-secrets.sh
```
