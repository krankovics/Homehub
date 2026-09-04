# Credentials Vault

## Cél

A Home Hub v0.18 a hálózati admin hozzáféréseket nem a Renderen és nem a böngésző localStorage-jában tárolja. A titkok gazdája a WD My Cloudon futó Bridge.

## Fájlok

Alapértelmezett helyek:

```text
/DataVolume/homehub/credentials.vault
/DataVolume/homehub/vault.key
/DataVolume/homehub/vault-pin.json
```

Mindhárom fájl `0600` jogosultságot kap. A `credentials.vault` AES-256-GCM titkosított JSON payload. A `vault.key` 32 véletlen bájt, amely a Bridge automatikus újraindulását teszi lehetővé. A `vault-pin.json` sózott, iterált PIN-hash-t tárol, nem a PIN-t.

## Helyi kezelőfelület

Otthoni hálózatról:

```text
http://192.168.1.180:8788/vault
```

Első megnyitáskor legalább 6 karakteres helyi PIN-t kell létrehozni. Ezután a trezorban eszközönként megadható:

- név;
- admin URL;
- felhasználónév;
- jelszó;
- opcionális megjegyzés.

A jelszó külön `Megjelenítés` művelettel kérhető le, csak feloldott helyi munkamenetben.

## Mit kap meg a Render?

A Bridge snapshot csak ezt küldi:

```json
{
  "id": "tl-sg108e",
  "label": "TL-SG108E",
  "username": "admin",
  "adminUrl": "http://192.168.1.49",
  "hasPassword": true,
  "saved": true
}
```

A `password` mező soha nem része a snapshotnak.

## Régi network-secrets migráció

Ha v0.17-ből megmaradt:

```text
/DataVolume/homehub/network-secrets.json
```

akkor a v0.18 induláskor a benne található credentialöket betölti a titkosított trezorba. Sikeres mentés után a plaintext fájlt eltávolítja. Ha a migráció hibázik, a régi fájlt nem törli.

## Diagnosztika

```sh
/DataVolume/homehub/homehub-bridge -vault-status -config /DataVolume/homehub/config.json
```

A parancs csak metaadatot ír ki. Jelszót nem.

## Backup

A három vault fájlt együtt kell menteni. A `credentials.vault` önmagában a `vault.key` nélkül nem visszafejthető. A PIN fájl nem helyettesíti a kulcsot.

## Korlát

A kulcs és a titkosított adat ugyanazon a WD-n található, mert a Bridge-nek felügyelet nélkül újra kell tudnia indulni. Ha valaki root hozzáférést szerez a WD-hez, a credentialök elméletileg visszafejthetők. A megoldás nem hardveres HSM és nem különálló jelszókezelő.
