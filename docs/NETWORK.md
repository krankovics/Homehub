# HomeHub hálózat v0.9

A hálózati felderítés a WD My Cloudon fut, ezért a belső IP-ket nem kell internet felől elérhetővé tenni.

## Ismert eszközök

- Technicolor FGA2233: `192.168.1.1`
- TP-Link Archer C6: `192.168.1.129`
- TP-Link RE220: MAC `B4-B0-24-EF-3C-12`
- TP-Link RE315 #1: MAC `DC-62-79-DD-93-86`
- TP-Link RE315 #2: MAC `0C-EF-15-1B-FE-CE`

## v0.9 állapotvizsgálat

A Bridge három jelből állapítja meg az elérhetőséget:

1. ICMP ping, ha a régi WD rendszer pingje támogatja.
2. ARP-jelenlét a `/proc/net/arp` táblában.
3. TCP próba a konfigurált admin portokra.

Ezért egy router/extender akkor is online lehet, ha a webadmin portja zárt vagy nem válaszol. Az `adminOnline` külön állapot.

Az ismeretlen extender IP-khez a Bridge helyi /24 hálózaton ARP warm-upot végez, majd MAC-cím alapján keres.
