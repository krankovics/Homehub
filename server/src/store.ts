import fs from "node:fs";
import path from "node:path";
import type { PersistentBackup, State } from "./types.js";

const initialState: State = {
  snapshot: null,
  bridgeLastSeenAt: null,
  commands: [],
  settings: {
    autoCopyEnabled: true,
    autoCopyDestination: "Filmek",
    aiMode: "suggest"
  },
  copies: {},
  automations: [],
  automationRuntime: {},
  alerts: [],
  knownNetworkMacs: [],
  networkEvents: [],
  people: [],
  history: [],
  presenceRuntime: {},
  historySampleKey: "",
  deviceIdentityOverrides: {},
  tuyaLogCursor: {},
  externalSignals: {},
  life360MemberMap: {},
  persistentUpdatedAt: null
};

export class Store {
  private file: string;
  private state: State;
  private bootstrapPending: boolean;

  constructor(file: string) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const existed = fs.existsSync(this.file);
    this.bootstrapPending = !existed;
    if (existed) {
      try {
        const disk = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.state = {
          ...structuredClone(initialState),
          ...disk,
          settings: { ...initialState.settings, ...(disk.settings || {}) },
          copies: disk.copies || {},
          commands: disk.commands || [],
          automations: Array.isArray(disk.automations) ? disk.automations : [],
          automationRuntime: disk.automationRuntime || {},
          alerts: Array.isArray(disk.alerts) ? disk.alerts : [],
          knownNetworkMacs: Array.isArray(disk.knownNetworkMacs) ? disk.knownNetworkMacs : [],
          networkEvents: Array.isArray(disk.networkEvents) ? disk.networkEvents : [],
          people: Array.isArray(disk.people) ? disk.people : [],
          history: Array.isArray(disk.history) ? disk.history : [],
          presenceRuntime: disk.presenceRuntime || {},
          historySampleKey: typeof disk.historySampleKey === "string" ? disk.historySampleKey : "",
          deviceIdentityOverrides: disk.deviceIdentityOverrides || {},
          tuyaLogCursor: disk.tuyaLogCursor || {},
          externalSignals: disk.externalSignals || {},
          life360MemberMap: disk.life360MemberMap || {},
          persistentUpdatedAt: disk.persistentUpdatedAt || null
        };
      } catch {
        this.state = structuredClone(initialState);
      }
    } else {
      this.state = structuredClone(initialState);
      this.save();
    }
  }

  get(): State { return this.state; }
  isBootstrapPending(){ return this.bootstrapPending; }
  markBootstrapComplete(){ this.bootstrapPending = false; }

  mutate(fn: (state: State) => void, persistent = true): State {
    fn(this.state);
    if (persistent) this.state.persistentUpdatedAt = new Date().toISOString();
    this.save();
    return this.state;
  }

  exportPersistent(): PersistentBackup {
    return {
      version: 1,
      persistentUpdatedAt: this.state.persistentUpdatedAt || new Date(0).toISOString(),
      settings: structuredClone(this.state.settings),
      copies: structuredClone(this.state.copies),
      commands: structuredClone(this.state.commands.slice(-200)),
      automations: structuredClone(this.state.automations),
      automationRuntime: structuredClone(this.state.automationRuntime),
      alerts: structuredClone(this.state.alerts.slice(-200)),
      knownNetworkMacs: structuredClone(this.state.knownNetworkMacs),
      networkEvents: structuredClone(this.state.networkEvents.slice(-200)),
      people: structuredClone(this.state.people),
      history: structuredClone(this.state.history.slice(-10000)),
      presenceRuntime: structuredClone(this.state.presenceRuntime),
      historySampleKey: this.state.historySampleKey,
      deviceIdentityOverrides: structuredClone(this.state.deviceIdentityOverrides),
      tuyaLogCursor: structuredClone(this.state.tuyaLogCursor),
      externalSignals: structuredClone(this.state.externalSignals),
      life360MemberMap: structuredClone(this.state.life360MemberMap)
    };
  }

  importPersistent(backup: PersistentBackup): boolean {
    const incoming = new Date(backup.persistentUpdatedAt || 0).getTime();
    const current = new Date(this.state.persistentUpdatedAt || 0).getTime();
    if (!Number.isFinite(incoming)) return false;
    // Render uses ephemeral /tmp storage. On a fresh instance the first WD backup is authoritative,
    // even if background Tuya/Life360 work already touched persistentUpdatedAt locally.
    if (!this.bootstrapPending && incoming <= current) return false;
    this.state.settings = { ...initialState.settings, ...(backup.settings || {}) };
    this.state.copies = backup.copies || {};
    this.state.commands = Array.isArray(backup.commands) ? backup.commands.slice(-200) : [];
    this.state.automations = Array.isArray(backup.automations) ? backup.automations : [];
    this.state.automationRuntime = backup.automationRuntime || {};
    this.state.alerts = Array.isArray(backup.alerts) ? backup.alerts.slice(-200) : [];
    this.state.knownNetworkMacs = Array.isArray(backup.knownNetworkMacs) ? backup.knownNetworkMacs : [];
    this.state.networkEvents = Array.isArray(backup.networkEvents) ? backup.networkEvents.slice(-200) : [];
    this.state.people = Array.isArray(backup.people) ? backup.people : [];
    this.state.history = Array.isArray(backup.history) ? backup.history.slice(-10000) : [];
    this.state.presenceRuntime = backup.presenceRuntime || {};
    this.state.historySampleKey = backup.historySampleKey || "";
    this.state.deviceIdentityOverrides = backup.deviceIdentityOverrides || {};
    this.state.tuyaLogCursor = backup.tuyaLogCursor || {};
    this.state.externalSignals = backup.externalSignals || {};
    this.state.life360MemberMap = backup.life360MemberMap || {};
    this.state.persistentUpdatedAt = backup.persistentUpdatedAt;
    this.bootstrapPending = false;
    this.save();
    return true;
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
