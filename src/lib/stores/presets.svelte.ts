const KEY = 'wb_selection_presets';

export interface SelectionPreset {
  id: string;
  name: string;
  ids: string[];
  created_at: number;
}

class PresetsStore {
  items = $state<SelectionPreset[]>([]);

  init() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed.filter(
            (p) =>
              typeof p === 'object' &&
              p &&
              typeof p.id === 'string' &&
              typeof p.name === 'string' &&
              Array.isArray(p.ids),
          );
        }
      }
    } catch {
      // noop
    }
  }

  save(name: string, ids: string[]): SelectionPreset {
    const trimmed = name.trim() || `Selection ${this.items.length + 1}`;
    // Replace existing preset with the same name
    const existing = this.items.findIndex((p) => p.name === trimmed);
    const preset: SelectionPreset = {
      id: existing >= 0 ? this.items[existing].id : crypto.randomUUID(),
      name: trimmed,
      ids: [...ids],
      created_at: Date.now(),
    };
    if (existing >= 0) {
      const copy = [...this.items];
      copy[existing] = preset;
      this.items = copy;
    } else {
      this.items = [preset, ...this.items];
    }
    this.persist();
    return preset;
  }

  remove(id: string) {
    this.items = this.items.filter((p) => p.id !== id);
    this.persist();
  }

  get(id: string): SelectionPreset | undefined {
    return this.items.find((p) => p.id === id);
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      // noop
    }
  }
}

export const presets = new PresetsStore();
