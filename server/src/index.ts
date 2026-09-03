import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { Store } from "./store.js";
import type { Command, Snapshot } from "./types.js";

const VERSION = "0.5.0";
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 8787);
const APP_PASSWORD = process.env.APP_PASSWORD || (isProd ? "" : "homehub-dev");
const COOKIE_SECRET = process.env.COOKIE_SECRET || (isProd ? "" : "dev-cookie-secret-change-me");
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || (isProd ? "" : "dev-token");
const DATA_FILE = process.env.DATA_FILE || "./data/state.json";
const WEB_DIST = path.resolve(process.env.WEB_DIST || "../web/dist");
const SESSION_COOKIE = "homehub_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const BRIDGE_STALE_MS = Number(process.env.BRIDGE_STALE_MS || 15_000);

if (!APP_PASSWORD || !COOKIE_SECRET || !BRIDGE_TOKEN) {
  throw new Error("APP_PASSWORD, COOKIE_SECRET and BRIDGE_TOKEN are required in production");
}

const app = express();
app.set("trust proxy", 1);
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const store = new Store(DATA_FILE);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

app.use(express.json({ limit: "24mb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function cookieMap(req: express.Request) {
  const raw = req.header("cookie") || "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionSignature(exp: string) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(`homehub:${exp}`).digest("hex");
}

function validSession(req: express.Request) {
  const value = cookieMap(req)[SESSION_COOKIE];
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, sessionSignature(exp));
}

function setSessionCookie(req: express.Request, res: express.Response) {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
  const value = `${exp}.${sessionSignature(exp)}`;
  const secure = req.secure || req.header("x-forwarded-proto") === "https" || isProd;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const secure = req.secure || req.header("x-forwarded-proto") === "https" || isProd;
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function userAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!validSession(req)) return res.status(401).json({ error: "login_required" });
  next();
}

function bridgeAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.header("authorization");
  if (!auth || !safeEqual(auth, `Bearer ${BRIDGE_TOKEN}`)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function enqueue(bridgeId: string, type: Command["type"], payload: Record<string, unknown>) {
  const cmd: Command = {
    id: crypto.randomUUID(),
    bridgeId,
    type,
    payload,
    createdAt: new Date().toISOString()
  };
  store.mutate((s) => {
    s.commands.push(cmd);
    if (s.commands.length > 200) s.commands = s.commands.slice(-200);
  });
  return cmd;
}

function autoQueueCopies(snapshot: Snapshot) {
  const s = store.get();
  if (!s.settings.autoCopyEnabled) return;

  for (const t of snapshot.kd20.torrents) {
    if (t.percentDone < 1 || !t.hashString) continue;
    if (s.copies[t.hashString]) continue;

    const cmd = enqueue(snapshot.bridgeId, "torrent.copyToWd", {
      torrentId: t.id,
      destination: s.settings.autoCopyDestination
    });

    store.mutate((state) => {
      state.copies[t.hashString] = {
        torrentHash: t.hashString,
        torrentId: t.id,
        torrentName: t.name,
        destination: state.settings.autoCopyDestination,
        commandId: cmd.id,
        state: "queued",
        updatedAt: new Date().toISOString()
      };
    });
  }
}

function publicState() {
  const s = store.get();
  const lastSeen = s.bridgeLastSeenAt ? new Date(s.bridgeLastSeenAt).getTime() : 0;
  return {
    snapshot: s.snapshot,
    bridgeLastSeenAt: s.bridgeLastSeenAt,
    bridgeOnline: lastSeen > 0 && Date.now() - lastSeen <= BRIDGE_STALE_MS,
    settings: s.settings,
    copies: s.copies,
    recentCommands: s.commands.slice(-10).reverse().map((c) => ({
      id: c.id,
      type: c.type,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
      ok: c.ok,
      message: c.message
    }))
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, version: VERSION }));

app.get("/api/auth/status", (req, res) => res.json({ authenticated: validSession(req) }));
app.post("/api/auth/login", (req, res) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record && record.resetAt > now && record.count >= 8) {
    return res.status(429).json({ error: "too_many_attempts" });
  }
  const parsed = z.object({ password: z.string().min(1).max(512) }).safeParse(req.body);
  if (!parsed.success || !safeEqual(parsed.data.password, APP_PASSWORD)) {
    const next = !record || record.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...record, count: record.count + 1 };
    loginAttempts.set(ip, next);
    return res.status(401).json({ error: "invalid_password" });
  }
  loginAttempts.delete(ip);
  setSessionCookie(req, res);
  res.json({ ok: true });
});
app.post("/api/auth/logout", userAuth, (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/state", userAuth, (_req, res) => res.json(publicState()));

app.get("/api/settings", userAuth, (_req, res) => res.json(store.get().settings));
app.put("/api/settings", userAuth, (req, res) => {
  const schema = z.object({
    autoCopyEnabled: z.boolean(),
    autoCopyDestination: z.string().trim().min(1).max(200).refine((v) => !v.includes("..") && !v.startsWith("/"), "relative folder required")
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  store.mutate((s) => { s.settings = parsed.data; });
  res.json(parsed.data);
});

app.post("/api/torrents/magnet", userAuth, (req, res) => {
  const parsed = z.object({ magnet: z.string().trim().startsWith("magnet:?").max(16_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_magnet" });
  const bridgeId = store.get().snapshot?.bridgeId;
  if (!bridgeId) return res.status(409).json({ error: "bridge_offline" });
  res.status(202).json(enqueue(bridgeId, "torrent.addMagnet", parsed.data));
});

app.post("/api/torrents/file", userAuth, upload.single("torrent"), (req, res) => {
  const bridgeId = store.get().snapshot?.bridgeId;
  if (!bridgeId) return res.status(409).json({ error: "bridge_offline" });
  if (!req.file) return res.status(400).json({ error: "torrent_file_missing" });
  const cmd = enqueue(bridgeId, "torrent.addFile", {
    filename: req.file.originalname,
    metainfo: req.file.buffer.toString("base64")
  });
  res.status(202).json(cmd);
});

app.post("/api/torrents/:id/copy", userAuth, (req, res) => {
  const bridgeId = store.get().snapshot?.bridgeId;
  if (!bridgeId) return res.status(409).json({ error: "bridge_offline" });
  const torrentId = Number(req.params.id);
  const destination = String(req.body?.destination || store.get().settings.autoCopyDestination).trim();
  if (!Number.isInteger(torrentId)) return res.status(400).json({ error: "invalid_torrent_id" });
  if (!destination || destination.includes("..") || destination.startsWith("/")) return res.status(400).json({ error: "invalid_destination" });
  res.status(202).json(enqueue(bridgeId, "torrent.copyToWd", { torrentId, destination }));
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
    })
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const snapshot = parsed.data as Snapshot;
  store.mutate((s) => {
    s.snapshot = snapshot;
    s.bridgeLastSeenAt = new Date().toISOString();
  });
  autoQueueCopies(snapshot);
  res.json({ ok: true, settings: store.get().settings });
});

app.get("/api/bridge/commands", bridgeAuth, (req, res) => {
  const bridgeId = String(req.query.bridgeId || "");
  const now = Date.now();
  const commands = store.get().commands.filter((c) => {
    if (c.bridgeId !== bridgeId || c.completedAt) return false;
    if (!c.leasedAt) return true;
    return now - new Date(c.leasedAt).getTime() > 60_000;
  }).slice(0, 5);

  store.mutate((s) => {
    for (const cmd of commands) {
      const target = s.commands.find((x) => x.id === cmd.id);
      if (target) target.leasedAt = new Date().toISOString();
      const copy = Object.values(s.copies).find((x) => x.commandId === cmd.id);
      if (copy) {
        copy.state = "running";
        copy.updatedAt = new Date().toISOString();
      }
    }
  });
  res.json(commands);
});

app.post("/api/bridge/commands/:id/complete", bridgeAuth, (req, res) => {
  const id = req.params.id;
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
      copy.updatedAt = new Date().toISOString();
    }
  });
  res.json({ ok: true });
});

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { maxAge: isProd ? "1h" : 0 }));
  app.use((_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HomeHub ${VERSION} listening on :${PORT}`);
});
