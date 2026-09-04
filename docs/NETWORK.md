# HomeHub Network Intelligence – v0.17.0

A v0.17-ben a WD My Cloudon futó HomeHub Bridge lett a helyi hálózat megfigyelőpontja. A Render csak a Bridge által küldött állapotot kapja meg; a helyi adminjelszavak nem kerülnek a böngészőbe, Renderre vagy az AI-kontextusba.

## Ismert hálózati infrastruktúra

| ID | Eszköz | Alap IP | MAC | v0.17 adatforrás |
|---|---|---:|---|---|
| technicolor-fga2233 | Technicolor FGA2233 | 192.168.1.1 | – | ping + admin port |
| archer-c6 | TP-Link Archer C6 | 192.168.1.129 | 5C:62:8B:95:64:EA | MAC/ARP + ping + admin port |
| re220 | TP-Link RE220 | automatikus | B4:B0:24:EF:3C:12 | MAC/ARP + ping + admin port |
| re315-1 | TP-Link RE315 #1 | automatikus | DC:62:79:DD:93:86 | MAC/ARP + ping + admin port |
| re315-2 | TP-Link RE315 #2 | automatikus | 0C:EF:15:1B:FE:CE | MAC/ARP + ping + admin port |
| tl-sg108e | TP-Link TL-SG108E V6.0 | 192.168.1.49 | 78:8C:B5:5F:7F:04 | **helyi read-only admin adapter** |
| kd20 | Shuttle OMNINAS KD20 / oldnas | 192.168.1.12 | 80:EE:73:49:89:0C | MAC/ARP + szolgáltatásellenőrzés |
| wd-my-cloud | WD My Cloud | 192.168.1.180 | 00:90:A9:D2:BB:EA | helyi Bridge + szolgáltatásellenőrzés |

A D-Link GO-SW-5G és a TP-Link LiteWave LS105G nem menedzselhető switchek, ezért saját portstátuszt nem tudnak szolgáltatni.

## TL-SG108E V6.0 élő portmonitor

A Bridge a switch **helyi webadminját csak olvasásra** használja. Nem módosít VLAN-t, QoS-t, portsebességet vagy más switch-beállítást.

Megjelenő adatok:

- modell, hardver- és firmware-verzió;
- port engedélyezve / letiltva;
- Link Up / Link Down;
- 10 / 100 / 1000 Mbps tényleges linksebesség;
- duplex állapot;
- flow-control állapot;
- portonkénti csomagszámláló, ha a firmware publikálja;
- opcionális saját portnév;
- figyelmeztetés, ha egy aktív link 1 Gbit/s alá esik.

A felhasználó által látott TL-SG108E V6.0 jelenlegi firmware: `1.0.0 Build 20211209 Rel.52369`.

### Helyi admin hitelesítés

A részletes switchadatokhoz a TL-SG108E **helyi admin** felhasználó/jelszó kell. TP-Link Cloud/Tether account nem szükséges.

A jelszót ne tedd a `config.json`-ba vagy GitHubba. A WD-n futtasd a csomagban lévő scriptet:

```sh
cd /DataVolume/homehub-update
chmod +x configure-network-secrets.sh
sh configure-network-secrets.sh
```

Ez létrehozza:

```text
/DataVolume/homehub/network-secrets.json
```

`0600` jogosultsággal, majd újraindítja a Bridge-et. A tényleges jelszó nincs benne a snapshotban és nem kerül fel a Renderre.

Kézi formátum:

```json
{
  "devices": {
    "tl-sg108e": {
      "username": "admin",
      "password": "SAJAT-HELYI-JELSZO"
    }
  }
}
```

## Router újraindítás és DHCP/IP-változás

A v0.17 az ismert eszközöket nem kizárólag IP-cím alapján azonosítja. Ha MAC-cím ismert, a Bridge rendszeresen frissíti a helyi ARP nézetet és a MAC-címhez tartozó aktuális IP-t használja.

Példa:

```text
KD20 konfigurált IP: 192.168.1.12
router restart után: 192.168.1.63
MAC: 80:EE:73:49:89:0C

HomeHub: 192.168.1.12 → 192.168.1.63
IP source: arp-mac
```

A KD20 esetén ez nem csak kijelzés. A Bridge a felderített címet használja:

- Transmission RPC-hez;
- KD20 SMB forráshoz;
- KD20 print-server ellenőrzéshez.

Ha a KD20 SMB korábban a régi IP-re volt mountolva, az új másolás előtt a Bridge felismeri az eltérő CIFS forrást, lecsatolja a stale mountot, majd az új címről mountolja vissza.

A WD-n futó médiaszerver nyilvános LAN-címe is az aktuális helyi WD IPv4 alapján frissül, így egy WD DHCP-címváltás után az új média-linkek az új címre mutatnak.

**Továbbra is ajánlott DHCP reservationt használni** az infrastruktúra-eszközökhöz. A MAC-alapú újrafelderítés védőháló, nem helyettesíti a rendezett hálózati címzést.

## Hálózati eseménynapló

A Render szerver az egymást követő Bridge snapshotokból naplózza:

- eszköz online → offline;
- offline → online;
- IP-cím változás;
- menedzselt switch port link-/sebességváltozás.

Az utolsó 200 esemény a perzisztens HomeHub állapotba is bekerül, a Hálózat tab az utolsó 50-et adja vissza.

## Új automatizálások

A v0.17 két hálózati triggert ad az Akciókhoz:

### Hálózati eszköz offline

Példa:

```text
WD My Cloud offline legalább 5 percig → HomeHub + email alert
```

Trigger:

```json
{
  "type": "network.offline",
  "networkId": "wd-my-cloud",
  "forSeconds": 300
}
```

### Switch port belassul

Példa:

```text
TL-SG108E Port 6 < 1000 Mbps legalább 2 percig → alert
```

Trigger:

```json
{
  "type": "network.link_below",
  "networkId": "tl-sg108e",
  "port": 6,
  "mbps": 1000,
  "forSeconds": 120
}
```

## AI Network Intelligence

Az AI az adminjelszavakat nem kapja meg. A kontextusba csak a HomeHub által normalizált állapot kerül, például:

- eszköz online/offline;
- aktuális és konfigurált IP;
- IP-változás;
- switch port linksebessége és duplex állapota;
- hálózati eseménynapló.

Így például a „Miért lassú a NAS?” kérdésnél az AI jelezheti, hogy a KD20-hoz tartozó switch port csak 100 vagy 10 Mbps sebességen áll, miközben a WD 1 Gbit/s-on kapcsolódik.

## Archer C6, RE220/RE315 és Technicolor

A v0.17 ezekhez **élő jelenlét-, MAC/IP- és admin-port monitorozást** ad. A részletes Wi-Fi klienslista, RSSI, rádiócsatorna és uplink-jelminőség helyi admin API-ja firmware- és hardververzió-függő, ezért a csomag nem próbál találomra belépési protokollt vagy endpointot használni.

A `network-secrets.json` felépítése már eszközönkénti hitelesítésre készült, így a következő adapterek hozzáadhatók a Bridge-hez anélkül, hogy jelszót kellene Renderre vagy TP-Link Cloudba küldeni.

## Ellenőrzés a WD-n

```sh
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge status
tail -n 100 /DataVolume/homehub/homehub.log
```

A v0.17 elvárt Bridge verziója:

```text
homehub-bridge 0.17.0 linux/arm
```
