import { getGenesByIds, type GeneRow } from '$lib/queries';

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function tsvEscape(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export async function exportTsv(ids: string[]) {
  const rows = await getGenesByIds(ids);
  const cols: (keyof GeneRow)[] = [
    'wormbase_gene',
    'gene_name',
    'entrez_id',
    'sequence_name',
    'gene_type',
    'status',
    'gene_class_description',
    'concise_description',
    'legacy_description',
    'other_names',
    'operon',
    'chromosome',
    'start_pos',
    'end_pos',
    'strand',
    'cm',
  ];
  const header = cols.join('\t');
  const body = rows.map((r) => cols.map((c) => tsvEscape(r[c])).join('\t')).join('\n');
  download(`wb_selection_${ts()}.tsv`, `${header}\n${body}\n`, 'text/tab-separated-values');
}

export function exportWBList(ids: string[]) {
  download(`wb_selection_${ts()}.txt`, ids.join('\n') + '\n', 'text/plain');
}

export async function exportGeneNames(ids: string[]) {
  const rows = await getGenesByIds(ids);
  const names = rows
    .map((r) => r.gene_name ?? r.wormbase_gene)
    .filter(Boolean)
    .join('\n');
  download(`wb_selection_names_${ts()}.txt`, names + '\n', 'text/plain');
}

export function exportGmt(ids: string[], label = 'wb_selection') {
  const line = [label, 'wormie.rs.ht export', ...ids].join('\t');
  download(`${label}_${ts()}.gmt`, line + '\n', 'text/plain');
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportCsv(ids: string[]) {
  const rows = await getGenesByIds(ids);
  const cols: (keyof GeneRow)[] = [
    'wormbase_gene',
    'gene_name',
    'entrez_id',
    'sequence_name',
    'gene_type',
    'status',
    'gene_class_description',
    'concise_description',
    'legacy_description',
    'other_names',
    'operon',
    'chromosome',
    'start_pos',
    'end_pos',
    'strand',
    'cm',
  ];
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n');
  download(`wb_selection_${ts()}.csv`, `${header}\n${body}\n`, 'text/csv');
}

async function writeClipboard(text: string, label: string) {
  await navigator.clipboard.writeText(text);
  return label;
}

export async function clipboardWBList(ids: string[]) {
  await writeClipboard(ids.join('\n'), 'WBGene IDs');
  return ids.length;
}

export async function clipboardGeneNames(ids: string[]) {
  const rows = await getGenesByIds(ids);
  const names = rows.map((r) => r.gene_name ?? r.wormbase_gene).filter(Boolean);
  await writeClipboard(names.join('\n'), 'Gene names');
  return names.length;
}

export async function clipboardTsv(ids: string[]) {
  const rows = await getGenesByIds(ids);
  const cols: (keyof GeneRow)[] = [
    'wormbase_gene',
    'gene_name',
    'entrez_id',
    'sequence_name',
    'gene_type',
    'status',
    'concise_description',
  ];
  const header = cols.join('\t');
  const body = rows.map((r) => cols.map((c) => tsvEscape(r[c])).join('\t')).join('\n');
  await writeClipboard(`${header}\n${body}`, 'TSV');
  return rows.length;
}

export async function exportJson(ids: string[]) {
  const rows = await getGenesByIds(ids);
  download(
    `wb_selection_${ts()}.json`,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        source: 'wormie.rs.ht',
        count: rows.length,
        genes: rows,
      },
      null,
      2,
    ),
    'application/json',
  );
}
