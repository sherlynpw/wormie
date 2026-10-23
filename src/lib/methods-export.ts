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

// Appended to the ssGSEA paragraph when a trend was tested on the score matrix.
function trendSentence(p: Record<string, unknown>): string {
  const t = p.trend as
    | { model: string; variable: string; splineDf?: number; sets: number; samples: number }
    | undefined;
  if (!t) return '';
  const design =
    t.model === 'factor'
      ? `a factor for ${t.variable}, with a moderated F-test across its levels`
      : t.model === 'spline'
        ? `a natural cubic spline in ${t.variable} with ${t.splineDf ?? 3} degrees of freedom, with a moderated F-test on the spline coefficients, as the limma user guide recommends for time courses`
        : `${t.variable} as a continuous covariate, with a moderated t-test on its slope`;
  return ` A trend across the ${t.samples} samples was tested on the score matrix by fitting, for each of the ${t.sets} gene sets, a linear model of score on ${design}, with limma's lmFit and eBayes (Smyth 2004; Ritchie et al. 2015) run in the browser through WebR, the design recommended for per-sample enrichment scores by Hänzelmann et al. (2013), and p-values adjusted across sets by the Benjamini-Hochberg method.`;
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

// Packages the analyses actually call. Rsubread was dropped from the bundle: nothing
// invoked it, since /counts runs the standalone featureCounts WASM build.
const REPORTED_PACKAGES = ['DESeq2', 'apeglm', 'ashr'];

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
    `Differential expression was performed in-browser using DESeq2 ${p.deseq2Version ? `${p.deseq2Version} ` : ''}(Bioconductor) compiled to WebAssembly via WebR${p.rVersion ? `, R ${p.rVersion}` : ''}. The design was \`~ ${p.batch ? 'batch + ' : ''}condition\` with reference level \`${fmt(p.reference)}\`. We fit with \`DESeq()\`${p.shrinkage === 'none' ? ' and report unshrunken log2 fold changes' : ` and shrank log2 fold changes with \`lfcShrink(type="${p.shrinkage === 'ashr' ? 'ashr' : 'apeglm'}")\`${p.shrinkage === 'ashr' ? '' : ', falling back to `type="ashr"` for comparisons whose baseline is not the reference level'}`}. ${p.minCount ? `Genes with a row-sum < ${p.minCount} were excluded. ` : ''}Engine concordance with native R DESeq2 was validated by the project benchmark over 27,500 genes across three dataset sizes (log2FC Pearson r = 1.0000, padj r = 1.0000, 0 sign flips at padj < 0.05, maximum absolute log2FC difference 1.8e-7 and padj difference 4e-14 against the same DESeq2 release running natively; see Wijaya et al. 2026).`,
  enrichment: (p) =>
    `Over-representation analysis was performed with a hypergeometric test, BH-FDR multiple-testing correction (max q reported), against the \`${fmt(p.kind)}\` annotation set${p.background ? ' with a custom background universe' : ''}.${p.kind === 'go' ? ' Each GO aspect is treated as its own family of tests: the background universe and the BH correction are both scoped to the aspect of the term being tested, so a gene without a biological-process annotation does not enter the denominator of a biological-process term.' : ''} All computation runs in-browser in a Web Worker; gene IDs are resolved against the WormBase WS roster shipped in the local SQLite database. On validation data the implementation agrees with \`fgsea::fora\` (a \`phyper\` wrapper) to within 3.9e-11 relative on every p-value, returns identical gene counts for every term, and recovers all 119 of R's significant terms at q < 0.05 while adding 2.`,
  gsea: (p) =>
    `Preranked GSEA was performed with a custom in-browser implementation (TypeScript, run in Web Workers) of Subramanian et al.'s weighted Kolmogorov-Smirnov enrichment score combined with gene-set permutation (\`nperm = ${fmt(p.nperm ?? 1000)}\`, \`minSize = ${fmt(p.minSize ?? 15)}\`, \`maxSize = ${fmt(p.maxSize ?? 500)}\`, weight exponent \`p = ${fmt(p.weight ?? 1)}\`). Permutations are pooled in log-spaced size buckets (fgsea-style).${p.multilevel === false ? '' : ' Sets whose permutation p-value fell within three times the permutation floor were re-estimated by adaptive multilevel splitting (Korotkevich et al.), scaled by the fraction of null scores sharing the observed sign as in `fgseaMultilevel`.'} On validation data NES correlation versus \`fgsea::fgseaSimple\` was ≥ 0.9999, and the browser run recovered 112 of R's 113 significant sets at q < 0.05 while adding 1.`,
  ssgsea: (p) =>
    `Single-sample GSEA was performed with a custom in-browser implementation (TypeScript, run in a Web Worker) of the Barbie et al. (2009) integral form, with weighting exponent α = ${fmt(p.alpha ?? 0.25)}${p.normalize === false ? '' : ' and final scores scaled by the matrix range (GSVA::ssgseaParam default)'}. Score correlation versus \`GSVA::gsva(ssgseaParam(...))\` on validation data was 1.0000 over 13,200 scores, with maximum absolute deviation 7.8e-5.${trendSentence(p)}`,
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
    'Wijaya, S. P., Sinurat, R. A. O., & Richardson, C. E. (2026). WormIE: an Integrated Explorer for multi-source *C. elegans* annotations and transcriptomic data interpretation. *Genetics*, in preparation.',
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
