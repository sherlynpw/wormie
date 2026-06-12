// OPFS-backed GSEA result cache, keyed by hash(ranked + params + kind).
// Avoids recomputing 1k-5k permutations on tab reload or kind switch.
// Falls back to an in-memory Map when OPFS is unavailable (Safari incognito, older browsers).

import type { GseaResult, GseaInput } from './db/client';

const CACHE_DIR = 'gsea-cache';
const VERSION = 1;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week: short enough that stale DB rebuilds invalidate naturally

type CacheValue = {
  v: number;
  at: number;
  results: GseaResult[];
  elapsedMs: number;
};

type CacheKey = {
  kind: string;
  minSize: number;
  maxSize: number;
  weight: number;
  nperm: number;
  multilevel: boolean;
  rankedHash: string;
};

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

export async function rankedHash(ranked: GseaInput[]): Promise<string> {
  // Sort defensively so equivalent ranked lists always hash to the same key.
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const text = sorted.map((r) => `${r.gene}\t${r.score.toFixed(6)}`).join('\n');
  return sha256Hex(text);
}

export async function keyFor(k: CacheKey): Promise<string> {
  return sha256Hex(
    [k.kind, k.minSize, k.maxSize, k.weight, k.nperm, k.multilevel ? 1 : 0, k.rankedHash].join('|'),
  );
}

const mem = new Map<string, CacheValue>();

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return null;
    return await root.getDirectoryHandle(CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

export async function getCached(key: string): Promise<CacheValue | null> {
  const m = mem.get(key);
  if (m && Date.now() - m.at < TTL_MS) return m;

  const dir = await opfsDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${key}.json`);
    const file = await fh.getFile();
    const v = JSON.parse(await file.text()) as CacheValue;
    if (v.v !== VERSION) return null;
    if (Date.now() - v.at > TTL_MS) return null;
    mem.set(key, v);
    return v;
  } catch {
    return null;
  }
}

export async function setCached(
  key: string,
  results: GseaResult[],
  elapsedMs: number,
): Promise<void> {
  const value: CacheValue = { v: VERSION, at: Date.now(), results, elapsedMs };
  mem.set(key, value);
  const dir = await opfsDir();
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(`${key}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(value));
    await w.close();
  } catch {
    // quota exceeded or unsupported writer; in-memory cache is the fallback
  }
}

// Persist ranked list for "Recent runs" restore. One file per rankedHash, shared across kinds.
export async function storeRanked(rankedHash: string, ranked: GseaInput[]): Promise<void> {
  const dir = await opfsDir();
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(`ranked-${rankedHash}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(ranked));
    await w.close();
  } catch {
    // ignore
  }
}

export async function loadRanked(rankedHash: string): Promise<GseaInput[] | null> {
  const dir = await opfsDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`ranked-${rankedHash}.json`);
    const file = await fh.getFile();
    return JSON.parse(await file.text()) as GseaInput[];
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  mem.clear();
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;
  try {
    await root.removeEntry(CACHE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

// Recent-runs index in localStorage (separate from OPFS blobs). Stores minimal metadata
// (when, kind, sizes, rankedHash); the full result blobs live in OPFS under their cache key.
const RECENT_KEY = 'wb.recentRuns.v1';
const RECENT_MAX = 10;

export type RecentRun = {
  cacheKey: string;
  kind: string;
  rankedHash: string;
  n_genes: number;
  n_results: number;
  n_significant: number;
  params: { minSize: number; maxSize: number; nperm: number; multilevel: boolean };
  at: number;
  label?: string;
};

export function listRecentRuns(): RecentRun[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentRun[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

export function recordRecentRun(run: RecentRun) {
  if (typeof localStorage === 'undefined') return;
  try {
    const cur = listRecentRuns().filter((r) => r.cacheKey !== run.cacheKey);
    cur.unshift(run);
    const trimmed = cur.slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function deleteRecentRun(cacheKey: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    const cur = listRecentRuns().filter((r) => r.cacheKey !== cacheKey);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur));
  } catch {
    // ignore
  }
}
