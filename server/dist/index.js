import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { Store } from "./store.js";
import { TuyaService } from "./tuya.js";
import { Mailer } from "./mailer.js";
import { AutomationEngine } from "./automations.js";
import { NotificationRouter } from "./notifier.js";
import { AIService } from "./ai.js";
import { networkEventsToHistory, pushHistory, recordHourlyNetworkSample, tuyaDeviceHistory, updatePresence } from "./history.js";
import { enrichNetworkIdentities, normalizeMac } from "./identity.js";
import { Life360Service, haversineMeters } from "./life360.js";
const VERSION = "0.24.9";
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 8787);
const APP_PASSWORD = process.env.APP_PASSWORD || (isProd ? "" : "homehub-dev");
const COOKIE_SECRET = process.env.COOKIE_SECRET || (isProd ? "" : "dev-cookie-secret-change-me");
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || (isProd ? "" : "dev-token");
const SIGNAL_TOKEN = process.env.SIGNAL_TOKEN || BRIDGE_TOKEN;
const DATA_FILE = process.env.DATA_FILE || "./data/state.json";
const WEB_DIST = path.resolve(process.env.WEB_DIST || "../web/dist");
const SESSION_COOKIE = "homehub_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const BRIDGE_STALE_MS = Number(process.env.BRIDGE_STALE_MS || 90_000);
const TUYA_ACCESS_ID = process.env.TUYA_ACCESS_ID || "";
const TUYA_ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET || "";
const TUYA_API_ENDPOINT = process.env.TUYA_API_ENDPOINT || "https://openapi.tuyaeu.com";
const TUYA_REFRESH_MS = Number(process.env.TUYA_REFRESH_MS || 15_000);
const TUYA_LOG_REFRESH_MS = Math.max(60_000, Number(process.env.TUYA_LOG_REFRESH_MS || 300_000));
const TUYA_LOG_LOOKBACK_MS = Math.max(60_000, Number(process.env.TUYA_LOG_LOOKBACK_MS || 15 * 60_000));
const LIFE360_REFRESH_MS = Math.max(60_000, Number(process.env.LIFE360_REFRESH_MS || 120_000));
const envNumber = (value) => value && value.trim() ? Number(value) : Number.NaN;
const LIFE360_HOME_LAT = envNumber(process.env.LIFE360_HOME_LATITUDE);
const LIFE360_HOME_LON = envNumber(process.env.LIFE360_HOME_LONGITUDE);
const LIFE360_HOME_RADIUS_M = Math.max(25, Number(process.env.LIFE360_HOME_RADIUS_M || 150));
const tuya = new TuyaService(TUYA_API_ENDPOINT, TUYA_ACCESS_ID, TUYA_ACCESS_SECRET);
const mailer = new Mailer();
if (!APP_PASSWORD || !COOKIE_SECRET || !BRIDGE_TOKEN) {
    throw new Error("APP_PASSWORD, COOKIE_SECRET and BRIDGE_TOKEN are required in production");
}
const app = express();
app.set("trust proxy", 1);
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const store = new Store(DATA_FILE);
const notifier = new NotificationRouter(store, mailer);
const ai = new AIService(store, tuya);
const life360 = new Life360Service(path.resolve(process.env.LIFE360_CONNECTOR || "server/connectors/life360_connector.py"));
const loginAttempts = new Map();
app.use(express.json({ limit: "24mb" }));
app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/" || req.path === "/index.html" || req.path === "/sw.js" || req.path === "/manifest.webmanifest") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
    }
    next();
});
app.use((req, res, next) => {
    if (!store.isBootstrapPending())
        return next();
    const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const protectedWrite = req.path.startsWith("/api/people") || req.path.startsWith("/api/automations") || req.path.startsWith("/api/settings") || req.path.startsWith("/api/network/identity");
    if (mutating && protectedWrite)
        return res.status(503).json({ error: "state_sync_pending", message: "A WD állapot visszaállítása folyamatban. A szerkesztés átmenetileg le van tiltva." });
    next();
});
function safeEqual(a, b) {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function cookieMap(req) {
    const raw = req.header("cookie") || "";
    const out = {};
    for (const part of raw.split(";")) {
        const i = part.indexOf("=");
        if (i < 0)
            continue;
        out[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}
const ALL_PERMISSIONS = ["overview", "people", "timeline", "downloads", "media", "smart", "actions", "ai", "network", "credentials", "printer", "settings"];
function normalizeLogin(v) { return v.trim().toLocaleLowerCase("hu-HU"); }
function passwordDigest(password, salt) { return crypto.scryptSync(password, salt, 32).toString("hex"); }
function makePasswordRecord(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    return { passwordSalt: salt, passwordHash: passwordDigest(password, salt) };
}
function verifyPersonPassword(person, password) {
    const auth = person.auth;
    if (!auth?.enabled || !auth.passwordSalt || !auth.passwordHash)
        return false;
    return safeEqual(passwordDigest(password, auth.passwordSalt), auth.passwordHash);
}
function sessionSignature(userId, exp) {
    return crypto.createHmac("sha256", COOKIE_SECRET).update(`homehub:${userId}:${exp}`).digest("hex");
}
function sessionUser(req) {
    const value = cookieMap(req)[SESSION_COOKIE];
    if (!value)
        return null;
    const [userId, exp, sig] = value.split(".");
    if (!userId || !exp || !sig || !/^\d+$/.test(exp))
        return null;
    if (Number(exp) < Math.floor(Date.now() / 1000))
        return null;
    if (!safeEqual(sig, sessionSignature(userId, exp)))
        return null;
    if (userId === "admin")
        return { id: "admin", name: "Admin", isAdmin: true, permissions: ALL_PERMISSIONS };
    const person = store.get().people.find(p => p.id === userId);
    if (!person?.auth?.enabled)
        return null;
    return { id: person.id, personId: person.id, name: person.nickname || person.name, isAdmin: false, permissions: person.auth.permissions || ["overview"] };
}
function validSession(req) { return Boolean(sessionUser(req)); }
function setSessionCookie(req, res, userId) {
    const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
    const value = `${userId}.${exp}.${sessionSignature(userId, exp)}`;
    const secure = req.secure || req.header("x-forwarded-proto") === "https" || isProd;
    const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${SESSION_TTL_SECONDS}`, "HttpOnly", "SameSite=Strict"];
    if (secure)
        parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(req, res) {
    const secure = req.secure || req.header("x-forwarded-proto") === "https" || isProd;
    const parts = [`${SESSION_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
    if (secure)
        parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}
function requiredPermission(req) {
    const path = req.path;
    if (req.method === "GET" && /^\/api\/people\/[^/]+\/avatar$/.test(path))
        return null;
    if (path.startsWith("/api/people"))
        return "people";
    if (path.startsWith("/api/history"))
        return "timeline";
    if (path.startsWith("/api/torrents") || path.startsWith("/api/copies"))
        return "downloads";
    if (path.startsWith("/api/media"))
        return "media";
    if (path.startsWith("/api/smart-home") || path.startsWith("/api/vacuum"))
        return "smart";
    if (path.startsWith("/api/automations") || path.startsWith("/api/alerts") || path.startsWith("/api/signals"))
        return "actions";
    if (path.startsWith("/api/ai"))
        return "ai";
    if (path.startsWith("/api/network"))
        return "network";
    if (path.startsWith("/api/settings"))
        return "settings";
    return null;
}
function userAuth(req, res, next) {
    const user = sessionUser(req);
    if (!user)
        return res.status(401).json({ error: "login_required" });
    const needed = requiredPermission(req);
    if (needed && !user.isAdmin && !user.permissions.includes(needed))
        return res.status(403).json({ error: "forbidden", permission: needed });
    res.locals.user = user;
    next();
}
function adminOnly(req, res, next) {
    const user = sessionUser(req);
    if (!user)
        return res.status(401).json({ error: "login_required" });
    if (!user.isAdmin)
        return res.status(403).json({ error: "admin_required" });
    res.locals.user = user;
    next();
}
function publicPerson(p, revealContact = false) {
    return {
        ...p,
        email: revealContact ? p.email : undefined,
        phone: revealContact ? p.phone : undefined,
        hasEmail: Boolean(p.email),
        hasPhone: Boolean(p.phone),
        avatarBase64: undefined,
        pushSubscriptions: undefined,
        pushSubscriptionCount: p.pushSubscriptions?.length || 0,
        auth: p.auth ? { enabled: p.auth.enabled, loginName: p.auth.loginName, permissions: p.auth.permissions, forcePasswordChange: Boolean(p.auth.forcePasswordChange), hasPassword: Boolean(p.auth.passwordHash) } : undefined,
        hasAvatar: Boolean(p.avatarBase64)
    };
}
function bridgeAuth(req, res, next) {
    const auth = req.header("authorization");
    if (!auth || !safeEqual(auth, `Bearer ${BRIDGE_TOKEN}`)) {
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
}
function signalAuth(req, res, next) {
    const auth = req.header("authorization");
    if (!SIGNAL_TOKEN || !auth || !safeEqual(auth, `Bearer ${SIGNAL_TOKEN}`))
        return res.status(401).json({ error: "unauthorized" });
    next();
}
function enqueue(bridgeId, type, payload) {
    const cmd = {
        id: crypto.randomUUID(),
        bridgeId,
        type,
        payload,
        createdAt: new Date().toISOString()
    };
    store.mutate((s) => {
        s.commands.push(cmd);
        if (s.commands.length > 200)
            s.commands = s.commands.slice(-200);
    });
    return cmd;
}
const automationEngine = new AutomationEngine(store, tuya, mailer, notifier, (action) => {
    const current = store.get();
    const bridgeId = current.snapshot?.bridgeId;
    const vacuum = current.snapshot?.vacuum;
    if (!bridgeId)
        throw new Error("bridge_offline");
    if (!vacuum?.configured || !vacuum.online || !vacuum.controlReady)
        throw new Error("vacuum_not_ready");
    enqueue(bridgeId, `vacuum.${action}`, {});
}, async () => (await ai.summary()).text);
function autoQueueCopies(snapshot) {
    const s = store.get();
    if (!s.settings.autoCopyEnabled)
        return;
    for (const t of snapshot.kd20.torrents) {
        if (t.percentDone < 1 || !t.hashString)
            continue;
        const existing = s.copies[t.hashString];
        if (existing && existing.state !== "error")
            continue;
        if (existing?.state === "error") {
            const last = new Date(existing.updatedAt).getTime();
            if (Number.isFinite(last) && Date.now() - last < 30_000)
                continue;
        }
        const cmd = enqueue(snapshot.bridgeId, "torrent.copyToWd", {
            torrentId: t.id,
            destination: s.settings.autoCopyDestination
        });
        store.mutate((state) => {
            const prev = state.copies[t.hashString];
            state.copies[t.hashString] = {
                torrentHash: t.hashString,
                torrentId: t.id,
                torrentName: t.name,
                destination: state.settings.autoCopyDestination,
                commandId: cmd.id,
                state: "queued",
                message: prev?.state === "error" ? "Automatikus újrapróbálás" : undefined,
                attempts: (prev?.attempts || 0) + 1,
                updatedAt: new Date().toISOString()
            };
        });
    }
}
function reconcileLocalCopies(snapshot) {
    const local = snapshot.localCopies || {};
    const torrents = snapshot.kd20.torrents;
    const current = store.get();
    const updates = [];
    for (const [hash, rec] of Object.entries(local)) {
        const torrent = torrents.find((x) => x.hashString === hash);
        if (!torrent || current.copies[hash]?.state === "done")
            continue;
        updates.push({ hash, rec, torrent });
    }
    if (!updates.length)
        return;
    store.mutate((s) => {
        for (const { hash, rec, torrent: t } of updates) {
            const existing = s.copies[hash];
            s.copies[hash] = {
                torrentHash: hash,
                torrentId: t.id,
                torrentName: rec.name || t.name,
                destination: rec.destination || s.settings.autoCopyDestination,
                commandId: existing?.commandId || `local-${hash.slice(0, 12)}`,
                state: "done",
                message: "A WD Bridge helyben már átmásolta",
                attempts: existing?.attempts || 1,
                percent: 1,
                etaSeconds: 0,
                updatedAt: rec.copiedAt || new Date().toISOString()
            };
        }
    });
}
function deriveNetworkEvents(previous = [], next = []) {
    const events = [];
    const prevById = new Map((previous || []).map(n => [n.id, n]));
    const now = new Date().toISOString();
    for (const n of next || []) {
        const p = prevById.get(n.id);
        if (!p)
            continue;
        if (p.online !== n.online) {
            events.push({ id: crypto.randomUUID(), type: n.online ? "online" : "offline", networkId: n.id, deviceName: n.name, message: n.online ? `${n.name} újra elérhető${n.ip ? ` · ${n.ip}` : ""}` : `${n.name} nem elérhető`, createdAt: now });
        }
        if (p.ip && n.ip && p.ip !== n.ip) {
            events.push({ id: crypto.randomUUID(), type: "ip_changed", networkId: n.id, deviceName: n.name, message: `${n.name} IP-címe megváltozott: ${p.ip} → ${n.ip}`, createdAt: now, fromValue: p.ip, toValue: n.ip });
        }
        const prevPorts = new Map((p.managed?.ports || []).map(x => [x.port, x]));
        for (const port of n.managed?.ports || []) {
            const old = prevPorts.get(port.port);
            if (!old || old.speedMbps === port.speedMbps || (!old.linkUp && !port.linkUp))
                continue;
            const label = port.label ? ` (${port.label})` : "";
            events.push({ id: crypto.randomUUID(), type: "link_speed", networkId: n.id, deviceName: n.name, port: port.port, message: `${n.name} Port ${port.port}${label}: ${old.linkUp ? `${old.speedMbps} Mbps` : "Link Down"} → ${port.linkUp ? `${port.speedMbps} Mbps` : "Link Down"}`, createdAt: now, fromValue: old.linkUp ? String(old.speedMbps) : "down", toValue: port.linkUp ? String(port.speedMbps) : "down" });
        }
    }
    return events;
}
function publicState(user) {
    const s = store.get();
    const lastSeen = s.bridgeLastSeenAt ? new Date(s.bridgeLastSeenAt).getTime() : 0;
    const enrichedNetwork = enrichNetworkIdentities(s.snapshot?.network || [], tuya.state().devices || [], s.deviceIdentityOverrides);
    const snapshot = s.snapshot ? {
        ...s.snapshot,
        network: enrichedNetwork,
        media: s.snapshot.media ? { ...s.snapshot.media, items: [] } : undefined
    } : null;
    return {
        snapshot,
        bridgeLastSeenAt: s.bridgeLastSeenAt,
        bridgeOnline: lastSeen > 0 && Date.now() - lastSeen <= BRIDGE_STALE_MS,
        settings: s.settings,
        copies: s.copies,
        networkEvents: s.networkEvents.slice(-50).reverse(),
        people: s.people.map(p => publicPerson(p, Boolean(user?.isAdmin))),
        presence: Object.values(s.presenceRuntime),
        signals: Object.values(s.externalSignals).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100),
        timeline: s.history.slice(-150).reverse(),
        recentCommands: s.commands.slice(-10).reverse().map((c) => ({
            id: c.id,
            type: c.type,
            createdAt: c.createdAt,
            completedAt: c.completedAt,
            ok: c.ok,
            message: c.message
        })),
        smartHome: tuya.state(),
        automation: {
            rules: s.automations,
            alerts: s.alerts.slice(-50).reverse(),
            unread: s.alerts.filter(a => !a.readAt).length,
            email: automationEngine.emailStatus(),
            notification: automationEngine.notificationStatus()
        },
        ai: ai.status(),
        persistence: { bootstrapPending: store.isBootstrapPending() },
        life360: { ...life360.getStatus(), mapping: s.life360MemberMap }
    };
}
app.get("/api/health", (_req, res) => res.json({ ok: true, version: VERSION }));
app.get("/api/auth/status", (req, res) => {
    const user = sessionUser(req);
    res.json({ authenticated: Boolean(user), user });
});
app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (record && record.resetAt > now && record.count >= 8)
        return res.status(429).json({ error: "too_many_attempts" });
    const parsed = z.object({ login: z.string().trim().max(120).optional().default(""), password: z.string().min(1).max(512) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(401).json({ error: "invalid_credentials" });
    const login = normalizeLogin(parsed.data.login);
    let userId = "";
    if ((!login || login === "admin") && safeEqual(parsed.data.password, APP_PASSWORD))
        userId = "admin";
    if (!userId && login) {
        const person = store.get().people.find(p => p.auth?.enabled && normalizeLogin(p.auth.loginName || "") === login);
        if (person && verifyPersonPassword(person, parsed.data.password))
            userId = person.id;
    }
    if (!userId) {
        const next = !record || record.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...record, count: record.count + 1 };
        loginAttempts.set(ip, next);
        return res.status(401).json({ error: "invalid_credentials" });
    }
    loginAttempts.delete(ip);
    setSessionCookie(req, res, userId);
    if (userId === "admin")
        return res.json({ ok: true, user: { id: "admin", name: "Admin", isAdmin: true, permissions: ALL_PERMISSIONS } });
    const person = store.get().people.find(p => p.id === userId);
    res.json({ ok: true, user: { id: person.id, personId: person.id, name: person.nickname || person.name, isAdmin: false, permissions: person.auth?.permissions || ["overview"] } });
});
app.post("/api/auth/logout", userAuth, (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
});
const pushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(3000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(20).max(1000), auth: z.string().min(8).max(500) })
});
app.get("/api/notifications/status", userAuth, (_req, res) => {
    const user = res.locals.user;
    const person = user.personId ? store.get().people.find(p => p.id === user.personId) : undefined;
    res.json({ ...notifier.status(), vapidPublicKey: notifier.publicVapidKey(), currentPersonPushSubscriptions: person?.pushSubscriptions?.length || 0 });
});
app.get("/api/notifications/push/public-key", userAuth, (_req, res) => {
    const key = notifier.publicVapidKey();
    if (!key)
        return res.status(503).json({ error: "push_not_configured" });
    res.json({ publicKey: key });
});
app.post("/api/notifications/push/subscribe", userAuth, (req, res) => {
    const user = res.locals.user;
    if (!user.personId)
        return res.status(400).json({ error: "person_account_required_for_push" });
    const parsed = pushSubscriptionSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const now = new Date().toISOString();
    store.mutate(s => {
        const p = s.people.find(x => x.id === user.personId);
        if (!p)
            return;
        const current = p.pushSubscriptions || [];
        const existing = current.find(x => x.endpoint === parsed.data.endpoint);
        if (existing) {
            existing.keys = parsed.data.keys;
            existing.expirationTime = parsed.data.expirationTime ?? null;
            existing.updatedAt = now;
            existing.userAgent = req.header("user-agent") || existing.userAgent;
        }
        else
            current.push({ id: crypto.randomUUID(), endpoint: parsed.data.endpoint, expirationTime: parsed.data.expirationTime ?? null, keys: parsed.data.keys, userAgent: req.header("user-agent") || "", createdAt: now, updatedAt: now });
        p.pushSubscriptions = current.slice(-10);
        p.updatedAt = now;
    });
    res.json({ ok: true });
});
app.delete("/api/notifications/push/subscribe", userAuth, (req, res) => {
    const user = res.locals.user;
    if (!user.personId)
        return res.status(400).json({ error: "person_account_required_for_push" });
    const endpoint = String(req.body?.endpoint || "");
    store.mutate(s => { const p = s.people.find(x => x.id === user.personId); if (p) {
        p.pushSubscriptions = (p.pushSubscriptions || []).filter(x => x.endpoint !== endpoint);
        p.updatedAt = new Date().toISOString();
    } });
    res.json({ ok: true });
});
app.post("/api/notifications/push/test", userAuth, async (_req, res) => {
    const user = res.locals.user;
    if (!user.personId)
        return res.status(400).json({ error: "person_account_required_for_push" });
    try {
        const deliveries = await notifier.deliver({ enabled: true, priority: "normal", recipientPersonIds: [user.personId], channels: ["push"], fallbackToAdmin: false }, "HomeHub teszt push", "Ha ezt az értesítést látod, az iPhone Web Push működik.");
        const ok = deliveries.some(d => d.channel === "push" && d.ok);
        if (!ok)
            return res.status(502).json({ ok: false, error: "push_send_failed", deliveries });
        res.json({ ok: true, deliveries });
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.get("/api/state", userAuth, (_req, res) => res.json(publicState(res.locals.user)));
app.get("/api/media", userAuth, (_req, res) => {
    const media = store.get().snapshot?.media;
    if (!media)
        return res.status(503).json({ error: "media_not_available" });
    res.json(media);
});
const personInputSchema = z.object({
    name: z.string().trim().min(1).max(80),
    nickname: z.string().trim().max(80).optional().default(""),
    role: z.string().trim().max(80).optional().default("Családtag"),
    email: z.union([z.literal(""), z.string().email().max(180)]).optional().default(""),
    phone: z.string().trim().max(40).optional().default("").transform(v => v.replace(/[\s().-]/g, "")).refine(v => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "A telefonszám nemzetközi formátumú legyen, például +36 30 123 4567."),
    notificationPrefs: z.object({
        pushEnabled: z.boolean().default(true),
        emailEnabled: z.boolean().default(true),
        smsEnabled: z.boolean().default(false)
    }).optional().default({ pushEnabled: true, emailEnabled: true, smsEnabled: false }),
    devices: z.array(z.object({
        networkId: z.string().min(1).max(160),
        role: z.enum(["primary", "secondary", "stationary"]),
        label: z.string().trim().max(120).optional().default("")
    })).max(20).default([])
});
app.get("/api/people", userAuth, (_req, res) => {
    const s = store.get();
    const user = res.locals.user;
    res.json({ people: s.people.map(p => publicPerson(p, user.isAdmin)), presence: Object.values(s.presenceRuntime) });
});
app.post("/api/people", adminOnly, (req, res) => {
    const parsed = personInputSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const now = new Date().toISOString();
    const person = { id: crypto.randomUUID(), ...parsed.data, createdAt: now, updatedAt: now };
    store.mutate(s => {
        s.people.push(person);
        updatePresence(s, s.snapshot?.network || []);
        pushHistory(s, { category: "system", type: "people.created", entityId: person.id, entityName: person.name, message: `${person.name} profilja létrejött.`, createdAt: now });
    });
    res.status(201).json(publicPerson(person, true));
});
app.put("/api/people/:id", adminOnly, (req, res) => {
    const parsed = personInputSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const id = paramString(req.params.id);
    let updated;
    store.mutate(s => {
        const p = s.people.find(x => x.id === id);
        if (!p)
            return;
        Object.assign(p, parsed.data, { updatedAt: new Date().toISOString() });
        updated = structuredClone(p);
        updatePresence(s, s.snapshot?.network || []);
    });
    if (!updated)
        return res.status(404).json({ error: "person_not_found" });
    res.json(publicPerson(updated, true));
});
const personAccessSchema = z.object({
    enabled: z.boolean().default(false),
    loginName: z.string().trim().max(80),
    password: z.union([z.literal(""), z.string().min(8).max(256)]).optional().default(""),
    permissions: z.array(z.enum(["overview", "people", "timeline", "downloads", "media", "smart", "actions", "ai", "network", "credentials", "printer", "settings"])).max(12).default(["overview"])
});
app.put("/api/people/:id/access", adminOnly, (req, res) => {
    const parsed = personAccessSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const id = paramString(req.params.id);
    const loginName = parsed.data.loginName.trim();
    if (parsed.data.enabled && loginName.length < 2)
        return res.status(400).json({ error: "login_name_required" });
    if (normalizeLogin(loginName) === "admin")
        return res.status(400).json({ error: "reserved_login_name" });
    const duplicate = store.get().people.some(p => p.id !== id && p.auth?.enabled && normalizeLogin(p.auth.loginName || "") === normalizeLogin(loginName));
    if (duplicate)
        return res.status(409).json({ error: "login_name_in_use" });
    let updated;
    let missingPassword = false;
    store.mutate(s => {
        const p = s.people.find(x => x.id === id);
        if (!p)
            return;
        const old = p.auth;
        if (parsed.data.enabled && !parsed.data.password && !old?.passwordHash) {
            missingPassword = true;
            return;
        }
        const passwordRecord = parsed.data.password ? makePasswordRecord(parsed.data.password) : { passwordSalt: old?.passwordSalt, passwordHash: old?.passwordHash };
        p.auth = { enabled: parsed.data.enabled, loginName, permissions: parsed.data.permissions.length ? parsed.data.permissions : ["overview"], ...passwordRecord };
        p.updatedAt = new Date().toISOString();
        updated = structuredClone(p);
        pushHistory(s, { category: "system", type: "people.access.updated", entityId: p.id, entityName: p.name, message: `${p.name}: webes hozzáférés ${p.auth.enabled ? "bekapcsolva" : "kikapcsolva"}.`, createdAt: p.updatedAt, data: { loginName: p.auth.loginName, permissions: p.auth.permissions } });
    });
    if (missingPassword)
        return res.status(400).json({ error: "password_required_for_first_enable" });
    if (!updated)
        return res.status(404).json({ error: "person_not_found" });
    res.json(publicPerson(updated, true));
});
app.delete("/api/people/:id", adminOnly, (req, res) => {
    const id = paramString(req.params.id);
    let removed;
    store.mutate(s => {
        const idx = s.people.findIndex(x => x.id === id);
        if (idx < 0)
            return;
        removed = s.people[idx];
        s.people.splice(idx, 1);
        delete s.presenceRuntime[id];
        pushHistory(s, { category: "system", type: "people.deleted", entityId: id, entityName: removed?.name, message: `${removed?.name || "Profil"} törölve.`, createdAt: new Date().toISOString() });
    });
    if (!removed)
        return res.status(404).json({ error: "person_not_found" });
    res.json({ ok: true });
});
app.post("/api/people/:id/avatar", adminOnly, upload.single("avatar"), (req, res) => {
    const id = paramString(req.params.id);
    if (!req.file)
        return res.status(400).json({ error: "avatar_missing" });
    if (![/^image\/jpeg$/, /^image\/png$/, /^image\/webp$/].some(r => r.test(req.file.mimetype)))
        return res.status(400).json({ error: "avatar_type_not_supported" });
    if (req.file.size > 700 * 1024)
        return res.status(413).json({ error: "avatar_too_large" });
    let found = false;
    store.mutate(s => {
        const p = s.people.find(x => x.id === id);
        if (!p)
            return;
        found = true;
        p.avatarMime = req.file.mimetype;
        p.avatarBase64 = req.file.buffer.toString("base64");
        p.updatedAt = new Date().toISOString();
    });
    if (!found)
        return res.status(404).json({ error: "person_not_found" });
    res.json({ ok: true, avatarUrl: `/api/people/${encodeURIComponent(id)}/avatar` });
});
app.get("/api/people/:id/avatar", userAuth, (req, res) => {
    const p = store.get().people.find(x => x.id === paramString(req.params.id));
    if (!p?.avatarBase64 || !p.avatarMime)
        return res.status(404).end();
    res.setHeader("Content-Type", p.avatarMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(p.avatarBase64, "base64"));
});
app.get("/api/history", userAuth, (req, res) => {
    const category = String(req.query.category || "");
    const from = req.query.from ? new Date(String(req.query.from)).getTime() : 0;
    const to = req.query.to ? new Date(String(req.query.to)).getTime() : Number.POSITIVE_INFINITY;
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500) || 500));
    const events = store.get().history.filter(e => (!category || e.category === category) && new Date(e.createdAt).getTime() >= from && new Date(e.createdAt).getTime() <= to).slice(-limit).reverse();
    res.json({ events });
});
const networkIdentityInput = z.object({
    name: z.string().trim().min(1).max(120),
    kind: z.string().trim().max(80).optional().default(""),
    owner: z.string().trim().max(80).optional().default(""),
    note: z.string().trim().max(500).optional().default("")
});
app.put("/api/network/identity/:mac", userAuth, (req, res) => {
    const parsed = networkIdentityInput.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const mac = normalizeMac(paramString(req.params.mac));
    if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac))
        return res.status(400).json({ error: "invalid_mac" });
    const now = new Date().toISOString();
    let saved;
    store.mutate(s => {
        const old = s.deviceIdentityOverrides[mac];
        saved = { mac, name: parsed.data.name, kind: parsed.data.kind || undefined, owner: parsed.data.owner || undefined, note: parsed.data.note || undefined, createdAt: old?.createdAt || now, updatedAt: now };
        s.deviceIdentityOverrides[mac] = saved;
        pushHistory(s, { category: "network", type: "network.identity", entityId: `mac:${mac}`, entityName: saved.name, message: `${saved.name}: hálózati eszköz azonosítva (${mac}).`, createdAt: now, data: { mac, kind: saved.kind, owner: saved.owner } });
    });
    res.json(saved);
});
app.delete("/api/network/identity/:mac", userAuth, (req, res) => {
    const mac = normalizeMac(paramString(req.params.mac));
    store.mutate(s => { delete s.deviceIdentityOverrides[mac]; });
    res.json({ ok: true });
});
app.post("/api/vacuum/command", userAuth, (req, res) => {
    const current = store.get();
    const bridgeId = current.snapshot?.bridgeId;
    const vacuum = current.snapshot?.vacuum;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    if (!vacuum?.configured)
        return res.status(409).json({ error: "vacuum_not_configured" });
    if (!vacuum.online)
        return res.status(409).json({ error: "vacuum_offline" });
    if (!vacuum.controlReady)
        return res.status(409).json({ error: "vacuum_control_not_ready" });
    const parsed = z.object({ action: z.enum(["start", "pause", "stop", "dock"]) }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_vacuum_action" });
    const cmd = enqueue(bridgeId, `vacuum.${parsed.data.action}`, {});
    res.status(202).json(cmd);
});
const signalInputSchema = z.object({
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
    label: z.string().trim().max(120).optional(),
    category: z.enum(["geofence", "ble", "generic"]).optional().default("generic"),
    source: z.string().trim().max(120).optional(),
    personId: z.string().trim().max(160).optional(),
    ttlSeconds: z.number().int().min(0).max(604800).optional().default(0)
});
function saveExternalSignal(keyRaw, input, sessionUser) {
    const key = keyRaw.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
    if (!key)
        throw new Error("invalid_signal_key");
    const now = new Date(), personId = sessionUser?.personId || input.personId || undefined;
    const record = { key, label: input.label || key, category: input.category, value: input.value, source: input.source || (sessionUser ? `user:${sessionUser.id}` : "integration"), personId, updatedAt: now.toISOString(), expiresAt: input.ttlSeconds ? new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() : undefined };
    store.mutate(s => {
        s.externalSignals[key] = record;
        const person = personId ? s.people.find(p => p.id === personId) : undefined;
        pushHistory(s, { category: input.category === "geofence" || input.category === "ble" ? "presence" : "system", type: `signal.${input.category}`, entityId: key, entityName: record.label, message: `${record.label}: ${String(record.value)}${person ? ` · ${person.name}` : ""}`, createdAt: record.updatedAt, data: { key, value: record.value, category: record.category, source: record.source, personId } });
    });
    automationEngine.tick().catch(() => { });
    return record;
}
app.get("/api/signals", userAuth, (_req, res) => res.json(Object.values(store.get().externalSignals).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
app.post("/api/signals/:key", userAuth, (req, res) => {
    const parsed = signalInputSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json(saveExternalSignal(paramString(req.params.key), parsed.data, res.locals.user));
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/integrations/signals/:key", signalAuth, (req, res) => {
    const parsed = signalInputSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json(saveExternalSignal(paramString(req.params.key), parsed.data));
    }
    catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
const automationTriggerSchema = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ type: z.literal("tuya.numeric"), deviceId: z.string().min(1), code: z.string().min(1), operator: z.enum(["gt", "gte", "lt", "lte", "eq"]), value: z.number(), forSeconds: z.number().int().min(0).max(86400).optional().default(0) }),
    z.object({ type: z.literal("tuya.state"), deviceId: z.string().min(1), code: z.string().min(1), operator: z.enum(["eq", "neq"]), value: z.union([z.string(), z.number(), z.boolean()]), forSeconds: z.number().int().min(0).max(86400).optional().default(0) }),
    z.object({ type: z.literal("network.online_window"), networkId: z.string().min(1), after: z.string().regex(/^\d{2}:\d{2}$/), before: z.string().regex(/^\d{2}:\d{2}$/), forSeconds: z.number().int().min(0).max(86400).optional().default(0), timezone: z.string().optional().default("Europe/Budapest") }),
    z.object({ type: z.literal("network.online"), networkId: z.string().min(1), forSeconds: z.number().int().min(0).max(86400).optional().default(0) }),
    z.object({ type: z.literal("network.offline"), networkId: z.string().min(1), forSeconds: z.number().int().min(0).max(86400).optional().default(300) }),
    z.object({ type: z.literal("network.link_below"), networkId: z.string().min(1), port: z.number().int().min(1).max(64), mbps: z.number().int().min(1).max(100000), forSeconds: z.number().int().min(0).max(86400).optional().default(120) }),
    z.object({ type: z.literal("network.new_device") }),
    z.object({ type: z.literal("presence.person_state"), personId: z.string().min(1), state: z.enum(["home", "away", "uncertain"]), forSeconds: z.number().int().min(0).max(86400).optional().default(0) }),
    z.object({ type: z.literal("presence.device_mismatch"), personId: z.string().min(1), forSeconds: z.number().int().min(0).max(86400).optional().default(300) }),
    z.object({ type: z.literal("signal.state"), key: z.string().trim().min(1).max(160), operator: z.enum(["eq", "neq"]), value: z.union([z.string(), z.number(), z.boolean()]), forSeconds: z.number().int().min(0).max(86400).optional().default(0), maxAgeSeconds: z.number().int().min(0).max(604800).optional().default(0) }),
    z.object({ type: z.literal("signal.numeric"), key: z.string().trim().min(1).max(160), operator: z.enum(["gt", "gte", "lt", "lte", "eq"]), value: z.number(), forSeconds: z.number().int().min(0).max(86400).optional().default(0), maxAgeSeconds: z.number().int().min(0).max(604800).optional().default(0) }),
    z.object({ type: z.literal("all"), conditions: z.array(automationTriggerSchema).min(2).max(6), forSeconds: z.number().int().min(0).max(86400).optional().default(0) }),
    z.object({ type: z.literal("schedule"), time: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), timezone: z.string().optional().default("Europe/Budapest") })
]));
const automationActionSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("tuya.command"),
        deviceId: z.string().min(1),
        code: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()])
    }),
    z.object({ type: z.literal("vacuum.command"), action: z.enum(["start", "pause", "stop", "dock"]) }),
    z.object({ type: z.literal("ai.summary"), subject: z.string().min(1).max(180), email: z.boolean().optional().default(true) }),
    z.object({ type: z.literal("alert"), subject: z.string().min(1).max(180), message: z.string().min(1).max(4000), email: z.boolean().optional().default(true) })
]);
const notificationChannelSchema = z.enum(["push", "email", "sms"]);
const automationNotificationSchema = z.object({
    enabled: z.boolean().default(true),
    priority: z.enum(["info", "normal", "warning", "critical"]).default("warning"),
    recipientPersonIds: z.array(z.string().min(1)).max(20).default([]),
    channels: z.array(notificationChannelSchema).max(3).default(["push"]),
    fallbackToAdmin: z.boolean().optional().default(false),
    escalations: z.array(z.object({ afterSeconds: z.number().int().min(60).max(86400), channels: z.array(notificationChannelSchema).min(1).max(3) })).max(4).optional().default([])
}).optional();
const automationRuleInputSchema = z.object({
    name: z.string().trim().min(2).max(120), enabled: z.boolean().default(true), trigger: automationTriggerSchema,
    actions: z.array(automationActionSchema).min(1).max(6), cooldownSeconds: z.number().int().min(0).max(604800).default(300),
    notifyEmail: z.boolean().optional().default(true),
    notification: automationNotificationSchema,
    safety: z.object({ allowGateAction: z.boolean().optional().default(false) }).optional()
});
function automationGateSafety(rule) {
    for (const action of rule.actions) {
        if (action.type !== "tuya.command")
            continue;
        const d = tuya.state().devices.find(x => x.id === action.deviceId);
        if (d && (d.profile === "mygate" || /kapu|gate|garage|garázs|door|lock|zár/i.test(`${d.name} ${d.productName}`)) && !rule.safety?.allowGateAction)
            return false;
    }
    return true;
}
app.get("/api/automations", userAuth, (_req, res) => res.json(publicState(res.locals.user).automation));
app.post("/api/automations", userAuth, (req, res) => {
    const parsed = automationRuleInputSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    if (!automationGateSafety(data))
        return res.status(400).json({ error: "gate_actions_are_blocked_in_automations" });
    const now = new Date().toISOString();
    const rule = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
    store.mutate(s => { s.automations.push(rule); });
    automationEngine.tick().catch(() => { });
    res.status(201).json(rule);
});
app.put("/api/automations/:id", userAuth, (req, res) => {
    const id = paramString(req.params.id);
    const parsed = automationRuleInputSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    if (!automationGateSafety(data))
        return res.status(400).json({ error: "gate_actions_are_blocked_in_automations" });
    let updated = null;
    store.mutate(s => {
        const existing = s.automations.find(x => x.id === id);
        if (!existing)
            return;
        updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
        s.automations = s.automations.map(x => x.id === id ? updated : x);
        s.automationRuntime[id] = {};
    });
    if (!updated)
        return res.status(404).json({ error: "automation_not_found" });
    res.json(updated);
});
app.delete("/api/automations/:id", userAuth, (req, res) => {
    const id = paramString(req.params.id);
    let found = false;
    store.mutate(s => { found = s.automations.some(x => x.id === id); s.automations = s.automations.filter(x => x.id !== id); delete s.automationRuntime[id]; });
    if (!found)
        return res.status(404).json({ error: "automation_not_found" });
    res.json({ ok: true });
});
app.post("/api/automations/:id/run", userAuth, async (req, res) => {
    const rule = store.get().automations.find(x => x.id === paramString(req.params.id));
    if (!rule)
        return res.status(404).json({ error: "automation_not_found" });
    try {
        await automationEngine.runNow(rule);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/alerts/:id/read", userAuth, (req, res) => {
    const id = paramString(req.params.id);
    let found = false;
    store.mutate(s => { const a = s.alerts.find(x => x.id === id); if (a) {
        found = true;
        a.readAt = a.readAt || new Date().toISOString();
    } });
    if (!found)
        return res.status(404).json({ error: "alert_not_found" });
    res.json({ ok: true });
});
app.post("/api/alerts/read-all", userAuth, (_req, res) => {
    const now = new Date().toISOString();
    store.mutate(s => { for (const a of s.alerts)
        if (!a.readAt)
            a.readAt = now; });
    res.json({ ok: true });
});
function paramString(value) {
    if (Array.isArray(value))
        return value[0] ?? "";
    return value ?? "";
}
const aiActionPlanInputSchema = z.object({
    kind: z.enum(["tuya.command", "vacuum.command", "none"]),
    summary: z.string().max(300), deviceId: z.string(), code: z.string(),
    valueType: z.enum(["boolean", "number", "string", "none"]),
    booleanValue: z.boolean(), numberValue: z.number(), stringValue: z.string(),
    vacuumAction: z.enum(["start", "pause", "stop", "dock", "none"]),
    reason: z.string().max(800), risk: z.enum(["low", "medium", "blocked"])
});
app.get("/api/ai/status", userAuth, (_req, res) => res.json(ai.status()));
app.post("/api/ai/chat", userAuth, async (req, res) => {
    const parsed = z.object({ message: z.string().trim().min(1).max(4000) }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_ai_message" });
    try {
        res.json(await ai.chat(parsed.data.message));
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/ai/summary", userAuth, async (_req, res) => {
    try {
        res.json(await ai.summary());
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/ai/automation-draft", userAuth, async (req, res) => {
    const parsed = z.object({ request: z.string().trim().min(3).max(4000) }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_ai_automation_request" });
    try {
        const result = await ai.draftAutomation(parsed.data.request);
        if (result.draft) {
            const validated = automationRuleInputSchema.safeParse(result.draft);
            if (!validated.success) {
                result.valid = false;
                result.warnings.push("HIBA: A generált szabály nem felel meg a HomeHub szabálysémának.");
            }
            else if (!automationGateSafety(validated.data)) {
                result.valid = false;
                result.warnings.push("HIBA: A HomeHub kapubiztonsági policy blokkolta a szabályt.");
            }
        }
        res.json(result);
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/ai/action-draft", userAuth, async (req, res) => {
    const parsed = z.object({ request: z.string().trim().min(2).max(2000) }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_ai_action_request" });
    try {
        res.json(await ai.draftAction(parsed.data.request));
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/ai/action-execute", userAuth, async (req, res) => {
    if (store.get().settings.aiMode !== "approved")
        return res.status(409).json({ error: "ai_approved_execution_disabled" });
    const parsed = z.object({ confirm: z.literal(true), plan: aiActionPlanInputSchema }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_ai_action_plan" });
    const checked = ai.validateActionPlan(parsed.data.plan);
    if (!checked.valid || checked.plan.risk === "blocked")
        return res.status(409).json({ error: checked.warning || "ai_action_blocked" });
    try {
        if (checked.plan.kind === "vacuum.command") {
            const bridgeId = store.get().snapshot?.bridgeId;
            const vacuum = store.get().snapshot?.vacuum;
            if (!bridgeId)
                return res.status(409).json({ error: "bridge_offline" });
            if (!vacuum?.configured || !vacuum.online || !vacuum.controlReady)
                return res.status(409).json({ error: "vacuum_not_ready" });
            const action = checked.plan.vacuumAction;
            if (action === "none")
                return res.status(400).json({ error: "invalid_vacuum_action" });
            const cmd = enqueue(bridgeId, `vacuum.${action}`, {});
            return res.status(202).json({ ok: true, command: cmd, summary: checked.plan.summary });
        }
        if (checked.plan.kind === "tuya.command") {
            const device = tuya.state().devices.find(x => x.id === checked.plan.deviceId);
            if (!device)
                return res.status(404).json({ error: "tuya_device_not_found" });
            const value = ai.actionValue(checked.plan);
            const invalid = validateTuyaCommand(device, checked.plan.code, value);
            if (invalid)
                return res.status(400).json({ error: invalid });
            await tuya.command(device.id, checked.plan.code, value);
            return res.json({ ok: true, summary: checked.plan.summary });
        }
        return res.status(409).json({ error: "ai_action_not_executable" });
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/smart-home/refresh", userAuth, async (_req, res) => {
    await tuya.refresh();
    await automationEngine.tick();
    res.json(tuya.state());
});
function validateTuyaCommand(device, code, value) {
    const fn = device.functions.find((x) => x.code === code);
    if (!fn)
        return "unsupported_dp_instruction";
    const type = fn.type.toLowerCase();
    let meta = {};
    try {
        meta = JSON.parse(fn.values || "{}");
    }
    catch {
        meta = {};
    }
    if (device.profile === "mygate" && ["stop_1", "pedestrian_1", "start_1", "open_1", "close_1"].includes(code) && value !== true)
        return "gate_pulse_must_be_true";
    if (type === "boolean" && typeof value !== "boolean")
        return "invalid_boolean_value";
    if (type === "enum") {
        const range = Array.isArray(meta.range) ? meta.range.map(String) : [];
        if (range.length && !range.includes(String(value)))
            return "invalid_enum_value";
    }
    if (type === "integer" || type === "value") {
        if (typeof value !== "number" || !Number.isFinite(value))
            return "invalid_numeric_value";
        const min = Number(meta.min);
        const max = Number(meta.max);
        const step = Number(meta.step || 1);
        if (Number.isFinite(min) && value < min)
            return "value_below_minimum";
        if (Number.isFinite(max) && value > max)
            return "value_above_maximum";
        if (Number.isFinite(min) && Number.isFinite(step) && step > 0 && Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-7)
            return "invalid_value_step";
    }
    return null;
}
app.get("/api/smart-home/devices/:id/debug", userAuth, (req, res) => {
    const device = tuya.state().devices.find((d) => d.id === paramString(req.params.id));
    if (!device)
        return res.status(404).json({ error: "tuya_device_not_found" });
    res.json({ id: device.id, name: device.name, profile: device.profile || null, productName: device.productName, category: device.category, online: device.online, mac: device.mac || null, uuid: device.uuid || null, serialNumber: device.serialNumber || null, status: device.status, functions: device.functions, statusSpec: device.statusSpec });
});
app.post("/api/smart-home/devices/:id/command", userAuth, async (req, res) => {
    const parsed = z.object({ code: z.string().min(1).max(128), value: z.unknown(), confirm: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const device = tuya.state().devices.find((d) => d.id === paramString(req.params.id));
    if (!device)
        return res.status(404).json({ error: "tuya_device_not_found" });
    const dangerous = device.profile === "mygate" || /kapu|gate|garage|garázs|door|lock|zár/i.test(`${device.name} ${device.productName}`);
    if (dangerous && parsed.data.confirm !== true)
        return res.status(409).json({ error: "confirmation_required" });
    const validationError = validateTuyaCommand(device, parsed.data.code, parsed.data.value);
    if (validationError)
        return res.status(400).json({ error: validationError });
    try {
        await tuya.command(device.id, parsed.data.code, parsed.data.value);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.post("/api/smart-home/scenes/:id/run", userAuth, async (req, res) => {
    const scene = tuya.state().scenes.find((x) => x.id === paramString(req.params.id));
    if (!scene)
        return res.status(404).json({ error: "tuya_scene_not_found" });
    const dangerous = /kapu|gate|garage|garázs|door|lock|zár/i.test(scene.name);
    if (dangerous && req.body?.confirm !== true)
        return res.status(409).json({ error: "confirmation_required" });
    try {
        await tuya.scene(scene.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.get("/api/settings", userAuth, (_req, res) => res.json(store.get().settings));
app.put("/api/settings", userAuth, (req, res) => {
    const schema = z.object({
        autoCopyEnabled: z.boolean(),
        autoCopyDestination: z.string().trim().min(1).max(200).refine((v) => !v.includes("..") && !v.startsWith("/"), "relative folder required"),
        aiMode: z.enum(["off", "suggest", "approved"])
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    store.mutate((s) => { s.settings = parsed.data; });
    res.json(parsed.data);
});
app.post("/api/torrents/magnet", userAuth, (req, res) => {
    const parsed = z.object({ magnet: z.string().trim().startsWith("magnet:?").max(16_000) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_magnet" });
    const bridgeId = store.get().snapshot?.bridgeId;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    res.status(202).json(enqueue(bridgeId, "torrent.addMagnet", parsed.data));
});
app.post("/api/torrents/file", userAuth, upload.single("torrent"), (req, res) => {
    const bridgeId = store.get().snapshot?.bridgeId;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    if (!req.file)
        return res.status(400).json({ error: "torrent_file_missing" });
    const cmd = enqueue(bridgeId, "torrent.addFile", {
        filename: req.file.originalname,
        metainfo: req.file.buffer.toString("base64")
    });
    res.status(202).json(cmd);
});
app.post("/api/torrents/:id/copy", userAuth, (req, res) => {
    const current = store.get();
    const bridgeId = current.snapshot?.bridgeId;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    const torrentId = Number(paramString(req.params.id));
    const destination = String(req.body?.destination || current.settings.autoCopyDestination).trim();
    if (!Number.isInteger(torrentId))
        return res.status(400).json({ error: "invalid_torrent_id" });
    if (!destination || destination.includes("..") || destination.startsWith("/"))
        return res.status(400).json({ error: "invalid_destination" });
    const torrent = current.snapshot?.kd20.torrents.find((t) => t.id === torrentId);
    if (!torrent || !torrent.hashString)
        return res.status(404).json({ error: "torrent_not_found" });
    if (torrent.percentDone < 1)
        return res.status(409).json({ error: "torrent_not_complete" });
    const cmd = enqueue(bridgeId, "torrent.copyToWd", { torrentId, destination });
    store.mutate((state) => {
        const prev = state.copies[torrent.hashString];
        state.copies[torrent.hashString] = {
            torrentHash: torrent.hashString, torrentId, torrentName: torrent.name, destination, commandId: cmd.id,
            state: "queued", attempts: (prev?.attempts || 0) + 1, updatedAt: new Date().toISOString()
        };
    });
    res.status(202).json(cmd);
});
app.delete("/api/torrents/:id", userAuth, (req, res) => {
    const current = store.get();
    const bridgeId = current.snapshot?.bridgeId;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    const torrentId = Number(paramString(req.params.id));
    const parsed = z.object({ deleteData: z.boolean().default(false), confirm: z.boolean() }).safeParse(req.body || {});
    if (!Number.isInteger(torrentId) || !parsed.success)
        return res.status(400).json({ error: "invalid_delete_request" });
    if (parsed.data.confirm !== true)
        return res.status(409).json({ error: "confirmation_required" });
    const torrent = current.snapshot?.kd20.torrents.find((t) => t.id === torrentId);
    if (!torrent)
        return res.status(404).json({ error: "torrent_not_found" });
    const cmd = enqueue(bridgeId, "torrent.remove", { torrentId, deleteData: parsed.data.deleteData });
    res.status(202).json({ ...cmd, wdCopyUntouched: true });
});
app.post("/api/copies/:hash/retry", userAuth, (req, res) => {
    const current = store.get();
    const bridgeId = current.snapshot?.bridgeId;
    if (!bridgeId)
        return res.status(409).json({ error: "bridge_offline" });
    const hash = paramString(req.params.hash);
    const copy = current.copies[hash];
    const torrent = current.snapshot?.kd20.torrents.find((t) => t.hashString === hash);
    if (!copy || !torrent)
        return res.status(404).json({ error: "copy_not_found" });
    if (torrent.percentDone < 1)
        return res.status(409).json({ error: "torrent_not_complete" });
    const cmd = enqueue(bridgeId, "torrent.copyToWd", { torrentId: torrent.id, destination: copy.destination });
    store.mutate((state) => {
        const target = state.copies[hash];
        if (target) {
            target.commandId = cmd.id;
            target.state = "queued";
            target.message = undefined;
            target.attempts = (target.attempts || 0) + 1;
            target.updatedAt = new Date().toISOString();
        }
    });
    res.status(202).json(cmd);
});
function life360PersonFor(member) {
    const mapped = store.get().life360MemberMap[member.id];
    if (mapped)
        return store.get().people.find(p => p.id === mapped);
    const first = String(member.firstName || "").trim().toLocaleLowerCase("hu-HU");
    return store.get().people.find(p => [p.name, p.nickname].filter(Boolean).some(n => String(n).trim().toLocaleLowerCase("hu-HU") === first));
}
function setLife360Signal(s, key, value, label, personId, category = "generic") {
    const prev = s.externalSignals[key];
    if (prev && prev.value === value)
        return;
    const now = new Date().toISOString();
    s.externalSignals[key] = { key, value, label, category, source: "life360", personId, updatedAt: now };
}
async function refreshLife360() {
    const st = await life360.refresh();
    if (!st.online)
        return;
    store.mutate(s => {
        for (const m of st.members) {
            const person = life360PersonFor(m), pid = person?.id, base = `life360.${pid || m.id}`;
            const loc = m.location || {};
            const lat = Number(loc.latitude), lon = Number(loc.longitude), battery = Number(loc.battery), speed = Number(loc.speed);
            if (Number.isFinite(lat))
                setLife360Signal(s, `${base}.latitude`, lat, `${person?.name || m.firstName || "Life360"} szélesség`, pid);
            if (Number.isFinite(lon))
                setLife360Signal(s, `${base}.longitude`, lon, `${person?.name || m.firstName || "Life360"} hosszúság`, pid);
            if (Number.isFinite(battery))
                setLife360Signal(s, `${base}.battery`, battery, `${person?.name || m.firstName || "Life360"} akkumulátor`, pid);
            if (Number.isFinite(speed))
                setLife360Signal(s, `${base}.speed`, speed, `${person?.name || m.firstName || "Life360"} sebesség`, pid);
            if (loc.name)
                setLife360Signal(s, `${base}.place`, String(loc.name), `${person?.name || m.firstName || "Life360"} hely`, pid);
            if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(LIFE360_HOME_LAT) && Number.isFinite(LIFE360_HOME_LON)) {
                const dist = Math.round(haversineMeters(lat, lon, LIFE360_HOME_LAT, LIFE360_HOME_LON));
                setLife360Signal(s, `${base}.distance_home_m`, dist, `${person?.name || m.firstName || "Life360"} távolság otthontól`, pid);
                setLife360Signal(s, `${base}.home`, dist <= LIFE360_HOME_RADIUS_M, `${person?.name || m.firstName || "Life360"} Life360 otthon`, pid, "geofence");
            }
        }
    }, false);
    automationEngine.tick().catch(() => { });
}
app.get("/api/integrations/life360", adminOnly, (_req, res) => res.json({ ...life360.getStatus(), mapping: store.get().life360MemberMap, homeGeofenceConfigured: Number.isFinite(LIFE360_HOME_LAT) && Number.isFinite(LIFE360_HOME_LON), homeRadiusM: LIFE360_HOME_RADIUS_M }));
app.post("/api/integrations/life360/refresh", adminOnly, async (_req, res) => { await refreshLife360(); res.json({ ...life360.getStatus(), mapping: store.get().life360MemberMap }); });
app.put("/api/integrations/life360/mapping", adminOnly, (req, res) => {
    const parsed = z.object({ memberId: z.string().min(1).max(160), personId: z.string().max(160) }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.personId && !store.get().people.some(p => p.id === parsed.data.personId))
        return res.status(404).json({ error: "person_not_found" });
    store.mutate(s => { if (parsed.data.personId)
        s.life360MemberMap[parsed.data.memberId] = parsed.data.personId;
    else
        delete s.life360MemberMap[parsed.data.memberId]; });
    res.json({ ok: true, mapping: store.get().life360MemberMap });
});
const persistentBackupSchema = z.object({
    version: z.literal(1),
    persistentUpdatedAt: z.string(),
    settings: z.object({ autoCopyEnabled: z.boolean(), autoCopyDestination: z.string(), aiMode: z.enum(["off", "suggest", "approved"]).optional().default("suggest") }),
    copies: z.record(z.any()),
    commands: z.array(z.object({
        id: z.string(), bridgeId: z.string(), type: z.enum(["torrent.addMagnet", "torrent.addFile", "torrent.copyToWd", "torrent.remove", "vacuum.start", "vacuum.pause", "vacuum.stop", "vacuum.dock"]),
        payload: z.record(z.any()), createdAt: z.string(), leasedAt: z.string().optional(), completedAt: z.string().optional(), ok: z.boolean().optional(), message: z.string().optional()
    })),
    automations: z.array(z.any()).optional(),
    automationRuntime: z.record(z.any()).optional(),
    alerts: z.array(z.any()).optional(),
    knownNetworkMacs: z.array(z.string()).optional(),
    networkEvents: z.array(z.any()).optional(),
    people: z.array(z.any()).optional(),
    history: z.array(z.any()).optional(),
    presenceRuntime: z.record(z.any()).optional(),
    historySampleKey: z.string().optional(),
    deviceIdentityOverrides: z.record(z.any()).optional(),
    tuyaLogCursor: z.record(z.number()).optional(),
    externalSignals: z.record(z.object({
        key: z.string(), label: z.string().optional(), category: z.enum(["geofence", "ble", "generic"]).optional(),
        value: z.union([z.string(), z.number(), z.boolean()]), source: z.string().optional(), personId: z.string().optional(),
        updatedAt: z.string(), expiresAt: z.string().optional()
    })).optional(),
    life360MemberMap: z.record(z.string()).optional()
});
app.post("/api/bridge/heartbeat", bridgeAuth, (req, res) => {
    const parsed = z.object({
        bridgeId: z.string().min(1),
        timestamp: z.string().optional(),
        version: z.string().optional()
    }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    store.mutate((s) => {
        s.bridgeLastSeenAt = new Date().toISOString();
    }, false);
    res.json({ ok: true, serverTime: new Date().toISOString() });
});
app.post("/api/bridge/snapshot", bridgeAuth, (req, res) => {
    const parsed = z.object({
        bridgeId: z.string().min(1),
        timestamp: z.string(),
        kd20: z.object({
            online: z.boolean(),
            rpcUrl: z.string(),
            torrents: z.array(z.object({
                id: z.number(),
                hashString: z.string(),
                name: z.string(),
                status: z.number(),
                percentDone: z.number(),
                rateDownload: z.number(),
                rateUpload: z.number(),
                eta: z.number(),
                downloadDir: z.string().optional()
            }))
        }),
        wd: z.object({
            online: z.boolean(),
            freeBytes: z.number(),
            totalBytes: z.number(),
            mediaRoot: z.string()
        }),
        printer: z.object({
            configured: z.boolean(),
            online: z.boolean(),
            host: z.string(),
            adminUrl: z.string(),
            detectedPorts: z.array(z.number().int()),
            protocol: z.string(),
            note: z.string()
        }).optional(),
        network: z.array(z.object({
            id: z.string(), name: z.string(), kind: z.string(), online: z.boolean(), adminOnline: z.boolean().optional(), ip: z.string(), configuredIp: z.string().optional(), ipSource: z.string().optional(), ipChanged: z.boolean().optional(), mac: z.string(), latencyMs: z.number(), adminUrl: z.string(), note: z.string(), visibility: z.string().optional(),
            managed: z.object({
                adapter: z.string(), credentialsConfigured: z.boolean(), authOk: z.boolean(), model: z.string().optional(), hardware: z.string().optional(), firmware: z.string().optional(), gateway: z.string().optional(), error: z.string().optional(), updatedAt: z.string(),
                ports: z.array(z.object({ port: z.number().int(), label: z.string().optional(), enabled: z.boolean(), linkUp: z.boolean(), speedMbps: z.number().int(), duplex: z.string(), configSpeed: z.string(), flowControl: z.boolean(), txPackets: z.number().nonnegative().optional(), rxPackets: z.number().nonnegative().optional(), health: z.string() })).optional()
            }).optional()
        })).optional(),
        vacuum: z.object({
            configured: z.boolean(), online: z.boolean(), controlReady: z.boolean(), name: z.string(), model: z.string(), ip: z.string(),
            state: z.string().optional(), battery: z.number().int().min(0).max(100).optional(), areaM2: z.number().nonnegative().optional(), durationSec: z.number().nonnegative().optional(),
            metrics: z.array(z.object({ name: z.string(), value: z.any(), unit: z.string().optional() })).optional(), note: z.string(), updatedAt: z.string()
        }).optional(),
        media: z.object({
            enabled: z.boolean(), online: z.boolean(), publicBaseUrl: z.string(), count: z.number().int().nonnegative(), truncated: z.boolean(), error: z.string().optional(), updatedAt: z.string(),
            items: z.array(z.object({
                id: z.string(), name: z.string(), relativePath: z.string(), folder: z.string(), sizeBytes: z.number().nonnegative(), modifiedAt: z.string(), extension: z.string(), nativePlay: z.boolean(), playUrl: z.string().url(), downloadUrl: z.string().url()
            }))
        }).optional(),
        vault: z.object({
            enabled: z.boolean(), initialized: z.boolean(), pinConfigured: z.boolean(), localUrl: z.string(), updatedAt: z.string(), error: z.string().optional(),
            entries: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string().optional(), username: z.string().optional(), adminUrl: z.string().optional(), ip: z.string().optional(), hasPassword: z.boolean(), saved: z.boolean(), updatedAt: z.string().optional() }))
        }).optional(),
        persistentState: persistentBackupSchema.optional(),
        localCopies: z.record(z.object({ hash: z.string(), name: z.string(), destination: z.string(), copiedAt: z.string() })).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const snapshot = parsed.data;
    if (snapshot.persistentState)
        store.importPersistent(snapshot.persistentState);
    else
        store.markBootstrapComplete();
    store.mutate((s) => {
        const previousMedia = s.snapshot?.media;
        const events = deriveNetworkEvents(s.snapshot?.network || [], snapshot.network || []);
        if (events.length) {
            s.networkEvents = [...s.networkEvents, ...events].slice(-200);
            for (const h of networkEventsToHistory(events))
                pushHistory(s, h);
        }
        const network = snapshot.network || [];
        updatePresence(s, network);
        recordHourlyNetworkSample(s, network);
        const prevSnapshot = s.snapshot;
        const now = new Date().toISOString();
        if (prevSnapshot && prevSnapshot.kd20.online !== snapshot.kd20.online)
            pushHistory(s, { category: "system", type: snapshot.kd20.online ? "kd20.online" : "kd20.offline", entityId: "kd20", entityName: "KD20 / oldnas", message: `KD20 / oldnas: ${snapshot.kd20.online ? "online" : "offline"}.`, createdAt: now });
        if (prevSnapshot && prevSnapshot.wd.online !== snapshot.wd.online)
            pushHistory(s, { category: "system", type: snapshot.wd.online ? "wd.online" : "wd.offline", entityId: "wd-my-cloud", entityName: "WD My Cloud", message: `WD My Cloud: ${snapshot.wd.online ? "online" : "offline"}.`, createdAt: now });
        if (prevSnapshot?.printer && snapshot.printer && prevSnapshot.printer.online !== snapshot.printer.online)
            pushHistory(s, { category: "system", type: snapshot.printer.online ? "printer.online" : "printer.offline", entityId: "kd20-printer", entityName: "Samsung SCX-3200", message: `KD20 nyomtatószolgáltatás: ${snapshot.printer.online ? "elérhető" : "nem elérhető"}.`, createdAt: now });
        if (prevSnapshot?.vacuum && snapshot.vacuum && (prevSnapshot.vacuum.state !== snapshot.vacuum.state || prevSnapshot.vacuum.online !== snapshot.vacuum.online))
            pushHistory(s, { category: "smart", type: "vacuum.state", entityId: "xiaomi-vacuum", entityName: snapshot.vacuum.name, message: `${snapshot.vacuum.name}: ${snapshot.vacuum.online ? (snapshot.vacuum.state || "online") : "offline"}.`, createdAt: now, data: { state: snapshot.vacuum.state, online: snapshot.vacuum.online, battery: snapshot.vacuum.battery } });
        s.snapshot = { ...snapshot, media: snapshot.media ?? previousMedia, persistentState: undefined, localCopies: undefined };
        s.bridgeLastSeenAt = now;
    });
    reconcileLocalCopies(snapshot);
    autoQueueCopies(snapshot);
    automationEngine.tick().catch(() => { });
    res.json({ ok: true, settings: store.get().settings, persistentState: store.exportPersistent() });
});
app.get("/api/bridge/commands", bridgeAuth, (req, res) => {
    const bridgeId = String(req.query.bridgeId || "");
    const now = Date.now();
    const commands = store.get().commands.filter((c) => {
        if (c.bridgeId !== bridgeId || c.completedAt)
            return false;
        if (!c.leasedAt)
            return true;
        return now - new Date(c.leasedAt).getTime() > 60_000;
    }).slice(0, 5);
    store.mutate((s) => {
        for (const cmd of commands) {
            const target = s.commands.find((x) => x.id === cmd.id);
            if (target)
                target.leasedAt = new Date().toISOString();
            const copy = Object.values(s.copies).find((x) => x.commandId === cmd.id);
            if (copy) {
                copy.state = "running";
                copy.updatedAt = new Date().toISOString();
            }
        }
    });
    res.json(commands);
});
app.post("/api/bridge/commands/:id/progress", bridgeAuth, (req, res) => {
    const id = paramString(req.params.id);
    const parsed = z.object({
        copiedBytes: z.number().nonnegative(),
        totalBytes: z.number().nonnegative(),
        currentFile: z.string().max(2000).optional().default(""),
        fileCopiedBytes: z.number().nonnegative().optional().default(0),
        fileTotalBytes: z.number().nonnegative().optional().default(0),
        speedBytesPerSec: z.number().nonnegative().optional().default(0),
        etaSeconds: z.number().nonnegative().optional().default(0),
        percent: z.number().min(0).max(1).optional().default(0)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    store.mutate((s) => {
        const copy = Object.values(s.copies).find((x) => x.commandId === id);
        if (!copy)
            return;
        copy.state = "running";
        copy.copiedBytes = parsed.data.copiedBytes;
        copy.totalBytes = parsed.data.totalBytes;
        copy.currentFile = parsed.data.currentFile;
        copy.fileCopiedBytes = parsed.data.fileCopiedBytes;
        copy.fileTotalBytes = parsed.data.fileTotalBytes;
        copy.speedBytesPerSec = parsed.data.speedBytesPerSec;
        copy.etaSeconds = parsed.data.etaSeconds;
        copy.percent = parsed.data.percent;
        copy.updatedAt = new Date().toISOString();
    });
    res.json({ ok: true });
});
app.post("/api/bridge/commands/:id/complete", bridgeAuth, (req, res) => {
    const id = paramString(req.params.id);
    const ok = Boolean(req.body?.ok);
    const message = String(req.body?.message || "").slice(0, 2000);
    store.mutate((s) => {
        const cmd = s.commands.find((c) => c.id === id);
        if (cmd) {
            cmd.completedAt = new Date().toISOString();
            cmd.ok = ok;
            cmd.message = message;
            cmd.payload = {}; // do not retain magnet links or uploaded metainfo after execution
        }
        const copy = Object.values(s.copies).find((x) => x.commandId === id);
        if (copy) {
            copy.state = ok ? "done" : "error";
            copy.message = message;
            if (ok) {
                copy.percent = 1;
                if (copy.totalBytes !== undefined)
                    copy.copiedBytes = copy.totalBytes;
                copy.etaSeconds = 0;
            }
            copy.updatedAt = new Date().toISOString();
        }
    });
    res.json({ ok: true, settings: store.get().settings, persistentState: store.exportPersistent() });
});
if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, {
        maxAge: isProd ? "1h" : 0,
        immutable: false,
        index: false,
        setHeaders: (res, filePath) => {
            if (filePath.endsWith("/sw.js") || filePath.endsWith("\\sw.js") || filePath.endsWith("/manifest.webmanifest") || filePath.endsWith("\\manifest.webmanifest")) {
                res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
                res.setHeader("Pragma", "no-cache");
                res.setHeader("Expires", "0");
            }
        }
    }));
    app.use((_req, res) => {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.sendFile(path.join(WEB_DIST, "index.html"));
    });
}
function tuyaLogCodes(device) {
    const candidates = [...new Set([...(device.status || []).map(x => x.code), ...(device.statusSpec || []).map(x => x.code)])];
    const useful = candidates.filter(code => /switch|power|current|voltage|energy|electric|door|gate|open|close|temp|humid|state|work|alarm|fault|signal|battery|charge|kwh/i.test(code));
    return (useful.length ? useful : candidates).slice(0, 40);
}
function tuyaLogHistory(device, log) {
    const text = `${device.name} ${device.productName} ${log.code}`.toLowerCase();
    const category = /gate|door|open|close|mygate/.test(text) ? "security" : /feyree|charger|charge|power|current|voltage|energy|kwh/.test(text) ? "energy" : "smart";
    const createdAt = new Date(log.eventTime).toISOString();
    const value = typeof log.value === "string" ? log.value : JSON.stringify(log.value);
    return { category: category, type: `tuya.log.${log.code}`, entityId: device.id, entityName: device.name, message: `${device.name}: ${log.code} = ${value}`, createdAt, data: { code: log.code, value: log.value, source: "tuya-report-log" } };
}
async function refreshTuyaLogs() {
    if (!tuya.state().configured || !tuya.state().online)
        return;
    const end = Date.now();
    for (const device of tuya.state().devices.slice(0, 40)) {
        const codes = tuyaLogCodes(device);
        if (!codes.length)
            continue;
        const currentCursor = Number(store.get().tuyaLogCursor[device.id] || 0);
        const start = currentCursor > 0 ? Math.max(currentCursor + 1, end - 24 * 60 * 60_000) : end - TUYA_LOG_LOOKBACK_MS;
        try {
            const logs = (await tuya.reportLogs(device.id, codes, start, end)).sort((a, b) => a.eventTime - b.eventTime);
            if (!logs.length)
                continue;
            store.mutate(s => {
                const baseCursor = Number(s.tuyaLogCursor[device.id] || 0);
                let cursor = baseCursor;
                for (const log of logs) {
                    if (log.eventTime <= baseCursor)
                        continue;
                    pushHistory(s, tuyaLogHistory(device, log));
                    cursor = Math.max(cursor, log.eventTime);
                }
                s.tuyaLogCursor[device.id] = cursor;
            });
        }
        catch { /* Device Log entitlement may be unavailable for some products; current-state history remains active. */ }
    }
}
async function refreshTuyaWithHistory() {
    const before = structuredClone(tuya.state().devices || []);
    await tuya.refresh();
    const after = tuya.state().devices || [];
    const events = tuyaDeviceHistory(before, after);
    if (events.length)
        store.mutate(s => { for (const e of events)
            pushHistory(s, e); });
    await automationEngine.tick();
}
if (tuya.state().configured) {
    refreshTuyaWithHistory().catch(() => { });
    setInterval(() => refreshTuyaWithHistory().catch(() => { }), TUYA_REFRESH_MS).unref();
    setTimeout(() => refreshTuyaLogs().catch(() => { }), 8_000).unref();
    setInterval(() => refreshTuyaLogs().catch(() => { }), TUYA_LOG_REFRESH_MS).unref();
}
if (life360.getStatus().configured) {
    setTimeout(() => refreshLife360().catch(() => { }), 12_000).unref();
    setInterval(() => refreshLife360().catch(() => { }), LIFE360_REFRESH_MS).unref();
}
setInterval(() => automationEngine.tick().catch(() => { }), 10_000).unref();
app.listen(PORT, "0.0.0.0", () => {
    console.log(`HomeHub ${VERSION} listening on :${PORT}`);
});
