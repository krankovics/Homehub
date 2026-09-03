import crypto from "node:crypto";

export type TuyaStatusPoint = { code: string; value: unknown };
export type TuyaSpecPoint = { code: string; type: string; values: string; dp_id?: number; dpId?: number };
export type TuyaDevice = {
  id: string;
  name: string;
  online: boolean;
  category: string;
  productName: string;
  productId?: string;
  status: TuyaStatusPoint[];
  functions: TuyaSpecPoint[];
  statusSpec: TuyaSpecPoint[];
};
export type TuyaScene = {
  id: string;
  name: string;
  capabilities: Array<{ interface_name?: string; commands?: string[] }>;
};
export type TuyaState = {
  configured: boolean;
  online: boolean;
  lastUpdatedAt: string | null;
  error?: string;
  devices: TuyaDevice[];
  scenes: TuyaScene[];
};

type Token = { access_token: string; expire_time?: number; expire?: number; uid?: string };
type ApiResponse<T> = { success: boolean; result?: T; code?: number; msg?: string; t?: number };

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256(input: string) { return crypto.createHash("sha256").update(input).digest("hex"); }
function hmac(input: string, secret: string) { return crypto.createHmac("sha256", secret).update(input).digest("hex").toUpperCase(); }

export class TuyaClient {
  private endpoint: string;
  private clientId: string;
  private secret: string;
  private token = "";
  private tokenUntil = 0;
  private mode: "modern" | "legacy" = "modern";
  private specCache = new Map<string, { at: number; functions: TuyaSpecPoint[]; status: TuyaSpecPoint[] }>();

  constructor(endpoint: string, clientId: string, secret: string) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.clientId = clientId;
    this.secret = secret;
  }

  configured() { return Boolean(this.clientId && this.secret && this.endpoint); }

  private stringToSign(method: string, path: string, body: string) {
    return `${method.toUpperCase()}\n${body ? sha256(body) : EMPTY_SHA}\n\n${path}`;
  }

  private headers(method: string, path: string, body: string, accessToken = "", mode: "modern" | "legacy" = this.mode) {
    const t = String(Date.now());
    let sign: string;
    if (mode === "legacy") {
      sign = hmac(this.clientId + accessToken + t, this.secret);
    } else {
      const sts = this.stringToSign(method, path, body);
      sign = hmac(this.clientId + accessToken + t + sts, this.secret);
    }
    const h: Record<string, string> = {
      client_id: this.clientId,
      sign,
      sign_method: "HMAC-SHA256",
      t,
      lang: "en",
      "content-type": "application/json"
    };
    if (accessToken) h.access_token = accessToken;
    return h;
  }

  private async raw<T>(method: string, path: string, bodyObj?: unknown, accessToken = "", mode: "modern" | "legacy" = this.mode): Promise<ApiResponse<T>> {
    const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
    const r = await fetch(this.endpoint + path, {
      method,
      headers: this.headers(method, path, body, accessToken, mode),
      body: body || undefined
    });
    const text = await r.text();
    let j: ApiResponse<T>;
    try { j = JSON.parse(text); } catch { throw new Error(`Tuya HTTP ${r.status}: ${text.slice(0, 500)}`); }
    if (!r.ok || !j.success) throw new Error(`Tuya ${j.code ?? r.status}: ${j.msg || "request failed"}`);
    return j;
  }

  private async ensureToken() {
    if (this.token && Date.now() < this.tokenUntil - 60_000) return this.token;
    const path = "/v1.0/token?grant_type=1";
    let j: ApiResponse<Token>;
    try {
      j = await this.raw<Token>("GET", path, undefined, "", "modern");
      this.mode = "modern";
    } catch (modernErr) {
      try {
        j = await this.raw<Token>("GET", path, undefined, "", "legacy");
        this.mode = "legacy";
      } catch {
        throw modernErr;
      }
    }
    if (!j.result?.access_token) throw new Error("Tuya token missing");
    this.token = j.result.access_token;
    const ttl = Number(j.result.expire_time || j.result.expire || 7200);
    this.tokenUntil = Date.now() + ttl * 1000;
    return this.token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    try {
      const j = await this.raw<T>(method, path, body, token);
      return j.result as T;
    } catch (err) {
      if (/token/i.test(String(err))) {
        this.token = "";
        const fresh = await this.ensureToken();
        const j = await this.raw<T>(method, path, body, fresh);
        return j.result as T;
      }
      throw err;
    }
  }

  private async specs(deviceId: string) {
    const cached = this.specCache.get(deviceId);
    if (cached && Date.now() - cached.at < 60 * 60_000) return cached;
    try {
      const result = await this.request<{ category?: string; functions?: TuyaSpecPoint[]; status?: TuyaSpecPoint[] }>("GET", `/v1.1/devices/${encodeURIComponent(deviceId)}/specifications`);
      const x = { at: Date.now(), functions: result?.functions || [], status: result?.status || [] };
      this.specCache.set(deviceId, x); return x;
    } catch {
      try {
        const result = await this.request<{ category?: string; functions?: TuyaSpecPoint[] }>("GET", `/v1.0/devices/${encodeURIComponent(deviceId)}/functions`);
        const x = { at: Date.now(), functions: result?.functions || [], status: [] as TuyaSpecPoint[] };
        this.specCache.set(deviceId, x); return x;
      } catch {
        const x = { at: Date.now(), functions: [] as TuyaSpecPoint[], status: [] as TuyaSpecPoint[] };
        this.specCache.set(deviceId, x); return x;
      }
    }
  }

  async devices(): Promise<TuyaDevice[]> {
    const all: any[] = [];
    let last = "";
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ size: "100" });
      if (last) qs.set("last_row_key", last);
      const result = await this.request<{ devices?: any[]; has_more?: boolean; last_row_key?: string }>("GET", `/v1.0/iot-01/associated-users/devices?${qs.toString()}`);
      all.push(...(result?.devices || []));
      if (!result?.has_more || !result.last_row_key) break;
      last = result.last_row_key;
    }
    const devices: TuyaDevice[] = [];
    const workers = Math.min(5, Math.max(1, all.length));
    let index = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      for (;;) {
        const i = index++;
        if (i >= all.length) return;
        const d = all[i];
        const spec = await this.specs(String(d.id));
        devices[i] = {
          id: String(d.id), name: String(d.name || d.product_name || "Tuya eszköz"), online: Boolean(d.online),
          category: String(d.category || ""), productName: String(d.product_name || ""), productId: d.product_id ? String(d.product_id) : undefined,
          status: Array.isArray(d.status) ? d.status.map((x: any) => ({ code: String(x.code), value: x.value })) : [],
          functions: spec.functions, statusSpec: spec.status
        };
      }
    }));
    return devices.filter(Boolean);
  }

  async scenes(): Promise<TuyaScene[]> {
    try {
      const result = await this.request<{ scenes?: any[] }>("GET", "/v1.0/iot-01/voice/users/scenes");
      return (result?.scenes || []).map((s: any) => ({ id: String(s.scene_id), name: String(s.scene_name || "Jelenet"), capabilities: Array.isArray(s.capabilities) ? s.capabilities : [] }));
    } catch { return []; }
  }

  async command(deviceId: string, code: string, value: unknown) {
    return await this.request<boolean>("POST", `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { commands: [{ code, value }] });
  }

  async runScene(scene: TuyaScene) {
    const cap = scene.capabilities?.find((x) => Array.isArray(x.commands) && x.commands.length) || scene.capabilities?.[0] || {};
    const interfaceName = cap.interface_name || "Tuya.SmartHome.PowerstateController";
    const command = cap.commands?.[0] || "TurnOn";
    return await this.request<unknown>("POST", `/v1.0/iot-01/voice/users/scenes/${encodeURIComponent(scene.id)}/commands`, { interface_name: interfaceName, command });
  }
}

export class TuyaService {
  private client: TuyaClient | null;
  private cache: TuyaState;
  private refreshing: Promise<void> | null = null;

  constructor(endpoint: string, clientId: string, secret: string) {
    this.client = endpoint && clientId && secret ? new TuyaClient(endpoint, clientId, secret) : null;
    this.cache = { configured: Boolean(this.client), online: false, lastUpdatedAt: null, devices: [], scenes: [] };
  }
  state() { return this.cache; }
  async refresh() {
    if (!this.client) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const [devices, scenes] = await Promise.all([this.client!.devices(), this.client!.scenes()]);
        this.cache = { configured: true, online: true, lastUpdatedAt: new Date().toISOString(), devices, scenes };
      } catch (err) {
        this.cache = { ...this.cache, configured: true, online: false, lastUpdatedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async command(deviceId: string, code: string, value: unknown) {
    if (!this.client) throw new Error("Tuya nincs konfigurálva");
    const r = await this.client.command(deviceId, code, value); await this.refresh(); return r;
  }
  async scene(sceneId: string) {
    if (!this.client) throw new Error("Tuya nincs konfigurálva");
    const scene = this.cache.scenes.find((x) => x.id === sceneId);
    if (!scene) throw new Error("Jelenet nem található");
    const r = await this.client.runScene(scene); await this.refresh(); return r;
  }
}
