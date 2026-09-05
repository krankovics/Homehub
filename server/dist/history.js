import crypto from "node:crypto";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 10_000;
export function pushHistory(state, event) {
    const full = { id: event.id || crypto.randomUUID(), ...event };
    state.history.push(full);
    const cutoff = Date.now() - RETENTION_MS;
    state.history = state.history.filter((e) => new Date(e.createdAt).getTime() >= cutoff).slice(-MAX_HISTORY);
    return full;
}
export function networkEventsToHistory(events) {
    return events.map((e) => ({
        id: crypto.randomUUID(),
        category: "network",
        type: `network.${e.type}`,
        entityId: e.networkId,
        entityName: e.deviceName,
        message: e.message,
        createdAt: e.createdAt,
        data: { port: e.port, fromValue: e.fromValue, toValue: e.toValue }
    }));
}
function networkById(network) {
    return new Map(network.map((n) => [n.id, n]));
}
export function derivePresence(person, network, previous) {
    const byId = networkById(network);
    const now = new Date().toISOString();
    const primary = person.devices.filter((d) => d.role === "primary");
    const secondary = person.devices.filter((d) => d.role === "secondary");
    const stationary = person.devices.filter((d) => d.role === "stationary");
    const resolvedPrimary = primary.map((d) => ({ link: d, n: byId.get(d.networkId) })).filter((x) => Boolean(x.n));
    const resolvedSecondary = secondary.map((d) => ({ link: d, n: byId.get(d.networkId) })).filter((x) => Boolean(x.n));
    const resolvedStationary = stationary.map((d) => ({ link: d, n: byId.get(d.networkId) })).filter((x) => Boolean(x.n));
    const primaryOnline = resolvedPrimary.find((x) => x.n?.online);
    const secondaryOnline = resolvedSecondary.find((x) => x.n?.online);
    const stationaryOnline = resolvedStationary.find((x) => x.n?.online);
    let status = "uncertain";
    let confidence = 0;
    let source;
    let networkId;
    let note;
    if (primaryOnline?.n) {
        status = "home";
        confidence = resolvedPrimary.filter((x) => x.n?.online).length > 1 ? 99 : 94;
        source = primaryOnline.n.name;
        networkId = primaryOnline.n.id;
        note = "Elsődleges jelenléti eszköz online.";
    }
    else if (primary.length > 0 && resolvedPrimary.length === primary.length) {
        status = "away";
        confidence = 90;
        note = "Az összes elsődleges jelenléti eszköz offline.";
    }
    else if (secondaryOnline?.n) {
        status = "home";
        confidence = 78;
        source = secondaryOnline.n.name;
        networkId = secondaryOnline.n.id;
        note = "Másodlagos személyes eszköz online; a telefon nincs biztosan megfigyelve.";
    }
    else if (stationaryOnline?.n) {
        status = "uncertain";
        confidence = 55;
        source = stationaryOnline.n.name;
        networkId = stationaryOnline.n.id;
        note = "Csak otthon maradható eszköz online, ez önmagában nem bizonyít jelenlétet.";
    }
    else if (person.devices.length === 0) {
        status = "uncertain";
        confidence = 0;
        note = "Nincs eszköz hozzárendelve.";
    }
    else if (resolvedPrimary.length < primary.length) {
        status = "uncertain";
        confidence = 35;
        note = "Legalább egy elsődleges eszköz nem látható a Bridge jelenlegi hálózati forrásából. Archer mögötti klienshez klienslista-adapter vagy közös LAN szükséges.";
    }
    else {
        status = "away";
        confidence = 75;
        note = "A hozzárendelt személyes eszközök jelenleg nem elérhetők.";
    }
    const same = previous?.status === status;
    return {
        personId: person.id,
        name: person.name,
        status,
        confidence,
        since: same ? previous?.since : now,
        lastSeenAt: status === "home" ? now : previous?.lastSeenAt,
        source,
        networkId,
        note
    };
}
export function updatePresence(state, network) {
    const now = new Date().toISOString();
    const next = {};
    const events = [];
    for (const person of state.people) {
        const prev = state.presenceRuntime[person.id];
        const current = derivePresence(person, network, prev);
        next[person.id] = current;
        if (!prev || prev.status !== current.status) {
            const text = current.status === "home" ? `${person.name} itthon van.` : current.status === "away" ? `${person.name} nincs itthon.` : `${person.name} jelenléte bizonytalan.`;
            events.push({
                id: crypto.randomUUID(), category: "presence", type: `presence.${current.status}`,
                entityId: person.id, entityName: person.name, message: text, createdAt: now,
                data: { confidence: current.confidence, source: current.source, networkId: current.networkId, note: current.note }
            });
        }
    }
    state.presenceRuntime = next;
    for (const e of events)
        pushHistory(state, e);
    return next;
}
export function recordHourlyNetworkSample(state, network) {
    const d = new Date();
    const key = d.toISOString().slice(0, 13);
    if (state.historySampleKey === key)
        return;
    state.historySampleKey = key;
    const createdAt = d.toISOString();
    for (const n of network.filter((x) => ["computer", "nas", "gateway", "router", "switch"].includes(x.kind))) {
        pushHistory(state, {
            category: "network", type: "network.sample", entityId: n.id, entityName: n.name,
            message: `${n.name}: ${n.online ? "online" : "offline"}${n.ip ? ` · ${n.ip}` : ""}`,
            createdAt, data: { online: n.online, ip: n.ip, kind: n.kind }
        });
    }
}
function statusMap(device) {
    return Object.fromEntries((Array.isArray(device?.status) ? device.status : []).map((x) => [String(x.code || ""), x.value]));
}
function gateValue(device) {
    const m = statusMap(device);
    const keys = Object.keys(m);
    const key = keys.find((k) => /door_sensor_state|door.*state|gate.*state|open.*state/i.test(k));
    if (!key)
        return undefined;
    return m[key];
}
function boolValue(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    const v = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "on", "open", "opened", "enabled"].includes(v))
        return true;
    if (["false", "0", "off", "close", "closed", "disabled", ""].includes(v))
        return false;
    return Boolean(value);
}
function normalizeGate(value) {
    const v = String(value ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();
    if (["closed", "close", "zárt"].includes(v))
        return "closed";
    if (["opened", "open", "nyitva", "opening", "partially opened", "partial open"].includes(v))
        return "open";
    return v || "unknown";
}
export function tuyaDeviceHistory(beforeDevices, afterDevices) {
    const before = new Map(beforeDevices.map((d) => [String(d.id), d]));
    const events = [];
    const now = new Date().toISOString();
    for (const d of afterDevices) {
        const prev = before.get(String(d.id));
        if (!prev)
            continue;
        const text = `${d?.name || ""} ${d?.productName || ""}`;
        if (Boolean(prev.online) !== Boolean(d.online)) {
            events.push({
                id: crypto.randomUUID(), category: "smart", type: d.online ? "smart.online" : "smart.offline",
                entityId: String(d.id), entityName: d.name || "Smart eszköz",
                message: `${d.name || "Smart eszköz"}: ${d.online ? "online" : "offline"}.`, createdAt: now,
                data: { online: Boolean(d.online), profile: d.profile || null }
            });
        }
        if (d?.profile === "mygate" || /kapu|gate|garage|garázs/i.test(text)) {
            const a = normalizeGate(gateValue(d));
            const b = normalizeGate(gateValue(prev));
            if (a !== b && a !== "unknown") {
                const opened = a === "open";
                events.push({
                    id: crypto.randomUUID(), category: "security", type: opened ? "gate.opened" : "gate.closed",
                    entityId: String(d.id), entityName: d.name || "Kapu",
                    message: opened ? `${d.name || "Kapu"} kinyílt.` : `${d.name || "Kapu"} bezárult.`,
                    createdAt: now, data: { from: b, to: a }
                });
            }
        }
        const beforeStatus = statusMap(prev), afterStatus = statusMap(d);
        if (d?.profile === "aircon" || /klíma|air conditioner|aircon|climate/i.test(text)) {
            const key = Object.keys(afterStatus).find(k => /^(switch|power|switch_1)$/i.test(k));
            if (key && beforeStatus[key] !== afterStatus[key]) {
                const on = boolValue(afterStatus[key]);
                events.push({ id: crypto.randomUUID(), category: "smart", type: on ? "climate.on" : "climate.off", entityId: String(d.id), entityName: d.name, message: `${d.name}: klíma ${on ? "bekapcsolva" : "kikapcsolva"}.`, createdAt: now, data: { code: key, value: afterStatus[key] } });
            }
        }
        if (d?.profile === "feyree" || /feyree|ev charger|evse|autó.*tölt/i.test(text)) {
            const key = Object.keys(afterStatus).find(k => /chargingoperation|devicestate|work_state/i.test(k));
            if (key && beforeStatus[key] !== afterStatus[key]) {
                events.push({ id: crypto.randomUUID(), category: "energy", type: "ev.state", entityId: String(d.id), entityName: d.name, message: `${d.name}: töltőállapot ${String(afterStatus[key]).replace(/_/g, " ")}.`, createdAt: now, data: { code: key, from: beforeStatus[key], to: afterStatus[key] } });
            }
        }
    }
    return events;
}
