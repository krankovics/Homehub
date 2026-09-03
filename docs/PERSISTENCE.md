# Render + WD tartós állapot

A Render Free instance fájlrendszere nem tekinthető tartós tárhelynek. A v0.9 ezért a HomeHub fontos szerverállapotát visszatükrözi a WD-re.

WD fájl:

```text
/DataVolume/homehub/server-state.json
```

Mentett adatok:

- automatikus másolás be/ki és célmappa
- másolási állapotok
- legutóbbi parancsok / függő parancsok

A Bridge a szerver `/api/bridge/snapshot` válaszából menti ezt a fájlt. Következő snapshotnál visszaküldi. Ha a Render friss példánya üres állapottal indul, a frissebb WD backupot importálja.

A kész torrentek helyi másolási nyilvántartása külön fájl:

```text
/DataVolume/homehub/autocopy-state.json
```

Ez teszi lehetővé, hogy a KD20 → WD automatikus másolás Render-kiesés alatt is működjön a legutóbb szinkronizált beállítással.
