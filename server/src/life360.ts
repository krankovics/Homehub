import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Life360Status = {
  configured: boolean;
  online: boolean;
  experimental: boolean;
  lastUpdatedAt: string | null;
  members: any[];
  circleId?: string;
  circleName?: string;
  error?: string;
};

export class Life360Service {
  private accessToken = process.env.LIFE360_ACCESS_TOKEN || "";
  private status: Life360Status = {
    configured: false,
    online: false,
    experimental: true,
    lastUpdatedAt: null,
    members: [],
  };
  private scriptPath: string;

  constructor(scriptPath: string) {
    this.scriptPath = path.resolve(scriptPath);
    this.status.configured = this.isConfigured();
  }

  private isConfigured() {
    return Boolean(
      process.env.LIFE360_ACCESS_TOKEN ||
      (process.env.LIFE360_USERNAME && process.env.LIFE360_PASSWORD)
    );
  }

  getStatus() {
    return this.status;
  }

  async refresh() {
    this.status.configured = this.isConfigured();

    if (!this.status.configured) {
      this.status = {
        configured: false,
        online: false,
        experimental: true,
        lastUpdatedAt: this.status.lastUpdatedAt,
        members: [],
      };
      return this.status;
    }

    try {
      const token = this.accessToken || process.env.LIFE360_ACCESS_TOKEN || "";
      const { stdout } = await execFileAsync(
        process.env.PYTHON_BIN || "python3",
        [this.scriptPath],
        {
          timeout: Math.max(15000, Number(process.env.LIFE360_TIMEOUT_MS || 35000)),
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            LIFE360_ACCESS_TOKEN: token,
          },
        }
      );

      const parsed = JSON.parse(stdout || "{}");
      if (parsed.accessToken) {
        this.accessToken = parsed.accessToken;
      }

      this.status = {
        configured: true,
        online: true,
        experimental: true,
        lastUpdatedAt: new Date().toISOString(),
        circleId: parsed.circleId,
        circleName: parsed.circleName,
        members: Array.isArray(parsed.members) ? parsed.members : [],
      };
    } catch (err: any) {
      this.status = {
        ...this.status,
        configured: true,
        online: false,
        experimental: true,
        error: String(err?.stderr || err?.message || err).slice(0, 500),
        lastUpdatedAt: new Date().toISOString(),
      };
      if (/401|403|unauthor|forbidden/i.test(this.status.error || "")) {
        this.accessToken = "";
      }
    }

    return this.status;
  }
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
