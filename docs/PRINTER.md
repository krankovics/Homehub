# KD20 USB nyomtatómegosztás

A Shuttle OMNINAS KD20 gyári firmware-e USB Print Server funkciót tartalmaz. A nyomtatót fizikailag a KD20 USB-portjára kell csatlakoztatni, majd a KD20 webes admin `USB → Printer Setting` menüjében engedélyezni.

## Mit csinál a HomeHub v0.7?

- a Bridge a helyi hálózaton ellenőrzi a KD20 tipikus print service portjait: RAW/JetDirect 9100, LPR/LPD 515, IPP 631;
- a dashboardon mutatja az észlelt protokollt/portot;
- shortcutot ad a `http://192.168.1.12` KD20 adminhoz;
- a nyomtatási adat nem megy a Renderen keresztül.

## Ha a HomeHub azt írja, hogy „Várakozik”

Ez nem feltétlenül jelenti, hogy a KD20 printer funkció hibás. Egyes USB nyomtatók / KD20 implementációk hálózati discoveryvel jelennek meg, és nem nyitják meg a tipikus RAW/LPR/IPP portokat. Ilyenkor a KD20 `USB → Printer Setting` oldala az elsődleges állapotforrás.

## Windows

A KD20-on engedélyezett printer után Windowsban az `Eszköz hozzáadása / Nyomtató hozzáadása` felületen keresd a hálózati nyomtatót. A gyártói printer driver továbbra is szükséges lehet.
