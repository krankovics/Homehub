(() => {
  let mounted = false;
  let mounting = false;
  let status = null;
  let statusRefreshBusy = false;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const dateText = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return String(v);
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
    if (code === 'ncore_disabled') return 'Az nCore integráció nincs bekapcsolva.';
    if (code === 'ncore_bridge_offline') return 'A WD HomeHub Bridge most nem érhető el. A teljes nCore keresés a helyi bridge-en fut.';
    if (code === 'ncore_bridge_credentials_missing') return 'A WD Credentials Vaultban még nincs ncore hozzáférés. Hozz létre egy ncore bejegyzést, és a Jelszó mezőbe mentsd a böngészőből kimásolt teljes nCore Cookie értéket.';
    if (code === 'ncore_bridge_timeout') return 'A WD Bridge nem válaszolt időben az nCore kérésre.';
    if (code === 'ncore_bridge_command_lost') return 'Az nCore kérés elveszett egy Render újraindulás miatt. Indítsd újra a keresést.';
    if (code === 'ncore_session_expired') return 'Az nCore munkamenet lejárt. Frissítsd a WD Vault ncore bejegyzésében a Cookie-t.';
    if (code === 'ncore_cloudflare') return 'Az nCore Cloudflare a WD Bridge HTTP kliensét blokkolja. A Cookie frissítése ezen nem segít; ha van passkey, a HomeHub automatikusan a friss RSS-re vált.';
    if (code === 'ncore_passkey_missing') return 'Az RSS tartalékhoz nincs NCORE_PASSKEY beállítva.';
    if (code === 'ncore_rss_cloudflare') return 'Az nCore RSS tartalékot Cloudflare blokkolta a Render felől.';
    if (code === 'ncore_rss_invalid_response') return 'Az nCore RSS tartalék most nem adott értelmezhető választ.';
    if (/^ncore_rss_http_/.test(code || '')) return `Az nCore RSS nem elérhető (${String(code).replace('ncore_rss_http_','HTTP ')}).`;
    if (code === 'ncore_download_cloudflare') return 'A régi Render-alapú torrent letöltést Cloudflare blokkolta. Használd a WD Bridge módot.';
    if (code === 'ncore_invalid_torrent_file') return 'Az nCore nem érvényes .torrent fájlt adott vissza.';
    if (/^kd20_add_failed/.test(code || '')) return `A torrent letöltődött, de a KD20 nem fogadta el: ${String(code).replace(/^kd20_add_failed:\s*/, '')}`;
    if (/^ncore_http_/.test(code || '')) return `Az nCore kapcsolat hibázott: ${code}`;
    return code || 'Ismeretlen nCore hiba.';
  }

  function stateInfo() {
    if (!status?.enabled) return {ok:false, label:'nCore kikapcsolva'};
    if (status?.bridgeSearchBlocked && status?.fallbackRss) return {ok:false, label:'WD Bridge blokkolva · RSS tartalék'};
    if (status?.bridgeSearchBlocked) return {ok:false, label:'WD Bridge · Cloudflare blokkolva'};
    if (status?.bridgeOnline && status?.bridgeConfigured) {
      const version = status?.bridgeVersion ? ` ${status.bridgeVersion}` : '';
      return {ok:true, label:`WD Bridge${version} · nCore kész`};
    }
    if (status?.bridgeOnline && !status?.bridgeConfigured) return {ok:false, label:'WD Bridge online · nCore Cookie kell'};
    if (status?.fallbackRss) return {ok:false, label:'WD Bridge offline · RSS tartalék'};
    return {ok:false, label:'WD Bridge offline'};
  }

  function setupMarkup() {
    if (!status?.enabled) {
      return `<div class="ncoreSetupV236"><div><strong>nCore integráció kikapcsolva</strong><span>Render Environmentben az <code>NCORE_ENABLED=true</code> kapcsolja be.</span></div></div>`;
    }
    const blocked = Boolean(status?.bridgeSearchBlocked);
    const placeholder = blocked ? 'Keresés a friss nCore RSS-ben…' : 'Keresés a teljes nCore katalógusban…';
    const helper = blocked
      ? 'A teljes katalógus HTML keresését Cloudflare blokkolja a WD Bridge felől. A HomeHub most automatikusan a passkey-alapú friss RSS-t használja.'
      : 'A teljes keresést a WD HomeHub Bridge végzi az otthoni kapcsolaton.';
    return `<form class="ncoreSearchFormV236">
      <label class="ncoreSearchInputV236"><span>⌕</span><input name="q" autocomplete="off" placeholder="${esc(placeholder)}" minlength="2" required></label>
      <select name="category" aria-label="Kategória">
        <option value="all">Minden</option>
        <option value="movies">Film</option>
        <option value="tv">Sorozat</option>
      </select>
      <button type="submit">Keresés</button>
    </form><div class="ncoreResultsV236"><div class="ncoreEmptyV236">${esc(helper)}</div></div>`;
  }

  function panel() {
    const el = document.createElement('section');
    el.className = 'panel ncorePanelV236';
    const st = stateInfo();
    const desc = status?.bridgeSearchBlocked
      ? 'A WD Bridge elérhető, de a Cloudflare blokkolja a HTML katalóguskeresést; ilyenkor a HomeHub automatikusan RSS tartalékra vált.'
      : 'Teljes katalógus keresése a WD Bridge-en, majd közvetlen hozzáadás a KD20 Transmissionhöz.';
    el.innerHTML = `<div class="ncoreHeadV236"><div><span class="smartEyebrowV12">TORRENT KERESŐ</span><h2>nCore keresés</h2><p>${esc(desc)}</p></div><span class="ncoreStateV236 ${st.ok?'ok':''}">${esc(st.label)}</span></div>${setupMarkup()}`;
    return el;
  }

  function resultsMarkup(items, diagnostics, mode) {
    if (!items?.length) {
      let detail = 'Nincs találat.';
      let debug = '';
      if (mode === 'direct-rss-fallback') {
        detail = diagnostics?.bridgeError === 'ncore_cloudflare'
          ? 'Nincs találat a friss nCore RSS-ben. A teljes katalógus keresését Cloudflare blokkolja a WD Bridge felől.'
          : 'Nincs találat a friss nCore RSS-ben. A teljes katalógushoz a WD Bridge-nek online és nCore Cookie-val konfiguráltnak kell lennie.';
      }
      if (diagnostics) {
        const bits = [];
        if (diagnostics.directRssItems !== undefined) bits.push(`nCore RSS elemek: ${Number(diagnostics.directRssItems || 0)}`);
        if (diagnostics.bridgeOnline !== undefined) bits.push(`WD Bridge: ${diagnostics.bridgeOnline ? 'online' : 'offline'}`);
        if (diagnostics.bridgeConfigured !== undefined) bits.push(`nCore Vault: ${diagnostics.bridgeConfigured ? 'kész' : 'nincs Cookie'}`);
        if (diagnostics.bridgeError === 'ncore_cloudflare') bits.push('teljes keresés: Cloudflare blokkolta');
        debug = `<small class="ncoreDiagV237">${bits.map(esc).join(' · ')}</small>`;
      }
      return `<div class="ncoreEmptyV236">${esc(detail)}${debug}</div>`;
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
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Küldés…';
    try {
      await json(`/api/ncore/add/${encodeURIComponent(id)}`, {method:'POST'});
      button.textContent = 'Hozzáadva';
      article.classList.add('added');
      setTimeout(() => window.dispatchEvent(new Event('focus')), 600);
    } catch (err) {
      button.disabled = false;
      button.textContent = original;
      alert(`nCore hiba: ${errorText(err instanceof Error ? err.message : String(err))}`);
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
      out.innerHTML = `<div class="ncoreEmptyV236">${status?.bridgeSearchBlocked ? 'Keresés a friss nCore RSS-ben…' : 'Keresés folyamatban a WD Bridge-en…'}</div>`;
      try {
        const data = await json(`/api/ncore/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
        out.innerHTML = resultsMarkup(data.results || [], data.diagnostics, data.mode);
        out.querySelectorAll('.ncoreResultV236').forEach(article => {
          const button = article.querySelector('button');
          if (button) button.addEventListener('click', () => addToKd20(article, button));
        });
        if (data.mode === 'direct-rss-fallback') refreshExisting(el);
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

  async function refreshExisting(el) {
    if (statusRefreshBusy) return;
    statusRefreshBusy = true;
    try {
      status = await json('/api/ncore/status');
      const st = stateInfo();
      const badge = el.querySelector('.ncoreStateV236');
      if (badge) {
        badge.textContent = st.label;
        badge.classList.toggle('ok', st.ok);
      }
    } catch {}
    finally { statusRefreshBusy = false; }
  }

  async function ensure() {
    const downloads = document.querySelector('.torrentList')?.closest('.tabPanel');
    if (!downloads) { mounted = false; return; }
    const existing = dedupe(downloads);
    if (existing) {
      mounted = true;
      refreshExisting(existing);
      return;
    }
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
      status = {enabled:false,configured:false};
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