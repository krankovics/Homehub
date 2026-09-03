import fs from "node:fs";
import path from "node:path";
import type { PersistentBackup, State } from "./types.js";

const initialState: State = {
  snapshot: null,
  bridgeLastSeenAt: null,
  commands: [],
  settings: {
    autoCopyEnabled: true,
    autoCopyDestination: "Filmek"
  },
  copies: {},
  persistentUpdatedAt: null
};

export class Store {
  private file: string;
  private state: State;

  constructor(file: string) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const disk = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.state = {
          ...structuredClone(initialState),
          ...disk,
          settings: { ...initialState.settings, ...(disk.settings || {}) },
          copies: disk.copies || {},
          commands: disk.commands || [],
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

  get(): State {
    return this.state;
  }

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
      commands: structuredClone(this.state.commands.slice(-200))
    };
  }

  importPersistent(backup: PersistentBackup): boolean {
    const incoming = new Date(backup.persistentUpdatedAt || 0).getTime();
    const current = new Date(this.state.persistentUpdatedAt || 0).getTime();
    if (!Number.isFinite(incoming) || incoming <= current) return false;
    this.state.settings = { ...initialState.settings, ...(backup.settings || {}) };
    this.state.copies = backup.copies || {};
    this.state.commands = Array.isArray(backup.commands) ? backup.commands.slice(-200) : [];
    this.state.persistentUpdatedAt = backup.persistentUpdatedAt;
    this.save();
    return true;
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
