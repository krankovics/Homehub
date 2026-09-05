import crypto from "node:crypto";
import express from "express";

const BASE = String(process.env.NCORE_BASE_URL || "https://ncore.pro").replace(/\/+$/, "");
const FINDER = String(process.env.NCORE_FINDER_URL || "https://finderss.it.cx/").trim();
const PASSKEY = String(process.env.NCORE_PASSKEY || process.env.NCORE_RSS_KEY || "").trim();
const ENABLED = String(process.env.NCORE_ENABLED || (PASSKEY ? "true" : "false")).toLowerCase() === "true";
const LIMIT = Math.max(1, Math.min(50, Number(process.env.NCORE_SEARCH_LIMIT || 25)));
const TIMEOUT_MS = Math.max(5000, Math.min(45000, Number(process.env.NCORE_TIMEOUT_MS || 20000)));
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const SESSION_COOKIE = "homehub_session";

const CATEGORY_GROUPS: Record<string, string[]> = {
  all: [
    "Film (HUN SD)", "Film (HUN DVD9)", "Film (HUN DVD)", "Film (ENG HD)",
    "Film (HUN HD)", "Film (ENG DVD9)", "Film (ENG SD)", "Sorozat (ENG DVD)",
    "Sorozat (ENG XviD)", "Sorozat (ENG HD)", "Sorozat (ENG SD)", "Sorozat (HUN SD)"
  ],
  movies: [
    "Film (HUN SD)", "Film (HUN DVD9)", "Film (HUN DVD)", "Film (ENG HD)",
    "Film (HUN HD)", "Film (ENG DVD9)", "Film (ENG SD)"
  ],
  tv: [
    "Sorozat (ENG DVD)", "Sorozat (ENG XviD)", "Sorozat (ENG HD)",
    "Sorozat (ENG SD)", "Sorozat (HUN SD)"
  ]
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

function directRssUrl() {
  const url = new URL(BASE + "/rss.php");
  url.searchParams.set("key", PASSKEY);
  return url.toString();
}

async function fetchDirectRss() {
  const response = await fetch(directRssUrl(), {
    headers: {
      "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 HomeHub/0.23.9",
      "accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": "hu-HU,hu;q=0.9,en;q=0.7",
      "cache-control": "no-cache"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ncore_rss_http_${response.status}`);
  const head = body.slice(0, 12000);
  if (/just a moment|attention required|cf-chl-|cloudflare/i.test(head)) throw new Error("ncore_rss_cloudflare");
  if (/login\.php|name\s*=\s*["']nev["']/i.test(head)) throw new Error("ncore_passkey_invalid");
  if (!/<(?:rss|feed)\b/i.test(body) && !/<item\b/i.test(body) && !/rss_dl\.php\/id=/i.test(body)) {
    throw new Error("ncore_rss_invalid_response");
  }
  return body;
}

function finderUrl(query: string, category: string) {
  const sep = FINDER.includes("?") ? "&" : "?";
  return `${FINDER}${sep}&s=${encodeURIComponent(query)}&cat=${encodeURIComponent(category)},`;
}

async function fetchFinder(query: string, category: string) {
  const response = await fetch(finderUrl(query, category), {
    headers: {
      "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 HomeHub/0.23.9",
      "accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": "hu-HU,hu;q=0.9,en;q=0.7",
      "cache-control": "no-cache"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ncore_finder_http_${response.status}`);
  if (!/<(?:rss|feed)\b/i.test(body) && !/<item\b/i.test(body)) throw new Error("ncore_finder_invalid_response");
  return body;
}

type NcoreResult = {
  id: string;
  title: string;
  size: string;
  seeds: number;
  leech: number;
  category: string;
  categoryLabel: string;
  uploadedAt: string;
  detailUrl: string;
  downloadReady: boolean;
  source: string;
};

function itemId(block: string) {
  const decoded = decodeXml(block);
  return decoded.match(/rss_dl\.php\/id=(\d+)/i)?.[1]
    || decoded.match(/(?:details|download)\.php\?[^\s"'<>]*[?&]id=(\d+)/i)?.[1]
    || decoded.match(/[?&]id=(\d+)/i)?.[1]
    || "";
}

function categoryKind(label: string) {
  return /^Sorozat/i.test(label) ? "tv" : /^Film/i.test(label) ? "movies" : "all";
}

function parseRssItems(xml: string, source: string, requestedCategory = ""): NcoreResult[] {
  const results: NcoreResult[] = [];
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const match of items) {
    const block = match[1] || "";
    const title = cleanText(xmlValue(block, "title"));
    const categoryLabel = cleanText(xmlValue(block, "category")) || requestedCategory;
    const uploadedAt = cleanText(xmlValue(block, "pubDate"));
    const id = itemId(block);
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
      detailUrl: `${BASE}/details.php?id=${encodeURIComponent(id)}`,
      downloadReady: Boolean(PASSKEY),
      source
    });
  }
  return results;
}

async function searchViaDirectRss(query: string, category: string) {
  const xml = await fetchDirectRss();
  const all = parseRssItems(xml, "ncore-rss");
  const results = all.filter((item) => queryMatches(item.title, query) && (category === "all" || item.category === category)).slice(0, LIMIT);
  return { results, totalItems: all.length };
}

async function searchViaFinder(query: string, category: string) {
  const categories = CATEGORY_GROUPS[category] || CATEGORY_GROUPS.all;
  const combined: NcoreResult[] = [];
  const errors: string[] = [];
  let categoriesOk = 0;
  let rssItems = 0;

  for (let i = 0; i < categories.length; i += 4) {
    const batch = categories.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map(async (cat) => {
      const xml = await fetchFinder(query, cat);
      return parseRssItems(xml, "ncore-finder", cat);
    }));
    settled.forEach((entry) => {
      if (entry.status === "fulfilled") {
        categoriesOk += 1;
        rssItems += entry.value.length;
        combined.push(...entry.value);
      } else {
        const reason = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
        if (reason && !errors.includes(reason)) errors.push(reason);
      }
    });
    if (combined.length >= LIMIT * 2) break;
  }

  const seen = new Set<string>();
  const results: NcoreResult[] = [];
  for (const item of combined) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    results.push(item);
    if (results.length >= LIMIT) break;
  }
  return { results, categoriesTried: categories.length, categoriesOk, rssItems, errors: errors.slice(0, 3) };
}

async function searchNcore(query: string, category: string) {
  let directError = "";
  try {
    const direct = await searchViaDirectRss(query, category);
    if (direct.results.length) {
      return {
        results: direct.results,
        diagnostics: { mode: "direct-rss", directRssItems: direct.totalItems, finderTried: false }
      };
    }
    // The personal nCore RSS feed contains only a recent slice. If the query is
    // not in that slice, try the external finder as a secondary source.
    const finder = await searchViaFinder(query, category);
    return {
      results: finder.results,
      diagnostics: {
        mode: "direct-rss+finder",
        directRssItems: direct.totalItems,
        categoriesTried: finder.categoriesTried,
        categoriesOk: finder.categoriesOk,
        rssItems: finder.rssItems,
        finderErrors: finder.errors
      }
    };
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
  }

  const finder = await searchViaFinder(query, category);
  return {
    results: finder.results,
    diagnostics: {
      mode: "finder-fallback",
      directRssError: directError,
      categoriesTried: finder.categoriesTried,
      categoriesOk: finder.categoriesOk,
      rssItems: finder.rssItems,
      finderErrors: finder.errors
    }
  };
}

async function probeSources() {
  let rssOnline = false;
  let rssItems = 0;
  let rssError = "";
  try {
    const xml = await fetchDirectRss();
    rssOnline = true;
    rssItems = parseRssItems(xml, "ncore-rss").length;
  } catch (err) {
    rssError = err instanceof Error ? err.message : String(err);
  }

  let finderOnline = false;
  let finderStatus = 0;
  try {
    const response = await fetch(FINDER, {
      headers: { "user-agent": "Mozilla/5.0 HomeHub/0.23.9", "accept": "text/html,application/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, 10000))
    });
    finderOnline = response.ok;
    finderStatus = response.status;
  } catch {}

  return { rssOnline, rssItems, rssError, finderOnline, finderStatus };
}

async function torrentFile(id: string) {
  if (!PASSKEY) throw new Error("ncore_passkey_missing");

  const candidates = [
    `${BASE}/rss_dl.php/id=${encodeURIComponent(id)}/key=${encodeURIComponent(PASSKEY)}`,
    `${BASE}/download.php?id=${encodeURIComponent(id)}&key=${encodeURIComponent(PASSKEY)}`
  ];
  let lastError = "ncore_download_failed";

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": process.env.NCORE_USER_AGENT || "Mozilla/5.0 HomeHub/0.23.9",
          "accept": "application/x-bittorrent,application/octet-stream,*/*;q=0.5"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const contentType = response.headers.get("content-type") || "";
      const data = Buffer.from(await response.arrayBuffer());
      const head = data.subarray(0, 1500).toString("utf8");
      if (!response.ok) { lastError = `ncore_download_http_${response.status}`; continue; }
      if (/text\/html/i.test(contentType) || /just a moment|attention required|cf-chl-|cloudflare/i.test(head)) {
        lastError = "ncore_download_cloudflare";
        continue;
      }
      if (/login\.php|name\s*=\s*["']nev["']/i.test(head)) {
        lastError = "ncore_passkey_invalid";
        continue;
      }
      if (!data.length || data.length > 20 * 1024 * 1024) {
        lastError = "ncore_invalid_torrent_file";
        continue;
      }
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

function cleanFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "ncore";
}

function register(app: any) {
  if (app.__homehubNcoreRegistered) return;
  app.__homehubNcoreRegistered = true;

  app.get("/api/ncore/status", requireAdmin, async (_req: any, res: any) => {
    const configured = ENABLED && Boolean(PASSKEY);
    const sources = configured ? await probeSources() : { rssOnline: false, rssItems: 0, rssError: "ncore_passkey_missing", finderOnline: false, finderStatus: 0 };
    res.json({
      enabled: ENABLED,
      configured,
      authenticated: configured,
      mode: configured ? "passkey-rss" : "unconfigured",
      baseUrl: BASE,
      finderUrl: FINDER,
      categories: Object.keys(CATEGORY_GROUPS),
      searchLimit: LIMIT,
      ...sources
    });
  });

  app.get("/api/ncore/search", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED || !PASSKEY) return res.status(503).json({ error: "ncore_passkey_missing" });
    const q = String(req.query?.q || "").trim().slice(0, 120);
    const category = String(req.query?.category || "all");
    if (q.length < 2) return res.status(400).json({ error: "search_too_short" });
    try {
      const data = await searchNcore(q, category);
      res.json({ ok: true, query: q, category, results: data.results, downloadReady: true, diagnostics: data.results.length ? undefined : data.diagnostics, mode: "passkey-rss" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  app.get("/api/ncore/torrent/:id", requireAdmin, async (req: any, res: any) => {
    if (!ENABLED || !PASSKEY) return res.status(503).json({ error: "ncore_passkey_missing" });
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
      const status = message === "ncore_download_cloudflare" ? 503 : message === "ncore_passkey_invalid" ? 401 : 502;
      res.status(status).json({ error: message });
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
