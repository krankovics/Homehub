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

export type NetworkSwitchPort = {
  port: number; label?: string; enabled: boolean; linkUp: boolean; speedMbps: number; duplex: string;
  configSpeed: string; flowControl: boolean; txPackets?: number; rxPackets?: number; health: string;
};

export type NetworkManagedStatus = {
  adapter: string; credentialsConfigured: boolean; authOk: boolean; model?: string; hardware?: string; firmware?: string; gateway?: string;
  ports?: NetworkSwitchPort[]; error?: string; updatedAt: string;
};

export type NetworkIdentity = {
  source: "configured" | "manual" | "known_device" | "tuya_factory" | "tuya_device_id" | "proxy";
  confidence: number;
  label: string;
  owner?: string;
  deviceType?: string;
  tuyaDeviceId?: string;
  tuyaProductName?: string;
  matchedMac?: string;
  note?: string;
};

export type NetworkStatus = {
  id: string;
  name: string;
  kind: string;
  online: boolean;
  adminOnline?: boolean;
  ip: string;
  configuredIp?: string;
  ipSource?: string;
  ipChanged?: boolean;
  mac: string;
  latencyMs: number;
  adminUrl: string;
  note: string;
  managed?: NetworkManagedStatus;
  visibility?: string;
  rawName?: string;
  identity?: NetworkIdentity;
};


export type DeviceIdentityOverride = {
  mac: string;
  name: string;
  kind?: string;
  owner?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type NetworkEvent = {
  id: string; type: "online" | "offline" | "ip_changed" | "link_speed"; networkId: string; deviceName: string;
  message: string; createdAt: string; port?: number; fromValue?: string; toValue?: string;
};

export type VacuumStatus = {
  configured: boolean;
  online: boolean;
  controlReady: boolean;
  name: string;
  model: string;
  ip: string;
  state?: string;
  battery?: number;
  areaM2?: number;
  durationSec?: number;
  metrics?: Array<{ name: string; value: unknown; unit?: string }>;
  note: string;
  updatedAt: string;
};


export type MediaItem = {
  id: string;
  name: string;
  relativePath: string;
  folder: string;
  sizeBytes: number;
  modifiedAt: string;
  extension: string;
  nativePlay: boolean;
  playUrl: string;
  downloadUrl: string;
};

export type MediaSnapshot = {
  enabled: boolean;
  online: boolean;
  publicBaseUrl: string;
  count: number;
  truncated: boolean;
  error?: string;
  items: MediaItem[];
  updatedAt: string;
};


export type VaultEntryMeta = {
  id: string; label: string; kind?: string; username?: string; adminUrl?: string; ip?: string; hasPassword: boolean; saved: boolean; updatedAt?: string;
};

export type VaultStatus = {
  enabled: boolean; initialized: boolean; pinConfigured: boolean; localUrl: string; entries: VaultEntryMeta[]; updatedAt: string; error?: string;
};


export type MenuPermission = "overview" | "people" | "timeline" | "downloads" | "media" | "smart" | "actions" | "ai" | "network" | "credentials" | "printer" | "settings";

export type PersonAuth = {
  enabled: boolean;
  loginName: string;
  passwordSalt?: string;
  passwordHash?: string;
  permissions: MenuPermission[];
  forcePasswordChange?: boolean;
};

export type PersonDeviceRole = "primary" | "secondary" | "stationary";

export type PersonDeviceLink = {
  networkId: string;
  role: PersonDeviceRole;
  label?: string;
};

export type PersonProfile = {
  id: string;
  name: string;
  nickname?: string;
  role?: string;
  avatarMime?: string;
  avatarBase64?: string;
  auth?: PersonAuth;
  devices: PersonDeviceLink[];
  createdAt: string;
  updatedAt: string;
};

export type PresenceStatus = {
  personId: string;
  name: string;
  status: "home" | "away" | "uncertain";
  confidence: number;
  since?: string;
  lastSeenAt?: string;
  source?: string;
  networkId?: string;
  note?: string;
};

export type HistoryEvent = {
  id: string;
  category: "presence" | "network" | "security" | "smart" | "energy" | "automation" | "system";
  type: string;
  entityId?: string;
  entityName?: string;
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
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
  vacuum?: VacuumStatus;
  media?: MediaSnapshot;
  vault?: VaultStatus;
  persistentState?: PersistentBackup;
  localCopies?: Record<string, { hash: string; name: string; destination: string; copiedAt: string }>;
};

export type CommandType =
  | "torrent.addMagnet"
  | "torrent.addFile"
  | "torrent.copyToWd"
  | "torrent.remove"
  | "vacuum.start"
  | "vacuum.pause"
  | "vacuum.stop"
  | "vacuum.dock";

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

export type AIMode = "off" | "suggest" | "approved";

export type Settings = {
  autoCopyEnabled: boolean;
  autoCopyDestination: string;
  aiMode: AIMode;
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

export type AutomationTrigger =
  | { type: "tuya.numeric"; deviceId: string; code: string; operator: "gt" | "gte" | "lt" | "lte" | "eq"; value: number; forSeconds?: number }
  | { type: "tuya.state"; deviceId: string; code: string; operator: "eq" | "neq"; value: string | number | boolean; forSeconds?: number }
  | { type: "network.online_window"; networkId: string; after: string; before: string; forSeconds?: number; timezone?: string }
  | { type: "network.offline"; networkId: string; forSeconds?: number }
  | { type: "network.link_below"; networkId: string; port: number; mbps: number; forSeconds?: number }
  | { type: "network.new_device" }
  | { type: "schedule"; time: string; days: number[]; timezone?: string };

export type AutomationAction =
  | { type: "tuya.command"; deviceId: string; code: string; value: unknown }
  | { type: "vacuum.command"; action: "start" | "pause" | "stop" | "dock" }
  | { type: "ai.summary"; subject: string; email?: boolean }
  | { type: "alert"; subject: string; message: string; email?: boolean };

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  cooldownSeconds: number;
  notifyEmail?: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
};

export type AutomationRuntime = {
  conditionSince?: string;
  latched?: boolean;
  lastScheduleKey?: string;
  lastSeenValue?: string;
};

export type AlertRecord = {
  id: string;
  ruleId: string;
  ruleName: string;
  subject: string;
  message: string;
  createdAt: string;
  emailRequested: boolean;
  emailSent: boolean;
  emailError?: string;
  readAt?: string;
};

export type PersistentBackup = {
  version: 1;
  persistentUpdatedAt: string;
  settings: Settings;
  copies: Record<string, CopyRecord>;
  commands: Command[];
  automations?: AutomationRule[];
  automationRuntime?: Record<string, AutomationRuntime>;
  alerts?: AlertRecord[];
  knownNetworkMacs?: string[];
  networkEvents?: NetworkEvent[];
  people?: PersonProfile[];
  history?: HistoryEvent[];
  presenceRuntime?: Record<string, PresenceStatus>;
  historySampleKey?: string;
  deviceIdentityOverrides?: Record<string, DeviceIdentityOverride>;
  tuyaLogCursor?: Record<string, number>;
};

export type State = {
  snapshot: Snapshot | null;
  bridgeLastSeenAt: string | null;
  commands: Command[];
  settings: Settings;
  copies: Record<string, CopyRecord>;
  automations: AutomationRule[];
  automationRuntime: Record<string, AutomationRuntime>;
  alerts: AlertRecord[];
  knownNetworkMacs: string[];
  networkEvents: NetworkEvent[];
  people: PersonProfile[];
  history: HistoryEvent[];
  presenceRuntime: Record<string, PresenceStatus>;
  historySampleKey: string;
  deviceIdentityOverrides: Record<string, DeviceIdentityOverride>;
  tuyaLogCursor: Record<string, number>;
  persistentUpdatedAt: string | null;
};
