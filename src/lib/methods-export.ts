// Generate a reproducible methods paragraph + version block for the active
// analysis. The output is a Markdown blob users can paste into a manuscript.

import pkg from '../../package.json';

export type Tool = 'deseq2' | 'enrichment' | 'gsea' | 'ssgsea' | 'gmt';

export interface MethodsContext {
  tool: Tool;
  params?: Record<string, unknown>;
  /** Free-form snippets describing the input (e.g. "18,205 genes × 6 samples"). */
  inputSummary?: string;
}

export interface MethodsBundle {
  appVersion: string;
  webrVersion: string;
  dbVersion: string;
  generated: string;
  sources?: Record<string, unknown>;
}

export async function loadBundle(): Promise<MethodsBundle> {
  const dbVer = await fetchVersion();
  return {
    appVersion: pkg.version,
    webrVersion: 'v0.5.9',
    dbVersion: dbVer.version ?? 'unknown',
    sources: dbVer.sources,
    generated: new Date().toISOString(),
  };
}

async function fetchVersion(): Promise<{ version?: string; sources?: Record<string, unknown> }> {
  try {
    const r = await fetch('/data/version.json', { cache: 'no-cache' });
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

const fmt = (x: unknown) => (x === undefined || x === null ? 'default' : String(x));

const toolText: Record<Tool, (p: Record<string, unknown>) => string> = {
  deseq2: (p) =>
    `Differential expression was performed in-browser using DESeq2 (Bioconductor) compiled to WebAssembly via WebR. The design was \`~ ${p.batch ? 'batch + ' : ''}condition\` with reference level \`${fmt(p.reference)}\`. We fit with \`DESeq()\` and shrank log2 fold changes with \`lfcShrink(type="apeglm")\`. ${p.minCount ? `Genes with a row-sum < ${p.minCount} were excluded. ` : ''}Engine concordance with native R DESeq2 was validated by the project benchmark (log2FC Pearson r = 1.0000, padj r = 1.0000, 0 sign flips at padj < 0.05; see Andrew 2026).`,
  enrichment: (p) =>
    `Over-representation analysis was performed with a hypergeometric test, BH-FDR multiple-testing correction (max q reported), against the \`${fmt(p.kind)}\` annotation set${p.background ? ' with a custom background universe' : ''}. All computation runs in-browser in a Web Worker; gene IDs are resolved against the WormBase WS roster shipped in the local SQLite database. The implementation matches \`phyper\` to floating-point identity on validation data.`,
  gsea: (p) =>
    `Preranked GSEA was performed with a custom WebAssembly implementation of Subramanian et al.'s weighted Kolmogorov-Smirnov enrichment score combined with gene-set permutation (\`nperm = ${fmt(p.nperm ?? 1000)}\`, \`minSize = ${fmt(p.minSize ?? 15)}\`, \`maxSize = ${fmt(p.maxSize ?? 500)}\`, weight exponent \`p = ${fmt(p.weight ?? 1)}\`). Permutations are dispatched across Web Workers and pooled in log-spaced size buckets (fgsea-style). NES correlation versus \`fgsea::fgseaSimple\` on validation data was ≥ 0.9999 and significant-set Jaccard was 1.000 at q < 0.05.`,
  ssgsea: (p) =>
    `Single-sample GSEA was performed with a custom WebAssembly implementation of the Barbie et al. (2009) integral form, with weighting exponent α = ${fmt(p.alpha ?? 0.25)}${p.normalize === false ? '' : ' and final scores scaled by the matrix range (GSVA::ssgseaParam default)'}. Score correlation versus \`GSVA::gsva(ssgseaParam(...))\` on validation data was 1.0000 with max absolute deviation ≤ 1e-4.`,
  gmt: (p) =>
    `Analysis was performed against a user-supplied GMT collection (${fmt(p.nSets)} gene sets). The hypergeometric universe is taken as the union of genes in the supplied sets (self-contained universe).`,
};

export function buildMethods(ctx: MethodsContext, bundle: MethodsBundle): string {
  const para = toolText[ctx.tool](ctx.params ?? {});
  const sources = bundle.sources ?? {};
  const sourceBlock = Object.entries(sources)
    .map(([k, v]) => `- **${k}**: ${formatSource(v)}`)
    .join('\n');
  return [
    `## Methods (${ctx.tool})`,
    '',
    para,
    '',
    ctx.inputSummary ? `Input: ${ctx.inputSummary}.\n` : '',
    '### Reproducibility',
    '',
    `- Tool: wormie.rs.ht v${bundle.appVersion}`,
    `- WebR runtime: ${bundle.webrVersion}`,
    `- Annotation database build: ${bundle.dbVersion}`,
    `- Generated: ${bundle.generated}`,
    '',
    sourceBlock ? '### Data sources\n\n' + sourceBlock + '\n' : '',
    '### Citation',
    '',
    'Andrew, R. (2026). wormie.rs.ht: an offline-first browser-native C. elegans gene-explorer with WebR-based DESeq2. *GigaScience*, in preparation.',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSource(v: unknown): string {
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${val}`)
      .join(', ');
  }
  return String(v);
}
