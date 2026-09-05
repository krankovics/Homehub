import crypto from "node:crypto";
import express from "express";

const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const SESSION_COOKIE = "homehub_session";
const BROWSER_TOKEN = String(process.env.NCORE_BROWSER_TOKEN || "").trim();
const WAIT_MS = Math.max(15_000, Math.min(60_000, Number(process.env.NCORE_BROWSER_WAIT_MS || 35_000)));
const FRESH_MS = 10_000;
const LEASE_MS = 20_000;

type BrowserCommand = {
  id: string;
  type: "ncore.search" | "ncore.download";
  payload: Record<string, unknown>;
  createdAt: string;
  leasedAt?: string;
  completedAt?: string;
  ok?: boolean;
  result?: any;
  error?: string;
};

const commands: BrowserCommand[] = [];
let browserState = { seenAt: 0, clientId: "", version: "" };

function parseCookieHeader(raw: string) {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function adminSession(req: any) {
  if (!COOKIE_SECRET) return false;
  const cookies = parseCookieHeader(String(req.headers?.cookie || ""));
  const value = cookies[SESSION_COOKIE];
  if (!value) return false;
  const [userId, exp, sig] = value.split(".");
  if (userId !== "admin" || !/^\d+$/.test(exp || "") || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(`homehub:${userId}:${exp}`).digest("hex");
  return Boolean(sig) && safeEqual(sig, expected);
}

function requireAdmin(req: any, res: any, next: any) {
  if (!adminSession(req)) return res.status(403).json({ error: "admin_required" });
  next();
}

function requireBrowser(req: any, res: any, next: any) {
  const auth = String(req.headers?.authorization || "");
  if (!BROWSER_TOKEN) return res.status(503).json({ error: "ncore_browser_not_configured" });
  if (!safeEqual(auth, `Bearer ${BROWSER_TOKEN}`)) return res.status(401).json({ error: "unauthorized" });
  next();
}

function online() {
  return browserState.seenAt > 0 && Date.now() - browserState.seenAt < FRESH_MS;
}

function cleanup() {
  const cutoff = Date.now() - 5 * 60_000;
  for (let i = commands.length - 1; i >= 0; i--) {
    const t = Date.parse(commands[i].completedAt || commands[i].createdAt);
    if (Number.isFinite(t) && t < cutoff) commands.splice(i, 1);
  }
  if (commands.length > 100) commands.splice(0, commands.length - 100);
}

function enqueue(type: BrowserCommand["type"], payload: Record<string, unknown>) {
  cleanup();
  const cmd: BrowserCommand = { id: crypto.randomUUID(), type, payload, createdAt: new Date().toISOString() };
  commands.push(cmd);
  return cmd;
}

async function waitFor(id: string) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const cmd = commands.find((x) => x.id === id);
    if (!cmd) throw new Error("ncore_browser_command_lost");
    if (cmd.completedAt) return cmd;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("ncore_browser_timeout");
}

function statusForError(message: string) {
  if (message === "search_too_short" || message === "invalid_torrent_id") return 400;
  if (message === "ncore_session_expired") return 401;
  if (message === "ncore_browser_offline" || message === "ncore_browser_timeout" || message === "ncore_browser_not_configured") return 503;
  return 502;
}

function register(app: any) {
  if (app.__homehubNcoreBrowserRegistered) return;
  app.__homehubNcoreBrowserRegistered = true;

  app.get("/api/ncore/browser/commands", requireBrowser, (req: any, res: any) => {
    browserState = {
      seenAt: Date.now(),
      clientId: String(req.query?.clientId || "browser"),
      version: String(req.query?.version || ""),
    };
    const now = Date.now();
    const available = commands.filter((cmd) => {
      if (cmd.completedAt) return false;
      if (!cmd.leasedAt) return true;
      const leased = Date.parse(cmd.leasedAt);
      return !Number.isFinite(leased) || now - leased > LEASE_MS;
    }).slice(0, 2);
    for (const cmd of available) cmd.leasedAt = new Date().toISOString();
    res.json(available.map(({ id, type, payload }) => ({ id, type, payload })));
  });

  app.post("/api/ncore/browser/commands/:id/complete", requireBrowser, express.json({ limit: "30mb" }), (req: any, res: any) => {
    const cmd = commands.find((x) => x.id === String(req.params?.id || ""));
    if (!cmd) return res.status(404).json({ error: "command_not_found" });
    cmd.completedAt = new Date().toISOString();
    cmd.ok = Boolean(req.body?.ok);
    cmd.result = req.body?.result;
    cmd.error = String(req.body?.error || "").slice(0, 500);
    cmd.payload = {};
    res.json({ ok: true });
  });

  app.get("/api/ncore/browser/status", requireAdmin, (_req: any, res: any) => {
    res.json({
      configured: Boolean(BROWSER_TOKEN),
      online: online(),
      version: browserState.version,
      clientId: browserState.clientId,
    });
  });

  app.get("/api/ncore/browser/search", requireAdmin, async (req: any, res: any) => {
    const q = String(req.query?.q || "").trim().slice(0, 120);
    const category = ["all", "movies", "tv"].includes(String(req.query?.category || "all")) ? String(req.query?.category || "all") : "all";
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 25)));
    if (q.length < 2) return res.status(400).json({ error: "search_too_short" });
    if (!BROWSER_TOKEN) return res.status(503).json({ error: "ncore_browser_not_configured" });
    if (!online()) return res.status(503).json({ error: "ncore_browser_offline" });
    try {
      const cmd = enqueue("ncore.search", { query: q, category, limit });
      const done = await waitFor(cmd.id);
      if (!done.ok) throw new Error(done.error || "ncore_browser_search_failed");
      return res.json({ ok: true, mode: "browser-companion", results: done.result?.results || [], browserVersion: browserState.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(statusForError(message)).json({ error: message });
    }
  });

  app.get("/api/ncore/browser/torrent/:id", requireAdmin, async (req: any, res: any) => {
    const id = String(req.params?.id || "");
    if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: "invalid_torrent_id" });
    if (!BROWSER_TOKEN) return res.status(503).json({ error: "ncore_browser_not_configured" });
    if (!online()) return res.status(503).json({ error: "ncore_browser_offline" });
    try {
      const cmd = enqueue("ncore.download", { id });
      const done = await waitFor(cmd.id);
      if (!done.ok) throw new Error(done.error || "ncore_browser_download_failed");
      const raw = String(done.result?.base64 || "");
      if (!raw || raw.length > 28 * 1024 * 1024) throw new Error("ncore_invalid_torrent_file");
      const data = Buffer.from(raw, "base64");
      if (!data.length || data[0] !== 0x64) throw new Error("ncore_invalid_torrent_file");
      res.setHeader("Content-Type", "application/x-bittorrent");
      res.setHeader("Cache-Control", "no-store");
      return res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(statusForError(message)).json({ error: message });
    }
  });
}

const proto: any = (express as any).application;
const originalInit = proto.init;
proto.init = function (...args: any[]) {
  const result = originalInit.apply(this, args);
  register(this);
  return result;
};
