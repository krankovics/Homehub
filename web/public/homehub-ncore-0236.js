(() => {
  let mounted = false;
  let mounting = false;
  let status = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('hu-HU', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  };

  async function json(url, options) {
    const r = await fetch(url, {credentials:'same-origin', cache:'no-store', ...options});
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {error:text || `HTTP ${r.status}`}; }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  function errorText(code) {
    if (code === 'ncore_passkey_missing') return 'Az nCore passkey nincs beállítva. Add meg Renderben az NCORE_PASSKEY változót.';
    if (code === 'ncore_finder_invalid_response') return 'Az RSS kereső most nem adott értelmezhető választ.';
    if (/^ncore_finder_http_/.test(code || '')) return `Az RSS kereső nem elérhető (${String(code).replace('ncore_finder_http_','HTTP ')}).`;
    if (code === 'ncore_download_cloudflare') return 'A keresés működik, de a .torrent letöltését az nCore Cloudflare blokkolta a Render felől. A következő lépésben ezt a KD20/WD helyi kapcsolaton adjuk át.';
    if (code === 'ncore_session_expired') return 'Az nCore letöltési hozzáférés elutasítva. Ellenőrizd a passkey-t.';
    if (code === 'ncore_invalid_torrent_file') return 'Az nCore nem érvényes .torrent fájlt adott vissza.';
    return code || 'Ismeretlen nCore hiba.';
  }

  function stateInfo() {
    if (!status?.configured) return {ok:false, label:'Passkey szükséges'};
    if (status?.mode === 'passkey-rss') return {ok:true, label:status?.finderOnline === false ? 'Passkey kész · RSS offline' : 'Passkey · RSS kész'};
    return {ok:true, label:'Kapcsolódás kész'};
  }

  function setupMarkup() {
    if (!status?.configured) {
      return `<div class="ncoreSetupV236"><div><strong>nCore passkey szükséges</strong><span>A böngészős Cookie helyett add meg Render Environmentben az <code>NCORE_PASSKEY</code> értéket. A HomeHub a keresést RSS-en végzi, így nem kell a Rendernek az nCore Cloudflare belépési ellenőrzését megkerülnie.</span></div></div>`;
    }
    return `<form class="ncoreSearchFormV236">
      <label class="ncoreSearchInputV236"><span>⌕</span><input name="q" autocomplete="off" placeholder="Keresés az nCore-on…" minlength="2" required></label>
      <select name="category" aria-label="Kategória">
        <option value="all">Minden</option>
        <option value="movies">Film</option>
        <option value="tv">Sorozat</option>
      </select>
      <button type="submit">Keresés</button>
    </form><div class="ncoreResultsV236"><div class="ncoreEmptyV236">Írj be legalább 2 karaktert.</div></div>`;
  }

  function panel() {
    const el = document.createElement('section');
    el.className = 'panel ncorePanelV236';
    const st = stateInfo();
    el.innerHTML = `<div class="ncoreHeadV236"><div><span class="smartEyebrowV12">TORRENT KERESŐ</span><h2>nCore keresés</h2><p>RSS-alapú keresés és közvetlen hozzáadás a KD20 Transmissionhöz.</p></div><span class="ncoreStateV236 ${st.ok?'ok':''}">${esc(st.label)}</span></div>${setupMarkup()}`;
    return el;
  }

  function resultsMarkup(items, diagnostics) {
    if (!items?.length) {
      const debug = diagnostics ? `<small class="ncoreDiagV237">RSS kategóriák: ${Number(diagnostics.categoriesOk || 0)}/${Number(diagnostics.categoriesTried || 0)} · RSS elemek: ${Number(diagnostics.rssItems || 0)}</small>` : '';
      return `<div class="ncoreEmptyV236">Nincs találat. Próbálj rövidebb vagy másik keresőkifejezést.${debug}</div>`;
    }
    return items.map(item => {
      const meta = [
        item.categoryLabel || '',
        dateText(item.uploadedAt),
        item.size || '',
        Number(item.seeds || 0) > 0 ? `↑ ${Number(item.seeds)} seeder` : '',
        Number(item.leech || 0) > 0 ? `↓ ${Number(item.leech)} leecher` : ''
      ].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
      return `<article class="ncoreResultV236" data-id="${esc(item.id)}" data-title="${esc(item.title)}">
        <div class="ncoreResultMainV236"><strong title="${esc(item.title)}">${esc(item.title)}</strong><div class="ncoreMetaV236">${meta}</div></div>
        <div class="ncoreResultActionsV236"><a href="${esc(item.detailUrl)}" target="_blank" rel="noopener noreferrer">Adatlap</a><button type="button" ${item.downloadReady?'':'disabled'}>Hozzáadás KD20-hoz</button></div>
      </article>`;
    }).join('');
  }

  async function addToKd20(article, button) {
    const id = article.dataset.id;
    const title = article.dataset.title || `ncore-${id}`;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Letöltés…';
    try {
      const r = await fetch(`/api/ncore/torrent/${encodeURIComponent(id)}?name=${encodeURIComponent(title)}`, {credentials:'same-origin', cache:'no-store'});
      if (!r.ok) {
        let message = `HTTP ${r.status}`;
        try { const j = await r.json(); message = errorText(j.error || message); } catch {}
        throw new Error(message);
      }
      const blob = await r.blob();
      const fd = new FormData();
      fd.append('torrent', new File([blob], `${title.replace(/[\\/:*?"<>|]+/g,'_').slice(0,150)}.torrent`, {type:'application/x-bittorrent'}));
      button.textContent = 'Küldés…';
      const upload = await fetch('/api/torrents/file', {method:'POST', body:fd, credentials:'same-origin'});
      if (!upload.ok) {
        let message = `HTTP ${upload.status}`;
        try { const j = await upload.json(); message = j.error || message; } catch {}
        throw new Error(message);
      }
      button.textContent = 'Hozzáadva';
      article.classList.add('added');
      setTimeout(() => window.dispatchEvent(new Event('focus')), 500);
    } catch (err) {
      button.disabled = false;
      button.textContent = original;
      alert(`nCore hiba: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function bind(el) {
    const form = el.querySelector('.ncoreSearchFormV236');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const q = String(form.elements.q.value || '').trim();
      const category = String(form.elements.category.value || 'all');
      const out = el.querySelector('.ncoreResultsV236');
      const submit = form.querySelector('button[type="submit"]');
      if (q.length < 2) return;
      submit.disabled = true;
      submit.textContent = 'Keresés…';
      out.innerHTML = '<div class="ncoreEmptyV236">Keresés folyamatban…</div>';
      try {
        const data = await json(`/api/ncore/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
        out.innerHTML = resultsMarkup(data.results || [], data.diagnostics);
        out.querySelectorAll('.ncoreResultV236').forEach(article => {
          const button = article.querySelector('button');
          if (button) button.addEventListener('click', () => addToKd20(article, button));
        });
      } catch (err) {
        out.innerHTML = `<div class="ncoreErrorV236">${esc(errorText(err instanceof Error ? err.message : String(err)))}</div>`;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Keresés';
      }
    });
  }

  function dedupe(downloads) {
    const panels = [...downloads.querySelectorAll('.ncorePanelV236')];
    if (panels.length <= 1) return panels[0] || null;
    const keep = panels.find(p => p.querySelector('input')?.value) || panels[0];
    panels.forEach(p => { if (p !== keep) p.remove(); });
    return keep;
  }

  async function ensure() {
    const downloads = document.querySelector('.torrentList')?.closest('.tabPanel');
    if (!downloads) { mounted = false; return; }
    const existing = dedupe(downloads);
    if (existing) { mounted = true; return; }
    if (mounting) return;
    mounting = true;
    try {
      status = await json('/api/ncore/status');
      const currentDownloads = document.querySelector('.torrentList')?.closest('.tabPanel');
      if (!currentDownloads) { mounted = false; return; }
      if (dedupe(currentDownloads)) { mounted = true; return; }
      const el = panel();
      const add = currentDownloads.querySelector('.panel.add');
      if (add) currentDownloads.insertBefore(el, add); else currentDownloads.prepend(el);
      bind(el);
      mounted = true;
    } catch {
      status = {configured:false};
      const currentDownloads = document.querySelector('.torrentList')?.closest('.tabPanel');
      if (currentDownloads && !dedupe(currentDownloads)) {
        const el = panel();
        const add = currentDownloads.querySelector('.panel.add');
        if (add) currentDownloads.insertBefore(el, add); else currentDownloads.prepend(el);
        bind(el);
        mounted = true;
      }
    } finally {
      mounting = false;
    }
  }

  let scheduled = false;
  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensure(); }, 60);
  };
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, {subtree:true, childList:true});
  setInterval(ensure, 2000);
  ensure();
})();
