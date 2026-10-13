// Persistent user-uploaded dataset store, IndexedDB-backed. Each dataset is
// keyed by a uuid; `body` holds the raw pasted text (gene list, DESeq2 CSV, GMT, etc).

import { idbDelete, idbGetAll, idbPut, STORE_DATASETS } from '$lib/idb';

export type DatasetType =
  | 'gene-list'
  | 'ranked'
  | 'deseq2'
  | 'gmt'
  | 'counts'
  | 'session'
  | 'gsea-bundle';

export interface Dataset {
  id: string;
  name: string;
  type: DatasetType;
  createdAt: number;
  body: string;
  // Free-form metadata (e.g. column hints for DESeq2, sample/set counts); avoids per-type schemas.
  meta?: Record<string, unknown>;
}

const TYPE_LABELS: Record<DatasetType, string> = {
  'gene-list': 'Gene list',
  ranked: 'Ranked list',
  deseq2: 'DESeq2 results',
  gmt: 'GMT collection',
  counts: 'Counts matrix',
  session: 'Analysis session',
  'gsea-bundle': 'GSEA result bundle',
};
export function labelFor(t: DatasetType): string {
  return TYPE_LABELS[t];
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ds-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class DatasetStore {
  items = $state<Dataset[]>([]);
  loaded = $state(false);

  private loading: Promise<void> | null = null;

  // Memoized: concurrent callers share one read, so a late duplicate read cannot
  // overwrite items added in between.
  init(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const all = await idbGetAll<Dataset>(STORE_DATASETS);
        this.items = all.sort((a, b) => b.createdAt - a.createdAt);
      } catch (e) {
        console.warn('[datasets] init failed:', e);
        this.items = [];
      }
      this.loaded = true;
    })();
    return this.loading;
  }

  async add(input: Omit<Dataset, 'id' | 'createdAt'>): Promise<Dataset> {
    const ds: Dataset = {
      id: uuid(),
      createdAt: Date.now(),
      ...input,
    };
    await idbPut(STORE_DATASETS, ds);
    this.items = [ds, ...this.items];
    return ds;
  }

  async rename(id: string, name: string): Promise<void> {
    const ds = this.items.find((d) => d.id === id);
    if (!ds) return;
    const next = { ...ds, name };
    await idbPut(STORE_DATASETS, next);
    this.items = this.items.map((d) => (d.id === id ? next : d));
  }

  async remove(id: string): Promise<void> {
    await idbDelete(STORE_DATASETS, id);
    this.items = this.items.filter((d) => d.id !== id);
  }

  byType(t: DatasetType): Dataset[] {
    return this.items.filter((d) => d.type === t);
  }

  // Lazy init so callers on cold load don't have to await init themselves.
  async getById(id: string): Promise<Dataset | null> {
    await this.init();
    return this.items.find((d) => d.id === id) ?? null;
  }
}

export const datasets = new DatasetStore();
