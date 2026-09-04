# HomeHub v0.19.0 telepítési útmutató

A v0.19.0 a működő v0.18.0 telepítésre frissíthető. A meglévő WD konfigurációt és Credentials Vaultot nem írja felül.

## 1. Biztonsági mentés

A WD-n, SSH kapcsolatban:

```sh
cp /DataVolume/homehub/config.json /DataVolume/homehub/config.json.before-v019
cp /DataVolume/homehub/server-state.json /DataVolume/homehub/server-state.json.before-v019 2>/dev/null || true
cp /DataVolume/homehub/credentials.vault /DataVolume/homehub/credentials.vault.before-v019 2>/dev/null || true
```

## 2. Render / GitHub frissítése

Csomagold ki a `homehub-mvp-v0.19.0.zip` fájlt, majd a teljes projekt forrását másold a Render által használt GitHub repositoryba.

A repository gyökerében:

```powershell
git add .
git commit -m "HomeHub v0.19.0 People Presence Timeline"
git push origin main
```

A Render automatikus deploy után ellenőrizd:

`https://homehub-2riv.onrender.com/api/health`

Belépés nélkül is ezt kell visszaadnia:

```json
{"ok":true,"version":"0.19.0"}
```

Ha a Render build hibát ad, ne frissítsd tovább a WD Bridge-et addig, amíg a build nem zöld.

## 3. ARMv7 Bridge feltöltése

Windows PowerShellben lépj a v0.19 csomag `bridge` mappájába.

```powershell
scp -O -oHostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-update/
scp -O -oHostKeyAlgorithms=+ssh-rsa .\upgrade-wd-os3.sh root@192.168.1.180:/DataVolume/homehub-update/
```

Belépés a WD-re:

```powershell
ssh -oHostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

Fontos: a következő parancsokat már a `WDMyCloud:~#` shellben futtasd, ne PowerShellben.

```sh
cd /DataVolume/homehub-update
chmod +x homehub-bridge-linux-armv7
chmod +x upgrade-wd-os3.sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

## 4. Bridge verzió és szolgáltatás ellenőrzése

```sh
/DataVolume/homehub/homehub-bridge -version
/etc/init.d/homehub-bridge status
```

Elvárt verzió:

```text
homehub-bridge 0.19.0 linux/arm
```

A Bridge normál szolgáltatásként fusson. Ne indítsd mellette a `-once` módot, mert a helyi média/vault HTTP port már foglalt lehet.

## 5. Meglévő funkciók gyors ellenőrzése

```sh
/DataVolume/homehub/homehub-bridge -check -config /DataVolume/homehub/config.json
```

A korábbi v0.18 funkcióknak továbbra is működniük kell: WD, KD20 RPC/SMB, nyomtatóport, Network Intelligence, média, Vault.

A Samsung nyomtató jelenlegi működő Windows beállítása:

```text
IP: 192.168.1.12
Protocol: LPR
Port: 515
Queue: SCX-3200S_2_0
Windows port: KD20-SCX3200-LPR
Driver: Samsung SCX-3200 Series
```

## 6. People & Presence beállítása

Nyisd meg a Home Hubot, majd **Emberek**.

1. Kattints a `+ Személy felvétele` gombra.
2. Add meg a nevet/becenevet.
3. Rendelj hozzá hálózati eszközt.
4. A telefont `Elsődleges jelenlét` szereppel add hozzá.
5. A laptopot/PC-t `Otthon maradhat` szereppel add hozzá.
6. Mentés után a személy kártyáján tölthetsz fel profilképet.

A kezdőlapon megjelenik a **Ki van itthon?** sáv.

### Archer C6 korlát

Az Archer C6 mögötti `192.168.0.x` telefonok jelenleg nem feltétlenül szerepelnek a WD Bridge által megfigyelhető klienslistában. Ha a telefon nincs a Home Hub Hálózat listájában, ne rendelj hozzá helyette laptopot elsődleges eszközként, mert hamis jelenlétet okozhat. A Home Hub ilyen helyzetben szándékosan `Bizonytalan` állapotot használ.

## 7. Timeline ellenőrzése

Az **Idővonal** menüben frissítés után meg kell jelenniük az eseményeknek. Hálózati állapotváltás mellett óránként minta is készül a fontos eszközökről.

Az események a WD tartós mentésébe is bekerülnek. Ellenőrzés:

```sh
grep -n '"history"' /DataVolume/homehub/server-state.json | head
```

Ha már vettél fel személyt:

```sh
grep -n '"people"' /DataVolume/homehub/server-state.json | head
```

## 8. AI történeti teszt

Legalább néhány esemény összegyűlése után az AI Asszisztensben próbáld:

```text
Ki van most itthon?
Melyik gép volt online éjjel?
Nyitva maradt ma a kapu?
Mikor volt utoljára offline az oldnas?
```

Az AI csak a v0.19 telepítése után rögzített eseményekből tud történeti tényt állítani. A jelenlegi AI prompt-kontekstukban 72 óra történet szerepel.

## 9. Visszaállítás

Ha a WD Bridge-et kell visszaállítani, másold vissza az előző ARM binárist vagy telepítsd újra a v0.18 csomagból. A `config.json` és a Credentials Vault külön mentése miatt a hitelesítések nem vesznek el.
