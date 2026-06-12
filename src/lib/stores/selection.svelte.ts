const STORAGE_KEY = 'wb_selection';

class SelectionStore {
  ids = $state<string[]>([]);

  init() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.ids = parsed.filter((x) => typeof x === 'string');
      }
    } catch {
      // noop
    }
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  toggle(id: string) {
    if (this.has(id)) this.ids = this.ids.filter((x) => x !== id);
    else this.ids = [...this.ids, id];
    this.persist();
  }

  add(id: string) {
    if (!this.has(id)) {
      this.ids = [...this.ids, id];
      this.persist();
    }
  }

  clear() {
    this.ids = [];
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ids));
    } catch {
      // noop
    }
  }
}

export const selection = new SelectionStore();
