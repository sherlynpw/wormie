<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/stores/db.svelte';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import pkg from '../../../package.json';
  import { KEGG_ENABLED } from '$lib/config';

  type Source = {
    name: string;
    version: string;
    updated?: string;
    url: string;
    license?: string;
    licenseUrl?: string;
    description: string;
  };

  // Populated from /data/version.json at runtime; defaults are last-known values for local dev.
  let srcVersions = $state({
    wormbase_release: 'WS298',
    wormbase_date: '2025-11-09',
    wormbase_phenotype_release: 'WS298',
    wormbase_phenotype_date: '2025-11-09',
    go_date: '2026-04-02',
    biogrid_version: '5.0.257',
    alliance_orthology_version: '9.0.0',
    alliance_expression_version: '8.3.0',
    alliance_disease_version: '8.3.0',
    wbbt_date: '2025-12-16',
  });

  const DATA_SOURCES: Source[] = $derived([
    {
      name: 'WormBase gene annotations',
      version: srcVersions.wormbase_release,
      updated: srcVersions.wormbase_date,
      url: 'https://wormbase.org/about/release_schedule',
      license: 'CC0 (Public Domain)',
      licenseUrl: 'https://wormbase.org/about/policies',
      description:
        'Gene roster (~52k WBGene IDs incl. Live/Dead/Suppressed), concise + provisional + automated + gene-class descriptions, sequence names, status, gene types, and transcript-level cross-references (NCBI/UniProt/Ensembl/InterPro). Refreshed from the EBI mirror at ftp.ebi.ac.uk/pub/databases/wormbase since downloads.wormbase.org is bot-blocked. Cite WormBase with the WS release number per their citation policy.',
    },
    {
      name: 'Gene Ontology',
      version: 'current.geneontology.org',
      updated: srcVersions.go_date,
      url: 'https://geneontology.org/',
      license: 'CC BY 4.0',
      licenseUrl: 'https://geneontology.org/docs/go-citation-policy/',
      description:
        'go.obo ontology (48k terms across BP/MF/CC) and wb.gaf.gz annotations (104k associations to C. elegans genes). Always pulled fresh from current.geneontology.org at build time.',
    },
    {
      name: 'WormCat',
      version: 'whole_genome_v2',
      updated: '2021-11-11',
      url: 'https://wormcat.com/',
      license: 'MIT (tool); cite Holdorf et al. 2019',
      licenseUrl: 'https://github.com/dphiggs01/Wormcat',
      description:
        'Hierarchical functional categorization of C. elegans genes (Cat1 → Cat2 → Cat3), 31k genes. Tool released under MIT on GitHub; cite the WormCat publication when using data.',
    },
    {
      name: 'BioGRID interactions',
      version: srcVersions.biogrid_version,
      url: 'https://thebiogrid.org/',
      license: 'MIT',
      licenseUrl: 'https://wiki.thebiogrid.org/doku.php/terms_and_conditions',
      description:
        'Physical and genetic gene-gene interactions for C. elegans. Mapped from Entrez to WBGene via the local pipeline. BioGRID releases all files under MIT and asks that you cite original publications plus the BioGRID paper (Stark et al.).',
    },
    {
      name: 'Alliance of Genome Resources orthology',
      version: srcVersions.alliance_orthology_version,
      url: 'https://www.alliancegenome.org/',
      license: 'CC0 / CC BY 4.0 (mixed)',
      licenseUrl: 'https://www.alliancegenome.org/terms-of-use',
      description:
        'Stringent ortholog calls across 9 species (human, mouse, rat, zebrafish, two frogs, fly, yeast, worm). Most Alliance data is CC0, some datasets are CC BY 4.0; see their terms page.',
    },
    {
      name: 'Neuronal gene classification',
      version: 'local curation',
      url: 'https://wormbase.org/',
      license: 'project-internal',
      description:
        'Custom neuronal supercategory/category curation for 1.3k C. elegans genes (ion channels, GPCRs, neuropeptides, etc.).',
    },
    {
      name: 'WormBase anatomy ontology (WBbt)',
      version: 'obophenotype master',
      updated: srcVersions.wbbt_date,
      url: 'https://github.com/obophenotype/c-elegans-gross-anatomy-ontology',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      description:
        'Anatomical structures and cell types for C. elegans (~7k terms). Underlies the Tissue enrichment tab. Pulled from the obophenotype GitHub mirror since downloads.wormbase.org is bot-blocked.',
    },
    {
      name: 'Alliance expression (gene-tissue)',
      version: srcVersions.alliance_expression_version,
      url: 'https://www.alliancegenome.org/downloads',
      license: 'CC0 / CC BY 4.0 (mixed)',
      licenseUrl: 'https://www.alliancegenome.org/terms-of-use',
      description:
        'Harmonized expression assays from Alliance EXPRESSION-ALLIANCE_WB.tsv: which gene was reported expressed in which WBbt anatomical entity. Feeds the Tissue enrichment/GSEA tab. NOT-qualified rows are dropped.',
    },
    {
      name: 'WormBase phenotype associations',
      version: srcVersions.wormbase_phenotype_release,
      updated: srcVersions.wormbase_phenotype_date,
      url: 'https://wormbase.org/',
      license: 'CC0 (Public Domain)',
      licenseUrl: 'https://wormbase.org/about/policies',
      description:
        'Allele-mediated phenotype associations from WormBase phenotype_association.wb (GAF 2.0, ~440k rows). Each row links a gene to a phenotype through an originating WBVar allele, so we populate both gene_phenotype (collapsed by gene) and allele_phenotype (kept per-allele) in one pass. The Phenotype enrichment tab uses the gene-collapsed view; per-gene pages show allele detail.',
    },
    {
      name: 'Alliance phenotype JSON',
      version: 'PHENOTYPE_WB',
      url: 'https://www.alliancegenome.org/downloads',
      license: 'CC0 / CC BY 4.0 (mixed)',
      licenseUrl: 'https://www.alliancegenome.org/terms-of-use',
      description:
        'Variant-level phenotype annotations from Alliance PHENOTYPE_WB.json.gz. ~27k records are gene-level (used directly), ~26k are variant-level (remapped to genes via the variant→gene index built from the WormBase GAF with/from column). Adds ~20k phenotype rows on top of the WormBase GAF baseline.',
    },
    {
      name: 'Alliance bibliography (references)',
      version: 'REFERENCE_WB',
      url: 'https://www.alliancegenome.org/downloads',
      license: 'CC0 / CC BY 4.0 (mixed)',
      licenseUrl: 'https://www.alliancegenome.org/terms-of-use',
      description:
        'Bulk bibliography dump (REFERENCE_WB.json.gz) used to resolve the WBPaper / PMID references cited on each gene page to real paper titles, journals, years, and DOIs. We store only papers actually cited by our GO + phenotype annotations. Papers newer than the dump cutoff fall back to the WBPaper/PMID link.',
    },
    {
      name: 'NCBI gene2pubmed',
      version: 'NCBI Gene',
      url: 'https://ftp.ncbi.nlm.nih.gov/gene/DATA/',
      license: 'Public Domain (US Government work)',
      licenseUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/',
      description:
        'Gene-to-publication links for C. elegans (tax 6239), joined to genes via the entrez_to_wb map. Drives the comprehensive "All literature" list on each gene page (titles/DOIs resolved from the Alliance bibliography, with a WormBase REST / NCBI esummary fallback for papers the dump lacks).',
    },
    {
      name: 'CeNGEN single-cell expression',
      version: '021821',
      url: 'https://www.cengen.org/',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      description:
        'L4 nervous-system scRNA-Seq atlas from Taylor et al. 2021 (Cell). Four FACS-calibrated binary call matrices (1=liberal, 2=medium, 3=conservative, 4=stringent) for 128 neuron classes + an integrated bulk TMM table for 41 classes. Feeds the Cell-type enrichment/GSEA tab and the /cell-type browse + per-gene heatmap. Cite Taylor et al. 2021.',
    },
    {
      name: 'WormBase RNAi phenotypes',
      version: srcVersions.wormbase_phenotype_release,
      url: 'https://wormbase.org/',
      license: 'CC0 (Public Domain)',
      licenseUrl: 'https://wormbase.org/about/policies',
      description:
        'rnai_phenotypes.wb.gz — 90k records linking WBRNAi reagents to genes + phenotypes (47k unique reagents across 8k genes). Surfaced as the "RNAi reagents" card on each gene page; each WBRNAi deep-links to wormbase.org for clone-name / library metadata.',
    },
    {
      name: 'Alliance disease ontology associations',
      version: srcVersions.alliance_disease_version,
      url: 'https://www.alliancegenome.org/downloads',
      license: 'CC0 / CC BY 4.0 (mixed)',
      licenseUrl: 'https://www.alliancegenome.org/terms-of-use',
      description:
        'DISEASE-ALLIANCE_WB.tsv — C. elegans gene → human Disease Ontology terms (~30k pairs), inferred via human ortholog or assigned directly by WB curators. Drives the Disease enrichment tab and the /disease browse route.',
    },
    {
      name: 'STRING-DB v12 (cel, score ≥ 700)',
      version: 'v12.0',
      url: 'https://string-db.org/',
      license: 'CC BY 4.0',
      licenseUrl: 'https://string-db.org/cgi/access',
      description:
        "High-confidence protein-protein interactions for C. elegans from STRING-DB, filtered to combined_score ≥ 700. Each edge ships with all seven STRING evidence channels (neighborhood, fusion, cooccurrence, coexpression, experimental, database, textmining) so the per-gene STRING card can render an evidence breakdown. STRING-protein IDs are joined to WBGene through STRING's own alias table. Cite Szklarczyk et al. 2023.",
    },
    {
      name: 'KEGG cel pathways (incl. KGML + maps)',
      version: 'rest.kegg.jp (live)',
      url: 'https://www.kegg.jp/kegg/pathway.html',
      license: 'Free for academic use (no bundled redistribution)',
      licenseUrl: 'https://www.kegg.jp/kegg/legal.html',
      description:
        'C. elegans pathway gene sets (~150 maps including Insulin/IGF, TGF-β, FoxO, longevity, autophagy), the KO ↔ worm-gene table, and the pre-rendered pathway map images (lossless WebP) re-encoded from the KEGG PNG output. All assets are pulled at build time from the KEGG REST API and ingested into the local SQLite DB so the /pathway/[id] viewer works fully offline. KEGG REST access is free for academic use; redistribution of the bulk dump is license-restricted (we ship per-pathway assets used to power the local viewer, no full data dump). Cite Kanehisa et al. as KEGG requires.',
    },
    {
      name: 'Synaptogenesis panel (v3)',
      version: 'celegans-pipeline refs/gene_sets',
      url: 'https://github.com/rayandrew/celegans-pipeline',
      license: 'project-internal',
      description:
        'Curated 215-gene panel grouped into 13 functional classes (proneural fate, terminal selector, active zone, SV release, innexins, postsynaptic, Wnt/PHR signaling, etc.). Sourced from the Andrew lab celegans-pipeline repo, with class membership PDF-verified. Drives the Synaptogenesis enrichment/GSEA tab and the gene-page panel card.',
    },
  ]);

  type Dep = { name: string; version: string; url: string };

  function toDeps(map: Record<string, string> | undefined): Dep[] {
    if (!map) return [];
    return Object.entries(map)
      .map(([name, version]) => ({
        name,
        version: version.replace(/^[~^]/, ''),
        url: `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const runtimeDeps = toDeps((pkg as { dependencies?: Record<string, string> }).dependencies);
  const devDeps = toDeps((pkg as { devDependencies?: Record<string, string> }).devDependencies);

  let dbStats = $state<{
    genes: number;
    go_terms: number;
    go_relations: number;
    gene_go: number;
    wormcat: number;
    neuronal: number;
    orthologs: number;
    interactions: number;
    anatomy_terms: number;
    gene_anatomy: number;
    gene_xrefs: number;
    phenotype_terms: number;
    gene_phenotype: number;
    allele_phenotype: number;
    synaptogenesis: number;
    cengen_calls: number;
    gene_rnai: number;
    gene_disease: number;
  } | null>(null);
  let dbVersion = $state<string>('');
  let rawDbSize = $state<number>(0);
  let gzDbSize = $state<number>(0);
  let builtAt = $state<string>('');

  // Ticker keeps "X ago" labels accurate while the page is open.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  function relTime(iso: string): string {
    if (!iso) return '';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const diff = Math.max(0, now - ms);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  onMount(async () => {
    try {
      type VersionDoc = {
        version?: string;
        raw_size?: number;
        gz_size?: number;
        built_at?: string;
        sources?: {
          wormbase?: { release?: string; date?: string };
          wormbase_phenotype?: { release?: string; date?: string };
          go?: { date?: string };
          biogrid?: { version?: string };
          alliance_orthology?: { version?: string };
          alliance_expression?: { version?: string };
          alliance_disease?: { version?: string };
          wbbt?: { date?: string };
        };
      };
      const v: VersionDoc = await (await fetch('/data/version.json')).json();
      dbVersion = v.version ?? '';
      rawDbSize = v.raw_size ?? 0;
      gzDbSize = v.gz_size ?? 0;
      builtAt = v.built_at ?? '';
      const s = v.sources ?? {};
      srcVersions = {
        wormbase_release: s.wormbase?.release ?? srcVersions.wormbase_release,
        wormbase_date: s.wormbase?.date ?? srcVersions.wormbase_date,
        wormbase_phenotype_release:
          s.wormbase_phenotype?.release ?? srcVersions.wormbase_phenotype_release,
        wormbase_phenotype_date: s.wormbase_phenotype?.date ?? srcVersions.wormbase_phenotype_date,
        go_date: s.go?.date ?? srcVersions.go_date,
        biogrid_version: s.biogrid?.version ?? srcVersions.biogrid_version,
        alliance_orthology_version:
          s.alliance_orthology?.version ?? srcVersions.alliance_orthology_version,
        alliance_expression_version:
          s.alliance_expression?.version ?? srcVersions.alliance_expression_version,
        alliance_disease_version:
          s.alliance_disease?.version ?? srcVersions.alliance_disease_version,
        wbbt_date: s.wbbt?.date ?? srcVersions.wbbt_date,
      };
    } catch {
      // ignore
    }
    if (db.phase === 'ready') {
      const { query } = await import('$lib/db/client');
      const rows = await query<typeof dbStats extends infer T ? Exclude<T, null> : never>(
        `SELECT
					(SELECT COUNT(*) FROM annotations) AS genes,
					(SELECT COUNT(*) FROM go_terms) AS go_terms,
					(SELECT COUNT(*) FROM go_relations) AS go_relations,
					(SELECT COUNT(*) FROM gene_go) AS gene_go,
					(SELECT COUNT(*) FROM wormcat) AS wormcat,
					(SELECT COUNT(*) FROM neuronal) AS neuronal,
					(SELECT COUNT(*) FROM orthologs) AS orthologs,
					(SELECT COUNT(*) FROM interactions) AS interactions,
					COALESCE((SELECT COUNT(*) FROM anatomy_terms), 0) AS anatomy_terms,
					COALESCE((SELECT COUNT(*) FROM gene_anatomy), 0) AS gene_anatomy,
					COALESCE((SELECT COUNT(*) FROM gene_xrefs), 0) AS gene_xrefs,
					COALESCE((SELECT COUNT(*) FROM phenotype_terms), 0) AS phenotype_terms,
					COALESCE((SELECT COUNT(*) FROM gene_phenotype), 0) AS gene_phenotype,
					COALESCE((SELECT COUNT(*) FROM allele_phenotype), 0) AS allele_phenotype,
					COALESCE((SELECT COUNT(*) FROM synaptogenesis), 0) AS synaptogenesis,
					COALESCE((SELECT COUNT(*) FROM cengen_calls), 0) AS cengen_calls,
					COALESCE((SELECT COUNT(*) FROM gene_rnai), 0) AS gene_rnai,
					COALESCE((SELECT COUNT(*) FROM gene_disease), 0) AS gene_disease`,
      );
      dbStats = rows[0];
    }
  });

  function fmtMB(bytes: number): string {
    if (!bytes) return '?';
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<svelte:head><title>Data sources &amp; credits · wormie.rs.ht</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
  <Button variant="ghost" size="sm" href="/" class="self-start">
    <ArrowLeft />
    Back
  </Button>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Data sources and credits</CardTitle>
      <div class="text-sm text-muted-foreground">
        wormie.rs.ht is a local-first browser for C. elegans gene annotations, classifications, GO
        ontology, orthology, and interactions. SQLite file.
      </div>
    </CardHeader>
    <CardContent>
      {#if builtAt}
        <div
          class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm"
        >
          <span class="text-muted-foreground">Database last rebuilt:</span>
          <span class="font-mono">{new Date(builtAt).toLocaleString()}</span>
          <span class="font-mono text-muted-foreground">· {relTime(builtAt)}</span>
          <span class="ml-auto text-xs text-muted-foreground">
            WormBase {srcVersions.wormbase_release}
          </span>
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            DB version
          </div>
          <div class="font-mono">{dbVersion || '...'}</div>
        </div>
        <div>
          <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            DB size (download)
          </div>
          <div class="font-mono">{fmtMB(gzDbSize)}</div>
        </div>
        <div>
          <div class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            DB size (raw)
          </div>
          <div class="font-mono">{fmtMB(rawDbSize)}</div>
        </div>
        {#if dbStats}
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Genes
            </div>
            <div class="font-mono tabular-nums">{dbStats.genes.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              GO terms
            </div>
            <div class="font-mono tabular-nums">{dbStats.go_terms.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              GO associations
            </div>
            <div class="font-mono tabular-nums">{dbStats.gene_go.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              WormCat rows
            </div>
            <div class="font-mono tabular-nums">{dbStats.wormcat.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Orthologs
            </div>
            <div class="font-mono tabular-nums">{dbStats.orthologs.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Anatomy terms
            </div>
            <div class="font-mono tabular-nums">{dbStats.anatomy_terms.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Gene-anatomy
            </div>
            <div class="font-mono tabular-nums">{dbStats.gene_anatomy.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Gene xrefs
            </div>
            <div class="font-mono tabular-nums">{dbStats.gene_xrefs.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Phenotype terms
            </div>
            <div class="font-mono tabular-nums">{dbStats.phenotype_terms.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Gene-phenotype
            </div>
            <div class="font-mono tabular-nums">{dbStats.gene_phenotype.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Allele-phenotype
            </div>
            <div class="font-mono tabular-nums">{dbStats.allele_phenotype.toLocaleString()}</div>
          </div>
          <div>
            <div
              class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Interactions
            </div>
            <div class="font-mono tabular-nums">{dbStats.interactions.toLocaleString()}</div>
          </div>
        {/if}
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Data sources</CardTitle>
      <div class="text-xs text-muted-foreground">
        Each row in the local database is sourced from one of these public datasets. Versions
        reflect what's currently in this build.
      </div>
    </CardHeader>
    <CardContent class="divide-y pt-0">
      {#each DATA_SOURCES.filter((s) => KEGG_ENABLED || !s.name.startsWith('KEGG')) as s (s.name)}
        <div class="py-3 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-baseline gap-2">
            <!-- eslint-disable svelte/no-navigation-without-resolve -->
            <a
              href={s.url}
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1 text-sm font-semibold hover:text-primary"
            >
              {s.name}
              <ExternalLink class="h-3 w-3" />
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
            <Badge variant="secondary" class="font-mono text-[0.65rem]">{s.version}</Badge>
            {#if s.updated}
              <Badge variant="muted" class="font-mono text-[0.65rem]">
                updated {s.updated}
                {#if relTime(s.updated)}
                  <span class="ml-1 text-muted-foreground/70">· {relTime(s.updated)}</span>
                {/if}
              </Badge>
            {/if}
            {#if s.license}
              {#if s.licenseUrl}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <a
                  href={s.licenseUrl}
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center"
                  title="View source's license terms"
                >
                  <Badge
                    variant="outline"
                    class="text-[0.65rem] transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {s.license}
                    <ExternalLink class="ml-1 h-2.5 w-2.5" />
                  </Badge>
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {:else}
                <Badge variant="outline" class="text-[0.65rem]">{s.license}</Badge>
              {/if}
            {:else if s.licenseUrl}
              <!-- eslint-disable svelte/no-navigation-without-resolve -->
              <a
                href={s.licenseUrl}
                target="_blank"
                rel="noopener"
                class="inline-flex items-center"
              >
                <Badge
                  variant="outline"
                  class="text-[0.65rem] transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  See source for terms
                  <ExternalLink class="ml-1 h-2.5 w-2.5" />
                </Badge>
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/if}
          </div>
          <div class="mt-1 text-sm leading-relaxed text-muted-foreground">{s.description}</div>
        </div>
      {/each}
    </CardContent>
  </Card>

  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Open source dependencies</CardTitle>
      <div class="text-xs text-muted-foreground">
        Read directly from package.json at build time. Click any name for license + source.
      </div>
    </CardHeader>
    <CardContent class="space-y-3 pt-0">
      <div>
        <div
          class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Runtime ({runtimeDeps.length})
        </div>
        <div class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {#each runtimeDeps as d (d.name)}
            <!-- eslint-disable svelte/no-navigation-without-resolve -->
            <a
              href={d.url}
              target="_blank"
              rel="noopener"
              class="flex items-baseline justify-between gap-2 hover:text-primary"
            >
              <span class="truncate font-mono text-xs">{d.name}</span>
              <span class="font-mono text-[0.65rem] tabular-nums text-muted-foreground"
                >{d.version}</span
              >
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          {/each}
        </div>
      </div>
      <div>
        <div
          class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Build / dev ({devDeps.length})
        </div>
        <div class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {#each devDeps as d (d.name)}
            <!-- eslint-disable svelte/no-navigation-without-resolve -->
            <a
              href={d.url}
              target="_blank"
              rel="noopener"
              class="flex items-baseline justify-between gap-2 hover:text-primary"
            >
              <span class="truncate font-mono text-xs">{d.name}</span>
              <span class="font-mono text-[0.65rem] tabular-nums text-muted-foreground"
                >{d.version}</span
              >
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          {/each}
        </div>
      </div>
    </CardContent>
  </Card>
</div>
