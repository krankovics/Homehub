import { enrichNetworkIdentities } from "./identity.js";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_TIMEOUT_MS = Math.max(5_000, Number(process.env.AI_TIMEOUT_MS || 45_000));
const automationSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "explanation", "trigger", "actions", "cooldownSeconds", "warnings"],
    properties: {
        name: { type: "string", minLength: 2, maxLength: 120 },
        explanation: { type: "string", minLength: 1, maxLength: 1200 },
        trigger: {
            type: "object",
            additionalProperties: false,
            required: ["type", "deviceId", "code", "operator", "valueType", "numberValue", "stringValue", "booleanValue", "forSeconds", "networkId", "after", "before", "time", "days", "timezone"],
            properties: {
                type: { enum: ["tuya.numeric", "tuya.state", "network.online_window", "network.new_device", "schedule"] },
                deviceId: { type: ["string", "null"] },
                code: { type: ["string", "null"] },
                operator: { enum: ["gt", "gte", "lt", "lte", "eq", "neq", "none"] },
                valueType: { enum: ["number", "string", "boolean", "none"] },
                numberValue: { type: ["number", "null"] },
                stringValue: { type: ["string", "null"] },
                booleanValue: { type: ["boolean", "null"] },
                forSeconds: { type: "integer", minimum: 0, maximum: 86400 },
                networkId: { type: ["string", "null"] },
                after: { type: ["string", "null"] },
                before: { type: ["string", "null"] },
                time: { type: ["string", "null"] },
                days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, maxItems: 7 },
                timezone: { type: "string" }
            }
        },
        actions: {
            type: "array", minItems: 1, maxItems: 6,
            items: {
                type: "object", additionalProperties: false,
                required: ["type", "deviceId", "code", "valueType", "numberValue", "stringValue", "booleanValue", "vacuumAction", "subject", "message", "email"],
                properties: {
                    type: { enum: ["tuya.command", "vacuum.command", "ai.summary", "alert"] },
                    deviceId: { type: ["string", "null"] },
                    code: { type: ["string", "null"] },
                    valueType: { enum: ["number", "string", "boolean", "none"] },
                    numberValue: { type: ["number", "null"] },
                    stringValue: { type: ["string", "null"] },
                    booleanValue: { type: ["boolean", "null"] },
                    vacuumAction: { enum: ["start", "pause", "stop", "dock", "none"] },
                    subject: { type: "string", maxLength: 180 },
                    message: { type: "string", maxLength: 4000 },
                    email: { type: "boolean" }
                }
            }
        },
        cooldownSeconds: { type: "integer", minimum: 0, maximum: 604800 },
        warnings: { type: "array", items: { type: "string" }, maxItems: 8 }
    }
};
const actionPlanSchema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "summary", "deviceId", "code", "valueType", "booleanValue", "numberValue", "stringValue", "vacuumAction", "reason", "risk"],
    properties: {
        kind: { enum: ["tuya.command", "vacuum.command", "none"] },
        summary: { type: "string", maxLength: 300 },
        deviceId: { type: "string" },
        code: { type: "string" },
        valueType: { enum: ["boolean", "number", "string", "none"] },
        booleanValue: { type: "boolean" },
        numberValue: { type: "number" },
        stringValue: { type: "string" },
        vacuumAction: { enum: ["start", "pause", "stop", "dock", "none"] },
        reason: { type: "string", maxLength: 800 },
        risk: { enum: ["low", "medium", "blocked"] }
    }
};
function outputText(payload) {
    if (typeof payload?.output_text === "string" && payload.output_text.trim())
        return payload.output_text.trim();
    const out = Array.isArray(payload?.output) ? payload.output : [];
    for (const item of out) {
        for (const c of Array.isArray(item?.content) ? item.content : []) {
            if (c?.type === "output_text" && typeof c.text === "string")
                return c.text.trim();
            if (typeof c?.text === "string")
                return c.text.trim();
        }
    }
    return "";
}
function usage(payload) {
    const u = payload?.usage || {};
    return {
        inputTokens: Number(u.input_tokens || 0) || undefined,
        outputTokens: Number(u.output_tokens || 0) || undefined,
        totalTokens: Number(u.total_tokens || 0) || undefined
    };
}
function valueFrom(valueType, numberValue, stringValue, booleanValue) {
    if (valueType === "number")
        return numberValue;
    if (valueType === "boolean")
        return booleanValue;
    if (valueType === "string")
        return stringValue;
    return null;
}
function isGateText(v) { return /kapu|gate|garage|garázs|door|lock|zár/i.test(v); }
function isBlockedInstruction(code) { return /erase|learn|factory|reset|pair|credential|password/i.test(code); }
function isEVCurrentInstruction(code) { return /devicemaxseta|current.*set|set.*current|set\d+a|set60a|set80a/i.test(code); }
export class AIService {
    store;
    tuya;
    lastCallAt = 0;
    constructor(store, tuya) {
        this.store = store;
        this.tuya = tuya;
    }
    status() {
        return {
            configured: Boolean(OPENAI_API_KEY),
            model: OPENAI_MODEL,
            mode: this.store.get().settings.aiMode,
            policy: "confirm-before-execute"
        };
    }
    ensureAvailable() {
        if (!OPENAI_API_KEY)
            throw new Error("openai_not_configured");
        if (this.store.get().settings.aiMode === "off")
            throw new Error("ai_disabled");
    }
    async responses(body) {
        this.ensureAvailable();
        const now = Date.now();
        if (now - this.lastCallAt < 700)
            await new Promise(r => setTimeout(r, 700 - (now - this.lastCallAt)));
        this.lastCallAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
        try {
            const res = await fetch(`${OPENAI_API_BASE}/responses`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: OPENAI_MODEL, ...body }),
                signal: controller.signal
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const message = data?.error?.message || data?.error?.code || `openai_http_${res.status}`;
                throw new Error(String(message));
            }
            return data;
        }
        finally {
            clearTimeout(timer);
        }
    }
    context(includeFunctions = false) {
        const state = this.store.get();
        const smart = this.tuya.state();
        const devices = smart.devices.slice(0, 60).map(d => ({
            id: d.id,
            name: d.name,
            productName: d.productName,
            profile: d.profile || null,
            online: d.online,
            status: d.status.slice(0, 60).map(s => ({ code: s.code, value: s.value })),
            functions: includeFunctions ? d.functions.slice(0, 60).map(f => ({ code: f.code, type: f.type, values: String(f.values || "").slice(0, 700) })) : undefined
        }));
        const network = enrichNetworkIdentities(state.snapshot?.network || [], smart.devices || [], state.deviceIdentityOverrides).slice(0, 120).map(n => ({
            id: n.id, name: n.name, kind: n.kind, online: n.online, ip: n.ip, configuredIp: n.configuredIp, ipChanged: n.ipChanged, mac: n.mac, identity: n.identity,
            managed: n.managed ? { adapter: n.managed.adapter, authOk: n.managed.authOk, hardware: n.managed.hardware, firmware: n.managed.firmware, error: n.managed.error, ports: (n.managed.ports || []).map(p => ({ port: p.port, label: p.label, linkUp: p.linkUp, speedMbps: p.speedMbps, duplex: p.duplex, health: p.health })) } : undefined
        }));
        const vacuum = state.snapshot?.vacuum ? {
            configured: state.snapshot.vacuum.configured,
            online: state.snapshot.vacuum.online,
            controlReady: state.snapshot.vacuum.controlReady,
            name: state.snapshot.vacuum.name,
            model: state.snapshot.vacuum.model,
            state: state.snapshot.vacuum.state,
            battery: state.snapshot.vacuum.battery,
            areaM2: state.snapshot.vacuum.areaM2,
            durationSec: state.snapshot.vacuum.durationSec
        } : null;
        const historyCutoff = Date.now() - 72 * 60 * 60 * 1000;
        const recentHistory = state.history.filter(e => new Date(e.createdAt).getTime() >= historyCutoff).slice(-700).map(e => ({
            category: e.category, type: e.type, entityId: e.entityId, entityName: e.entityName, message: e.message, createdAt: e.createdAt, data: e.data
        }));
        const people = state.people.map(p => ({ id: p.id, name: p.name, nickname: p.nickname, role: p.role, devices: p.devices }));
        const presence = Object.values(state.presenceRuntime).map(p => ({ personId: p.personId, name: p.name, status: p.status, confidence: p.confidence, since: p.since, lastSeenAt: p.lastSeenAt, source: p.source, networkId: p.networkId, note: p.note }));
        const signals = Object.values(state.externalSignals).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100).map(s => ({ key: s.key, label: s.label, category: s.category, value: s.value, source: s.source, personId: s.personId, updatedAt: s.updatedAt, expiresAt: s.expiresAt }));
        return {
            now: new Date().toISOString(),
            timezone: "Europe/Budapest",
            bridgeOnline: Boolean(state.bridgeLastSeenAt && Date.now() - new Date(state.bridgeLastSeenAt).getTime() < 90_000),
            devices,
            network,
            people,
            presence,
            signals,
            recentHistory,
            historyWindowHours: 72,
            networkEvents: state.networkEvents.slice(-30).map(e => ({ type: e.type, deviceName: e.deviceName, message: e.message, createdAt: e.createdAt })),
            vacuum,
            automations: state.automations.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, trigger: r.trigger, actions: r.actions, lastTriggeredAt: r.lastTriggeredAt })),
            alerts: state.alerts.slice(-30).map(a => ({ subject: a.subject, message: a.message, createdAt: a.createdAt, priority: a.priority, deliveries: (a.deliveries || []).map(d => ({ personName: d.personName, channel: d.channel, ok: d.ok, skipped: d.skipped, error: d.error })) }))
        };
    }
    async chat(message) {
        const context = this.context(false);
        const data = await this.responses({
            max_output_tokens: 1200,
            input: [
                { role: "system", content: [{ type: "input_text", text: "Te vagy a HomeHub AI Asszisztens. Magyarul, tömören és tényszerűen válaszolj. Kizárólag a kapott HomeHub állapotból és recentHistory eseményekből állíts tényt a házról. A people/presence mezőből válaszolj arra, ki van itthon; a signals mező friss geofence/BLE/ESP32 állapotokat is tartalmazhat. A recentHistory alapján válaszolj a ma, tegnap, éjjel, mikor, mennyi ideig jellegű kérdésekre; az eseményidőket Europe/Budapest szerint értelmezd. Ha a kért időszak kívül esik a historyWindowHours ablakon vagy nincs elég esemény, ezt egyértelműen mondd ki. Ne találj ki eszközállapotot. A kapu nyitása/zárása, telepítő DP-k, valamint EV töltő áramlimit módosítása magas kockázatú és AI-ból nem hajtható végre. A felhasználó kérésére javasolhatsz automatizálást, de az AI önállóan nem aktivál szabályt vagy eszközt. Időzóna: Europe/Budapest." }] },
                { role: "user", content: [{ type: "input_text", text: `HomeHub állapot:\n${JSON.stringify(context)}\n\nKérdés:\n${message}` }] }
            ]
        });
        return { text: outputText(data) || "Nem érkezett AI válasz.", usage: usage(data) };
    }
    async summary() {
        const context = this.context(false);
        const data = await this.responses({
            max_output_tokens: 1200,
            input: [
                { role: "system", content: [{ type: "input_text", text: "Készíts magyar nyelvű HomeHub állapotösszefoglalót. Legfeljebb 8 rövid pontban emeld ki: offline/figyelmet igénylő eszközök, kapu, klíma/szenzorok, EV, porszívó, hálózati újdonságok, automatizálások és riasztások. Ne találj ki semmit. Ha egy kategóriáról nincs adat, ne részletezd." }] },
                { role: "user", content: [{ type: "input_text", text: JSON.stringify(context) }] }
            ]
        });
        return { text: outputText(data) || "Nem érkezett összefoglaló.", usage: usage(data) };
    }
    async draftAutomation(request) {
        const context = this.context(true);
        const data = await this.responses({
            max_output_tokens: 1800,
            text: { format: { type: "json_schema", name: "homehub_automation_draft", strict: true, schema: automationSchema } },
            input: [
                { role: "system", content: [{ type: "input_text", text: "HomeHub automatizálási tervező vagy. A kontextusban szereplő pontos deviceId, networkId és Tuya DP code értékeket használd; soha ne találj ki azonosítót vagy DP kódot. A kapu/myGate eszközön semmilyen tuya.command akciót ne tervezz; a kapu csak trigger lehet. Ne használj learn/erase/reset/factory telepítő parancsot. EV töltő áramlimit vagy nagyáramú preset beállítást AI automatizálásból ne tervezz. Az alert üzenetek lehetnek magyarul. Napi/esti állapotösszefoglalóhoz használhatod az ai.summary akciót schedule triggerrel. Ha a kérés nem megvalósítható a rendelkezésre álló adatokból, a legközelebbi biztonságos draftot add, és a warnings mezőben írd le a hiányt. A szabály mentés előtt mindig felhasználói jóváhagyást kap." }] },
                { role: "user", content: [{ type: "input_text", text: `Elérhető HomeHub képességek:\n${JSON.stringify(context)}\n\nKérés:\n${request}` }] }
            ]
        });
        const text = outputText(data);
        if (!text)
            throw new Error("openai_empty_structured_output");
        const raw = JSON.parse(text);
        const warnings = [...(raw.warnings || [])];
        const trigger = this.convertTrigger(raw.trigger, warnings);
        const actions = raw.actions.map(a => this.convertAction(a, warnings)).filter(Boolean);
        if (!trigger)
            warnings.push("A trigger nem alakítható érvényes HomeHub feltétellé.");
        if (!actions.length)
            warnings.push("Nincs biztonságosan végrehajtható akció a draftban.");
        const draft = trigger && actions.length ? {
            name: raw.name.trim().slice(0, 120),
            enabled: true,
            trigger,
            actions,
            cooldownSeconds: Math.max(0, Math.min(604800, Math.round(raw.cooldownSeconds || 300))),
            notifyEmail: true
        } : null;
        this.validateDraft(draft, warnings);
        return { explanation: raw.explanation, draft: warnings.length ? (draft || null) : draft, valid: Boolean(draft) && !warnings.some(w => w.startsWith("HIBA:")), warnings, usage: usage(data) };
    }
    convertTrigger(t, warnings) {
        if (t.type === "tuya.numeric") {
            if (!t.deviceId || !t.code || !["gt", "gte", "lt", "lte", "eq"].includes(t.operator) || t.numberValue === null)
                return null;
            return { type: t.type, deviceId: t.deviceId, code: t.code, operator: t.operator, value: t.numberValue, forSeconds: t.forSeconds || 0 };
        }
        if (t.type === "tuya.state") {
            if (!t.deviceId || !t.code || !["eq", "neq"].includes(t.operator))
                return null;
            const value = valueFrom(t.valueType, t.numberValue, t.stringValue, t.booleanValue);
            if (value === null)
                return null;
            return { type: t.type, deviceId: t.deviceId, code: t.code, operator: t.operator, value: value, forSeconds: t.forSeconds || 0 };
        }
        if (t.type === "network.online_window") {
            if (!t.networkId || !t.after || !t.before)
                return null;
            return { type: t.type, networkId: t.networkId, after: t.after, before: t.before, forSeconds: t.forSeconds || 0, timezone: t.timezone || "Europe/Budapest" };
        }
        if (t.type === "network.new_device")
            return { type: t.type };
        if (!t.time || !Array.isArray(t.days) || !t.days.length)
            return null;
        return { type: "schedule", time: t.time, days: [...new Set(t.days)].filter(d => d >= 0 && d <= 6), timezone: t.timezone || "Europe/Budapest" };
    }
    convertAction(a, warnings) {
        if (a.type === "alert") {
            return { type: "alert", subject: (a.subject || "HomeHub értesítés").slice(0, 180), message: (a.message || "{{detail}}").slice(0, 4000), email: a.email };
        }
        if (a.type === "ai.summary") {
            return { type: "ai.summary", subject: (a.subject || "HomeHub AI összefoglaló").slice(0, 180), email: a.email };
        }
        if (a.type === "vacuum.command") {
            if (a.vacuumAction === "none")
                return null;
            return { type: "vacuum.command", action: a.vacuumAction };
        }
        if (!a.deviceId || !a.code)
            return null;
        const value = valueFrom(a.valueType, a.numberValue, a.stringValue, a.booleanValue);
        if (value === null)
            return null;
        const d = this.tuya.state().devices.find(x => x.id === a.deviceId);
        if (!d) {
            warnings.push(`HIBA: Tuya eszköz nem található: ${a.deviceId}`);
            return null;
        }
        if (d.profile === "mygate" || isGateText(`${d.name} ${d.productName}`)) {
            warnings.push("HIBA: Kapuvezérlési akciót az AI policy blokkol.");
            return null;
        }
        if (isBlockedInstruction(a.code)) {
            warnings.push(`HIBA: Telepítő/biztonsági DP blokkolva: ${a.code}`);
            return null;
        }
        if (d.profile === "feyree" && isEVCurrentInstruction(a.code)) {
            warnings.push(`HIBA: EV áramlimit DP blokkolva AI automatizálásból: ${a.code}`);
            return null;
        }
        return { type: "tuya.command", deviceId: a.deviceId, code: a.code, value };
    }
    validateDraft(draft, warnings) {
        if (!draft)
            return;
        const devices = this.tuya.state().devices;
        const trigger = draft.trigger;
        if (trigger.type === "tuya.numeric" || trigger.type === "tuya.state") {
            const d = devices.find(x => x.id === trigger.deviceId);
            if (!d)
                warnings.push(`HIBA: Trigger eszköz nem található: ${trigger.deviceId}`);
            else if (!d.status.some(s => s.code === trigger.code))
                warnings.push(`HIBA: Trigger DP nincs az aktuális státuszban: ${trigger.code}`);
        }
        if (trigger.type === "network.online_window") {
            if (!(this.store.get().snapshot?.network || []).some(n => n.id === trigger.networkId))
                warnings.push(`HIBA: Hálózati eszköz nem található: ${trigger.networkId}`);
        }
        for (const a of draft.actions) {
            if (a.type === "tuya.command") {
                const d = devices.find(x => x.id === a.deviceId);
                if (!d)
                    warnings.push(`HIBA: Akció eszköz nem található: ${a.deviceId}`);
                else if (!d.functions.some(f => f.code === a.code))
                    warnings.push(`HIBA: A DP nem vezérelhető az aktuális function listában: ${a.code}`);
            }
            if (a.type === "vacuum.command") {
                const v = this.store.get().snapshot?.vacuum;
                if (!v?.configured || !v.controlReady)
                    warnings.push("HIBA: A porszívó vezérlése még nincs készre konfigurálva.");
            }
        }
    }
    async draftAction(request) {
        const context = this.context(true);
        const data = await this.responses({
            max_output_tokens: 900,
            text: { format: { type: "json_schema", name: "homehub_action_plan", strict: true, schema: actionPlanSchema } },
            input: [
                { role: "system", content: [{ type: "input_text", text: "HomeHub egyetlen azonnali eszközműveletét tervezd. Csak a kontextusban lévő exact deviceId és function code használható. Ha a kérés nem eszközművelet vagy nem biztonságos, kind=none. Kapu/myGate nyitás, zárás, start, pedestrian vagy bármilyen kapuparancs mindig kind=none és risk=blocked. learn/erase/reset/factory parancs mindig blokkolt. EV töltő áramlimit/preset módosítás mindig blokkolt. Klíma, egyszerű kapcsoló, világítás, porszívó normál műveletei tervezhetők. Minden tényleges végrehajtás külön felhasználói megerősítést igényel." }] },
                { role: "user", content: [{ type: "input_text", text: `Elérhető képességek:\n${JSON.stringify(context)}\n\nKérés:\n${request}` }] }
            ]
        });
        const raw = JSON.parse(outputText(data) || "{}");
        const validation = this.validateActionPlan(raw);
        return { plan: validation.plan, valid: validation.valid, warning: validation.warning, usage: usage(data) };
    }
    validateActionPlan(plan) {
        if (!plan || plan.kind === "none")
            return { valid: false, plan, warning: plan?.reason || "Nincs végrehajtható művelet." };
        if (plan.kind === "vacuum.command") {
            const v = this.store.get().snapshot?.vacuum;
            if (!v?.configured || !v.online || !v.controlReady)
                return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "A porszívó nem áll készen a vezérlésre." };
            if (plan.vacuumAction === "none")
                return { valid: false, plan, warning: "Hiányzik a porszívó művelet." };
            return { valid: true, plan: { ...plan, risk: plan.vacuumAction === "start" ? "medium" : "low" } };
        }
        const d = this.tuya.state().devices.find(x => x.id === plan.deviceId);
        if (!d)
            return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "A kiválasztott Tuya eszköz nem található." };
        if (d.profile === "mygate" || isGateText(`${d.name} ${d.productName}`))
            return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "Kapuvezérlés AI-ból blokkolva van." };
        if (isBlockedInstruction(plan.code))
            return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "Telepítő vagy reset DP AI-ból blokkolva van." };
        if (d.profile === "feyree" && isEVCurrentInstruction(plan.code))
            return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "EV áramlimit módosítása AI-ból blokkolva van." };
        if (!d.functions.some(f => f.code === plan.code))
            return { valid: false, plan: { ...plan, risk: "blocked" }, warning: "A kiválasztott DP jelenleg nem vezérelhető." };
        return { valid: true, plan: { ...plan, risk: d.profile === "feyree" ? "medium" : plan.risk === "blocked" ? "medium" : plan.risk } };
    }
    actionValue(plan) {
        if (plan.valueType === "boolean")
            return plan.booleanValue;
        if (plan.valueType === "number")
            return plan.numberValue;
        if (plan.valueType === "string")
            return plan.stringValue;
        return null;
    }
}
