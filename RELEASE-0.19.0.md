# HomeHub v0.19.0 – People & Presence + Home Timeline + Historical AI

A v0.19.0 a v0.18.0 Credentials Vault kiadásra épül. A cél, hogy a HomeHub ne csak az aktuális pillanatképet ismerje, hanem személyekhez, jelenléthez és időbeli eseményekhez is tudjon kontextust adni.

## Új funkciók

### Emberek / Household

- Új **Emberek** menüpont.
- Név, becenév és szerep kezelése.
- Profilkép feltöltése JPEG/PNG/WebP formátumban.
- A böngésző nagy képet automatikusan kb. 320 px-es JPEG profilképpé kicsinyít, így a tartós állapot nem nő indokolatlanul.
- Egy személyhez több hálózati eszköz rendelhető.
- Eszközszerepek:
  - `primary`: elsődleges jelenléti eszköz, tipikusan telefon;
  - `secondary`: másodlagos személyes eszköz;
  - `stationary`: otthon maradható PC/laptop, önmagában nem bizonyítja a személy jelenlétét.

### Ki van itthon?

A kezdőlapon új jelenléti sáv jelenik meg profilképekkel.

Állapotok:

- **Itthon**: megfigyelhető elsődleges eszköz online, vagy megfelelő másodlagos személyes eszköz látható.
- **Nincs itthon**: az összes megfigyelhető elsődleges eszköz offline.
- **Bizonytalan**: nincs elég megbízható hálózati jel, vagy csak otthon maradható eszköz látható.

A v0.19 szándékosan nem állítja azt, hogy valaki nincs otthon, ha az elsődleges telefon az Archer C6 `192.168.0.x` NAT mögötti hálózatán van, és a WD Bridge nem tudja megfigyelni. Ilyenkor `Bizonytalan` állapot jelenik meg.

### Home Timeline

Új **Idővonal** menüpont, kategóriaszűrőkkel.

Rögzített események:

- hálózati eszköz online/offline;
- IP-változás;
- switch linksebesség-változás;
- óránkénti hálózati státuszminta a fontos infrastruktúráról és számítógépekről;
- személy jelenléti állapotváltás;
- myGate kapu nyitás/zárás;
- Smart Life online/offline változás;
- klíma be/ki állapotváltás, ha a Tuya profilból egyértelműen azonosítható;
- Feyree töltő állapotváltás, ha kategória-DP elérhető;
- Xiaomi porszívó állapotváltás;
- KD20 / WD / nyomtatószolgáltatás elérhetőségének változása;
- automatizálás lefutása.

A részletes történet 90 napra van korlátozva, legfeljebb 10 000 eseménnyel.

### AI Historical Queries

Az AI Asszisztens az aktuális HomeHub állapot mellett megkapja az utolsó 72 óra legfeljebb 700 releváns timeline eseményét, valamint az Emberek/Jelenlét állapotot.

Példák:

- `Ki van most itthon?`
- `Melyik gép volt online éjjel?`
- `Mikor ért haza Dorka?`
- `Nyitva maradt ma a kapu?`
- `Mikor volt utoljára offline az oldnas?`

Ha nincs elég történeti adat vagy a kérdezett időszak kívül esik az AI 72 órás kontextusablakán, az asszisztensnek ezt ki kell mondania.

## Tartós tárolás

A v0.19 nem vezet be új SQLite-függőséget az öreg WD OS3 rendszerre. A People/Presence/Timeline adatok a HomeHub meglévő persistent state-jének részei, amelyet a WD Bridge minden ciklusban a következő helyre tükröz:

`/DataVolume/homehub/server-state.json`

Ez megtartja a v0.18 biztonságos, függőségmentes ARMv7 telepítési modellt, és Render újraindítás után a WD-ről visszaállítható az állapot.

A profilkép kisméretű normalizált változata a persistent state része, ezért futás közben a Render memóriájában/állapotfájljában is jelen van, majd tartósan a WD-re tükröződik. A Credentials Vault jelszavai ettől függetlenül továbbra sem kerülnek a Render persistent state-be.

## Kompatibilitás

- Meglévő `/DataVolume/homehub/config.json` nem kerül felülírásra.
- A v0.18 Credentials Vault és a már migrált TL-SG108E hitelesítés megmarad.
- Nincs új Render környezeti változó.
- Nincs új Go modul vagy ARM runtime függőség.
- A KD20 Transmission, SMB, LPR nyomtató, média és Smart Life funkciók változatlanul megmaradnak.

## Ismert korlát

A jelenlegi WD Bridge közvetlenül a `192.168.1.0/24` hálózatot figyeli. Az Archer C6 saját `192.168.0.0/24` LAN-ján lévő telefonok és kliensek automatikus jelenléti követéséhez a következő fejlesztési lépés az Archer firmware-specifikus klienslista-adapter, vagy hálózati oldalon az Archer AP mód / közös LAN kialakítása.
