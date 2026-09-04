# HomeHub v0.18.0 telepítési útmutató

Ez az útmutató a jelenlegi v0.17.0 telepítés frissítésére készült. A meglévő `/DataVolume/homehub/config.json` megmarad.

## 1. Render / GitHub frissítés

A v0.18.0 csomag teljes forrását másold a GitHub `krankovics/Homehub` repó `main` branchére, majd commit + push:

```powershell
git add .
git commit -m "HomeHub v0.18.0 Credentials Vault"
git push origin main
```

A Render automatikusan buildel. Sikeres buildben mindkét workspace-nek `0.18.0` verzióval kell lefordulnia.

## 2. WD Bridge fájlok feltöltése

Windows PowerShellben lépj a kibontott csomag `bridge` mappájába.

```powershell
cd C:\...\homehub-mvp-v0.18.0\bridge
```

Ellenőrzés:

```powershell
dir .\bin
```

A WD My Cloudhoz ez kell:

```text
homehub-bridge-linux-armv7
```

Hozd létre az update könyvtárat:

```powershell
ssh -oHostKeyAlgorithms=+ssh-rsa root@192.168.1.180 "mkdir -p /DataVolume/homehub-update"
```

Bináris feltöltése:

```powershell
scp -O -oHostKeyAlgorithms=+ssh-rsa .\bin\homehub-bridge-linux-armv7 root@192.168.1.180:/DataVolume/homehub-update/
```

Frissítő script:

```powershell
scp -O -oHostKeyAlgorithms=+ssh-rsa .\upgrade-wd-os3.sh root@192.168.1.180:/DataVolume/homehub-update/
```

## 3. Bridge élesítés

SSH:

```powershell
ssh -oHostKeyAlgorithms=+ssh-rsa root@192.168.1.180
```

WD-n:

```sh
cd /DataVolume/homehub-update
chmod +x homehub-bridge-linux-armv7
chmod +x upgrade-wd-os3.sh
sh upgrade-wd-os3.sh ./homehub-bridge-linux-armv7
```

Verzióellenőrzés:

```sh
/DataVolume/homehub/homehub-bridge -version
```

Elvárt:

```text
homehub-bridge 0.18.0 linux/arm
```

Szolgáltatás:

```sh
/etc/init.d/homehub-bridge status
```

## 4. Credentials Vault ellenőrzése

```sh
/DataVolume/homehub/homehub-bridge -vault-status -config /DataVolume/homehub/config.json
```

Első induláskor létrejön:

```text
/DataVolume/homehub/credentials.vault
/DataVolume/homehub/vault.key
```

Ha a v0.17 `network-secrets.json` tartalmazta a TL-SG108E credentialt, azt a Bridge automatikusan importálja. Sikeres migráció után a plaintext fájl törlődik.

Fájljogosultságok:

```sh
ls -l /DataVolume/homehub/credentials.vault /DataVolume/homehub/vault.key
```

Mindkettőnél `-rw-------` az elvárt.

## 5. Trezor PIN létrehozása

Otthoni Wi-Fi-ről nyisd meg:

```text
http://192.168.1.180:8788/vault
```

Első alkalommal adj meg egy legalább 6 karakteres PIN-t. A PIN-t ne küldd el chatben és ne tedd GitHubra.

A létrehozás után ez is megjelenik:

```text
/DataVolume/homehub/vault-pin.json
```

## 6. Hozzáférések felvétele

A trezor előre listázza a jelenlegi infrastruktúrát:

```text
Technicolor FGA2233      https://192.168.1.1
Archer C6 v4             http://192.168.0.1
TP-Link RE220 v3         http://192.168.0.110
TP-Link RE315 #1 v1      http://192.168.0.113
TP-Link RE315 #2 v1      http://192.168.0.116
TL-SG108E                http://192.168.1.49
KD20 / oldnas            http://192.168.1.12
WD My Cloud              http://192.168.1.180
```

Eszközönként add meg a helyi admin felhasználónevet/jelszót. Ha egy eszköz csak jelszót használ, a felhasználónév maradhat üresen.

## 7. Home Hub ellenőrzése

A Render deploy és Bridge frissítés után a Home Hubban új **Hozzáférések** menüpont jelenik meg.

Ott látszik:

- admin URL;
- felhasználónév;
- `••••••••`, ha van mentett jelszó;
- `Admin megnyitása`;
- `Helyi trezor megnyitása`.

A jelszó maga nem érkezik meg a Renderre.

## 8. TL-SG108E ellenőrzés

A v0.17-ben beállított switch credentialnek migráció után továbbra is működnie kell. A Home Hub Hálózat tabon ellenőrizd:

```text
Admin kapcsolat OK
Port 1..8 sebesség / duplex
```

Ha nem:

```sh
/DataVolume/homehub/homehub-bridge -vault-status -config /DataVolume/homehub/config.json
```

és a helyi trezorban ellenőrizd a `tl-sg108e` bejegyzést.

## 9. Health ellenőrzés

```text
http://192.168.1.180:8788/health
```

Elvárt JSON:

```json
{"ok":true,"service":"homehub-media"}
```

A `/vault` ugyanazon a helyi HTTP szerveren fut.

## 10. Fontos hálózati megjegyzés

Az Archer C6 külön LAN-t használ:

```text
WAN: 192.168.1.129
LAN: 192.168.0.1
```

Az RE220/RE315 eszközök a `192.168.0.x` oldalon vannak. A WD Bridge a `192.168.1.x` hálózaton fut, ezért az admin URL-eket tárolni és megnyitni tudjuk, de a WD-ről közvetlen részletes API-monitorozásuk alapból nem garantált. A v0.18 emiatt nem kapcsol be WAN remote managementet és nem módosít router tűzfalat.
