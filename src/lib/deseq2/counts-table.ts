// Shared reader for raw count tables pasted or uploaded to /de. Accepts the featureCounts
// layout (Geneid + Chr/Start/End/Strand/Length, then samples) and a plain gene-by-sample
// matrix (merged HTSeq, nf-core/rnaseq salmon/featureCounts merges, R write.table output),
// tab- or comma-separated.

const FEATURECOUNTS_META = ['chr', 'start', 'end', 'strand', 'length'];

export interface CountsLayout {
  delim: string;
  header: string[]; // sample columns only
  sampleStart: number; // index of the first sample column in a data row
}

function dataLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
}

function unquote(s: string): string {
  return s.trim().replace(/^"+|"+$/g, '');
}

export function countsLayout(text: string): CountsLayout | null {
  const lines = dataLines(text);
  if (lines.length < 1) return null;
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map(unquote);
  const isFeatureCounts = FEATURECOUNTS_META.every((m, i) => header[i + 1]?.toLowerCase() === m);
  if (isFeatureCounts) return { delim, header: header.slice(6), sampleStart: 6 };
  // R's write.table() omits the row-name column from the header, so it is one field short.
  const firstRowLen = lines[1]?.split(delim).length ?? header.length;
  if (header.length === firstRowLen - 1) return { delim, header, sampleStart: 1 };
  return { delim, header: header.slice(1), sampleStart: 1 };
}

export function countsSamples(text: string): string[] {
  return countsLayout(text)?.header ?? [];
}

export function parseCountsTable(text: string): {
  genes: string[];
  samples: string[];
  counts: number[][];
} {
  const layout = countsLayout(text);
  const lines = dataLines(text);
  if (!layout || lines.length < 2) throw new Error('The counts table has no data rows');
  const { delim, header: samples, sampleStart } = layout;
  const genes: string[] = [];
  const counts: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    if (cols.length < sampleStart + samples.length) continue;
    genes.push(unquote(cols[0]));
    counts.push(
      // Merged salmon / nf-core matrices hold estimated counts; DESeq2 needs integers.
      cols
        .slice(sampleStart, sampleStart + samples.length)
        .map((s) => Math.round(Number(unquote(s))) || 0),
    );
  }
  return { genes, samples, counts };
}
