import crypto from "node:crypto";
import express from "express";

const BASE = String(process.env.NCORE_BASE_URL || "https://ncore.pro").replace(/\/+$/, "");
const PASSKEY = String(process.env.NCORE_PASSKEY || process.env.NCORE_RSS_KEY || "").trim();
const ENABLED = String(process.env.NCORE_ENABLED || (PASSKEY ? "true" : "false")).toLowerCase() === "true";
const LIMIT = Math.max(1, Math.min(50, Number(process.env.NCORE_SEARCH_LIMIT || 25)));
const TIMEOUT_MS = Math.max(5000, Math.min(45000, Number(process.env.NCORE_TIMEOUT_MS || 20000)));
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const SESSION_COOKIE = "homehub_session";
const BRIDGE_ID = String(process.env.NCORE_BRIDGE_ID || "home-1").trim() || "home-1";
const BRIDGE_FRESH_MS = 10_000;
const COMMAND_LEASE_MS = 20_000;
const COMMAND_WAIT_MS = Math.max(15_000, Math.min(60_000, Number(process.env.NCORE_BRIDGE_WAIT_MS || 35_000)));

type BrokerCommand = {
  id: string;
  bridgeId: string;
  type: "ncore.search" | "ncore.download";
  payload: Record<string, unknown>;
  createdAt: string;
  leasedAt?: string;
  completedAt?: string;
  ok?: boolean;
  message?: string;
};

const brokerCommands: BrokerCommand[] = [];
let bridgeState = {
  seenAt: 0,
  bridgeId: BRIDGE_ID,
  version: "",
  configured: false,
};

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

function requireBridge(req: any, res: any, next: any) {
  const auth = String(req.headers?.authorization || "");
  if (!BRIDGE_TOKEN || !safeEqual(auth, `Bearer ${BRIDGE_TOKEN}`)) return res.status(401).json({ error: "unauthorized" });
  next();
}

function bridgeOnline() {
  return bridgeState.seenAt > 0 && Date.now() - bridgeState.seenAt < BRIDGE_FRESH_MS;
}

function cleanupCommands() {
  const cutoff = Date.now() - 5 * 60_000;
  for (let i = brokerCommands.length - 1; i >= 0; i--) {
    const t = Date.parse(brokerCommands[i].completedAt || brokerCommands[i].createdAt);
    if (Number.isFinite(t) && t < cutoff) brokerCommands.splice(i, 1);
  }
  if (brokerCommands.length > 100) brokerCommands.splice(0, brokerCommands.length - 100);
}

function enqueue(type: BrokerCommand["type"], payload: Record<string, unknown>) {
  cleanupCommands();
  const cmd: BrokerCommand = {
    id: crypto.randomUUID(),
    bridgeId: BRIDGE_ID,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
  brokerCommands.push(cmd);
  return cmd;
}

async function waitForCommand(id: string) {
  const deadline = Date.now() + COMMAND_WAIT_MS;
  while (Date.now() < deadline) {
    const cmd = brokerCommands.find((c) => c.id === id);
    if (!cmd) throw new Error("ncore_bridge_command_lost");
    if (cmd.completedAt) return cmd;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("ncore_bridge_timeout");
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}

function xmlValue(block: string, tag: string) {
  const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}>`, "i"));
  return decodeXml((match?.[1] || "").trim());
}

function cleanText(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryMatches(title: string, query: string) {
  const hay = normalize(title);
  const words = normalize(query).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

function categoryKind(label: string) {
  return /^Sorozat/i.test(label) ? "tv" : /^Film/i.test(label) ? "movies" : "all";
}

async function fetchDirectRss() {
  if (!PASSKEY) throw new Error("ncore_passkey_missing");
  const url = new URL(BASE + "/rss.php");
  url.searchParams.set("key", PASSKEY);
  const response = await fetch(url.toString(), {
    headers: {
      "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 HomeHub/0.24.0",
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ncore_rss_http_${response.status}`);
  const head = body.slice(0, 12000);
  if (/just a moment|attention required|cf-chl-|cloudflare/i.test(head)) throw new Error("ncore_rss_cloudflare");
  if (!/<(?:rss|feed)\b/i.test(body) && !/<item\b/i.test(body) && !/rss_dl\.php\/id=/i.test(body)) throw new Error("ncore_rss_invalid_response");
  return body;
}

function parseDirectRss(xml: string) {
  const results: any[] = [];
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const match of items) {
    const block = match[1] || "";
    const title = cleanText(xmlValue(block, "title"));
    const categoryLabel = cleanText(xmlValue(block, "category"));
    const uploadedAt = cleanText(xmlValue(block, "pubDate"));
    const decoded = decodeXml(block);
    const id = decoded.match(/rss_dl\.php\/id=(\d+)/i)?.[1]
      || decoded.match(/[?&]id=(\d+)/i)?.[1]
      || "";
    if (!id || !title) continue;
    results.push({
      id,
      title,
      size: cleanText(xmlValue(block, "size")),
      seeds: Number(cleanText(xmlValue(block, "seed")) || cleanText(xmlValue(block, "seeds"))) || 0,
      leech: Number(cleanText(xmlValue(block, "leech")) || cleanText(xmlValue(block, "leechers"))) || 0,
      category: categoryKind(categoryLabel),
      categoryLabel,
      uploadedAt,
      detailUrl: `${BASE}/torrents.php?action=details&id=${encodeURIComponent(id)}`,
      downloadReady: false,
      source: "ncore-rss-fallback",
    });
  }
  return results;
}

async function fallbackSearch(query: string, category: string) {
  const xml = await fetchDirectRss();
  const all = parseDirectRss(xml);
  const results = all.filter((item) => queryMatches(item.title, query) && (category === "all" || item.category === category)).slice(0, LIMIT);
  return { results, diagnostics: { mode: "direct-rss-fallback", directRssItems: all.length, bridgeOnline: bridgeOnline(), bridgeConfigured: bridgeState.configured } };
}

async function directTorrentFile(id: string) {
  if (!PASSKEY) throw new Error("ncore_passkey_missing");
  const url = `${BASE}/rss_dl.php/id=${encodeURIComponent(id)}/key=${encodeURIComponent(PASSKEY)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 HomeHub/0.24.0",
      accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const type = response.headers.get("content-type") || "";
  const data = Buffer.from(await response.arrayBuffer());
  const head = data.subarray(0, 1800).toString("utf8");
  if (!response.ok) throw new Error(`ncore_download_http_${response.status}`);
  if (/text\/html/i.test(type) || /just a moment|attention required|cf-chl-|cloudflare/i.test(head)) throw new Error("ncore_download_cloudflare");
  if (!data.length || data.length > 20 * 1024 * 1024 || data[0] !== 0x64) throw new Error("ncore_invalid_torrent_file");
  return data;
}

function errorStatus(message: string) {
  if (message === "ncore_session_expired") return 401;
  if (message === "ncore_bridge_credentials_missing" || message === "ncore_bridge_offline" || message === "ncore_bridge_timeout") return 503;
  if (message === "ncore_cloudflare" || message === "ncore_download_cloudflare") return 503;
  if (message === "invalid_torrent_id" || message === "search_too_short") return 400;
  return 502;
}

function register(app: any) {
  if (app.__homehubNcoreRegistered) return;
  app.__homehubNcoreRegistered = true;

  app.get("/api/ncore/bridge/commands", requireBridge, (req: any, res: any) => {
    const bridgeId = String(req.query?.bridgeId || "").trim();
    bridgeState = {
      seenAt: Date.now(),
      bridgeId: bridgeId || BRIDGE_ID,
      version: String(req.query?.version || ""),
      configured: String(req.query?.configured || "false").toLowerCase() === "true",
    };
    const now = Date.now();
    const available = brokerCommands.filter((cmd) => {
      if (cmd.bridgeId !== bridgeId || cmd.completedAt) return false;
      if (!cmd.leasedAt) return true;
      const leased = Date.parse(cmd.leasedAt);
      return !Number.isFinite(leased) || now - leased > COMMAND_LEASE_MS;
    }).slice(0, 3);
    for (const cmd of available) cmd.leasedAt = new Date().toISOString();
    res.json(available.map(({ id, type, payload }) => ({ id, type, payload })));
  });

  app.post("/api/ncore/bridge/commands/:id/complete", requireBridge, express.json({ limit: "2mb" }), (req: any, res: any) => {
    const id = String(req.params?.id || "");
    const cmd = brokerCommands.find((c) => c.id === id);
    if (!cmd) return res.status(404).json({ error: "command_not_found" });
    cmd.completedAt = new Date().toISOString();
    cmd.ok = Boolean(req.body?.ok);
    cmd.message = String(req.body?.message || "").slice(0, 1_500_000);
    cmd.payload = {};
    res.json({ ok: true });
  });

  app.get("/api/ncore/status", requireAdmin, (_req: any, res: any) => {
    res.json({
      enabled: ENABLED,
      configured: ENABLED,
      ready: ENABLED && ((bridgeOnline() && bridgeState.configured) || Boolean(PASSKEY)),
      mode: bridgeOnline() ? "wd-bridge" : PASSKEY ? "passkey-rss-fallback" : "bridge-wait",
      bridgeOnline: bridgeOnline(),
      bridgeConfigured: bridgeState.configured,
      bridgeVersion: bridgeState.version,
      bridgeId: bridgeState.bridgeId,
      fallbackRss: Boolean(PASSKEY),
      categories: ["all", "movies", "tv"],
      searchLimit: LIMIT,
    });
  });

  app.get("/api/ncore/search", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED) return res.status(503).json({ error: "ncore_disabled" });
    const q = String(req.query?.q || "").trim().slice(0, 120);
    const category = ["all", "movies", "tv"].includes(String(req.query?.category || "all")) ? String(req.query?.category || "all") : "all";
    if (q.length < 2) return res.status(400).json({ error: "search_too_short" });

    if (bridgeOnline() && bridgeState.configured) {
      try {
        const cmd = enqueue("ncore.search", { query: q, category, limit: LIMIT });
        const done = await waitForCommand(cmd.id);
        if (!done.ok) throw new Error(done.message || "ncore_bridge_search_failed");
        const parsed = JSON.parse(done.message || "{}");
        return res.json({ ok: true, query: q, category, results: parsed.results || [], mode: "wd-bridge", bridgeVersion: parsed.bridgeVersion || bridgeState.version });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(errorStatus(message)).json({ error: message });
      }
    }

    if (PASSKEY) {
      try {
        const data = await fallbackSearch(q, category);
        return res.json({ ok: true, query: q, category, results: data.results, diagnostics: data.results.length ? undefined : data.diagnostics, mode: "direct-rss-fallback" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(errorStatus(message)).json({ error: message });
      }
    }

    return res.status(503).json({ error: bridgeOnline() ? "ncore_bridge_credentials_missing" : "ncore_bridge_offline" });
  });

  app.post("/api/ncore/add/:id", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED) return res.status(503).json({ error: "ncore_disabled" });
    const id = String(req.params?.id || "");
    if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: "invalid_torrent_id" });
    if (!bridgeOnline()) return res.status(503).json({ error: "ncore_bridge_offline" });
    if (!bridgeState.configured) return res.status(503).json({ error: "ncore_bridge_credentials_missing" });
    try {
      const cmd = enqueue("ncore.download", { id });
      const done = await waitForCommand(cmd.id);
      if (!done.ok) throw new Error(done.message || "ncore_bridge_download_failed");
      let detail: any = {};
      try { detail = JSON.parse(done.message || "{}"); } catch {}
      res.json({ ok: true, mode: "wd-bridge", ...detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(errorStatus(message)).json({ error: message });
    }
  });

  // Compatibility for an older cached frontend. New clients use POST /api/ncore/add/:id
  // so the torrent never traverses Render; this fallback only uses the passkey RSS route.
  app.get("/api/ncore/torrent/:id", requireAdmin, async (req: any, res: any) => {
    const id = String(req.params?.id || "");
    if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: "invalid_torrent_id" });
    try {
      const data = await directTorrentFile(id);
      const name = String(req.query?.name || `ncore-${id}`).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160);
      res.setHeader("Content-Type", "application/x-bittorrent");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name + ".torrent")}`);
      res.setHeader("Cache-Control", "no-store");
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(errorStatus(message)).json({ error: message });
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
