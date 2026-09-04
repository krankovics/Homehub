# HomeHub v0.20.0 — Device Identity & Tuya Network Enrichment

## Cél

Az automatikusan felderített hálózati kliensek tartós, emberi névvel ellátott azonosítása, különösen a Tuya/Smart Life eszközök, családi telefonok/órák, TV beltérik és mesh mögötti kliensek esetén.

## Újdonságok

- Tuya factory-info MAC lekérés és automatikus LAN-párosítás.
- Kompatibilitási fallback a régi, MAC-et tartalmazó ESP/Tuya Device ID-khez.
- Megerősített családi eszközök név szerinti azonosítása IP-hardcode nélkül.
- Két Telekom TV beltéri és Xiaomi porszívó előre megerősített identitása.
- Duplikált/proxy MAC felismerés TP-Link mesh helyzetekhez.
- `Azonosítás` gomb a hálózati eszközkártyákon; kézi override tartós mentéssel.
- Tuya MAC/Device ID/owner/confidence információ a Hálózat UI-ban.
- Tuya report-log import a Home Timeline-ba, ha az API-jogosultság rendelkezésre áll.
- AI hálózati kontextus az enrich-elt eszköznevekkel.
- Új környezeti beállítások: `TUYA_LOG_REFRESH_MS`, `TUYA_LOG_LOOKBACK_MS`.

## Kompatibilitás

A v0.20.0 a v0.19.0 state-et betölti. Új persistent mezők:

- `deviceIdentityOverrides`
- `tuyaLogCursor`

A Credentials Vault formátuma nem változik. A Bridge configot az upgrade script nem írja felül.

## Tudatos korlátok

- Edina iPhone-ja nincs hardcode-olva, mert a stabil otthoni privát MAC-jét még később kell megerősíteni.
- A Tuya Basic Information `IP Address` mező publikus WAN IP lehet; ezt a Home Hub nem használja LAN-identitásnak.
- Tuya Device Logs csak megfelelő cloud entitlement mellett importálható.
- Ugyanaz a proxy MAC több IP-n nem tekinthető valódi egyedi kliensnek.
