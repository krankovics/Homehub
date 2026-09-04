# HomeHub v0.20.0 telepítési útmutató

A v0.20.0 a működő v0.19.0 telepítésre frissíthető. A meglévő WD konfigurációt, Credentials Vaultot, People/Presence adatokat és Timeline-t nem írja felül.

## 1. Biztonsági mentés

A WD-n, SSH kapcsolatban:

```sh
cp /DataVolume/homehub/config.json /DataVolume/homehub/config.json.before-v020
cp /DataVolume/homehub/server-state.json /DataVolume/homehub/server-state.json.before-v020 2>/dev/null || true
cp /DataVolume/homehub/credentials.vault /DataVolume/homehub/credentials.vault.before-v020 2>/dev/null || true
```

## 2. Render / GitHub frissítése

Csomagold ki a `homehub-mvp-v0.20.0.zip` fájlt, majd a projekt forrását másold a Homehub GitHub repositoryba.

```powershell
git add .
git commit -m "HomeHub v0.20.0 Device Identity Tuya Enrichment"
git push origin main
```

A Render deploy után ellenőrizd:

```text
https://homehub-2riv.onrender.com/api/health
```

Elvárt válasz:

```json
{"ok":true,"version":"0.20.0"}
```

A WD Bridge-et csak zöld Render build után frissítsd.

## 3. Opcionális Tuya log környezeti változók

Az alapértelmezések használhatók, de Renderen külön is megadhatók:

```env
TUYA_LOG_REFRESH_MS=300000
TUYA_LOG_LOOKBACK_MS=900000
```

A `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET` és `TUYA_API_ENDPOINT` maradjon a meglévő Render environmentben. Titkot ne írj a repositoryba.

Ha a Tuya projekt nem enged Device Log API-t, a v0.20 ettől még működik: a normál eszközlista és factory-info enrichment megmarad, csak a Timeline log-import marad ki.

## 4. ARMv7 Bridge feltöltése

Windows PowerShellben lépj a v0.20 csomag `bridge` mappájába:

```powershell
scp -O -oHostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-update/
scp -O -oHostKeyAlgorithms=+ssh-rsa .\upgrade-wd-os3.sh root@192.168.1.180:/DataVolume/homehub-update/
```

Belépés:

```powershell
ssh -oHostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

A következő parancsok már a WD shellben futnak:

```sh
cd /DataVolume/homehub-update
chmod +x homehub-bridge-linux-armv7 upgrade-wd-os3.sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

## 5. Verzió és szolgáltatás ellenőrzése

```sh
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge status
```

Elvárt:

```text
homehub-bridge 0.20.0 linux/arm
running pid ...
```

A futó Bridge mellett ne indíts `-once` példányt, mert a média/Vault helyi `8788` portja foglalt lehet.

## 6. Bridge gyors ellenőrzés

```sh
/DataVolume/homehub/homehub-bridge -check -config /DataVolume/homehub/config.json
```

A korábbi WD, KD20, printer, Network Intelligence, média és Vault ellenőrzéseknek továbbra is működniük kell.

## 7. Device Identity ellenőrzése

Nyisd meg a Home Hub **Hálózat** tabját. A v0.20-ban az ismeretlen kártyák egy részének automatikusan névre kell váltania.

Példák a már megerősített identitásokból:

```text
Béla iPhone
Béla Apple Watch
Dorka iPhone
Dávid iPhone
Dávid Apple Watch
Edina Galaxy A34
Lenti nappali Telekom TV beltéri
Fenti Telekom TV beltéri
Xiaomi Robot Vacuum E10
```

A Tuya-eszközöknél `Tuya MAC` vagy `Tuya ID` badge jelenhet meg. Az azonosítási százalék a forrás biztonságát jelzi.

Ha ugyanaz a MAC több IP-n látszik, a Home Hub `Mesh proxy` jelzést ad, és nem kezeli önálló megbízható eszközként.

## 8. Kézi azonosítás

Egy hálózati eszköz kártyáján kattints az **Azonosítás** gombra, majd add meg a nevet, típust és opcionálisan a tulajdonost.

A kézi azonosítás 100%-os megerősítésként kerül a persistent state-be, és IP-változás után is megmarad.

Edina iPhone-ját akkor add Edina személyéhez elsődleges jelenléti eszközként, amikor hazaér és az otthoni Wi-Fi-n megjelenik. Az A34 maradjon másodlagos jel.

## 9. Tuya enrichment ellenőrzése

A Smart Home eszköz részleteiben a gyári MAC megjelenhet. A Home Hub a factory-info MAC-et összeveti a hálózati kliens MAC-jével.

A két régebbi ESP szenzornál a már ismert fallbacknek ezeket kell felismernie:

```text
3C:61:05:C2:CD:65 -> Dorka szoba
3C:61:05:C3:74:77 -> Dávid szoba
```

## 10. Timeline / AI ellenőrzése

Néhány perc után az **Idővonal** nézetben megjelenhetnek Tuya log-események is, például power/current/voltage/state. Ez jogosultságfüggő.

Az AI Asszisztens ezután az enrich-elt hálózati neveket is megkapja, így például az `Ismeretlen hálózati eszköz 192.168.1.x` helyett `Dávid iPhone` vagy `Lenti nappali Telekom TV beltéri` szerepelhet a válaszban.

## 11. Visszaállítás

Hiba esetén a v0.19 Bridge bináris visszatelepíthető. A v0.20 új persistent mezői opcionálisak, ezért a korábbi state adatai nem vesznek el. A biztonsági mentések a `/DataVolume/homehub/*.before-v020` fájlokban maradnak.
