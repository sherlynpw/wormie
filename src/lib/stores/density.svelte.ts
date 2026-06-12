// Density preference ('comfortable' | 'compact') for cards/table views.
// Compact shrinks padding and hides secondary detail (2-3x more rows).
// Persisted in localStorage.

const STORAGE_KEY = 'wb.density.v1';

export type Density = 'comfortable' | 'compact';

class DensityStore {
  value = $state<Density>('comfortable');
  initialized = $state<boolean>(false);

  init() {
    if (this.initialized) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'compact' || raw === 'comfortable') this.value = raw;
    } catch {
      // ignore
    }
    this.initialized = true;
  }

  set(v: Density) {
    this.value = v;
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // ignore
    }
  }

  toggle() {
    this.set(this.value === 'compact' ? 'comfortable' : 'compact');
  }
}

export const density = new DensityStore();
