// Parser for the wormie.bio GSEA results TSV (from GseaResults.exportTsv).
// Columns: term_id, name, namespace, size, es, nes, p, q, leading_edge (pipe-delimited).
// Returns parsed rows + dropped count for bad-input detection.

export interface ParsedGseaRow {
  term_id: string;
  name: string;
  namespace: string | null;
  size: number;
  es: number;
  nes: number;
  p: number;
  q: number;
  leading_edge: string[];
}

export interface ParsedGseaTsv {
  rows: ParsedGseaRow[];
  dropped: number;
  totalRows: number;
}

function splitLine(line: string): string[] {
  return line.split('\t'); // export format is always tab-only
}

export function parseGseaTsv(text: string): ParsedGseaTsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, ''))
    .filter((l) => l.trim().length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return { rows: [], dropped: 0, totalRows: 0 };

  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idCol = col('term_id');
  const nameCol = col('name');
  const nsCol = col('namespace');
  const sizeCol = col('size');
  const esCol = col('es');
  const nesCol = col('nes');
  const pCol = col('p');
  const qCol = col('q');
  const leCol = col('leading_edge');

  if (idCol < 0 || nesCol < 0 || qCol < 0) {
    throw new Error(
      'Could not detect required columns. Expected at least term_id, nes, q (this is the wormie.bio GSEA export format).',
    );
  }

  const rows: ParsedGseaRow[] = [];
  let dropped = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = splitLine(lines[i]);
    if (parts.length <= idCol) {
      dropped++;
      continue;
    }
    const term_id = parts[idCol]?.trim();
    if (!term_id) {
      dropped++;
      continue;
    }
    const nes = parseFloat(parts[nesCol]);
    const q = parseFloat(parts[qCol]);
    if (!Number.isFinite(nes) || !Number.isFinite(q)) {
      dropped++;
      continue;
    }
    const name = (nameCol >= 0 ? parts[nameCol] : '')?.trim() || term_id;
    const namespace = (nsCol >= 0 ? parts[nsCol]?.trim() : '') || null;
    const size = sizeCol >= 0 ? parseInt(parts[sizeCol], 10) : 0;
    const es = esCol >= 0 ? parseFloat(parts[esCol]) : nes;
    const p = pCol >= 0 ? parseFloat(parts[pCol]) : q;
    const leadingRaw = leCol >= 0 ? (parts[leCol] ?? '') : '';
    const leading_edge = leadingRaw
      ? leadingRaw
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    rows.push({
      term_id,
      name,
      namespace,
      size: Number.isFinite(size) ? size : 0,
      es: Number.isFinite(es) ? es : nes,
      nes,
      p: Number.isFinite(p) ? p : q,
      q,
      leading_edge,
    });
  }
  return { rows, dropped, totalRows: lines.length - 1 };
}
