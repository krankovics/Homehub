import webpush from "web-push";
import type { AutomationNotificationPlan, NotificationChannel, NotificationDelivery, PersonProfile } from "./types.js";
import { Mailer } from "./mailer.js";
import { Store } from "./store.js";

function maskEmail(v: string) {
  const [a,b] = v.split("@");
  if (!a || !b) return v;
  return `${a.slice(0,2)}***@${b}`;
}
function maskPhone(v: string) { return v.length > 5 ? `${v.slice(0,4)}***${v.slice(-3)}` : "***"; }

export class NotificationRouter {
  private vapidPublic = process.env.VAPID_PUBLIC_KEY || "";
  private vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";
  private vapidSubject = process.env.VAPID_SUBJECT || "mailto:homehub@example.com";
  private twilioSid = process.env.TWILIO_ACCOUNT_SID || "";
  private twilioToken = process.env.TWILIO_AUTH_TOKEN || "";
  private twilioFrom = process.env.TWILIO_FROM_NUMBER || "";

  constructor(private store: Store, private mailer: Mailer) {
    if (this.pushConfigured()) webpush.setVapidDetails(this.vapidSubject, this.vapidPublic, this.vapidPrivate);
  }

  status() {
    return {
      emailConfigured: this.mailer.configured(),
      fallbackEmailRecipients: this.mailer.recipientsCount(),
      pushConfigured: this.pushConfigured(),
      smsConfigured: this.smsConfigured()
    };
  }
  publicVapidKey() { return this.pushConfigured() ? this.vapidPublic : ""; }
  pushConfigured() { return Boolean(this.vapidPublic && this.vapidPrivate && this.vapidSubject); }
  smsConfigured() { return Boolean(this.twilioSid && this.twilioToken && this.twilioFrom); }

  private personPrefs(person: PersonProfile) {
    return person.notificationPrefs || { pushEnabled: true, emailEnabled: true, smsEnabled: false };
  }

  async deliver(plan: AutomationNotificationPlan | undefined, subject: string, message: string, channelsOverride?: NotificationChannel[]) {
    const deliveries: NotificationDelivery[] = [];
    if (!plan?.enabled) return deliveries;
    const channels = channelsOverride?.length ? channelsOverride : plan.channels;
    const people = plan.recipientPersonIds.map(id => this.store.get().people.find(p => p.id === id)).filter(Boolean) as PersonProfile[];

    for (const person of people) {
      const prefs = this.personPrefs(person);
      for (const channel of channels) {
        if (channel === "email") {
          if (!prefs.emailEnabled || !person.email || !this.mailer.configured()) { deliveries.push({ personId: person.id, personName: person.name, channel, ok: false, skipped: true, error: !person.email ? "email_missing" : !prefs.emailEnabled ? "email_disabled" : "email_not_configured" }); continue; }
          try { await this.mailer.send(subject, message, [person.email]); deliveries.push({ personId: person.id, personName: person.name, channel, target: maskEmail(person.email), ok: true }); }
          catch (err) { deliveries.push({ personId: person.id, personName: person.name, channel, target: maskEmail(person.email), ok: false, error: err instanceof Error ? err.message : String(err) }); }
        }
        if (channel === "sms") {
          if (!prefs.smsEnabled || !person.phone || !this.smsConfigured()) { deliveries.push({ personId: person.id, personName: person.name, channel, ok: false, skipped: true, error: !person.phone ? "phone_missing" : !prefs.smsEnabled ? "sms_disabled" : "sms_not_configured" }); continue; }
          try { await this.sendSms(person.phone, `${subject}\n${message}`); deliveries.push({ personId: person.id, personName: person.name, channel, target: maskPhone(person.phone), ok: true }); }
          catch (err) { deliveries.push({ personId: person.id, personName: person.name, channel, target: maskPhone(person.phone), ok: false, error: err instanceof Error ? err.message : String(err) }); }
        }
        if (channel === "push") {
          const subs = person.pushSubscriptions || [];
          if (!prefs.pushEnabled || !subs.length || !this.pushConfigured()) { deliveries.push({ personId: person.id, personName: person.name, channel, ok: false, skipped: true, error: !subs.length ? "push_subscription_missing" : !prefs.pushEnabled ? "push_disabled" : "push_not_configured" }); continue; }
          let sent = 0;
          for (const sub of [...subs]) {
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({ title: subject, body: message, url: "/#notifications", tag: `homehub-${Date.now()}` }), { TTL: 300, urgency: plan.priority === "critical" ? "high" : "normal" });
              sent++;
            } catch (err: any) {
              if (err?.statusCode === 404 || err?.statusCode === 410) {
                this.store.mutate(s => { const p = s.people.find(x => x.id === person.id); if (p) p.pushSubscriptions = (p.pushSubscriptions || []).filter(x => x.endpoint !== sub.endpoint); });
              }
            }
          }
          deliveries.push({ personId: person.id, personName: person.name, channel, ok: sent > 0, error: sent ? undefined : "push_send_failed" });
        }
      }
    }

    if (!people.length && plan.fallbackToAdmin && channels.includes("email")) {
      const to = this.mailer.defaultRecipients();
      if (to.length) {
        try { await this.mailer.send(subject, message, to); deliveries.push({ channel: "email", target: `${to.length} fallback címzett`, ok: true }); }
        catch (err) { deliveries.push({ channel: "email", ok: false, error: err instanceof Error ? err.message : String(err) }); }
      } else deliveries.push({ channel: "email", ok: false, skipped: true, error: "fallback_email_missing" });
    }
    return deliveries;
  }

  private async sendSms(to: string, body: string) {
    if (!this.smsConfigured()) throw new Error("sms_not_configured");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.twilioSid)}/Messages.json`;
    const form = new URLSearchParams({ To: to, From: this.twilioFrom, Body: body.slice(0, 1400) });
    const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString("base64");
    const res = await fetch(url, { method: "POST", headers: { "authorization": `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body: form });
    if (!res.ok) throw new Error(`sms_http_${res.status}`);
  }
}
