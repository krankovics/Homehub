(() => {
  const VERSION = "0.24.6";
  let authState = null;
  let authPromise = null;

  async function loadAuth(force = false) {
    if (authPromise && !force) return authPromise;
    authPromise = fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        authState = data;
        return data;
      })
      .catch(() => {
        authState = null;
        return null;
      })
      .finally(() => { authPromise = null; });
    return authPromise;
  }

  function user() {
    return authState?.authenticated ? authState.user : null;
  }

  function initial(name) {
    return String(name || "H").trim().slice(0, 1).toUpperCase() || "H";
  }

  function can(permission) {
    const u = user();
    return Boolean(u && (u.isAdmin || (u.permissions || []).includes(permission)));
  }

  async function logout() {
    const buttons = document.querySelectorAll("[data-hh-account-logout]");
    buttons.forEach((button) => { button.disabled = true; button.textContent = "Kilépés…"; });
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    const url = new URL("/", location.origin);
    url.searchParams.set("hhv", VERSION);
    location.replace(url.toString());
  }

  function navigate(tab) {
    closeSheet();
    location.hash = `#${tab}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  function closeSheet() {
    document.querySelector(".hhAccountBackV246")?.remove();
    document.body.classList.remove("hhAccountOpenV246");
  }

  function openSheet() {
    const u = user();
    if (!u) return;
    closeSheet();

    const back = document.createElement("div");
    back.className = "hhAccountBackV246";
    back.innerHTML = `
      <section class="hhAccountSheetV246" role="dialog" aria-modal="true" aria-label="Fiók">
        <div class="hhAccountHandleV246"></div>
        <div class="hhAccountSheetHeadV246">
          <div class="hhAccountAvatarV246"></div>
          <div class="hhAccountIdentityV246"><strong></strong><span></span></div>
          <button type="button" class="hhAccountCloseV246" aria-label="Bezárás">×</button>
        </div>
        <div class="hhAccountSheetBodyV246"></div>
        <div class="hhAccountSheetActionsV246"></div>
      </section>`;

    const avatar = back.querySelector(".hhAccountAvatarV246");
    const name = back.querySelector(".hhAccountIdentityV246 strong");
    const role = back.querySelector(".hhAccountIdentityV246 span");
    avatar.textContent = initial(u.name);
    name.textContent = u.name || "HomeHub felhasználó";
    role.textContent = u.isAdmin ? "Adminisztrátor" : "Személyes fiók";

    const body = back.querySelector(".hhAccountSheetBodyV246");
    const note = document.createElement("div");
    note.className = `hhAccountNoteV246 ${u.isAdmin ? "warn" : "good"}`;
    note.innerHTML = u.isAdmin
      ? "<b>Push értesítéshez személyes fiók kell.</b><span>Az iPhone push előfizetés egy konkrét személyhez kerül. Az Emberek oldalon kapcsold be a személyes belépést, majd jelentkezz be azzal.</span>"
      : "<b>Ez egy személyes fiók.</b><span>A push értesítés ezen a telefonon ehhez a személyhez rendelhető.</span>";
    body.appendChild(note);

    const actions = back.querySelector(".hhAccountSheetActionsV246");
    if (can("settings")) {
      const settings = document.createElement("button");
      settings.type = "button";
      settings.className = "hhAccountActionV246";
      settings.innerHTML = "<span>⚙</span><b>Beállítások</b><small>Push, rendszer és fiók</small>";
      settings.addEventListener("click", () => navigate("settings"));
      actions.appendChild(settings);
    }
    if (can("people")) {
      const people = document.createElement("button");
      people.type = "button";
      people.className = "hhAccountActionV246";
      people.innerHTML = "<span>◉</span><b>Emberek és hozzáférések</b><small>Személyes belépés kezelése</small>";
      people.addEventListener("click", () => navigate("people"));
      actions.appendChild(people);
    }

    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = "hhAccountLogoutV246";
    exit.dataset.hhAccountLogout = "1";
    exit.textContent = "Kilépés";
    exit.addEventListener("click", logout);
    actions.appendChild(exit);

    back.querySelector(".hhAccountCloseV246")?.addEventListener("click", closeSheet);
    back.addEventListener("click", (event) => { if (event.target === back) closeSheet(); });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key !== "Escape") return;
      document.removeEventListener("keydown", onKey);
      closeSheet();
    });

    document.body.appendChild(back);
    document.body.classList.add("hhAccountOpenV246");
  }

  function ensureHeaderButton() {
    const u = user();
    const actions = document.querySelector(".hhTopActions");
    if (!u || !actions || actions.querySelector(".hhMobileAccountV246")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hhMobileAccountV246";
    button.setAttribute("aria-label", `Fiók: ${u.name || "HomeHub"}`);
    button.title = u.name || "Fiók";
    button.textContent = initial(u.name);
    button.addEventListener("click", openSheet);
    const theme = actions.querySelector(".hhTheme");
    actions.insertBefore(button, theme || null);
  }

  function ensureSettingsCard() {
    const u = user();
    const pushPanel = document.querySelector(".pushSettingsV22");
    if (!u || !pushPanel || document.querySelector(".accountSettingsV246")) return;

    const card = document.createElement("section");
    card.className = "panel accountSettingsV246";
    card.innerHTML = `
      <div class="accountSettingsHeadV246">
        <div>
          <span class="smartEyebrowV12">FIÓK</span>
          <h2>Bejelentkezés</h2>
          <p>A mobilos fiókkezelés és a kilépés innen is elérhető.</p>
        </div>
      </div>
      <div class="accountSettingsIdentityV246">
        <div class="hhAccountAvatarV246"></div>
        <div><strong></strong><span></span></div>
      </div>
      <div class="accountSettingsNoteV246"></div>
      <div class="accountSettingsActionsV246"></div>`;

    card.querySelector(".hhAccountAvatarV246").textContent = initial(u.name);
    card.querySelector(".accountSettingsIdentityV246 strong").textContent = u.name || "HomeHub felhasználó";
    card.querySelector(".accountSettingsIdentityV246 span").textContent = u.isAdmin ? "Adminisztrátor" : "Személyes fiók";

    const note = card.querySelector(".accountSettingsNoteV246");
    note.textContent = u.isAdmin
      ? "Az admin technikai fiók. iPhone pushhoz jelentkezz be egy személyhez kötött HomeHub fiókkal."
      : "Ez a fiók személyhez kötött, ezért ezen az eszközön a push bekapcsolható hozzá.";
    note.classList.toggle("warn", Boolean(u.isAdmin));

    const actions = card.querySelector(".accountSettingsActionsV246");
    if (can("people")) {
      const people = document.createElement("button");
      people.type = "button";
      people.className = "ghost";
      people.textContent = u.isAdmin ? "Emberek és hozzáférések" : "Saját profil";
      people.addEventListener("click", () => navigate("people"));
      actions.appendChild(people);
    }
    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = "hhAccountLogoutV246";
    exit.dataset.hhAccountLogout = "1";
    exit.textContent = "Kilépés";
    exit.addEventListener("click", logout);
    actions.appendChild(exit);

    pushPanel.parentElement?.insertBefore(card, pushPanel);
  }

  function ensure() {
    ensureHeaderButton();
    ensureSettingsCard();
  }

  const observer = new MutationObserver(() => ensure());

  window.addEventListener("load", async () => {
    await loadAuth();
    ensure();
    observer.observe(document.body, { childList: true, subtree: true });
  }, { once: true });

  window.addEventListener("focus", async () => {
    await loadAuth(true);
    ensure();
  });

  window.HomeHubAccount = { version: VERSION, open: openSheet, logout };
})();
