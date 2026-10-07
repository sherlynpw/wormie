// Fixed colour scale for the significance axis (-log10 q) of the dot plots, so plots made from
// different gene lists can share one legend. Null means scale to the terms shown. Persisted so
// the setting survives across runs of a case study.

const STORAGE_KEY = 'wb.plot.qscale.v1';

class QScaleStore {
  min = $state<number | null>(null);
  max = $state<number | null>(null);
  initialized = $state<boolean>(false);

  init() {
    if (this.initialized) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { min?: number | null; max?: number | null };
        this.min = Number.isFinite(v.min) ? (v.min as number) : null;
        this.max = Number.isFinite(v.max) ? (v.max as number) : null;
      }
    } catch {
      // ignore
    }
    this.initialized = true;
  }

  set(min: number | null, max: number | null) {
    this.min = min;
    this.max = max;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ min, max }));
    } catch {
      // ignore
    }
  }

  get fixed(): boolean {
    return this.min !== null && this.max !== null && this.max > this.min;
  }
}

export const qScale = new QScaleStore();
