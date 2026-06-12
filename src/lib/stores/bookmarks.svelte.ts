// Per-gene bookmarks: local star + free-text note per WBGene.
// localStorage-backed (notes are small; no need for OPFS).

import { SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'wb.bookmarks.v1';

export interface Bookmark {
  wormbase_gene: string;
  gene_name: string | null;
  note: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

type State = Record<string, Bookmark>;

function load(): State {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as State) : {};
  } catch {
    return {};
  }
}

function save(s: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // quota or no localStorage; degrade silently
  }
}

class BookmarksStore {
  byId = $state<State>({});
  initialized = $state<boolean>(false);

  init() {
    if (this.initialized) return;
    this.byId = load();
    this.initialized = true;
  }

  has(wb: string): boolean {
    if (!this.initialized) this.init();
    return wb in this.byId;
  }

  get(wb: string): Bookmark | null {
    if (!this.initialized) this.init();
    return this.byId[wb] ?? null;
  }

  all(): Bookmark[] {
    if (!this.initialized) this.init();
    return Object.values(this.byId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  toggle(wb: string, gene_name: string | null) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    if (wb in next) {
      delete next[wb];
    } else {
      const now = Date.now();
      next[wb] = { wormbase_gene: wb, gene_name, note: '', createdAt: now, updatedAt: now };
    }
    this.byId = next;
    save(next);
  }

  setNote(wb: string, gene_name: string | null, note: string) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    const existing = next[wb];
    const now = Date.now();
    next[wb] = existing
      ? { ...existing, note, updatedAt: now }
      : { wormbase_gene: wb, gene_name, note, createdAt: now, updatedAt: now };
    this.byId = next;
    save(next);
  }

  setTags(wb: string, gene_name: string | null, tags: string[]) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    const existing = next[wb];
    const now = Date.now();
    const norm = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    next[wb] = existing
      ? { ...existing, tags: norm, updatedAt: now }
      : { wormbase_gene: wb, gene_name, note: '', tags: norm, createdAt: now, updatedAt: now };
    this.byId = next;
    save(next);
  }

  allTags(): string[] {
    if (!this.initialized) this.init();
    const s = new SvelteSet<string>();
    for (const b of Object.values(this.byId)) {
      for (const t of b.tags ?? []) s.add(t);
    }
    return [...s].sort();
  }

  remove(wb: string) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    delete next[wb];
    this.byId = next;
    save(next);
  }

  count(): number {
    if (!this.initialized) this.init();
    return Object.keys(this.byId).length;
  }
}

export const bookmarks = new BookmarksStore();
