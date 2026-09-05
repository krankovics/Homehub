import crypto from "node:crypto";
import express from "express";

const BASE = String(process.env.NCORE_BASE_URL || "https://ncore.pro").replace(/\/+$/, "");
const COOKIE = String(process.env.NCORE_COOKIE || "").replace(/[\r\n]/g, "").trim();
const ENABLED = String(process.env.NCORE_ENABLED || (COOKIE ? "true" : "false")).toLowerCase() === "true";
const RSS_KEY = String(process.env.NCORE_RSS_KEY || "").trim();
const LIMIT = Math.max(1, Math.min(50, Number(process.env.NCORE_SEARCH_LIMIT || 25)));
const TIMEOUT_MS = Math.max(5000, Math.min(45000, Number(process.env.NCORE_TIMEOUT_MS || 20000)));
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const SESSION_COOKIE = "homehub_session";

const CATEGORIES: Record<string, string> = {
  all: "xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd,xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser,mp3_hun,mp3,lossless_hun,lossless,clip,game_iso,game_rip,console,iso,misc,mobil,ebook_hun,ebook",
  movies: "xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd",
  tv: "xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser",
  music: "mp3_hun,mp3,lossless_hun,lossless,clip",
  games: "game_iso,game_rip,console",
  software: "iso,misc,mobil",
  books: "ebook_hun,ebook"
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

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

function ncoreHeaders() {
  return {
    "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "hu-HU,hu;q=0.9,en;q=0.7",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "cookie": COOKIE
  };
}

async function fetchNcore(url: string) {
  return fetch(url, {
    headers: ncoreHeaders(),
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

function pageTitle(html: string) {
  return stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function pageProblem(html: string, finalUrl: string) {
  const title = pageTitle(html);
  if (/\/login\.php(?:$|[?#])/i.test(finalUrl)) return "ncore_session_expired";
  if (/^ncore$/i.test(title) && /(?:login\.php|name\s*=\s*["']nev["']|name\s*=\s*["']pass["'])/i.test(html)) return "ncore_session_expired";
  if (/name\s*=\s*["']nev["']/i.test(html) && /name\s*=\s*["']pass["']/i.test(html)) return "ncore_session_expired";
  if (/just a moment|attention required|cf-chl-|cloudflare/i.test(title + " " + html.slice(0, 12000))) return "ncore_cloudflare_challenge";
  return "";
}

function extractKey(html: string) {
  if (RSS_KEY) return RSS_KEY;
  for (const match of html.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = decodeHtml(match[1]);
    const key = href.match(/[?&]key=([^&"'<>]+)/i)?.[1];
    if (key) return decodeURIComponent(key);
  }
  for (const match of html.matchAll(/(?:download|rss)\.php\?[^"'<>\s]*[?&]key=([^&"'<>\s]+)/gi)) {
    if (match[1]) return decodeURIComponent(decodeHtml(match[1]));
  }
  return "";
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? decodeHtml(m[1]) : "";
}

function torrentBlocks(html: string) {
  const starts = [...html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bbox_torrent\b[^"']*["'][^>]*>/gi)];
  if (!starts.length) return [] as string[];
  return starts.map((m, i) => html.slice((m.index || 0) + m[0].length, i + 1 < starts.length ? (starts[i + 1].index || html.length) : html.length));
}

function resultFromBlock(block: string, category: string, key: string) {
  const tags = [...block.matchAll(/<a\b[^>]*>/gi)].map(x => x[0]);
  const detailTag = tags.find(tag => /details\.php\?[^"']*\bid=/i.test(attr(tag, "href")));
  if (!detailTag) return null;
  const href = attr(detailTag, "href");
  const id = href.match(/[?&]id=(\d+)/i)?.[1];
  if (!id) return null;
  const title = attr(detailTag, "title") || stripHtml(block.match(/<div\b[^>]*class\s*=\s*["'][^"']*torrent_txt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  if (!title) return null;
  const size = stripHtml(block.match(/<div\b[^>]*class\s*=\s*["'][^"']*box_meret[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  const peers = [...block.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']*peers[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(x => Number(stripHtml(x[1]).replace(/\D+/g, "")) || 0);
  const detailUrl = new URL(href.replace(/^\//, ""), BASE + "/").toString();
  return { id, title, size, seeds: peers[0] || 0, leech: peers[1] || 0, category, detailUrl, downloadReady: Boolean(key), source: "ncore" };
}

function fallbackResults(html: string, category: string, key: string) {
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*details\.php\?[^"']*\bid=\d+[^"']*)["'][^>]*>/gi)];
  for (const match of anchors) {
    const tag = match[0];
    const href = decodeHtml(match[1]);
    const id = href.match(/[?&]id=(\d+)/i)?.[1];
    if (!id || seen.has(id)) continue;
    const title = attr(tag, "title");
    if (!title) continue;
    seen.add(id);
    results.push({ id, title, size: "", seeds: 0, leech: 0, category, detailUrl: new URL(href.replace(/^\//, ""), BASE + "/").toString(), downloadReady: Boolean(key), source: "ncore" });
    if (results.length >= LIMIT) break;
  }
  return results;
}

function parseSearch(html: string, category: string) {
  const key = extractKey(html);
  const blocks = torrentBlocks(html);
  const results: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    const item = resultFromBlock(block, category, key);
    if (item) results.push(item);
    if (results.length >= LIMIT) break;
  }
  if (!results.length) results.push(...fallbackResults(html, category, key));
  return { key, results, diagnostics: { title: pageTitle(html), htmlBytes: Buffer.byteLength(html), boxTorrentCount: blocks.length, detailsCount: (html.match(/details\.php\?/gi) || []).length, keyPresent: Boolean(key) } };
}

async function searchNcore(q: string, category: string, page: number) {
  const cat = CATEGORIES[category] || CATEGORIES.all;
  const url = new URL(BASE + "/torrents.php");
  url.searchParams.set("miszerint", "seeders");
  url.searchParams.set("hogyan", "DESC");
  url.searchParams.set("tipus", "kivalasztottak_kozott");
  url.searchParams.set("mire", q);
  url.searchParams.set("kivalasztott_tipus", cat);
  url.searchParams.set("oldal", String(page));
  const response = await fetchNcore(url.toString());
  const html = await response.text();
  if (!response.ok) throw new Error(`ncore_http_${response.status}`);
  const problem = pageProblem(html, response.url);
  if (problem) throw new Error(problem);
  return { ...parseSearch(html, category), finalUrl: response.url };
}

async function probeNcore() {
  if (!ENABLED || !COOKIE) return { authenticated: false, error: "ncore_not_configured" };
  try {
    const response = await fetchNcore(BASE + "/torrents.php");
    const html = await response.text();
    if (!response.ok) return { authenticated: false, error: `ncore_http_${response.status}` };
    const problem = pageProblem(html, response.url);
    if (problem) return { authenticated: false, error: problem, title: pageTitle(html) };
    return { authenticated: true, title: pageTitle(html), keyPresent: Boolean(extractKey(html)) };
  } catch (err) {
    return { authenticated: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function currentDownloadKey() {
  if (RSS_KEY) return RSS_KEY;
  const response = await fetchNcore(BASE + "/torrents.php");
  const html = await response.text();
  if (!response.ok) throw new Error(`ncore_http_${response.status}`);
  const problem = pageProblem(html, response.url);
  if (problem) throw new Error(problem);
  const key = extractKey(html);
  if (!key) throw new Error("ncore_download_key_missing");
  return key;
}

async function torrentFile(id: string) {
  const key = await currentDownloadKey();
  const url = new URL(BASE + "/download.php");
  url.searchParams.set("id", id);
  url.searchParams.set("key", key);
  const response = await fetchNcore(url.toString());
  if (!response.ok) throw new Error(`ncore_download_http_${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const data = Buffer.from(await response.arrayBuffer());
  if (/text\/html/i.test(contentType) || data.subarray(0, 512).toString("utf8").includes("login.php")) throw new Error("ncore_session_expired");
  if (!data.length || data.length > 20 * 1024 * 1024) throw new Error("ncore_invalid_torrent_file");
  return data;
}

function cleanFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "ncore";
}

function statusForError(message: string) {
  if (message === "ncore_session_expired") return 401;
  if (message === "ncore_cloudflare_challenge") return 503;
  return 502;
}

function register(app: any) {
  if (app.__homehubNcoreRegistered) return;
  app.__homehubNcoreRegistered = true;

  app.get("/api/ncore/status", requireAdmin, async (_req: any, res: any) => {
    const configured = ENABLED && Boolean(COOKIE);
    if (!configured) return res.json({ enabled: ENABLED, configured: false, authenticated: false, baseUrl: BASE, categories: Object.keys(CATEGORIES), searchLimit: LIMIT });
    const probe = await probeNcore();
    res.json({ enabled: ENABLED, configured: true, ...probe, baseUrl: BASE, categories: Object.keys(CATEGORIES), searchLimit: LIMIT });
  });

  app.get("/api/ncore/search", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED || !COOKIE) return res.status(503).json({ error: "ncore_not_configured" });
    const q = String(req.query?.q || "").trim().slice(0, 120);
    const category = String(req.query?.category || "all");
    const page = Math.max(1, Math.min(5, Number(req.query?.page || 1) || 1));
    if (q.length < 2) return res.status(400).json({ error: "search_too_short" });
    try {
      const data = await searchNcore(q, category, page);
      res.json({ ok: true, query: q, category, page, results: data.results, downloadReady: Boolean(data.key), diagnostics: data.results.length ? undefined : data.diagnostics });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(statusForError(message)).json({ error: message });
    }
  });

  app.get("/api/ncore/torrent/:id", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED || !COOKIE) return res.status(503).json({ error: "ncore_not_configured" });
    const id = String(req.params?.id || "");
    if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: "invalid_torrent_id" });
    try {
      const data = await torrentFile(id);
      const filename = cleanFilename(String(req.query?.name || `ncore-${id}`)) + ".torrent";
      res.setHeader("Content-Type", "application/x-bittorrent");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Cache-Control", "no-store");
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(statusForError(message)).json({ error: message });
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
