export type Torrent = {
  id: number;
  hashString: string;
  name: string;
  status: number;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  downloadDir?: string;
};

export type PrinterStatus = {
  configured: boolean;
  online: boolean;
  host: string;
  adminUrl: string;
  detectedPorts: number[];
  protocol: string;
  note: string;
};

export type NetworkStatus = {
  id: string; name: string; kind: string; online: boolean; ip: string; mac: string; latencyMs: number; adminUrl: string; note: string;
};

export type Snapshot = {
  bridgeId: string;
  timestamp: string;
  kd20: {
    online: boolean;
    rpcUrl: string;
    torrents: Torrent[];
  };
  wd: {
    online: boolean;
    freeBytes: number;
    totalBytes: number;
    mediaRoot: string;
  };
  printer?: PrinterStatus;
  network?: NetworkStatus[];
};

export type CommandType =
  | "torrent.addMagnet"
  | "torrent.addFile"
  | "torrent.copyToWd";

export type Command = {
  id: string;
  bridgeId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  createdAt: string;
  leasedAt?: string;
  completedAt?: string;
  ok?: boolean;
  message?: string;
};

export type Settings = {
  autoCopyEnabled: boolean;
  autoCopyDestination: string;
};

export type CopyRecord = {
  torrentHash: string;
  torrentId: number;
  torrentName: string;
  destination: string;
  commandId: string;
  state: "queued" | "running" | "done" | "error";
  message?: string;
  attempts?: number;
  copiedBytes?: number;
  totalBytes?: number;
  currentFile?: string;
  fileCopiedBytes?: number;
  fileTotalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  percent?: number;
  updatedAt: string;
};

export type State = {
  snapshot: Snapshot | null;
  bridgeLastSeenAt: string | null;
  commands: Command[];
  settings: Settings;
  copies: Record<string, CopyRecord>;
};
