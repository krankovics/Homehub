const HH234 = (() => {
  let lastState = null;
  let timer = null;
  let applying = false;

  const truthy = (v) => {
    if (v === true || v === 1) return true;
    const s = String(v ?? '').trim().toLowerCase();
    return ['1','true','yes','on','charging','drive','driving'].includes(s);
  };
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tsMs = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(String(v || ''));
    return Number.isFinite(d) ? d : 0;
  };
  const ageLabel = (v) => {
    const t = tsMs(v);
    if (!t) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 45) return 'most';
    if (sec < 3600) return `${Math.round(sec/60)} perce`;
    if (sec < 86400) return `${Math.round(sec/3600)} órája`;
    return `${Math.round(sec/86400)} napja`;
  };
  const normalPlace = (loc) => String(loc?.name || loc?.shortAddress || loc?.address1 || '').trim();
  const isHomePlace = (loc) => /(^|\b)(otthon|home)(\b|$)/i.test(String(loc?.name || '').trim());
  const cleanNetworkSource = (source) => {
    const s = String(source || '').trim();
    if (!s) return 'hálózat';
    if (/ismeretlen hálózati eszköz/i.test(s)) return 'hálózat';
    return s;
  };
  const lifeByPerson = (state) => {
    const out = new Map();
    const life = state?.life360;
    if (!life?.online || !Array.isArray(life.members)) return out;
    for (const member of life.members) {
      const pid = life.mapping?.[member.id];
      if (pid) out.set(pid, member);
    }
    return out;
  };
  const lifeInfo = (member) => {
    const loc = member?.location || {};
    const battery = num(loc.battery);
    const rawSpeed = num(loc.speed);
    const speed = rawSpeed !== null && rawSpeed >= 0 ? rawSpeed : null;
    const driving = truthy(loc.isDriving);
    const transit = truthy(loc.inTransit);
    const charging = truthy(loc.charge);
    const place = normalPlace(loc);
    const accuracy = num(loc.accuracy);
    const stamp = loc.timestamp || loc.endTimestamp || loc.since;
    const stampMs = tsMs(stamp);
    const ageMs = stampMs ? Math.max(0, Date.now() - stampMs) : null;
    const freshEnough = ageMs === null || ageMs <= 15 * 60 * 1000;
    const moving = driving || transit || (speed !== null && speed > 0);
    const home = isHomePlace(loc) && !moving;
    const fresh = ageLabel(stamp);
    let state = 'Helyadat';
    if (driving) state = 'Vezet';
    else if (transit || (speed !== null && speed > 0)) state = 'Úton';
    else if (home) state = 'Otthon';
    else if (place) state = place;
    return {loc,battery,speed,driving,transit,charging,place,home,moving,accuracy,fresh,freshEnough,state};
  };
  const combined = (presence, member) => {
    if (!member) return {status: presence?.status || 'uncertain', confidence: presence?.confidence ?? 0, source: cleanNetworkSource(presence?.source || presence?.note || 'Nincs jelenléti adat')};
    const li = lifeInfo(member);
    const networkHome = presence?.status === 'home';
    const networkAway = presence?.status === 'away';
    const netSource = cleanNetworkSource(presence?.source);

    /* Movement wins over a stale Life360 place label such as "Otthon". */
    if (li.moving && li.freshEnough) {
      return {status:'away',confidence:networkHome?93:97,source:networkHome?`Life360 · ${li.state} · hálózat még online`:`Life360 · ${li.state}`,li};
    }
    if (li.moving) {
      return {status:networkHome?'uncertain':'away',confidence:networkHome?62:82,source:`Life360 · ${li.state} · régebbi helyadat`,li};
    }
    if (li.home && networkHome) return {status:'home',confidence:99,source:`Life360 + ${netSource}`,li};
    if (li.home) return {status:'home',confidence:96,source:'Life360 · Otthon',li};

    const knownAwayPlace = Boolean(li.place) && !li.home;
    if (knownAwayPlace && li.freshEnough && networkAway) return {status:'away',confidence:97,source:'Life360 + hálózat',li};
    if (knownAwayPlace && li.freshEnough && networkHome) return {status:'uncertain',confidence:70,source:'Eltérő jelek · Life360 / hálózat',li};
    if (knownAwayPlace && li.freshEnough) return {status:'away',confidence:91,source:`Life360 · ${li.state}`,li};

    return {status:presence?.status || 'uncertain',confidence:presence?.confidence ?? 70,source:presence?.source?`Life360 + ${netSource}`:'Life360',li};
  };
  const statusText = (s) => s === 'home' ? 'Itthon' : s === 'away' ? 'Nincs itthon' : 'Bizonytalan';

  function personLifeMarkup(member, combinedState) {
    const li = combinedState.li || lifeInfo(member);
    const chips = [];
    chips.push(`<span class="lifePillV234 lifeStateV234"><b>Life360</b>${esc(li.state)}</span>`);
    if (li.battery !== null) chips.push(`<span class="lifePillV234"><b>Akku</b>${Math.round(li.battery)}%${li.charging ? ' · töltőn' : ''}</span>`);
    if (li.fresh) chips.push(`<span class="lifePillV234"><b>Frissítve</b>${esc(li.fresh)}</span>`);
    if (li.accuracy !== null && li.accuracy >= 0) chips.push(`<span class="lifePillV234"><b>Pontosság</b>${Math.round(li.accuracy)} m</span>`);
    if (li.loc?.wifiState !== undefined && String(li.loc.wifiState) !== '') chips.push(`<span class="lifePillV234"><b>Wi-Fi</b>${truthy(li.loc.wifiState) ? 'kapcsolódva' : 'nincs'}</span>`);
    const headline = li.moving ? li.state : (li.place || li.state);
    return `<div class="life360PersonV234"><div class="life360HeadV234"><strong>${esc(headline)}</strong><small>${esc(combinedState.source)}</small></div><div class="life360PillsV234">${chips.join('')}</div></div>`;
  }

  function enhancePeople(state) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const presence = new Map((state?.presence || []).map((p) => [p.personId,p]));
    const members = lifeByPerson(state);
    const cards = document.querySelectorAll('.peopleGridV19 .personCardV19');
    cards.forEach((card, index) => {
      const person = people[index];
      if (!person) return;
      const member = members.get(person.id);
      const ps = presence.get(person.id);
      const c = combined(ps, member);
      const badge = card.querySelector('.presenceBadgeV19');
      if (badge) {
        badge.classList.remove('home','away','uncertain');
        badge.classList.add(c.status);
        badge.textContent = `${statusText(c.status)} · ${c.confidence}%`;
      }
      let box = card.querySelector('.life360PersonV234');
      if (!member) {
        if (box) box.remove();
        return;
      }
      const host = card.querySelector('.personMetaV19');
      if (!box && host) {
        host.insertAdjacentHTML('afterend', personLifeMarkup(member,c));
      } else if (box) {
        const wrap = document.createElement('div');
        wrap.innerHTML = personLifeMarkup(member,c);
        box.replaceWith(wrap.firstElementChild);
      }
      const note = card.querySelector('.personNoteV19');
      if (note && c.li) note.textContent = c.source;
    });
  }

  function enhancePresenceStrip(state) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const presence = new Map((state?.presence || []).map((p) => [p.personId,p]));
    const members = lifeByPerson(state);
    const combinedStates = [];
    document.querySelectorAll('.presencePeopleV19 .presencePersonV19').forEach((node,index) => {
      const person = people[index];
      if (!person) return;
      const c = combined(presence.get(person.id),members.get(person.id));
      combinedStates.push({person,c});
      node.classList.remove('home','away','uncertain');
      node.classList.add(c.status);
      const status = node.querySelector('span');
      const detail = node.querySelector('small');
      const icon = node.querySelector('i');
      if (status) status.textContent = statusText(c.status);
      if (detail) {
        const bits = [c.source];
        if (c.li?.battery !== null && c.li?.battery !== undefined) bits.push(`${Math.round(c.li.battery)}% akku`);
        if (c.li?.fresh) bits.push(c.li.fresh);
        detail.textContent = bits.filter(Boolean).join(' · ');
      }
      if (icon) icon.textContent = c.status === 'home' ? '✓' : c.status === 'away' ? '×' : '?';
    });
    return combinedStates;
  }

  function enhanceHero(state, combinedStates) {
    if (!combinedStates?.length) return;
    const first = document.querySelector('.hhStatusStrip button:first-child');
    if (!first) return;
    const home = combinedStates.filter((x) => x.c.status === 'home');
    const strong = first.querySelector('strong');
    const detail = first.querySelector('span');
    if (strong) strong.textContent = `${home.length} fő`;
    if (detail) detail.textContent = home.map((x) => x.person.nickname || x.person.name).slice(0,4).join(', ') || 'Nincs biztos jelenlét';
  }

  function fixSmartLabels() {
    document.querySelectorAll('.smartDevice.switch,.smartDevice.light').forEach((card) => {
      const stateBox = card.querySelector('.switchCardStateV12');
      const stateText = stateBox?.querySelector(':scope > span');
      if (stateText && !stateText.dataset.hh234) {
        stateText.dataset.hh234 = '1';
        stateText.innerHTML = `<small>Kapcsoló</small><strong>${esc(stateText.textContent || '')}</strong>`;
      }
    });
  }

  function apply(state) {
    if (applying || !state) return;
    applying = true;
    try {
      enhancePeople(state);
      const combinedStates = enhancePresenceStrip(state);
      enhanceHero(state, combinedStates);
      fixSmartLabels();
      document.documentElement.dataset.hh234 = 'ready';
    } finally { applying = false; }
  }

  async function refresh() {
    try {
      const r = await fetch('/api/state', {credentials:'same-origin', cache:'no-store'});
      if (!r.ok) return;
      lastState = await r.json();
      apply(lastState);
    } catch (_) {}
  }

  function scheduleApply() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; if (lastState) apply(lastState); }, 80);
  }

  function start() {
    refresh();
    setInterval(refresh, 3000);
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {subtree:true,childList:true});
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
  return {refresh};
})();
