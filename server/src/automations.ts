import crypto from "node:crypto";
import type { AutomationAction, AutomationRule, AutomationRuntime, AlertRecord, NetworkStatus } from "./types.js";
import { Store } from "./store.js";
import { TuyaService, type TuyaDevice } from "./tuya.js";
import { Mailer } from "./mailer.js";

const DEFAULT_TZ = "Europe/Budapest";
const normMac = (v: string) => v.trim().toLowerCase().replace(/-/g, ":");
const normText = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");

function fmtLocal(now: Date, timezone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    seconds: Number(get("second") || 0),
    weekday: dayMap[get("weekday")] ?? 0,
    minutes: Number(get("hour") || 0) * 60 + Number(get("minute") || 0)
  };
}

function hm(v: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return 0;
  return Math.max(0, Math.min(1439, Number(m[1]) * 60 + Number(m[2])));
}

function inWindow(nowMinutes: number, after: string, before: string) {
  const a = hm(after), b = hm(before);
  if (a === b) return true;
  return a < b ? nowMinutes >= a && nowMinutes < b : nowMinutes >= a || nowMinutes < b;
}

function specMeta(d: TuyaDevice, code: string) {
  const s = [...d.functions, ...d.statusSpec].find(x => x.code === code);
  try { return JSON.parse(s?.values || "{}") as Record<string, unknown>; } catch { return {} as Record<string, unknown>; }
}

function numericValue(d: TuyaDevice, code: string): number | null {
  const p = d.status.find(x => x.code === code);
  if (!p || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
  const meta = specMeta(d, code);
  const scale = Number(meta.scale || 0);
  let value = Number(p.value) / Math.pow(10, Number.isFinite(scale) ? scale : 0);
  if ((!scale || scale === 0) && /va_temperature/i.test(code) && Math.abs(value) > 100) value /= 10;
  return value;
}

function compareNumber(actual: number, op: "gt" | "gte" | "lt" | "lte" | "eq", expected: number) {
  if (op === "gt") return actual > expected;
  if (op === "gte") return actual >= expected;
  if (op === "lt") return actual < expected;
  if (op === "lte") return actual <= expected;
  return Math.abs(actual - expected) < 1e-7;
}

function compareState(actual: unknown, op: "eq" | "neq", expected: unknown) {
  let same: boolean;
  if (typeof actual === "string" || typeof expected === "string") same = normText(actual) === normText(expected);
  else same = actual === expected;
  return op === "eq" ? same : !same;
}

export class AutomationEngine {
  private ticking = false;
  constructor(
    private store: Store,
    private tuya: TuyaService,
    private mailer: Mailer,
    private queueVacuum: (action: "start" | "pause" | "stop" | "dock") => void,
    private generateAISummary: () => Promise<string>
  ) {}

  emailStatus() { return { configured: this.mailer.configured(), recipients: this.mailer.recipientsCount() }; }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.captureNewNetworkDevices();
      const rules = [...this.store.get().automations].filter(r => r.enabled);
      for (const rule of rules) {
        try { await this.evaluate(rule); }
        catch (err) { await this.logEngineError(rule, err); }
      }
    } finally { this.ticking = false; }
  }

  async runNow(rule: AutomationRule) {
    await this.execute(rule, { detail: "Kézi teszt / futtatás" });
  }

  private runtime(ruleId: string): AutomationRuntime {
    return this.store.get().automationRuntime[ruleId] || {};
  }

  private updateRuntime(ruleId: string, patch: Partial<AutomationRuntime>) {
    this.store.mutate(s => { s.automationRuntime[ruleId] = { ...(s.automationRuntime[ruleId] || {}), ...patch }; });
  }

  private cooldownOK(rule: AutomationRule, now: number) {
    if (!rule.lastTriggeredAt) return true;
    const last = new Date(rule.lastTriggeredAt).getTime();
    return !Number.isFinite(last) || now - last >= Math.max(0, rule.cooldownSeconds || 0) * 1000;
  }

  private async captureNewNetworkDevices() {
    const network = this.store.get().snapshot?.network || [];
    const current = [...new Set(network.map(n => normMac(n.mac)).filter(Boolean))];
    if (!current.length) return;
    const known = new Set(this.store.get().knownNetworkMacs.map(normMac));
    if (!known.size) {
      this.store.mutate(s => { s.knownNetworkMacs = current; });
      return;
    }
    const newcomers = network.filter(n => n.mac && !known.has(normMac(n.mac)));
    if (!newcomers.length) return;

    // Baseline is advanced before alerting so a mail failure cannot create an alert storm.
    this.store.mutate(s => {
      s.knownNetworkMacs = [...new Set([...s.knownNetworkMacs.map(normMac), ...current])].sort();
    });

    for (const rule of this.store.get().automations.filter(r => r.enabled && r.trigger.type === "network.new_device")) {
      if (!this.cooldownOK(rule, Date.now())) continue;
      const detail = newcomers.map(n => `${n.name || "Ismeretlen eszköz"} · ${n.ip || "IP?"} · ${normMac(n.mac)}`).join("\n");
      await this.execute(rule, { detail: `Új hálózati eszköz:\n${detail}`, network: newcomers });
    }
  }

  private async evaluate(rule: AutomationRule) {
    if (rule.trigger.type === "network.new_device") return; // handled as an edge event above
    const now = new Date();
    const nowMs = now.getTime();
    const rt = this.runtime(rule.id);

    if (rule.trigger.type === "schedule") {
      const local = fmtLocal(now, rule.trigger.timezone || DEFAULT_TZ);
      const days = rule.trigger.days?.length ? rule.trigger.days : [0,1,2,3,4,5,6];
      if (!days.includes(local.weekday) || local.time !== rule.trigger.time) return;
      const key = `${local.date}@${rule.trigger.time}`;
      if (rt.lastScheduleKey === key || !this.cooldownOK(rule, nowMs)) return;
      this.updateRuntime(rule.id, { lastScheduleKey: key });
      await this.execute(rule, { detail: `Ütemezés: ${local.date} ${local.time}` });
      return;
    }

    let active = false;
    let detail = "";
    const trigger = rule.trigger;
    if (trigger.type === "tuya.numeric") {
      const d = this.tuya.state().devices.find(x => x.id === trigger.deviceId);
      const value = d ? numericValue(d, trigger.code) : null;
      active = Boolean(d?.online && value !== null && compareNumber(value!, trigger.operator, trigger.value));
      detail = d ? `${d.name}: ${trigger.code} = ${value ?? "nincs adat"}` : `Tuya eszköz nem található: ${trigger.deviceId}`;
    } else if (trigger.type === "tuya.state") {
      const d = this.tuya.state().devices.find(x => x.id === trigger.deviceId);
      const p = d?.status.find(x => x.code === trigger.code);
      active = Boolean(d?.online && p && compareState(p.value, trigger.operator, trigger.value));
      detail = d ? `${d.name}: ${trigger.code} = ${String(p?.value ?? "nincs adat")}` : `Tuya eszköz nem található: ${trigger.deviceId}`;
    } else if (trigger.type === "network.online_window") {
      const n = (this.store.get().snapshot?.network || []).find(x => x.id === trigger.networkId);
      const local = fmtLocal(now, trigger.timezone || DEFAULT_TZ);
      active = Boolean(n?.online && inWindow(local.minutes, trigger.after, trigger.before));
      detail = n ? `${n.name} online (${n.ip || n.mac}) · időablak ${trigger.after}–${trigger.before}` : `Hálózati eszköz nem található: ${trigger.networkId}`;
    }

    if (!active) {
      if (rt.conditionSince || rt.latched) this.updateRuntime(rule.id, { conditionSince: undefined, latched: false });
      return;
    }
    if (rt.latched) return;
    const since = rt.conditionSince ? new Date(rt.conditionSince).getTime() : nowMs;
    if (!rt.conditionSince) this.updateRuntime(rule.id, { conditionSince: now.toISOString() });
    const forSeconds = "forSeconds" in trigger ? Math.max(0, Number(trigger.forSeconds || 0)) : 0;
    if (nowMs - since < forSeconds * 1000 || !this.cooldownOK(rule, nowMs)) return;
    this.updateRuntime(rule.id, { latched: true });
    await this.execute(rule, { detail });
  }

  private render(template: string, rule: AutomationRule, detail: string) {
    return template
      .replaceAll("{{rule}}", rule.name)
      .replaceAll("{{detail}}", detail)
      .replaceAll("{{time}}", new Date().toLocaleString("hu-HU", { timeZone: DEFAULT_TZ }));
  }

  private async execute(rule: AutomationRule, context: { detail: string; network?: NetworkStatus[] }) {
    const failures: string[] = [];
    for (const action of rule.actions) {
      try { await this.executeAction(rule, action, context.detail); }
      catch (err) { failures.push(`${action.type}: ${err instanceof Error ? err.message : String(err)}`); }
    }
    this.store.mutate(s => {
      const target = s.automations.find(x => x.id === rule.id);
      if (target) target.lastTriggeredAt = new Date().toISOString();
    });
    if (failures.length) await this.createAlert(rule, "HomeHub akcióhiba", `${context.detail}\n\n${failures.join("\n")}`, false);
  }

  private async executeAction(rule: AutomationRule, action: AutomationAction, detail: string) {
    if (action.type === "vacuum.command") {
      this.queueVacuum(action.action);
      return;
    }
    if (action.type === "tuya.command") {
      const d = this.tuya.state().devices.find(x => x.id === action.deviceId);
      if (!d) throw new Error("tuya_device_not_found");
      if (d.profile === "mygate" || /kapu|gate|garage|garázs|door|lock|zár/i.test(`${d.name} ${d.productName}`)) {
        throw new Error("gate_actions_are_blocked_in_automations");
      }
      await this.tuya.command(action.deviceId, action.code, action.value);
      return;
    }
    if (action.type === "ai.summary") {
      const subject = this.render(action.subject || "HomeHub AI összefoglaló", rule, detail);
      const message = await this.generateAISummary();
      await this.createAlert(rule, subject, message, action.email !== false);
      return;
    }
    if (action.type === "alert") {
      const subject = this.render(action.subject || rule.name, rule, detail);
      const message = this.render(action.message || "{{detail}}", rule, detail);
      await this.createAlert(rule, subject, message, action.email !== false);
    }
  }

  private async createAlert(rule: AutomationRule, subject: string, message: string, emailRequested: boolean) {
    const record: AlertRecord = {
      id: crypto.randomUUID(), ruleId: rule.id, ruleName: rule.name, subject, message,
      createdAt: new Date().toISOString(), emailRequested, emailSent: false
    };
    if (emailRequested) {
      try { await this.mailer.send(subject, `${message}\n\nHomeHub · ${new Date().toLocaleString("hu-HU", { timeZone: DEFAULT_TZ })}`); record.emailSent = true; }
      catch (err) { record.emailError = err instanceof Error ? err.message : String(err); }
    }
    this.store.mutate(s => { s.alerts.push(record); if (s.alerts.length > 200) s.alerts = s.alerts.slice(-200); });
  }

  private async logEngineError(rule: AutomationRule, err: unknown) {
    await this.createAlert(rule, "HomeHub automatizálási hiba", err instanceof Error ? err.message : String(err), false);
  }
}
