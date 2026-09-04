import type { DeviceIdentityOverride, NetworkIdentity, NetworkStatus } from "./types.js";
import type { TuyaDevice } from "./tuya.js";

export function normalizeMac(value: string | undefined | null) {
  const raw = String(value || "").trim().toLowerCase().replace(/-/g, ":");
  const hex = raw.replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return raw;
  return hex.match(/.{2}/g)?.join(":") || raw;
}

function embeddedMac(deviceId: string) {
  const hex = String(deviceId || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length < 12) return "";
  const tail = hex.slice(-12);
  // Tuya's older ESP sensor ids in this home include the physical MAC in the
  // last 12 hex characters. Do not use the heuristic for random-looking ids.
  const id = String(deviceId || "").toLowerCase();
  if (!id.startsWith("20284731") && !tail.startsWith("3c6105")) return "";
  return normalizeMac(tail);
}

type KnownIdentity = { label: string; owner?: string; deviceType: string; note?: string };

// Confirmed by the homeowner. These are stable, per-SSID private Wi-Fi MACs
// where applicable, so they are suitable HomeHub identity keys even when DHCP
// addresses change.
const KNOWN: Record<string, KnownIdentity> = Object.fromEntries([
  ["02:f7:6c:70:f3:f9", { label: "Béla iPhone", owner: "Béla", deviceType: "telefon", note: "Elsődleges jelenléti eszköz" }],
  ["0a:c7:bb:f2:c4:48", { label: "Béla Apple Watch", owner: "Béla", deviceType: "okosóra", note: "Másodlagos jelenléti eszköz" }],
  ["fa:24:f6:7f:74:cc", { label: "Edina Galaxy A34", owner: "Edina", deviceType: "telefon", note: "Másodlagos jelenléti eszköz; Edina iPhone-ja lesz az elsődleges" }],
  ["06:c7:92:dd:c2:c1", { label: "Dorka iPhone", owner: "Dorka", deviceType: "telefon", note: "Elsődleges jelenléti eszköz" }],
  ["d2:a9:53:16:bd:d3", { label: "Dávid iPhone", owner: "Dávid", deviceType: "telefon", note: "Elsődleges jelenléti eszköz" }],
  ["2e:23:0b:4e:ed:41", { label: "Dávid Apple Watch", owner: "Dávid", deviceType: "okosóra", note: "Másodlagos jelenléti eszköz" }],
  ["10:5f:49:f7:0a:da", { label: "Lenti nappali Telekom TV beltéri", deviceType: "TV beltéri" }],
  ["48:f7:c0:ee:e7:b4", { label: "Fenti Telekom TV beltéri", deviceType: "TV beltéri" }],
  ["c8:5c:cc:59:aa:b5", { label: "Xiaomi Robot Vacuum E10", deviceType: "porszívó" }]
].map(([mac, v]) => [normalizeMac(mac as string), v as KnownIdentity]));

function identityFromOverride(o: DeviceIdentityOverride): NetworkIdentity {
  return {
    source: "manual",
    confidence: 100,
    label: o.name,
    owner: o.owner || undefined,
    deviceType: o.kind || undefined,
    matchedMac: normalizeMac(o.mac),
    note: o.note || "Kézzel megerősített hálózati identitás."
  };
}

function identityFromKnown(mac: string, k: KnownIdentity): NetworkIdentity {
  return {
    source: "known_device",
    confidence: 100,
    label: k.label,
    owner: k.owner,
    deviceType: k.deviceType,
    matchedMac: mac,
    note: k.note || "Kézzel megerősített eszköz."
  };
}

function tuyaMacCandidates(d: TuyaDevice) {
  return [...new Set([normalizeMac(d.mac), embeddedMac(d.id)].filter(x => /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(x)))];
}

export function enrichNetworkIdentities(network: NetworkStatus[], tuyaDevices: TuyaDevice[], overrides: Record<string, DeviceIdentityOverride> = {}) {
  const tuyaByMac = new Map<string, { device: TuyaDevice; source: "tuya_factory" | "tuya_device_id" }>();
  for (const d of tuyaDevices) {
    const factoryMac = normalizeMac(d.mac);
    if (/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(factoryMac)) tuyaByMac.set(factoryMac, { device: d, source: "tuya_factory" });
    for (const mac of tuyaMacCandidates(d)) if (!tuyaByMac.has(mac)) tuyaByMac.set(mac, { device: d, source: "tuya_device_id" });
  }

  const macCounts = new Map<string, number>();
  for (const n of network) {
    const mac = normalizeMac(n.mac);
    if (mac) macCounts.set(mac, (macCounts.get(mac) || 0) + 1);
  }

  return network.map((n): NetworkStatus => {
    const mac = normalizeMac(n.mac);
    let identity: NetworkIdentity | undefined;
    const override = overrides[mac];
    if (override) identity = identityFromOverride(override);
    else if (KNOWN[mac]) identity = identityFromKnown(mac, KNOWN[mac]);
    else if (tuyaByMac.has(mac)) {
      const match = tuyaByMac.get(mac)!;
      identity = {
        source: match.source,
        confidence: match.source === "tuya_factory" ? 99 : 94,
        label: match.device.name,
        deviceType: match.device.productName || match.device.category || "Tuya / Smart Life",
        tuyaDeviceId: match.device.id,
        tuyaProductName: match.device.productName,
        matchedMac: mac,
        note: match.source === "tuya_factory" ? "Tuya factory-info MAC alapján automatikusan párosítva." : "Tuya Device ID-be ágyazott MAC alapján párosítva."
      };
    } else if ((macCounts.get(mac) || 0) > 1 && mac) {
      identity = {
        source: "proxy",
        confidence: 35,
        label: "TP-Link mesh mögötti kliens",
        deviceType: "proxyzott Wi-Fi kliens",
        matchedMac: mac,
        note: "Ugyanez a MAC több IP-n jelent meg. A HomeHub nem tekinti ezt valódi kliensidentitásnak."
      };
    }

    const rawName = n.rawName || n.name;
    const shouldRename = Boolean(identity && (n.kind === "discovered" || /ismeretlen/i.test(n.name)));
    return {
      ...n,
      rawName,
      name: shouldRename ? identity!.label : n.name,
      mac,
      identity
    };
  });
}
