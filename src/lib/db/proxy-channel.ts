// BroadcastChannel-based host/guest coordination for per-tab DB workers.
//
// The first tab to acquire the OPFS-SAH-Pool VFS becomes the host and owns the
// live SQLite handle. Guest workers hold no DB state (~10 MB RAM vs 512 MB for
// memory-mode fallback) and forward all requests to the host over the channel.
//
// Election: new worker sends `hello`, waits HELLO_TIMEOUT_MS for `hello-ack`.
// If none arrives it races for the OPFS lock; winner becomes host, losers find
// the pool locked and become guests. Host emits periodic `heartbeat`, but a
// host runs queries on the same thread as its channel handler, so a long job
// silences both; the OPFS lock, which a live host holds throughout, is the
// liveness signal and the heartbeat only triggers the check.

export const CHANNEL_NAME = 'wb-db-v1';
export const ANY_HOST = '*';
export const HELLO_TIMEOUT_MS = 400; // how long to wait for an existing host
export const HEARTBEAT_INTERVAL_MS = 1000;
export const HEARTBEAT_TIMEOUT_MS = 3500; // 3 missed beats → assume host gone

export type ChannelMsg =
  | { kind: 'hello'; from: string }
  // `version` is the build the host has open, so guests label (and pin) what they really query.
  | { kind: 'hello-ack'; from: string; version?: string }
  | { kind: 'heartbeat'; from: string; version?: string }
  // Guest-to-host request; `payload` mirrors the worker Req shape, `reqId` supplied by proxy.
  // `to` is the host id, or ANY_HOST from a guest that has not heard the host yet.
  | { kind: 'req'; from: string; to: string; reqId: string; payload: unknown }
  // Final response.
  | {
      kind: 'res';
      from: string;
      to: string;
      reqId: string;
      ok: boolean;
      data?: unknown;
      error?: string;
    }
  // Progress event for long-running tasks (enrichment/GSEA).
  | {
      kind: 'progress';
      from: string;
      to: string;
      reqId: string;
      phase: string;
      current?: number;
      total?: number;
    };

export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Awaitable delay for the election window.
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
