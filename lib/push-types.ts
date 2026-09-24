export interface BrowserPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  dedupeKey?: string;
}

export interface PushSendResult {
  subscriptionCount: number;
  sentCount: number;
  failedCount: number;
  staleCount: number;
  deduplicated?: boolean;
}

export type PushClientStatus =
  | "checking"
  | "ready"
  | "not-enabled"
  | "blocked"
  | "unsupported"
  | "error";

export interface PushClientSummary {
  status: PushClientStatus;
  registeredDeviceCount: number;
  error?: string;
}
