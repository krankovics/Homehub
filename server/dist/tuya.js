import crypto from "node:crypto";
function inferProfile(name, productName, category) {
    const s = `${name} ${productName} ${category}`.toLowerCase();
    if (/mygate|gatepro|garage door opener|ckmkzq/.test(s))
        return "mygate";
    if (/feyree|portable charger|ev charger|evse/.test(s))
        return "feyree";
    if (/新风分体机|air conditioner|aircon|climate/.test(s))
        return "aircon";
    return undefined;
}
function mergeFunctions(profile, source) {
    const out = [...source];
    const add = (point) => { if (!out.some(x => x.code === point.code))
        out.push(point); };
    if (profile === "mygate") {
        for (const code of ["light_1", "stop_1", "pedestrian_1", "start_1", "open_1", "close_1"])
            add({ code, type: "Boolean", values: "{}" });
    }
    if (profile === "feyree")
        add({ code: "switchsvg", type: "Boolean", values: "{}" });
    if (profile === "aircon")
        add({ code: "Powersvg", type: "Boolean", values: "{}" });
    return out;
}
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function sha256(input) { return crypto.createHash("sha256").update(input).digest("hex"); }
function hmac(input, secret) { return crypto.createHmac("sha256", secret).update(input).digest("hex").toUpperCase(); }
export class TuyaClient {
    endpoint;
    clientId;
    secret;
    token = "";
    tokenUntil = 0;
    uid = "";
    mode = "modern";
    specCache = new Map();
    constructor(endpoint, clientId, secret) {
        this.endpoint = endpoint.replace(/\/$/, "");
        this.clientId = clientId;
        this.secret = secret;
    }
    configured() { return Boolean(this.clientId && this.secret && this.endpoint); }
    stringToSign(method, path, body) {
        return `${method.toUpperCase()}\n${body ? sha256(body) : EMPTY_SHA}\n\n${path}`;
    }
    headers(method, path, body, accessToken = "", mode = this.mode) {
        const t = String(Date.now());
        const sign = mode === "legacy"
            ? hmac(this.clientId + accessToken + t, this.secret)
            : hmac(this.clientId + accessToken + t + this.stringToSign(method, path, body), this.secret);
        const h = {
            client_id: this.clientId, sign, sign_method: "HMAC-SHA256", t, lang: "en", "content-type": "application/json"
        };
        if (accessToken)
            h.access_token = accessToken;
        return h;
    }
    async raw(method, path, bodyObj, accessToken = "", mode = this.mode) {
        const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
        const r = await fetch(this.endpoint + path, { method, headers: this.headers(method, path, body, accessToken, mode), body: body || undefined });
        const text = await r.text();
        let j;
        try {
            j = JSON.parse(text);
        }
        catch {
            throw new Error(`Tuya HTTP ${r.status}: ${text.slice(0, 500)}`);
        }
        if (!r.ok || !j.success)
            throw new Error(`Tuya ${j.code ?? r.status}: ${j.msg || "request failed"}`);
        return j;
    }
    async ensureToken() {
        if (this.token && Date.now() < this.tokenUntil - 60_000)
            return this.token;
        const path = "/v1.0/token?grant_type=1";
        let j;
        try {
            j = await this.raw("GET", path, undefined, "", "modern");
            this.mode = "modern";
        }
        catch (modernErr) {
            try {
                j = await this.raw("GET", path, undefined, "", "legacy");
                this.mode = "legacy";
            }
            catch {
                throw modernErr;
            }
        }
        if (!j.result?.access_token)
            throw new Error("Tuya token missing");
        this.token = j.result.access_token;
        this.uid = j.result.uid ? String(j.result.uid) : this.uid;
        const ttl = Number(j.result.expire_time || j.result.expire || 7200);
        this.tokenUntil = Date.now() + ttl * 1000;
        return this.token;
    }
    async request(method, path, body) {
        const token = await this.ensureToken();
        try {
            return (await this.raw(method, path, body, token)).result;
        }
        catch (err) {
            if (/token/i.test(String(err))) {
                this.token = "";
                const fresh = await this.ensureToken();
                return (await this.raw(method, path, body, fresh)).result;
            }
            throw err;
        }
    }
    async factoryInfos(deviceIds) {
        const out = new Map();
        for (let i = 0; i < deviceIds.length; i += 20) {
            const chunk = deviceIds.slice(i, i + 20).filter(Boolean);
            if (!chunk.length)
                continue;
            const qs = new URLSearchParams({ device_ids: chunk.join(",") }).toString();
            let list = [];
            try {
                list = await this.request("GET", `/v1.0/iot-03/devices/factory-infos?${qs}`);
            }
            catch {
                try {
                    list = await this.request("GET", `/v1.0/devices/factory-infos?${qs}`);
                }
                catch {
                    list = [];
                }
            }
            for (const row of Array.isArray(list) ? list : []) {
                const id = String(row?.id || "");
                if (!id)
                    continue;
                out.set(id, {
                    id,
                    uuid: row?.uuid ? String(row.uuid) : undefined,
                    sn: row?.sn ? String(row.sn) : undefined,
                    mac: row?.mac ? String(row.mac).toLowerCase().replace(/-/g, ":") : undefined
                });
            }
        }
        return out;
    }
    async reportLogs(deviceId, codes, startTime, endTime) {
        const cleanCodes = [...new Set(codes.map(x => String(x || "").trim()).filter(Boolean))].slice(0, 50);
        if (!cleanCodes.length)
            return [];
        const qs = new URLSearchParams({
            codes: cleanCodes.join(","),
            start_time: String(Math.max(0, Math.floor(startTime))),
            end_time: String(Math.max(0, Math.floor(endTime))),
            size: "100"
        });
        let result;
        try {
            result = await this.request("GET", `/v2.1/cloud/thing/${encodeURIComponent(deviceId)}/report-logs?${qs.toString()}`);
        }
        catch {
            result = await this.request("GET", `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/report-logs?${qs.toString()}`);
        }
        return (Array.isArray(result?.logs) ? result.logs : []).map((x) => ({
            code: String(x?.code || ""), value: x?.value, eventTime: Number(x?.event_time || x?.eventTime || 0)
        })).filter((x) => Boolean(x.code) && Number.isFinite(x.eventTime) && x.eventTime > 0);
    }
    async specs(deviceId) {
        const cached = this.specCache.get(deviceId);
        if (cached && Date.now() - cached.at < 60 * 60_000)
            return cached;
        try {
            const result = await this.request("GET", `/v1.1/devices/${encodeURIComponent(deviceId)}/specifications`);
            const x = { at: Date.now(), functions: result?.functions || [], status: result?.status || [] };
            this.specCache.set(deviceId, x);
            return x;
        }
        catch {
            try {
                const result = await this.request("GET", `/v1.0/devices/${encodeURIComponent(deviceId)}/functions`);
                const x = { at: Date.now(), functions: result?.functions || [], status: [] };
                this.specCache.set(deviceId, x);
                return x;
            }
            catch {
                const x = { at: Date.now(), functions: [], status: [] };
                this.specCache.set(deviceId, x);
                return x;
            }
        }
    }
    async devices() {
        const all = [];
        let last = "";
        for (let page = 0; page < 10; page++) {
            const qs = new URLSearchParams({ size: "100" });
            if (last)
                qs.set("last_row_key", last);
            const result = await this.request("GET", `/v1.0/iot-01/associated-users/devices?${qs.toString()}`);
            all.push(...(result?.devices || []));
            if (!result?.has_more || !result.last_row_key)
                break;
            last = result.last_row_key;
        }
        const factory = await this.factoryInfos(all.map(d => String(d?.id || "")).filter(Boolean));
        const devices = [];
        const workers = Math.min(5, Math.max(1, all.length));
        let index = 0;
        await Promise.all(Array.from({ length: workers }, async () => {
            for (;;) {
                const i = index++;
                if (i >= all.length)
                    return;
                const d = all[i];
                const spec = await this.specs(String(d.id));
                const name = String(d.name || d.product_name || "Tuya eszköz");
                const productName = String(d.product_name || "");
                const category = String(d.category || "");
                const profile = inferProfile(name, productName, category);
                const fi = factory.get(String(d.id));
                devices[i] = {
                    id: String(d.id), name, online: Boolean(d.online),
                    category, productName, productId: d.product_id ? String(d.product_id) : undefined,
                    homeId: d.home_id !== undefined && d.home_id !== null ? String(d.home_id) : undefined,
                    mac: fi?.mac, uuid: fi?.uuid, serialNumber: fi?.sn, profile,
                    status: Array.isArray(d.status) ? d.status.map((x) => ({ code: String(x.code), value: x.value })) : [],
                    functions: mergeFunctions(profile, spec.functions), statusSpec: spec.status
                };
            }
        }));
        return devices.filter(Boolean);
    }
    async scenes(devices) {
        const homes = [...new Set(devices.map(d => d.homeId).filter((x) => Boolean(x)))];
        if (homes.length === 0 && this.uid) {
            try {
                const homeList = await this.request("GET", `/v1.0/users/${encodeURIComponent(this.uid)}/homes`);
                for (const h of Array.isArray(homeList) ? homeList : [])
                    if (h.home_id !== undefined && h.home_id !== null)
                        homes.push(String(h.home_id));
            }
            catch { /* scene package may not grant home list */ }
        }
        const scenes = [];
        for (const homeId of homes) {
            let list = [];
            try {
                list = await this.request("GET", `/v1.1/homes/${encodeURIComponent(homeId)}/scenes`);
            }
            catch {
                try {
                    list = await this.request("GET", `/v1.0/homes/${encodeURIComponent(homeId)}/scenes`);
                }
                catch {
                    list = [];
                }
            }
            for (const s of Array.isArray(list) ? list : []) {
                scenes.push({ id: String(s.scene_id || s.id), name: String(s.name || s.scene_name || "Jelenet"), homeId, enabled: s.enabled !== false });
            }
        }
        if (scenes.length === 0) {
            try {
                const result = await this.request("GET", "/v1.0/iot-01/voice/users/scenes");
                for (const s of result?.scenes || [])
                    scenes.push({ id: String(s.scene_id), name: String(s.scene_name || "Jelenet"), capabilities: Array.isArray(s.capabilities) ? s.capabilities : [] });
            }
            catch { /* optional fallback */ }
        }
        const seen = new Set();
        return scenes.filter(s => s.id && !seen.has(`${s.homeId || "voice"}:${s.id}`) && seen.add(`${s.homeId || "voice"}:${s.id}`));
    }
    async command(deviceId, code, value) {
        return await this.request("POST", `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { commands: [{ code, value }] });
    }
    async runScene(scene) {
        if (scene.homeId)
            return await this.request("POST", `/v1.0/homes/${encodeURIComponent(scene.homeId)}/scenes/${encodeURIComponent(scene.id)}/trigger`);
        const cap = scene.capabilities?.find(x => Array.isArray(x.commands) && x.commands.length) || scene.capabilities?.[0] || {};
        return await this.request("POST", `/v1.0/iot-01/voice/users/scenes/${encodeURIComponent(scene.id)}/commands`, {
            interface_name: cap.interface_name || "Tuya.SmartHome.PowerstateController", command: cap.commands?.[0] || "TurnOn"
        });
    }
}
export class TuyaService {
    client;
    cache;
    refreshing = null;
    constructor(endpoint, clientId, secret) {
        this.client = endpoint && clientId && secret ? new TuyaClient(endpoint, clientId, secret) : null;
        this.cache = { configured: Boolean(this.client), online: false, lastUpdatedAt: null, devices: [], scenes: [] };
    }
    state() { return this.cache; }
    async refresh() {
        if (!this.client)
            return;
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = (async () => {
            try {
                const devices = await this.client.devices();
                const scenes = await this.client.scenes(devices);
                this.cache = { configured: true, online: true, lastUpdatedAt: new Date().toISOString(), devices, scenes };
            }
            catch (err) {
                this.cache = { ...this.cache, configured: true, online: false, lastUpdatedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
            }
            finally {
                this.refreshing = null;
            }
        })();
        return this.refreshing;
    }
    async reportLogs(deviceId, codes, startTime, endTime) {
        if (!this.client)
            return [];
        return await this.client.reportLogs(deviceId, codes, startTime, endTime);
    }
    async command(deviceId, code, value) {
        if (!this.client)
            throw new Error("Tuya nincs konfigurálva");
        const r = await this.client.command(deviceId, code, value);
        await this.refresh();
        return r;
    }
    async scene(sceneId) {
        if (!this.client)
            throw new Error("Tuya nincs konfigurálva");
        const scene = this.cache.scenes.find(x => x.id === sceneId);
        if (!scene)
            throw new Error("Jelenet nem található");
        const r = await this.client.runScene(scene);
        await this.refresh();
        return r;
    }
}
