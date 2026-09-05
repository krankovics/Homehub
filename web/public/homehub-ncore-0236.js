(() => {
  let mounted = false;
  let status = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function json(url, options) {
    const r = await fetch(url, {credentials:'same-origin', cache:'no-store', ...options});
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {error:text || `HTTP ${r.status}`}; }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  function setupMarkup() {
    if (!status?.configured) {
      return `<div class="ncoreSetupV236"><div><strong>nCore nincs konfigurálva</strong><span>A kereső használatához Render Environmentben add meg az <code>NCORE_COOKIE</code> változót. A hitelesítési adat nem jelenik meg a HomeHub felületén.</span></div></div>`;
    }
    return `<form class="ncoreSearchFormV236">
      <label class="ncoreSearchInputV236"><span>⌕</span><input name="q" autocomplete="off" placeholder="Keresés az nCore-on…" minlength="2" required></label>
      <select name="category" aria-label="Kategória">
        <option value="all">Minden</option>
        <option value="movies">Film</option>
        <option value="tv">Sorozat</option>
        <option value="music">Zene</option>
        <option value="games">Játék</option>
        <option value="software">Program</option>
        <option value="books">E-könyv</option>
      </select>
      <button type="submit">Keresés</button>
    </form><div class="ncoreResultsV236"><div class="ncoreEmptyV236">Írj be legalább 2 karaktert.</div></div>`;
  }

  function panel() {
    const el = document.createElement('section');
    el.className = 'panel ncorePanelV236';
    el.innerHTML = `<div class="ncoreHeadV236"><div><span class="smartEyebrowV12">TORRENT KERESŐ</span><h2>nCore keresés</h2><p>Találat keresése és közvetlen hozzáadás a KD20 Transmissionhöz.</p></div><span class="ncoreStateV236 ${status?.configured?'ok':''}">${status?.configured?'Kapcsolódás kész':'Nincs konfigurálva'}</span></div>${setupMarkup()}`;
    return el;
  }

  function resultsMarkup(items) {
    if (!items?.length) return `<div class="ncoreEmptyV236">Nincs találat.</div>`;
    return items.map(item => `<article class="ncoreResultV236" data-id="${esc(item.id)}" data-title="${esc(item.title)}">
      <div class="ncoreResultMainV236"><strong title="${esc(item.title)}">${esc(item.title)}</strong><div class="ncoreMetaV236"><span>${esc(item.size || '—')}</span><span>↑ ${Number(item.seeds||0)} seeder</span><span>↓ ${Number(item.leech||0)} leecher</span></div></div>
      <div class="ncoreResultActionsV236"><a href="${esc(item.detailUrl)}" target="_blank" rel="noopener noreferrer">Adatlap</a><button type="button" ${item.downloadReady?'':'disabled'}>Hozzáadás KD20-hoz</button></div>
    </article>`).join('');
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
        try { const j = await r.json(); message = j.error || message; } catch {}
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
    if (form) form.addEventListener('submit', async e => {
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
        out.innerHTML = resultsMarkup(data.results || []);
        out.querySelectorAll('.ncoreResultV236').forEach(article => {
          const button = article.querySelector('button');
          if (button) button.addEventListener('click', () => addToKd20(article, button));
        });
      } catch (err) {
        out.innerHTML = `<div class="ncoreErrorV236">${esc(err instanceof Error ? err.message : String(err))}</div>`;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Keresés';
      }
    });
  }

  async function ensure() {
    const downloads = document.querySelector('.torrentList')?.closest('.tabPanel');
    if (!downloads) { mounted = false; return; }
    if (downloads.querySelector('.ncorePanelV236')) { mounted = true; return; }
    try { status = await json('/api/ncore/status'); }
    catch { status = {configured:false}; }
    const el = panel();
    const add = downloads.querySelector('.panel.add');
    if (add) downloads.insertBefore(el, add); else downloads.prepend(el);
    bind(el);
    mounted = true;
  }

  const observer = new MutationObserver(() => { if (!mounted || !document.querySelector('.ncorePanelV236')) ensure(); });
  observer.observe(document.documentElement, {subtree:true, childList:true});
  setInterval(ensure, 1500);
  ensure();
})();
