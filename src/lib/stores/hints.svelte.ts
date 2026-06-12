// Unified hint registry for PageHint strips and ControlHint info-icons.
// Migrates legacy keys (wb.hints.v1, wb.controlHints.v1) on first read.
// localStorage layout: wb.hints.v2 = {"dismissed": [...], "allOff": false}

import { SvelteSet } from 'svelte/reactivity';

const KEY = 'wb.hints.v2';
const LEGACY_PAGE = 'wb.hints.v1';
const LEGACY_CONTROL = 'wb.controlHints.v1';
const LEGACY_ALL_OFF = 'wb.hints.allOff';

type State = {
  dismissed: string[];
  allOff: boolean;
};

function loadFromStorage(): State {
  if (typeof localStorage === 'undefined') {
    return { dismissed: [], allOff: false };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as State;
      if (Array.isArray(v?.dismissed)) return { dismissed: v.dismissed, allOff: Boolean(v.allOff) };
    }
    // Migrate legacy keys, then erase them.
    const dismissed = new SvelteSet<string>();
    for (const legacy of [LEGACY_PAGE, LEGACY_CONTROL]) {
      try {
        const r = localStorage.getItem(legacy);
        if (!r) continue;
        const arr = JSON.parse(r);
        if (Array.isArray(arr)) for (const id of arr) dismissed.add(String(id));
      } catch {
        // ignore malformed legacy
      }
    }
    const allOff = localStorage.getItem(LEGACY_ALL_OFF) === '1';
    const next: State = { dismissed: [...dismissed], allOff };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      localStorage.removeItem(LEGACY_PAGE);
      localStorage.removeItem(LEGACY_CONTROL);
      localStorage.removeItem(LEGACY_ALL_OFF);
    } catch {
      // quota; in-memory state is still fine
    }
    return next;
  } catch {
    return { dismissed: [], allOff: false };
  }
}

function persist(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

class HintsStore {
  dismissed = $state<Set<string>>(new Set());
  allOff = $state<boolean>(false);
  initialized = $state<boolean>(false);

  init() {
    if (this.initialized) return;
    const loaded = loadFromStorage();
    this.dismissed = new Set(loaded.dismissed);
    this.allOff = loaded.allOff;
    this.initialized = true;
  }

  shouldShow(id: string): boolean {
    if (!this.initialized) this.init();
    return !this.allOff && !this.dismissed.has(id);
  }

  dismiss(id: string) {
    if (this.dismissed.has(id)) return;
    const next = new SvelteSet(this.dismissed);
    next.add(id);
    this.dismissed = next;
    persist({ dismissed: [...next], allOff: this.allOff });
  }

  hideAll() {
    this.allOff = true;
    persist({ dismissed: [...this.dismissed], allOff: true });
  }

  resetAll() {
    this.dismissed = new Set();
    this.allOff = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }

  totalCount(): number {
    return this.dismissed.size;
  }
}

export const hints = new HintsStore();
