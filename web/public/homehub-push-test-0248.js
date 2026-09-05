(() => {
  const VERSION = "0.24.8";
  let busy = false;

  async function json(url, options = {}) {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  function flash(message) {
    const toast = document.querySelector(".toast");
    if (toast) {
      toast.textContent = message;
      return;
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function sendTest(button) {
    if (busy) return;
    busy = true;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = "Teszt küldése…";
    let ruleId = "";
    try {
      const auth = await json("/api/auth/status");
      const user = auth?.user;
      if (!auth?.authenticated || !user?.personId) throw new Error("Személyes fiókkal kell belépni.");

      const status = await json("/api/notifications/status");
      if (!status?.pushConfigured) throw new Error("A push szerver nincs kész.");
      if (!status?.currentPersonPushSubscriptions) throw new Error("Ezen a személyen még nincs aktív push feliratkozás.");

      const rule = await json("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `Push teszt ${new Date().toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}`,
          enabled: false,
          trigger: { type: "schedule", time: "00:00", days: [0,1,2,3,4,5,6], timezone: "Europe/Budapest" },
          actions: [{ type: "alert", subject: "HomeHub teszt push", message: "Ha ezt az értesítést látod, az iPhone Web Push működik.", email: true }],
          cooldownSeconds: 0,
          notifyEmail: false,
          notification: {
            enabled: true,
            priority: "normal",
            recipientPersonIds: [user.personId],
            channels: ["push"],
            fallbackToAdmin: false
          }
        })
      });
      ruleId = rule?.id || "";
      if (!ruleId) throw new Error("A teszt automatizálás nem jött létre.");

      await json(`/api/automations/${encodeURIComponent(ruleId)}/run`, { method: "POST" });
      flash("Teszt push elküldve. Ha minden rendben, pár másodpercen belül meg kell érkeznie.");
    } catch (err) {
      flash(`Teszt push hiba: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (ruleId) {
        try { await json(`/api/automations/${encodeURIComponent(ruleId)}`, { method: "DELETE" }); } catch (_) {}
      }
      busy = false;
      button.disabled = false;
      button.textContent = old;
    }
  }

  function ensure() {
    const panel = document.querySelector(".pushSettingsV22");
    if (!panel || panel.querySelector(".hhPushTestV248")) return;
    const host = panel.querySelector(".pushActionsV22") || panel;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost hhPushTestV248";
    button.textContent = "Teszt push küldése";
    button.addEventListener("click", () => sendTest(button));
    host.appendChild(button);
  }

  window.addEventListener("load", ensure, { once: true });
  window.addEventListener("hashchange", () => setTimeout(ensure, 120));
  setInterval(ensure, 1800);
  window.HomeHubPushTest = { version: VERSION };
})();
