// BroadcastChannel-based host/guest coordination for per-tab DB workers.
//
// The first tab to acquire the OPFS-SAH-Pool VFS becomes the host and owns the
// live SQLite handle. Guest workers hold no DB state (~10 MB RAM vs 512 MB for
// memory-mode fallback) and forward all requests to the host over the channel.
//
// Election: new worker sends `hello`, waits HELLO_TIMEOUT_MS for `hello-ack`.
// If none arrives it races for the OPFS lock; winner becomes host, losers retry
// and find the winner. Host emits periodic `heartbeat`; guests re-elect after
// HEARTBEAT_TIMEOUT_MS (3 missed beats).

export const CHANNEL_NAME = 'wb-db-v1';
export const HELLO_TIMEOUT_MS = 400; // how long to wait for an existing host
export const HEARTBEAT_INTERVAL_MS = 1000;
export const HEARTBEAT_TIMEOUT_MS = 3500; // 3 missed beats → assume host gone

export type ChannelMsg =
  | { kind: 'hello'; from: string }
  | { kind: 'hello-ack'; from: string }
  | { kind: 'heartbeat'; from: string }
  // Guest-to-host request; `payload` mirrors the worker Req shape, `reqId` supplied by proxy.
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
