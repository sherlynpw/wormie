const KEY = 'wb_recents';
const MAX = 8;

export type RecentKind = 'search' | 'gene' | 'go';

export interface Recent {
  kind: RecentKind;
  value: string;
  label: string;
  at: number;
}

class RecentsStore {
  items = $state<Recent[]>([]);

  init() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.items = parsed.slice(0, MAX);
      }
    } catch {
      // noop
    }
  }

  push(kind: RecentKind, value: string, label: string) {
    const filtered = this.items.filter((r) => !(r.kind === kind && r.value === value));
    this.items = [{ kind, value, label, at: Date.now() }, ...filtered].slice(0, MAX);
    this.persist();
  }

  clear() {
    this.items = [];
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      // noop
    }
  }
}

export const recents = new RecentsStore();
