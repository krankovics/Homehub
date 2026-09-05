const CATEGORY_VALUES = {
  all: 'xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd,xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser,mp3_hun,mp3,lossless_hun,lossless,clip,game_iso,game_rip,console,iso,misc,mobil,ebook_hun,ebook',
  movies: 'xvid_hun,xvid,dvd_hun,dvd,dvd9_hun,dvd9,hd_hun,hd',
  tv: 'xvidser_hun,xvidser,dvdser_hun,dvdser,hdser_hun,hdser'
};

function categoryInfo(code) {
  const labels = {
    xvid_hun:'Film (HUN SD)',xvid:'Film (ENG SD)',dvd_hun:'Film (HUN DVD)',dvd:'Film (ENG DVD)',
    dvd9_hun:'Film (HUN DVD9)',dvd9:'Film (ENG DVD9)',hd_hun:'Film (HUN HD)',hd:'Film (ENG HD)',
    xvidser_hun:'Sorozat (HUN SD)',xvidser:'Sorozat (ENG SD)',dvdser_hun:'Sorozat (HUN DVD)',dvdser:'Sorozat (ENG DVD)',
    hdser_hun:'Sorozat (HUN HD)',hdser:'Sorozat (ENG HD)',mp3_hun:'Zene (HUN MP3)',mp3:'Zene (MP3)',
    lossless_hun:'Zene (HUN Lossless)',lossless:'Zene (Lossless)',clip:'Klip',game_iso:'Játék ISO',game_rip:'Játék RIP',
    console:'Konzol',iso:'Szoftver ISO',misc:'Szoftver',mobil:'Mobil',ebook_hun:'E-book HUN',ebook:'E-book'
  };
  let kind = 'all';
  if (code.includes('ser')) kind = 'tv';
  else if (/^(xvid|dvd|hd)/.test(code)) kind = 'movies';
  return { kind, label: labels[code] || code };
}

function text(el) {
  return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function normalizeDate(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') : s;
}

function detectPageError(body, finalUrl) {
  const head = body.slice(0, 20000).toLowerCase();
  if (/just a moment|attention required|cf-chl-|cloudflare/.test(head)) return 'ncore_cloudflare';
  if (/login\.php/i.test(finalUrl) || /name=["']nev["']/i.test(body)) return 'ncore_session_expired';
  return '';
}

async function searchNcore(payload) {
  const query = String(payload?.query || '').trim();
  const category = ['all','movies','tv'].includes(payload?.category) ? payload.category : 'all';
  const limit = Math.max(1, Math.min(50, Number(payload?.limit || 25)));
  if (query.length < 2) throw new Error('search_too_short');

  const url = new URL('/torrents.php', location.origin);
  url.searchParams.set('miszerint', 'seeders');
  url.searchParams.set('hogyan', 'DESC');
  url.searchParams.set('tipus', 'kivalasztottak_kozott');
  url.searchParams.set('mire', query);
  url.searchParams.set('miben', 'name');
  url.searchParams.set('kivalasztott_tipus', CATEGORY_VALUES[category] || CATEGORY_VALUES.all);
  url.searchParams.set('oldal', '1');

  const response = await fetch(url.toString(), {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ncore_http_${response.status}`);
  const pageError = detectPageError(body, response.url);
  if (pageError) throw new Error(pageError);

  const doc = new DOMParser().parseFromString(body, 'text/html');
  const results = [];
  const seen = new Set();
  for (const block of doc.querySelectorAll('.box_torrent')) {
    const anchor = block.querySelector('a[href*="action=details"][href*="id="]');
    if (!anchor) continue;
    const href = anchor.getAttribute('href') || '';
    const id = href.match(/[?&]id=(\d+)/)?.[1] || '';
    if (!id || seen.has(id)) continue;
    const title = anchor.getAttribute('title') || text(anchor);
    if (!title) continue;
    const categoryHref = block.querySelector('.box_alap_img a[href*="tipus="]')?.getAttribute('href') || '';
    const code = categoryHref.match(/[?&]tipus=([a-z0-9_]+)/i)?.[1] || '';
    const info = categoryInfo(code);
    results.push({
      id,
      title,
      size: text(block.querySelector('.box_meret2')),
      seeds: Number(text(block.querySelector('.box_s2'))) || 0,
      leech: Number(text(block.querySelector('.box_l2'))) || 0,
      category: info.kind,
      categoryLabel: info.label,
      uploadedAt: normalizeDate(text(block.querySelector('.box_feltoltve2'))),
      detailUrl: new URL(href, location.origin).href,
      downloadReady: true,
      source: 'browser-companion'
    });
    seen.add(id);
    if (results.length >= limit) break;
  }
  return { results };
}

async function getPasskey() {
  const response = await fetch('/index.php', { credentials: 'include', cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`ncore_http_${response.status}`);
  const pageError = detectPageError(body, response.url);
  if (pageError) throw new Error(pageError);
  const key = body.match(/rss\.php\?key=([a-z0-9]+)/i)?.[1] || '';
  if (!key) throw new Error('ncore_passkey_missing');
  return key;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function downloadTorrent(payload) {
  const id = String(payload?.id || '');
  if (!/^\d{1,12}$/.test(id)) throw new Error('invalid_torrent_id');
  const key = await getPasskey();
  const candidates = [
    `/rss_dl.php/id=${encodeURIComponent(id)}/key=${encodeURIComponent(key)}`,
    `/torrents.php?action=download&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`,
    `/download.php?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`
  ];

  let lastError = 'ncore_invalid_torrent_file';
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        headers: { Accept: 'application/x-bittorrent,application/octet-stream,*/*;q=0.5' }
      });
      const data = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get('content-type') || '';
      const head = new TextDecoder().decode(data.subarray(0, Math.min(1800, data.length))).toLowerCase();
      if (!response.ok) { lastError = `ncore_download_http_${response.status}`; continue; }
      if (/text\/html/i.test(type) || /cloudflare|just a moment|attention required|cf-chl-/.test(head)) {
        lastError = 'ncore_cloudflare';
        continue;
      }
      if (!data.length || data.length > 20 * 1024 * 1024 || data[0] !== 0x64) {
        lastError = 'ncore_invalid_torrent_file';
        continue;
      }
      return { base64: bytesToBase64(data) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'HOMEHUB_NCORE_EXECUTE') return;
  const command = message.command || {};
  (async () => {
    try {
      if (command.action === 'search') return { ok: true, result: await searchNcore(command.payload || {}) };
      if (command.action === 'download') return { ok: true, result: await downloadTorrent(command.payload || {}) };
      return { ok: false, error: 'ncore_browser_unknown_command' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })().then(sendResponse);
  return true;
});
