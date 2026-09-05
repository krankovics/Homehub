(() => {
  const VERSION = "0.24.9";
  const nativeFetch = window.fetch.bind(window);

  function timeoutFetch(input, init = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const external = init.signal;
    let externalAbort;
    if (external) {
      if (external.aborted) controller.abort();
      else {
        externalAbort = () => controller.abort();
        external.addEventListener("abort", externalAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return nativeFetch(input, { ...init, signal: controller.signal })
      .finally(() => {
        clearTimeout(timer);
        if (external && externalAbort) external.removeEventListener("abort", externalAbort);
      });
  }

  window.fetch = function homeHubFetch(input, init = {}) {
    let url = "";
    try { url = typeof input === "string" ? input : input?.url || ""; } catch (_) {}
    if (url.includes("/api/auth/status")) {
      return timeoutFetch(input, { ...init, cache: "no-store" }, 8000).catch(() => new Response(
        JSON.stringify({ authenticated: false, user: null, transient: true }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
      ));
    }
    return nativeFetch(input, init);
  };

  function recovery(message) {
    if (document.querySelector(".hhRecoveryV247")) return;
    const box = document.createElement("div");
    box.className = "hhRecoveryV247";
    box.innerHTML = `<b>HomeHub betöltési hiba</b><span>${message || "A kapcsolat megszakadt."}</span><button type="button">Újratöltés</button>`;
    box.querySelector("button")?.addEventListener("click", () => location.replace(`/?hhv=${VERSION}`));
    document.body.appendChild(box);
  }

  window.addEventListener("error", (event) => {
    const text = String(event?.error?.message || event?.message || "");
    if (text) console.error("HomeHub runtime", text);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const text = String(event?.reason?.message || event?.reason || "");
    if (text) console.error("HomeHub promise", text);
  });

  window.addEventListener("DOMContentLoaded", () => {
    const started = Date.now();
    const timer = setInterval(() => {
      const splash = document.querySelector(".splash");
      if (!splash) { clearInterval(timer); return; }
      if (Date.now() - started < 12000) return;
      clearInterval(timer);
      recovery("A bejelentkezési állapot nem érkezett meg. Próbáld újratölteni az alkalmazást.");
    }, 1000);
  }, { once: true });

  window.HomeHubStability = { version: VERSION };
})();
