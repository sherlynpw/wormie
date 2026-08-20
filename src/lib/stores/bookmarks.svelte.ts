// Per-gene bookmarks: local star + free-text note per WBGene. The star and the
// note are independent, so a gene can carry a note without being starred and vice
// versa; an entry is dropped once it holds neither.
// localStorage-backed (notes are small; no need for OPFS).

import { SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'wb.bookmarks.v1';

export interface Bookmark {
  wormbase_gene: string;
  gene_name: string | null;
  starred: boolean;
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
    if (!raw) return {};
    const parsed = JSON.parse(raw) as State;
    // Before the star and the note were separable, any stored entry was starred.
    for (const b of Object.values(parsed)) {
      if (typeof b.starred !== 'boolean') b.starred = true;
    }
    return parsed;
  } catch {
    return {};
  }
}

/** An entry with no star, no note and no tags is not worth keeping. */
function isEmpty(b: Bookmark): boolean {
  return !b.starred && !b.note.trim() && (b.tags ?? []).length === 0;
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

  /** Starred, as distinct from merely having a note. */
  has(wb: string): boolean {
    if (!this.initialized) this.init();
    return this.byId[wb]?.starred === true;
  }

  hasNote(wb: string): boolean {
    if (!this.initialized) this.init();
    return !!this.byId[wb]?.note.trim();
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
    const existing = next[wb];
    const now = Date.now();
    if (existing) {
      const updated = { ...existing, starred: !existing.starred, updatedAt: now };
      // Unstarring must not discard a note the user wrote.
      if (isEmpty(updated)) delete next[wb];
      else next[wb] = updated;
    } else {
      next[wb] = {
        wormbase_gene: wb,
        gene_name,
        starred: true,
        note: '',
        createdAt: now,
        updatedAt: now,
      };
    }
    this.byId = next;
    save(next);
  }

  setNote(wb: string, gene_name: string | null, note: string) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    const existing = next[wb];
    const now = Date.now();
    const updated: Bookmark = existing
      ? { ...existing, note, updatedAt: now }
      : { wormbase_gene: wb, gene_name, starred: false, note, createdAt: now, updatedAt: now };
    if (isEmpty(updated)) delete next[wb];
    else next[wb] = updated;
    this.byId = next;
    save(next);
  }

  setTags(wb: string, gene_name: string | null, tags: string[]) {
    if (!this.initialized) this.init();
    const next = { ...this.byId };
    const existing = next[wb];
    const now = Date.now();
    const norm = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    const updated: Bookmark = existing
      ? { ...existing, tags: norm, updatedAt: now }
      : {
          wormbase_gene: wb,
          gene_name,
          starred: false,
          note: '',
          tags: norm,
          createdAt: now,
          updatedAt: now,
        };
    if (isEmpty(updated)) delete next[wb];
    else next[wb] = updated;
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

  /** Everything being tracked, starred or noted. */
  count(): number {
    if (!this.initialized) this.init();
    return Object.keys(this.byId).length;
  }

  starredCount(): number {
    if (!this.initialized) this.init();
    return Object.values(this.byId).filter((b) => b.starred).length;
  }
}

export const bookmarks = new BookmarksStore();
