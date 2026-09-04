# HomeHub Device Identity v0.20

A Home Hub hálózati eszközazonosítása nem az IP-címet tekinti identitásnak. A DHCP-cím változhat, a TP-Link mesh pedig bizonyos helyzetekben ugyanazt a proxy MAC-et több kliensnél is megjelenítheti.

## Prioritási sorrend

1. **Kézzel megerősített azonosítás** a Home Hub Hálózat felületén.
2. **Megerősített ismert eszköz**: a háztartásban kézzel azonosított, stabil per-SSID privát MAC vagy fizikai MAC.
3. **Tuya factory-info MAC**: a Tuya Device ID gyári MAC-címe és a LAN MAC egyezése.
4. **Tuya Device ID-be ágyazott MAC**: csak a már ismert `20284731...`/ESP szenzor mintára engedélyezett fallback.
5. **Proxy/mesh jelölés**: ha ugyanaz a MAC több IP-n szerepel, az nem kap önálló megbízható identitást.

Az IP, hostname és nyitott portok diagnosztikai jelek, de önmagukban nem írják felül a fenti identitást.

## Tuya enrichment

A server a Tuya eszközlistát factory-info adatokkal egészíti ki. A gyári MAC alapján a Smart Life név és Device ID hozzárendelhető a WD Bridge által látott hálózati klienshez.

A lekérdezés 20 Device ID-s kötegekben történik. A Home Hub először az újabb `iot-03` factory-info útvonalat próbálja, majd kompatibilitási fallbacket használ.

Példa eredmény:

```text
Lenti gépek
Tuya ID: bfe975a8423536b876toek
MAC: xx:xx:xx:xx:xx:xx
LAN IP: 192.168.1.x
Azonosítás: Tuya factory-info MAC, 99%
```

## Megerősített otthoni eszközök a release-ben

A v0.20 a jelenlegi háztartásban már megerősített eszközazonosítókat ismeri, hogy deploy után azonnal kulturált neveket tudjon adni. Az IP nincs hardcode-olva.

- Béla iPhone és Apple Watch
- Edina Galaxy A34, másodlagos jelenléti eszköz
- Dorka iPhone
- Dávid iPhone és Apple Watch
- Lenti nappali Telekom TV beltéri
- Fenti Telekom TV beltéri
- Xiaomi Robot Vacuum E10

Edina iPhone-ja nincs előre felvéve. A Home Hub felületén később kell megerősíteni, amikor az otthoni Wi-Fi-n megjelenik.

## Kézi azonosítás

A Hálózat kártyán az **Azonosítás** gombbal megadható:

- név;
- típus;
- tulajdonos;
- opcionális megjegyzés.

A mentés MAC-kulccsal kerül a tartós Home Hub state-be, ezért DHCP/IP változás után is megmarad.

## Mesh/proxy MAC

Ha ugyanaz a MAC egyszerre több IP-n látszik, a Home Hub ezt nem tekinti több valódi eszköznek. Az ilyen rekord alacsony biztonságú `TP-Link mesh mögötti kliens` identitást kap. A végleges azonosításhoz Archer/Technicolor klienslista, hostname vagy kézi megerősítés használható.

## Tuya logok és Timeline

A v0.20 időszakosan lekérheti a releváns Tuya report logokat. Tipikusan bekerülhet:

- online/offline;
- switch/state;
- power/current/voltage/energy;
- temperature/humidity;
- door/gate/open/close;
- signal/battery;
- charge/alarm/fault.

A loglekérés jogosultságfüggő. Ha a Tuya projekt nem engedi a Device Log API-t, a normál Smart Life állapotfrissítés továbbra is működik, a log import pedig csendben kimarad.

## Biztonság

A Device Identity réteg nem tárol Tuya Access Secretet, Local Key-t, Wi-Fi jelszót vagy Vault-jelszót. A Tuya hitelesítés továbbra is Render environment változókból történik; hálózati adminjelszavak a WD helyi Credentials Vaultjában maradnak.
