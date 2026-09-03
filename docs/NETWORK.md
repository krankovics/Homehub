# Router és Wi-Fi extender modul

A HomeHub v0.8 hálózati ellenőrzése a WD My Cloudon futó Bridge-ben történik, tehát a belső IP-k és MAC-címek nem igényelnek internet felőli elérést.

A jelenlegi konfiguráció:

- Technicolor FGA2233: `192.168.1.1`
- TP-Link Archer C6: `192.168.1.129`, MAC `5C-62-8B-95-64-EA`
- TP-Link RE220: MAC `B4-B0-24-EF-3C-12`
- TP-Link RE315 #1: MAC `DC-62-79-DD-93-86`
- TP-Link RE315 #2: MAC `0C-EF-15-1B-FE-CE`

A Bridge az ismert IP-ket közvetlenül ellenőrzi. A csak MAC-címmel ismert extendereket a WD ARP-táblájából keresi; szükség esetén ritkán, legfeljebb 5 percenként egy könnyű `/24` LAN-felderítéssel frissíti az ARP-táblát.

## v0.8-ban elérhető

- Online/offline állapot
- IP és MAC
- TCP válaszidő
- Közvetlen helyi admin link

## Későbbi részletes TP-Link / Technicolor adapter

A jelerősség, csatlakozott kliensek, rádiócsatorna és Wi-Fi statisztika gyártói admin/API-hozzáférést igényelhet. Ezekhez a router admin hitelesítési adatait később a WD-n tárolt lokális secretbe lehet tenni; ne küldd el őket chatben és ne tedd Renderbe.
