// Per-tool "last input" cache (separate from named datasets). Stashes the
// last successfully-run input per tool for quick restore. Backed by
// localStorage, capped at 100 KB per slot to avoid quota issues; large
// inputs should be saved as a named dataset.

import type { DatasetType } from './datasets.svelte';

interface LastInput {
  kind: DatasetType;
  body: string;
  at: number; // unix ms
}

const STORAGE_KEY = 'wb.lastInputs.v1';
const MAX_BYTES = 100 * 1024; // 100 KB per slot

function load(): Record<DatasetType, LastInput | null> {
  const empty: Record<DatasetType, LastInput | null> = {
    'gene-list': null,
    ranked: null,
    deseq2: null,
    gmt: null,
    counts: null,
    session: null,
  };
  if (typeof localStorage === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Record<string, LastInput>;
    const out = { ...empty };
    for (const k of Object.keys(empty) as DatasetType[]) {
      if (parsed[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return empty;
  }
}

class LastInputsStore {
  byKind = $state<Record<DatasetType, LastInput | null>>(load());

  stash(kind: DatasetType, body: string) {
    // Skip empty or oversize bodies; large inputs belong in the Datasets store.
    if (!body || !body.trim()) return;
    if (body.length > MAX_BYTES) return;
    const next: LastInput = { kind, body, at: Date.now() };
    this.byKind = { ...this.byKind, [kind]: next };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.byKind));
    } catch {
      // quota or no localStorage; silently degrade
    }
  }

  get(kind: DatasetType): LastInput | null {
    return this.byKind[kind] ?? null;
  }

  clear(kind: DatasetType) {
    this.byKind = { ...this.byKind, [kind]: null };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.byKind));
    } catch {
      // ignore
    }
  }
}

export const lastInputs = new LastInputsStore();
