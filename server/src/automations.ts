import crypto from "node:crypto";
import type { AutomationAction, AutomationNotificationPlan, AutomationRule, AutomationRuntime, AutomationTrigger, AlertRecord, NetworkStatus, NotificationChannel } from "./types.js";
import { Store } from "./store.js";
import { TuyaService, type TuyaDevice } from "./tuya.js";
import { Mailer } from "./mailer.js";
import { NotificationRouter } from "./notifier.js";
import { pushHistory } from "./history.js";

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
    weekday: dayMap[get("weekday")] ?? 0,
    minutes: Number(get("hour") || 0) * 60 + Number(get("minute") || 0)
  };
}
function hm(v: string) { const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim()); return m ? Math.max(0, Math.min(1439, Number(m[1]) * 60 + Number(m[2]))) : 0; }
function inWindow(nowMinutes: number, after: string, before: string) { const a = hm(after), b = hm(before); return a === b ? true : a < b ? nowMinutes >= a && nowMinutes < b : nowMinutes >= a || nowMinutes < b; }
function specMeta(d: TuyaDevice, code: string) { const s = [...d.functions, ...d.statusSpec].find(x => x.code === code); try { return JSON.parse(s?.values || "{}") as Record<string, unknown>; } catch { return {}; } }
function numericValue(d: TuyaDevice, code: string): number | null {
  const p = d.status.find(x => x.code === code); if (!p || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
  const meta = specMeta(d, code); const scale = Number(meta.scale || 0); let value = Number(p.value) / Math.pow(10, Number.isFinite(scale) ? scale : 0);
  if ((!scale || scale === 0) && /va_temperature/i.test(code) && Math.abs(value) > 100) value /= 10; return value;
}
function compareNumber(actual: number, op: "gt" | "gte" | "lt" | "lte" | "eq", expected: number) { if (op === "gt") return actual > expected; if (op === "gte") return actual >= expected; if (op === "lt") return actual < expected; if (op === "lte") return actual <= expected; return Math.abs(actual - expected) < 1e-7; }
function compareState(actual: unknown, op: "eq" | "neq", expected: unknown) { const same = (typeof actual === "string" || typeof expected === "string") ? normText(actual) === normText(expected) : actual === expected; return op === "eq" ? same : !same; }
function operatorLabel(operator: string) { return ({ gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠" } as Record<string,string>)[operator] || operator; }

export class AutomationEngine {
  private ticking = false;
  constructor(
    private store: Store,
    private tuya: TuyaService,
    private mailer: Mailer,
    private notifier: NotificationRouter,
    private queueVacuum: (action: "start" | "pause" | "stop" | "dock") => void,
    private generateAISummary: () => Promise<string>
  ) {}

  emailStatus() { return { configured: this.mailer.configured(), recipients: this.mailer.recipientsCount() }; }
  notificationStatus() { return this.notifier.status(); }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.captureNewNetworkDevices();
      for (const rule of [...this.store.get().automations].filter(r => r.enabled)) {
        try { await this.evaluate(rule); } catch (err) { await this.logEngineError(rule, err); }
      }
    } finally { this.ticking = false; }
  }

  async runNow(rule: AutomationRule) { await this.execute(rule, { detail: "Kézi teszt / futtatás" }); }
  private runtime(ruleId: string): AutomationRuntime { return this.store.get().automationRuntime[ruleId] || {}; }
  private updateRuntime(ruleId: string, patch: Partial<AutomationRuntime>) { this.store.mutate(s => { s.automationRuntime[ruleId] = { ...(s.automationRuntime[ruleId] || {}), ...patch }; }); }
  private cooldownOK(rule: AutomationRule, now: number) { if (!rule.lastTriggeredAt) return true; const last = new Date(rule.lastTriggeredAt).getTime(); return !Number.isFinite(last) || now - last >= Math.max(0, rule.cooldownSeconds || 0) * 1000; }

  private legacyPlan(rule: AutomationRule, emailRequested = true): AutomationNotificationPlan | undefined {
    if (rule.notification) return rule.notification;
    if (rule.notifyEmail === false || !emailRequested) return { enabled: false, priority: "normal", recipientPersonIds: [], channels: [] };
    return { enabled: true, priority: "normal", recipientPersonIds: [], channels: ["email"], fallbackToAdmin: true };
  }

  private async captureNewNetworkDevices() {
    const network = this.store.get().snapshot?.network || [];
    const current = [...new Set(network.map(n => normMac(n.mac)).filter(Boolean))];
    if (!current.length) return;
    const known = new Set(this.store.get().knownNetworkMacs.map(normMac));
    if (!known.size) { this.store.mutate(s => { s.knownNetworkMacs = current; }); return; }
    const newcomers = network.filter(n => n.mac && !known.has(normMac(n.mac)));
    if (!newcomers.length) return;
    this.store.mutate(s => { s.knownNetworkMacs = [...new Set([...s.knownNetworkMacs.map(normMac), ...current])].sort(); });
    for (const rule of this.store.get().automations.filter(r => r.enabled && r.trigger.type === "network.new_device")) {
      if (!this.cooldownOK(rule, Date.now())) continue;
      const detail = newcomers.map(n => `${n.name || "Ismeretlen eszköz"} · ${n.ip || "IP?"} · ${normMac(n.mac)}`).join("\n");
      await this.execute(rule, { detail: `Új hálózati eszköz:\n${detail}`, network: newcomers });
    }
  }

  private evaluateCondition(trigger: AutomationTrigger, now: Date): { active: boolean; detail: string; forSeconds: number } {
    const nowMs = now.getTime();
    if (trigger.type === "tuya.numeric") {
      const d = this.tuya.state().devices.find(x => x.id === trigger.deviceId), value = d ? numericValue(d, trigger.code) : null;
      return { active: Boolean(d?.online && value !== null && compareNumber(value!, trigger.operator, trigger.value)), detail: d ? `${d.name}: ${trigger.code} = ${value ?? "nincs adat"}; feltétel: ${operatorLabel(trigger.operator)} ${trigger.value}` : `Tuya eszköz nem található: ${trigger.deviceId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "tuya.state") {
      const d = this.tuya.state().devices.find(x => x.id === trigger.deviceId), point = d?.status.find(x => x.code === trigger.code);
      return { active: Boolean(d?.online && point && compareState(point.value, trigger.operator, trigger.value)), detail: d ? `${d.name}: ${trigger.code} = ${String(point?.value ?? "nincs adat")}; feltétel: ${operatorLabel(trigger.operator)} ${String(trigger.value)}` : `Tuya eszköz nem található: ${trigger.deviceId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "network.online_window") {
      const n = (this.store.get().snapshot?.network || []).find(x => x.id === trigger.networkId), local = fmtLocal(now, trigger.timezone || DEFAULT_TZ);
      return { active: Boolean(n?.online && inWindow(local.minutes, trigger.after, trigger.before)), detail: n ? `${n.name} online (${n.ip || n.mac}) · időablak ${trigger.after}–${trigger.before}` : `Hálózati eszköz nem található: ${trigger.networkId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "network.online" || trigger.type === "network.offline") {
      const n = (this.store.get().snapshot?.network || []).find(x => x.id === trigger.networkId), wanted = trigger.type === "network.online";
      return { active: Boolean(n && n.online === wanted), detail: n ? `${n.name} ${wanted ? "online" : "offline"} (${n.ip || n.mac || "ismeretlen cím"})` : `Hálózati eszköz nem található: ${trigger.networkId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "network.link_below") {
      const n = (this.store.get().snapshot?.network || []).find(x => x.id === trigger.networkId), port = n?.managed?.ports?.find(p => p.port === trigger.port);
      return { active: Boolean(n?.online && port?.linkUp && port.speedMbps > 0 && port.speedMbps < trigger.mbps), detail: n ? `${n.name} Port ${trigger.port}${port?.label ? ` (${port.label})` : ""}: ${port?.linkUp ? `${port.speedMbps} Mbps` : "Link Down"} · küszöb ${trigger.mbps} Mbps` : `Hálózati eszköz nem található: ${trigger.networkId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "presence.person_state") {
      const person = this.store.get().people.find(p => p.id === trigger.personId), presence = this.store.get().presenceRuntime[trigger.personId];
      return { active: Boolean(person && presence?.status === trigger.state), detail: person ? `${person.name}: jelenlét = ${presence?.status || "ismeretlen"}; elvárt: ${trigger.state}` : `Személy nem található: ${trigger.personId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "presence.device_mismatch") {
      const person = this.store.get().people.find(p => p.id === trigger.personId), network = this.store.get().snapshot?.network || [];
      const primary = person?.devices.filter(d => d.role === "primary") || [], secondary = person?.devices.filter(d => d.role === "secondary") || [];
      const primaryOnline = primary.some(d => network.find(n => n.id === d.networkId)?.online), secondaryOnline = secondary.some(d => network.find(n => n.id === d.networkId)?.online);
      const pNames = primary.map(d => d.label || network.find(n => n.id === d.networkId)?.name || d.networkId).join(", "), sNames = secondary.map(d => d.label || network.find(n => n.id === d.networkId)?.name || d.networkId).join(", ");
      return { active: Boolean(person && primary.length && secondary.length && !primaryOnline && secondaryOnline), detail: person ? `${person.name}: elsődleges eszköz offline (${pNames || "nincs"}), miközben másodlagos eszköz online (${sNames || "nincs"})` : `Személy nem található: ${trigger.personId}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "signal.state" || trigger.type === "signal.numeric") {
      const signal = this.store.get().externalSignals[trigger.key], updated = signal ? new Date(signal.updatedAt).getTime() : 0;
      const freshByExpiry = Boolean(signal && (!signal.expiresAt || new Date(signal.expiresAt).getTime() > nowMs));
      const maxAge = Math.max(0, Number(trigger.maxAgeSeconds || 0));
      const freshByAge = Boolean(signal && (!maxAge || (Number.isFinite(updated) && nowMs - updated <= maxAge * 1000)));
      let active = false;
      if (signal && freshByExpiry && freshByAge) {
        if (trigger.type === "signal.numeric") active = typeof signal.value === "number" && compareNumber(signal.value, trigger.operator, trigger.value);
        else active = compareState(signal.value, trigger.operator, trigger.value);
      }
      const expected = `${operatorLabel(trigger.operator)} ${String(trigger.value)}`;
      return { active, detail: signal ? `${signal.label || signal.key}: ${String(signal.value)}; feltétel: ${expected}${freshByExpiry && freshByAge ? "" : " · a jel lejárt"}` : `Külső jel még nem érkezett: ${trigger.key}`, forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    if (trigger.type === "all") {
      const parts = trigger.conditions.map(c => this.evaluateCondition(c, now));
      return { active: parts.length > 0 && parts.every(p => p.active), detail: parts.map((p, i) => `${i + 1}. ${p.detail}`).join(" · "), forSeconds: Math.max(0, Number(trigger.forSeconds || 0)) };
    }
    return { active: false, detail: `Nem értékelhető trigger: ${trigger.type}`, forSeconds: 0 };
  }

  private async evaluate(rule: AutomationRule) {
    if (rule.trigger.type === "network.new_device") return;
    const now = new Date(), nowMs = now.getTime(), rt = this.runtime(rule.id);
    if (rule.trigger.type === "schedule") {
      const local = fmtLocal(now, rule.trigger.timezone || DEFAULT_TZ), days = rule.trigger.days?.length ? rule.trigger.days : [0,1,2,3,4,5,6];
      if (!days.includes(local.weekday) || local.time !== rule.trigger.time) return;
      const key = `${local.date}@${rule.trigger.time}`;
      if (rt.lastScheduleKey === key || !this.cooldownOK(rule, nowMs)) return;
      this.updateRuntime(rule.id, { lastScheduleKey: key, triggeredAt: now.toISOString(), escalationsSent: [] });
      await this.execute(rule, { detail: `Ütemezés: ${local.date} ${local.time}` });
      return;
    }

    const result = this.evaluateCondition(rule.trigger, now), active = result.active, detail = result.detail, forSeconds = result.forSeconds;
    if (!active) {
      if (rt.conditionSince || rt.latched || rt.triggeredAt) this.updateRuntime(rule.id, { conditionSince: undefined, latched: false, triggeredAt: undefined, escalationsSent: [] });
      return;
    }
    if (rt.latched) { await this.processEscalations(rule, nowMs, detail); return; }
    const since = rt.conditionSince ? new Date(rt.conditionSince).getTime() : nowMs;
    if (!rt.conditionSince) this.updateRuntime(rule.id, { conditionSince: now.toISOString() });
    if (nowMs - since < forSeconds * 1000 || !this.cooldownOK(rule, nowMs)) return;
    const triggeredAt = now.toISOString(); this.updateRuntime(rule.id, { latched: true, triggeredAt, escalationsSent: [] });
    const durationDetail = forSeconds > 0 ? `${detail} · legalább ${forSeconds} másodpercig fennállt` : detail;
    await this.execute(rule, { detail: durationDetail });
  }

  private async processEscalations(rule: AutomationRule, nowMs: number, detail: string) {
    const plan = rule.notification, rt = this.runtime(rule.id); if (!plan?.enabled || !plan.escalations?.length || !rt.triggeredAt) return;
    const elapsed = Math.max(0, nowMs - new Date(rt.triggeredAt).getTime()) / 1000, sent = new Set(rt.escalationsSent || []);
    for (let i = 0; i < plan.escalations.length; i++) {
      const step = plan.escalations[i]; if (sent.has(i) || elapsed < step.afterSeconds) continue;
      await this.createAlert(rule, `HomeHub eszkaláció: ${rule.name}`, `${detail}\n\nA feltétel a kezdeti riasztás után még ${Math.round(elapsed / 60)} perce fennáll.`, true, step.channels, i + 1);
      sent.add(i); this.updateRuntime(rule.id, { escalationsSent: [...sent] });
    }
  }

  private actionSummary(action: AutomationAction) { if (action.type === "vacuum.command") return `Porszívó: ${action.action}`; if (action.type === "tuya.command") { const d = this.tuya.state().devices.find(x => x.id === action.deviceId); return `${d?.name || "Tuya eszköz"}: ${action.code} → ${String(action.value)}`; } if (action.type === "ai.summary") return "AI összefoglaló"; return `Értesítés: ${action.subject}`; }
  private render(template: string, rule: AutomationRule, detail: string) { return template.replaceAll("{{rule}}", rule.name).replaceAll("{{detail}}", detail).replaceAll("{{time}}", new Date().toLocaleString("hu-HU", { timeZone: DEFAULT_TZ })); }

  private async execute(rule: AutomationRule, context: { detail: string; network?: NetworkStatus[] }) {
    const failures: string[] = [], performed: string[] = [];
    for (const action of rule.actions) { try { await this.executeAction(rule, action, context.detail); performed.push(this.actionSummary(action)); } catch (err) { failures.push(`${this.actionSummary(action)}: ${err instanceof Error ? err.message : String(err)}`); } }
    const firedAt = new Date().toISOString(), reason = context.detail || "A szabály feltétele teljesült.", result = failures.length ? `${performed.length} akció sikeres, ${failures.length} hiba.` : `${performed.length} akció sikeresen végrehajtva.`;
    const historyMessage = `${rule.name}: lefutott. Ok: ${reason}. Akció: ${performed.join("; ") || "nincs sikeres akció"}. Eredmény: ${result}`;
    this.store.mutate(s => { const target = s.automations.find(x => x.id === rule.id); if (target) target.lastTriggeredAt = firedAt; pushHistory(s, { category: "automation", type: failures.length ? "automation.partial" : "automation.executed", entityId: rule.id, entityName: rule.name, message: historyMessage, createdAt: firedAt, data: { reason, actions: performed, failures, result } }); });

    const hasExplicitAlert = rule.actions.some(a => a.type === "alert" || a.type === "ai.summary");
    if (!hasExplicitAlert && (rule.notification?.enabled || rule.notifyEmail !== false)) {
      const lines = [`Ok: ${reason}`, "", "Végrehajtott akció:", performed.join("\n") || "—", "", `Eredmény: ${result}`]; if (failures.length) lines.push("", "Hibák:", failures.join("\n"));
      await this.createAlert(rule, `HomeHub automatizálás: ${rule.name}`, lines.join("\n"), true);
    } else if (failures.length) await this.createAlert(rule, "HomeHub akcióhiba", [`Ok: ${reason}`, "", failures.join("\n")].join("\n"), false);
  }

  private async executeAction(rule: AutomationRule, action: AutomationAction, detail: string) {
    if (action.type === "vacuum.command") { this.queueVacuum(action.action); return; }
    if (action.type === "tuya.command") {
      const d = this.tuya.state().devices.find(x => x.id === action.deviceId); if (!d) throw new Error("tuya_device_not_found");
      const gateLike = d.profile === "mygate" || /kapu|gate|garage|garázs|door|lock|zár/i.test(`${d.name} ${d.productName}`);
      if (gateLike && !rule.safety?.allowGateAction) throw new Error("gate_action_requires_explicit_safety_opt_in");
      if (gateLike && /^(?:start_1|stop_1|pedestrian_1|open_1|close_1|gate_(?:open|close|start|stop)|door_(?:open|close))$/i.test(action.code) && action.value !== true) throw new Error("gate_pulse_must_be_true");
      await this.tuya.command(action.deviceId, action.code, action.value); return;
    }
    if (action.type === "ai.summary") { const subject = this.render(action.subject || "HomeHub AI összefoglaló", rule, detail), message = await this.generateAISummary(); await this.createAlert(rule, subject, message, action.email !== false); return; }
    if (action.type === "alert") { const subject = this.render(action.subject || rule.name, rule, detail), message = this.render(action.message || "{{detail}}", rule, detail); await this.createAlert(rule, subject, message, action.email !== false); }
  }

  private async createAlert(rule: AutomationRule, subject: string, message: string, notifyRequested: boolean, channelsOverride?: NotificationChannel[], escalationLevel?: number) {
    const plan = this.legacyPlan(rule, notifyRequested), body = `${message}\n\nHomeHub · ${new Date().toLocaleString("hu-HU", { timeZone: DEFAULT_TZ })}`;
    const deliveries = notifyRequested && plan?.enabled ? await this.notifier.deliver(plan, subject, body, channelsOverride) : [];
    const emailDeliveries = deliveries.filter(d => d.channel === "email" && !d.skipped), emailSent = emailDeliveries.some(d => d.ok), emailError = emailDeliveries.find(d => !d.ok)?.error;
    const createdAt = new Date().toISOString();
    const record: AlertRecord = { id: crypto.randomUUID(), ruleId: rule.id, ruleName: rule.name, subject, message, createdAt, priority: plan?.priority, emailRequested: Boolean(notifyRequested && (channelsOverride || plan?.channels || []).includes("email")), emailSent, emailError, deliveries, escalationLevel };
    this.store.mutate(s => {
      s.alerts.push(record); if (s.alerts.length > 200) s.alerts = s.alerts.slice(-200);
      if (deliveries.length) {
        const ok = deliveries.filter(d => d.ok).map(d => `${d.personName || "fallback"}/${d.channel}`).join(", ");
        const failed = deliveries.filter(d => !d.ok && !d.skipped).map(d => `${d.personName || "fallback"}/${d.channel}`).join(", ");
        pushHistory(s, { category: "automation", type: escalationLevel ? "notification.escalated" : "notification.sent", entityId: rule.id, entityName: rule.name, message: `${rule.name}: értesítés ${ok ? `elküldve (${ok})` : "nem került kiküldésre"}${failed ? `; hiba: ${failed}` : ""}.`, createdAt, data: { subject, deliveries, escalationLevel: escalationLevel || 0 } });
      }
    });
  }

  private async logEngineError(rule: AutomationRule, err: unknown) { await this.createAlert(rule, "HomeHub automatizálási hiba", err instanceof Error ? err.message : String(err), false); }
}
