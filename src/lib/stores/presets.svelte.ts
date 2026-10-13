// Saved gene lists as seen from the selection bar. Backed by the datasets store
// (type 'gene-list') so a list saved here is the same object every "From saved list"
// picker and the Datasets page show, and lists made elsewhere load as a selection.

import { datasets, type Dataset } from '$lib/stores/datasets.svelte';
import { parseGeneList } from '$lib/gene-parse';
import { bulkLookup } from '$lib/queries';

const LEGACY_KEY = 'wb_selection_presets';

export interface SelectionPreset {
  id: string;
  name: string;
  ids: string[];
  created_at: number;
}

function toPreset(d: Dataset): SelectionPreset {
  return { id: d.id, name: d.name, ids: parseGeneList(d.body), created_at: d.createdAt };
}

class PresetsStore {
  items = $derived(datasets.items.filter((d) => d.type === 'gene-list').map(toPreset));

  async init() {
    await datasets.init();
    await this.migrateLegacy();
  }

  // Selections saved before the move to datasets lived in localStorage; carry them over once.
  private async migrateLegacy() {
    if (typeof localStorage === 'undefined') return;
    let legacy: { name?: unknown; ids?: unknown }[] = [];
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) legacy = parsed;
    } catch {
      return;
    }
    const taken = new Set(this.items.map((p) => p.name));
    for (const p of [...legacy].reverse()) {
      if (typeof p?.name !== 'string' || !Array.isArray(p.ids) || taken.has(p.name)) continue;
      await this.add(
        p.name,
        p.ids.filter((x): x is string => typeof x === 'string'),
      );
    }
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // noop
    }
  }

  private add(name: string, ids: string[]): Promise<Dataset> {
    return datasets.add({
      name,
      type: 'gene-list',
      body: ids.join('\n'),
      meta: { source: 'selection', count: ids.length },
    });
  }

  // Saving under an existing name replaces that list.
  async save(name: string, ids: string[]): Promise<SelectionPreset> {
    const trimmed = name.trim() || `Selection ${this.items.length + 1}`;
    const existing = this.items.find((p) => p.name === trimmed);
    if (existing) await datasets.remove(existing.id);
    return toPreset(await this.add(trimmed, ids));
  }

  async remove(id: string) {
    await datasets.remove(id);
  }

  get(id: string): SelectionPreset | undefined {
    return this.items.find((p) => p.id === id);
  }
}

export const presets = new PresetsStore();

// Lists saved from a selection hold WBGene IDs; lists pasted on the Datasets page may hold
// names or aliases, so anything that is not a WBGene ID is resolved before it becomes a selection.
export async function resolveListIds(ids: string[]): Promise<string[]> {
  if (ids.every((x) => /^WBGene\d+$/.test(x))) return ids;
  const { hits } = await bulkLookup(ids);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  return [...new Set(hits.map((h) => h.wormbase_gene))];
}
