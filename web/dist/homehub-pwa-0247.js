(() => {
  const VERSION = "0.24.9";
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
    if (!hasSW) return null;
    try {
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${VERSION}`, { updateViaCache: "none" });
      reg.update().catch(() => {});
      return reg;
    } catch (_) { return null; }
  }

  async function forceRefresh() {
    try { await clearCaches(); } catch (_) {}
    try {
      const reg = hasSW ? await navigator.serviceWorker.getRegistration() : null;
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg?.update().catch(() => {});
    } catch (_) {}
    location.replace(`/?hhv=${VERSION}`);
  }

  function row(ok, title, detail) {
    return `<div class="pushCheckV245 ${ok ? "ok" : "warn"}"><i>${ok ? "✓" : "!"}</i><div><b>${title}</b><span>${detail}</span></div></div>`;
  }

  function enhanceSettings() {
    const panel = document.querySelector(".pushSettingsV22");
    if (!panel || panel.querySelector(".pushGuideV245")) return false;
    const serverReady = [...panel.querySelectorAll(".statusBadge")].some(el => /szerver kész/i.test(el.textContent || ""));
    const subscribed = [...panel.querySelectorAll(".statusBadge")].some(el => /feliratkozott/i.test(el.textContent || ""));
    const permission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const guide = document.createElement("div");
    guide.className = "pushGuideV245";
    guide.innerHTML = `
      <div class="pushGuideHeadV245"><div><span class="smartEyebrowV12">WEB PUSH · iPHONE</span><h3>Push értesítések</h3><p>Az engedélykérés a Push bekapcsolása gombbal indul.</p></div><button type="button" class="ghost pushRefreshV245">Webapp frissítése</button></div>
      <div class="pushChecksV245">
        ${row(secure, "HTTPS", secure ? `Biztonságos kapcsolat · ${location.host}` : "HTTPS szükséges.")}
        ${row(hasSW, "Service Worker", hasSW ? "Támogatott." : "Nem támogatott.")}
        ${row(hasPush, "Push API", hasPush ? "Elérhető." : "Nem érhető el.")}
        ${row(!isIOS || isStandalone, "Home Screen webapp", !isIOS ? "Nem iOS eszköz." : isStandalone ? "Home Screen módban fut." : "Safari Megosztás → Főképernyőhöz adás szükséges.")}
        ${row(serverReady, "VAPID szerver", serverReady ? "A HomeHub push szervere kész." : "A VAPID szerver nem kész.")}
        ${row(subscribed && permission === "granted", "Ez az eszköz", subscribed ? "Push aktív ezen az eszközön." : permission === "denied" ? "Az értesítés tiltva van." : "Még nincs feliratkozva.")}
      </div>`;
    panel.appendChild(guide);
    guide.querySelector(".pushRefreshV245")?.addEventListener("click", forceRefresh);
    return true;
  }

  function stampVersion() {
    document.querySelectorAll(".systemInfo>div").forEach((card) => {
      const label = card.querySelector("span");
      if ((label?.textContent || "").trim() !== "HomeHub") return;
      const strong = card.querySelector("strong");
      if (strong) strong.textContent = `v${VERSION}`;
    });
  }

  window.HomeHubPWA = { version: VERSION, refresh: forceRefresh };
  window.addEventListener("load", () => {
    updateWorker();
    try { localStorage.setItem("homehub-build-version", VERSION); } catch (_) {}
    let count = 0;
    const timer = setInterval(() => {
      enhanceSettings();
      stampVersion();
      if (++count > 120) clearInterval(timer);
    }, 1000);
  }, { once: true });
})();
