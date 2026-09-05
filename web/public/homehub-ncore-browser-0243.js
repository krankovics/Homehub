(() => {
  const CHANNEL = 'homehub-ncore-companion-v1';
  let companionReady = false;
  let companionVersion = '';
  const pending = new Map();

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return String(v);
    return d.toLocaleString('hu-HU', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  };

  function errorText(code) {
    const map = {
      ncore_browser_tab_missing: 'Nyiss meg egy nCore fület a böngészőben, és jelentkezz be.',
      ncore_browser_tab_not_ready: 'Az nCore böngészőfül még nem áll készen. Frissítsd az nCore oldalt.',
      ncore_browser_extension_error: 'A HomeHub nCore Companion nem válaszolt.',
      ncore_browser_no_response: 'A HomeHub nCore Companion nem adott választ.',
      ncore_session_expired: 'Az nCore böngészős munkamenet lejárt. Jelentkezz be újra az nCore fülön.',
      ncore_cloudflare: 'Az nCore böngészőfülön Cloudflare ellenőrzés látható. Fejezd be azt a normál böngészőben, majd próbáld újra.',
      ncore_passkey_missing: 'Az nCore oldalról nem sikerült kiolvasni a torrent letöltési kulcsot.',
      ncore_invalid_torrent_file: 'Az nCore nem érvényes .torrent fájlt adott vissza.'
    };
    return map[code] || code || 'Ismeretlen nCore hiba.';
  }

  function ping() {
    window.postMessage({channel: CHANNEL, type:'ping'}, window.location.origin);
  }

  function request(action, payload, timeout = 35000) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('ncore_browser_timeout'));
      }, timeout);
      pending.set(id, {resolve, reject, timer});
      window.postMessage({channel: CHANNEL, type:'request', id, command:{action, payload}}, window.location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL) return;
    if (msg.type === 'ready') {
      companionReady = Boolean(msg.ready);
      companionVersion = String(msg.version || '');
      applyState();
      return;
    }
    if (msg.type === 'response' && msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      const payload = msg.payload || {};
      if (payload.ok) p.resolve(payload.result || {});
      else p.reject(new Error(payload.error || 'ncore_browser_no_response'));
    }
  });

  function applyState() {
    if (!companionReady) return;
    const panel = document.querySelector('.ncorePanelV236');
    if (!panel) return;
    const badge = panel.querySelector('.ncoreStateV236');
    if (badge) {
      badge.textContent = `Böngészős nCore${companionVersion ? ` ${companionVersion}` : ''} · teljes katalógus`;
      badge.classList.add('ok');
    }
    const desc = panel.querySelector('.ncoreHeadV236 p');
    if (desc) desc.textContent = 'A teljes nCore katalógus keresését a bejelentkezett Chrome/Edge nCore füled végzi. A Cookie nem kerül a HomeHubba.';
    const input = panel.querySelector('.ncoreSearchFormV236 input[name="q"]');
    if (input) input.placeholder = 'Keresés a teljes nCore katalógusban…';
    const initial = panel.querySelector('.ncoreResultsV236 .ncoreEmptyV236');
    if (initial && !panel.querySelector('.ncoreResultV236')) initial.textContent = 'Böngészős Companion aktív. A teljes nCore katalógus kereshető.';
  }

  function resultsMarkup(items) {
    if (!items?.length) return '<div class="ncoreEmptyV236">Nincs találat a teljes nCore katalógusban.</div>';
    return items.map(item => {
      const meta = [
        item.categoryLabel || '', dateText(item.uploadedAt), item.size || '',
        Number(item.seeds || 0) > 0 ? `↑ ${Number(item.seeds)} seeder` : '',
        Number(item.leech || 0) > 0 ? `↓ ${Number(item.leech)} leecher` : ''
      ].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
      return `<article class="ncoreResultV236" data-id="${esc(item.id)}" data-title="${esc(item.title)}" data-source="browser-companion">
        <div class="ncoreResultMainV236"><strong title="${esc(item.title)}">${esc(item.title)}</strong><div class="ncoreMetaV236">${meta}</div></div>
        <div class="ncoreResultActionsV236"><a href="${esc(item.detailUrl)}" target="_blank" rel="noopener noreferrer">Adatlap</a><button type="button">Hozzáadás KD20-hoz</button></div>
      </article>`;
    }).join('');
  }

  function base64ToBlob(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], {type:'application/x-bittorrent'});
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target?.closest?.('.ncoreSearchFormV236');
    if (!form || !companionReady) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const q = String(form.elements.q?.value || '').trim();
    const category = String(form.elements.category?.value || 'all');
    if (q.length < 2) return;
    const panel = form.closest('.ncorePanelV236');
    const out = panel?.querySelector('.ncoreResultsV236');
    const submit = form.querySelector('button[type="submit"]');
    if (!out || !submit) return;
    submit.disabled = true;
    submit.textContent = 'Keresés…';
    out.innerHTML = '<div class="ncoreEmptyV236">Keresés a bejelentkezett nCore böngészőfülön…</div>';
    try {
      const data = await request('search', {query:q, category, limit:25});
      out.innerHTML = resultsMarkup(data.results || []);
    } catch (err) {
      out.innerHTML = `<div class="ncoreErrorV236">${esc(errorText(err instanceof Error ? err.message : String(err)))}</div>`;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Keresés';
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('.ncoreResultV236[data-source="browser-companion"] button');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const article = button.closest('.ncoreResultV236');
    const id = article?.dataset.id || '';
    const title = article?.dataset.title || `ncore-${id}`;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Letöltés…';
    try {
      const data = await request('download', {id}, 45000);
      const blob = base64ToBlob(String(data.base64 || ''));
      const fd = new FormData();
      fd.append('torrent', new File([blob], `${title.replace(/[\\/:*?"<>|]+/g,'_').slice(0,150)}.torrent`, {type:'application/x-bittorrent'}));
      button.textContent = 'Küldés…';
      const upload = await fetch('/api/torrents/file', {method:'POST', body:fd, credentials:'same-origin'});
      if (!upload.ok) {
        let message = `HTTP ${upload.status}`;
        try { const body = await upload.json(); message = body.error || message; } catch {}
        throw new Error(message);
      }
      button.textContent = 'Hozzáadva';
      article.classList.add('added');
    } catch (err) {
      button.disabled = false;
      button.textContent = original;
      alert(`nCore hiba: ${errorText(err instanceof Error ? err.message : String(err))}`);
    }
  }, true);

  const observer = new MutationObserver(applyState);
  observer.observe(document.documentElement, {subtree:true, childList:true});
  setInterval(() => { ping(); applyState(); }, 2000);
  ping();
})();
