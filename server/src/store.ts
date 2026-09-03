import fs from "node:fs";
import path from "node:path";
import type { State } from "./types.js";

const initialState: State = {
  snapshot: null,
  bridgeLastSeenAt: null,
  commands: [],
  settings: {
    autoCopyEnabled: true,
    autoCopyDestination: "Filmek"
  },
  copies: {}
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
          commands: disk.commands || []
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

  mutate(fn: (state: State) => void): State {
    fn(this.state);
    this.save();
    return this.state;
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
