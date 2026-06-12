// Minimal KGML parser: extracts positioned entries (genes, compounds, maps, orthologs)
// and relations needed to render the standard KEGG rectangular map layout in SVG.

export interface KgmlEntry {
  id: string;
  type: 'gene' | 'compound' | 'map' | 'ortholog' | 'group' | 'enzyme';
  /** Space-separated KEGG gene IDs ("cel:172123 cel:..."). */
  name: string;
  /** First gene/compound symbol (KGML appends "..." when truncated). */
  label: string;
  /** Full comma-separated list of symbols inside this node (KEGG groups
      several worm orthologs of one mammalian gene into a single box). */
  labels: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  shape: string;
  fg: string;
  bg: string;
  /** For type='group' entries: IDs of the constituent entries (KGML uses
      <component id="..."> children to declare complexes). */
  components: string[];
}

export interface KgmlRelation {
  entry1: string;
  entry2: string;
  type: string;
}

export interface Kgml {
  title: string;
  width: number;
  height: number;
  entries: KgmlEntry[];
  relations: KgmlRelation[];
}

export function parseKgml(xml: string): Kgml {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const title = root.getAttribute('title') ?? '';
  // Canvas size computed from entries (safer than relying on <pathway> attrs); defaults match KEGG canvas.
  let canvasW = 1200;
  let canvasH = 900;
  const entries: KgmlEntry[] = [];
  for (const el of root.querySelectorAll('entry')) {
    const g = el.querySelector('graphics');
    if (!g) continue;
    const x = Number(g.getAttribute('x') ?? 0);
    const y = Number(g.getAttribute('y') ?? 0);
    const w = Number(g.getAttribute('width') ?? 46);
    const h = Number(g.getAttribute('height') ?? 17);
    canvasW = Math.max(canvasW, x + w + 20);
    canvasH = Math.max(canvasH, y + h + 20);
    const rawName = (g.getAttribute('name') ?? '').trim();
    // Multi-gene boxes: "aakb-1, aak-1, aakg-5..." (ellipsis sometimes present). Split on commas, strip trailing "...".
    const labels = rawName
      .split(',')
      .map((s) => s.trim().replace(/\.\.\.$/, ''))
      .filter(Boolean);
    const components: string[] = [];
    for (const c of el.querySelectorAll('component')) {
      const cid = c.getAttribute('id');
      if (cid) components.push(cid);
    }
    entries.push({
      id: el.getAttribute('id') ?? '',
      type: (el.getAttribute('type') ?? 'gene') as KgmlEntry['type'],
      name: el.getAttribute('name') ?? '',
      label: labels[0] ?? '',
      labels,
      x,
      y,
      width: w,
      height: h,
      shape: g.getAttribute('type') ?? 'rectangle',
      fg: g.getAttribute('fgcolor') ?? '#000000',
      bg: g.getAttribute('bgcolor') ?? '#BFFFBF',
      components,
    });
  }
  const relations: KgmlRelation[] = [];
  for (const r of root.querySelectorAll('relation')) {
    relations.push({
      entry1: r.getAttribute('entry1') ?? '',
      entry2: r.getAttribute('entry2') ?? '',
      type: r.getAttribute('type') ?? '',
    });
  }
  return { title, width: canvasW, height: canvasH, entries, relations };
}

/** Extract the set of KEGG `cel:<entrez>` IDs in an entry's name attribute. */
export function entryKeggIds(name: string): string[] {
  return name.split(/\s+/).filter((s) => s.startsWith('cel:'));
}
