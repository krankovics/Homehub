# HomeHub v0.18.0 – Credentials Vault

A v0.18.0 a v0.17.0 Network Intelligence kiadásra épül, és helyi, titkosított hozzáférés-kezelést ad a WD My Cloud Bridge-hez.

## Új funkciók

- Új **Hozzáférések** tab a Home Hub PWA-ban.
- Helyi **Credentials Vault** a WD My Cloudon.
- AES-256-GCM titkosítás a `credentials.vault` fájlban.
- Külön, root-only 32 bájtos `vault.key`.
- Helyi PIN-nel védett jelszó-megjelenítés, rövid életű HttpOnly munkamenettel.
- A jelszavak nem kerülnek Renderre, a Home Hub felhős snapshotba vagy OpenAI-hoz.
- A felhős UI csak metaadatot lát: eszköz, admin URL, felhasználónév, van-e mentett jelszó.
- Helyi trezoroldal: `http://<WD-IP>:8788/vault`.
- Beépített inventory: Technicolor FGA2233, Archer C6 v4, RE220 v3, két RE315 v1, TL-SG108E v6, KD20 és WD My Cloud.
- A korábbi `network-secrets.json` sikeres migráció után automatikusan bekerül a titkosított trezorba, majd a plaintext fájl törlődik.
- A TL-SG108E read-only adapter már a trezorból kapja a helyi admin credentialt.
- `-vault-status` diagnosztikai kapcsoló, amely csak metaadatot ír ki, jelszót soha.
- A v0.17 `-once` média-port ütközése javítva: egyszeri snapshot módban nem indul második helyi HTTP szerver.

## Ismert hálózati topológia frissítése

- Technicolor FGA2233: `192.168.1.1`
- TL-SG108E v6: `192.168.1.49`
- Archer C6 v4 WAN: `192.168.1.129`
- Archer C6 v4 LAN/admin: `192.168.0.1`
- RE220 v3: `192.168.0.110`
- RE315 #1 v1: `192.168.0.113`
- RE315 #2 v1: `192.168.0.116`
- KD20 / oldnas: `192.168.1.12`
- WD My Cloud: `192.168.1.180`

Az Archer mögötti `192.168.0.0/24` eszközök admin URL-jeit a Home Hub tárolja és meg tudja nyitni, de a WD Bridge a WAN/LAN szeparáció miatt nem feltétlenül tudja közvetlenül monitorozni ezeket. A v0.18 nem kapcsol be távoli adminisztrációt és nem gyengíti az Archer tűzfalát.

## Biztonsági modell

A titkosított trezor a véletlen fájlmásolás, backupba kerülés és felhős kiszivárgás kockázatát csökkenti. A titkosítási kulcs ugyanazon a WD-n van, root-only fájlban, mert a Bridge-nek újraindítás után automatikusan fel kell tudnia oldani a credentialöket. Emiatt teljes WD root kompromittálás ellen ez nem hardveres vagy különálló password manager.

A helyi trezor HTTP végpont csak privát/loopback forráscímről fogad kérést, külső assetet nem tölt, és a reveal munkamenet alapból 10 perc után lejár.

## Élesítés

Részletesen: `INSTALL-0.18.0.md`.
