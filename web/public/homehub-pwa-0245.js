(() => {
  const VERSION = "0.24.6";
  const BUILD_KEY = "homehub-build-version";
  const RELOAD_KEY = `homehub-reloaded-${VERSION}`;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  const secure = window.isSecureContext;
  const hasSW = "serviceWorker" in navigator;
  const hasPush = "PushManager" in window && typeof Notification !== "undefined";

  async function clearCaches() {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("homehub-")).map(k => caches.delete(k)));
  }

  async function updateWorker() {
    if (!hasSW) return;
    try {
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${VERSION}`, { updateViaCache: "none" });
      await reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (_) {}
  }

  async function forceRefresh() {
    try { await clearCaches(); } catch (_) {}
    try {
      const reg = hasSW ? await navigator.serviceWorker.getRegistration() : null;
      if (reg?.active) reg.active.postMessage({ type: "CLEAR_HOMEHUB_CACHES" });
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      await reg?.update();
    } catch (_) {}
    const url = new URL(location.href);
    url.searchParams.set("hhv", VERSION);
    location.replace(url.toString());
  }

  async function ensureFreshBuild() {
    const previous = localStorage.getItem(BUILD_KEY);
    await updateWorker();
    if (previous !== VERSION) {
      localStorage.setItem(BUILD_KEY, VERSION);
      try { await clearCaches(); } catch (_) {}
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        const url = new URL(location.href);
        if (url.searchParams.get("hhv") !== VERSION) {
          url.searchParams.set("hhv", VERSION);
          location.replace(url.toString());
          return;
        }
      }
    }
  }

  function row(ok, title, detail) {
    return `<div class="pushCheckV245 ${ok ? "ok" : "warn"}"><i>${ok ? "✓" : "!"}</i><div><b>${title}</b><span>${detail}</span></div></div>`;
  }

  function enhanceSettings() {
    const panel = document.querySelector(".pushSettingsV22");
    if (!panel || panel.querySelector(".pushGuideV245")) return;

    const serverReady = [...panel.querySelectorAll(".statusBadge")].some(el => /szerver kész/i.test(el.textContent || ""));
    const subscribed = [...panel.querySelectorAll(".statusBadge")].some(el => /feliratkozott/i.test(el.textContent || ""));
    const permission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";

    const guide = document.createElement("div");
    guide.className = "pushGuideV245";
    guide.innerHTML = `
      <div class="pushGuideHeadV245">
        <div>
          <span class="smartEyebrowV12">WEB PUSH · iPHONE</span>
          <h3>Push értesítések</h3>
          <p>Az engedélykérés csak a bekapcsoló gomb megnyomásakor indul. iPhone-on a Home Screenre telepített HTTPS webapp támogatott.</p>
        </div>
        <button type="button" class="ghost pushRefreshV245">Webapp frissítése</button>
      </div>
      <div class="pushChecksV245">
        ${row(secure, "HTTPS", secure ? `Biztonságos kapcsolat · ${location.host}` : "Ezen a címen a Web Push nem használható.")}
        ${row(hasSW, "Service Worker", hasSW ? "A böngésző támogatja." : "A böngésző nem támogatja.")}
        ${row(hasPush, "Push API", hasPush ? "A PushManager elérhető." : "Ezen a böngészőn nem érhető el.")}
        ${row(!isIOS || isStandalone, "Home Screen webapp", !isIOS ? "Nem iOS eszköz." : isStandalone ? "Home Screen módban fut." : "Safari Megosztás → Főképernyőhöz adás szükséges.")}
        ${row(serverReady, "VAPID szerver", serverReady ? "A HomeHub push szervere kész." : "A Renderen még be kell állítani a VAPID kulcsokat.")}
        ${row(subscribed && permission === "granted", "Ez az eszköz", subscribed ? "Push aktív ezen az eszközön." : permission === "denied" ? "Az értesítés tiltva van az iOS-ben." : "Még nincs feliratkozva.")}
      </div>
      ${!secure ? `<div class="pushCalloutV245">A helyi <code>http://192.168.1.180:8788</code> cím helyett a HTTPS HomeHub címet nyisd meg az iPhone-on.</div>` : ""}
      ${isIOS && !isStandalone ? `<div class="pushCalloutV245">iPhone-on előbb add a HomeHubot a Főképernyőhöz, majd onnan megnyitva nyomd meg a <b>Push bekapcsolása</b> gombot.</div>` : ""}
    `;
    panel.appendChild(guide);
    guide.querySelector(".pushRefreshV245")?.addEventListener("click", forceRefresh);
  }

  function stampVersion() {
    document.querySelectorAll(".systemInfo>div").forEach((card) => {
      const label = card.querySelector("span");
      if ((label?.textContent || "").trim() !== "HomeHub") return;
      const strong = card.querySelector("strong");
      if (strong) strong.textContent = `v${VERSION}`;
    });
  }

  const observer = new MutationObserver(() => {
    enhanceSettings();
    stampVersion();
  });

  window.HomeHubPWA = { version: VERSION, refresh: forceRefresh };
  window.addEventListener("load", () => {
    ensureFreshBuild();
    enhanceSettings();
    stampVersion();
    observer.observe(document.body, { subtree: true, childList: true });
  }, { once: true });

  navigator.serviceWorker?.addEventListener?.("controllerchange", () => {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
    location.reload();
  });
})();
