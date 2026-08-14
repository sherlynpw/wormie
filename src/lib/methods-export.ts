// Generate a reproducible methods paragraph + version block for the active
// analysis. The output is a Markdown blob users can paste into a manuscript.

import pkg from '../../package.json';
import { getBundleManifest, type BundlePackage } from '$lib/deseq2/webr-instance';
import { db } from '$lib/stores/db.svelte';

export type Tool = 'deseq2' | 'enrichment' | 'gsea' | 'ssgsea' | 'gmt' | 'nta';

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
  /** R packages baked into the deployed WebR bundle, when the manifest is reachable. */
  rPackages?: BundlePackage[];
  rVersion?: string;
  bundleBaked?: string;
}

export async function loadBundle(): Promise<MethodsBundle> {
  const [dbVer, manifest] = await Promise.all([fetchVersion(), getBundleManifest()]);
  return {
    appVersion: pkg.version,
    webrVersion: 'v0.5.9',
    // The loaded build, which is not always the newest published one.
    dbVersion: db.version || dbVer.version || 'unknown',
    sources: dbVer.sources,
    rPackages: manifest?.packages,
    rVersion: manifest?.rVersion,
    bundleBaked: manifest?.baked,
    generated: new Date().toISOString(),
  };
}

const REPORTED_PACKAGES = ['DESeq2', 'apeglm', 'ashr', 'Rsubread'];

function pkgVersion(bundle: MethodsBundle, name: string): string | null {
  return bundle.rPackages?.find((p) => p.name === name)?.version ?? null;
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
    `Differential expression was performed in-browser using DESeq2 ${p.deseq2Version ? `${p.deseq2Version} ` : ''}(Bioconductor) compiled to WebAssembly via WebR${p.rVersion ? `, R ${p.rVersion}` : ''}. The design was \`~ ${p.batch ? 'batch + ' : ''}condition\` with reference level \`${fmt(p.reference)}\`. We fit with \`DESeq()\` and shrank log2 fold changes with \`lfcShrink(type="apeglm")\`. ${p.minCount ? `Genes with a row-sum < ${p.minCount} were excluded. ` : ''}Engine concordance with native R DESeq2 was validated by the project benchmark (log2FC Pearson r = 1.0000, padj r = 1.0000, 0 sign flips at padj < 0.05; see Andrew 2026).`,
  enrichment: (p) =>
    `Over-representation analysis was performed with a hypergeometric test, BH-FDR multiple-testing correction (max q reported), against the \`${fmt(p.kind)}\` annotation set${p.background ? ' with a custom background universe' : ''}. All computation runs in-browser in a Web Worker; gene IDs are resolved against the WormBase WS roster shipped in the local SQLite database. The implementation matches \`phyper\` to floating-point identity on validation data.`,
  gsea: (p) =>
    `Preranked GSEA was performed with a custom WebAssembly implementation of Subramanian et al.'s weighted Kolmogorov-Smirnov enrichment score combined with gene-set permutation (\`nperm = ${fmt(p.nperm ?? 1000)}\`, \`minSize = ${fmt(p.minSize ?? 15)}\`, \`maxSize = ${fmt(p.maxSize ?? 500)}\`, weight exponent \`p = ${fmt(p.weight ?? 1)}\`). Permutations are dispatched across Web Workers and pooled in log-spaced size buckets (fgsea-style). NES correlation versus \`fgsea::fgseaSimple\` on validation data was ≥ 0.9999 and significant-set Jaccard was 1.000 at q < 0.05.`,
  ssgsea: (p) =>
    `Single-sample GSEA was performed with a custom WebAssembly implementation of the Barbie et al. (2009) integral form, with weighting exponent α = ${fmt(p.alpha ?? 0.25)}${p.normalize === false ? '' : ' and final scores scaled by the matrix range (GSVA::ssgseaParam default)'}. Score correlation versus \`GSVA::gsva(ssgseaParam(...))\` on validation data was 1.0000 with max absolute deviation ≤ 1e-4.`,
  nta: (p) =>
    `Network connectivity was tested against the ${
      p.edgeKind === 'physical'
        ? 'BioGRID physical interaction graph'
        : p.edgeKind === 'genetic'
          ? 'BioGRID genetic interaction graph'
          : 'BioGRID interaction graph (physical and genetic evidence combined)'
    } shipped in the local database. We counted edges induced among the query genes and compared that count to ${fmt(p.perms ?? 1000)} random gene sets${
      p.nullModel === 'uniform'
        ? ' drawn uniformly from the genes present in the interaction data'
        : ', each gene replaced by one drawn from the same degree bin (bins of at least 100 genes, closed on degree boundaries), so that a list of well-studied and therefore better-connected genes is not scored high on that account alone'
    }, reporting the z-score of the observed count against that null. All computation runs in-browser.`,
  gmt: (p) =>
    `Analysis was performed against a user-supplied GMT collection (${fmt(p.nSets)} gene sets). The hypergeometric universe is taken as the union of genes in the supplied sets (self-contained universe).`,
};

export function buildMethods(ctx: MethodsContext, bundle: MethodsBundle): string {
  const params = { ...(ctx.params ?? {}) };
  if (ctx.tool === 'deseq2') {
    params.deseq2Version = pkgVersion(bundle, 'DESeq2') ?? undefined;
    params.rVersion = bundle.rVersion;
  }
  const para = toolText[ctx.tool](params);
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
    ...(bundle.rPackages
      ? [
          `- Analysis bundle: baked ${bundle.bundleBaked ?? 'unknown'}, R ${bundle.rVersion ?? 'unknown'}`,
          ...REPORTED_PACKAGES.map((n) => `  - ${n} ${pkgVersion(bundle, n) ?? 'not in bundle'}`),
        ]
      : []),
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
