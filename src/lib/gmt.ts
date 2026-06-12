// Minimal GMT parser (Broad MSigDB convention): SET_NAME\tDESCRIPTION_OR_URL\tgene1\tgene2\t...
// '#' comments and blank lines are skipped. Description column preserved for tooltips.

export interface GmtSet {
  name: string;
  description: string;
  genes: string[];
}

export function parseGmt(text: string): GmtSet[] {
  const sets: GmtSet[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [name, description, ...genes] = parts;
    const cleaned = genes.map((g) => g.trim()).filter(Boolean);
    if (!name || cleaned.length === 0) continue;
    sets.push({ name, description: description ?? '', genes: cleaned });
  }
  return sets;
}

export interface GmtStats {
  count: number;
  minSize: number;
  maxSize: number;
  medianSize: number;
  uniqueGenes: number;
}

export function summarize(sets: GmtSet[]): GmtStats {
  if (sets.length === 0) return { count: 0, minSize: 0, maxSize: 0, medianSize: 0, uniqueGenes: 0 };
  const sizes = sets.map((s) => s.genes.length).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const uniq = new Set<string>();
  for (const s of sets) for (const g of s.genes) uniq.add(g);
  return {
    count: sets.length,
    minSize: sizes[0],
    maxSize: sizes[sizes.length - 1],
    medianSize: median,
    uniqueGenes: uniq.size,
  };
}
