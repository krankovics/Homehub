(() => {
  const VERSION = "0.24.7";
  let authState = null;
  let timer = null;

  async function loadAuth() {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" });
      authState = await res.json().catch(() => null);
    } catch (_) {
      authState = null;
    }
    return authState;
  }

  function user() { return authState?.authenticated ? authState.user : null; }
  function initial(name) { return String(name || "H").trim().slice(0,1).toUpperCase() || "H"; }
  function can(permission) { const u=user(); return Boolean(u && (u.isAdmin || (u.permissions || []).includes(permission))); }

  async function logout() {
    document.querySelectorAll("[data-hh-account-logout]").forEach((button) => {
      button.disabled = true;
      button.textContent = "Kilépés…";
    });
    try { await fetch("/api/auth/logout", { method:"POST", credentials:"same-origin" }); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    location.replace(`/?hhv=${VERSION}`);
  }

  function closeSheet() {
    document.querySelector(".hhAccountBackV246")?.remove();
    document.body.classList.remove("hhAccountOpenV246");
  }

  function navigate(tab) {
    closeSheet();
    if (location.hash === `#${tab}`) return;
    location.hash = `#${tab}`;
  }

  function openSheet() {
    const u = user();
    if (!u) return;
    closeSheet();
    const back = document.createElement("div");
    back.className = "hhAccountBackV246";
    back.innerHTML = `<section class="hhAccountSheetV246" role="dialog" aria-modal="true" aria-label="Fiók">
      <div class="hhAccountHandleV246"></div>
      <div class="hhAccountSheetHeadV246">
        <div class="hhAccountAvatarV246">${initial(u.name)}</div>
        <div class="hhAccountIdentityV246"><strong>${u.name || "HomeHub felhasználó"}</strong><span>${u.isAdmin ? "Adminisztrátor" : "Személyes fiók"}</span></div>
        <button type="button" class="hhAccountCloseV246" aria-label="Bezárás">×</button>
      </div>
      <div class="hhAccountSheetBodyV246">
        <div class="hhAccountNoteV246 ${u.isAdmin ? "warn" : "good"}">
          <b>${u.isAdmin ? "Push értesítéshez személyes fiók kell." : "Ez egy személyes fiók."}</b>
          <span>${u.isAdmin ? "Az iPhone push előfizetés egy konkrét személyhez kerül. Az Emberek oldalon kapcsold be a személyes belépést, majd jelentkezz be azzal." : "A push értesítés ezen a telefonon ehhez a személyhez rendelhető."}</span>
        </div>
      </div>
      <div class="hhAccountSheetActionsV246"></div>
    </section>`;
    const actions = back.querySelector(".hhAccountSheetActionsV246");
    if (can("settings")) {
      const b=document.createElement("button"); b.type="button"; b.className="hhAccountActionV246"; b.innerHTML="<span>⚙</span><b>Beállítások</b><small>Push, rendszer és fiók</small>"; b.onclick=()=>navigate("settings"); actions.appendChild(b);
    }
    if (can("people")) {
      const b=document.createElement("button"); b.type="button"; b.className="hhAccountActionV246"; b.innerHTML="<span>◉</span><b>Emberek és hozzáférések</b><small>Személyes belépés kezelése</small>"; b.onclick=()=>navigate("people"); actions.appendChild(b);
    }
    const exit=document.createElement("button"); exit.type="button"; exit.className="hhAccountLogoutV246"; exit.dataset.hhAccountLogout="1"; exit.textContent="Kilépés"; exit.onclick=logout; actions.appendChild(exit);
    back.querySelector(".hhAccountCloseV246").onclick=closeSheet;
    back.addEventListener("click", e=>{ if(e.target===back) closeSheet(); });
    document.body.appendChild(back);
    document.body.classList.add("hhAccountOpenV246");
  }

  function ensureHeaderButton() {
    const u=user();
    const actions=document.querySelector(".hhTopActions");
    if(!u || !actions || actions.querySelector(".hhMobileAccountV246")) return;
    const button=document.createElement("button");
    button.type="button";
    button.className="hhMobileAccountV246";
    button.setAttribute("aria-label",`Fiók: ${u.name || "HomeHub"}`);
    button.textContent=initial(u.name);
    button.onclick=openSheet;
    const theme=actions.querySelector(".hhTheme");
    actions.insertBefore(button,theme || null);
  }

  function ensureSettingsCard() {
    const u=user();
    const pushPanel=document.querySelector(".pushSettingsV22");
    if(!u || !pushPanel || document.querySelector(".accountSettingsV246")) return;
    const card=document.createElement("section");
    card.className="panel accountSettingsV246";
    card.innerHTML=`<div class="accountSettingsHeadV246"><div><span class="smartEyebrowV12">FIÓK</span><h2>Bejelentkezés</h2><p>A mobilos fiókkezelés és a kilépés innen is elérhető.</p></div></div>
      <div class="accountSettingsIdentityV246"><div class="hhAccountAvatarV246">${initial(u.name)}</div><div><strong>${u.name || "HomeHub felhasználó"}</strong><span>${u.isAdmin ? "Adminisztrátor" : "Személyes fiók"}</span></div></div>
      <div class="accountSettingsNoteV246 ${u.isAdmin ? "warn" : ""}">${u.isAdmin ? "Az admin technikai fiók. iPhone pushhoz jelentkezz be egy személyhez kötött HomeHub fiókkal." : "Ez a fiók személyhez kötött, ezért ezen az eszközön a push bekapcsolható hozzá."}</div>
      <div class="accountSettingsActionsV246"></div>`;
    const actions=card.querySelector(".accountSettingsActionsV246");
    if(can("people")){const b=document.createElement("button");b.type="button";b.className="ghost";b.textContent=u.isAdmin?"Emberek és hozzáférések":"Saját profil";b.onclick=()=>navigate("people");actions.appendChild(b);}
    const exit=document.createElement("button");exit.type="button";exit.className="hhAccountLogoutV246";exit.dataset.hhAccountLogout="1";exit.textContent="Kilépés";exit.onclick=logout;actions.appendChild(exit);
    pushPanel.parentElement?.insertBefore(card,pushPanel);
  }

  async function refresh() {
    await loadAuth();
    ensureHeaderButton();
    ensureSettingsCard();
  }

  window.addEventListener("load", () => {
    refresh();
    timer=setInterval(() => { ensureHeaderButton(); ensureSettingsCard(); }, 1500);
    setTimeout(() => { if(timer) clearInterval(timer); timer=null; }, 120000);
  }, { once:true });
  window.addEventListener("focus", refresh);
  window.addEventListener("hashchange", () => setTimeout(ensureSettingsCard, 250));
  window.HomeHubAccount={version:VERSION,open:openSheet,logout};
})();
