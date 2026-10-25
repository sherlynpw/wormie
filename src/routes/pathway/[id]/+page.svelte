<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { query } from '$lib/db/client';
  import { getPathwayImage } from '$lib/queries';
  import { parseKgml, entryKeggIds, type Kgml, type KgmlEntry } from '$lib/kgml';
  import PathwayMap from '$lib/components/PathwayMap.svelte';
  import { KEGG_ENABLED } from '$lib/config';
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';

  // URL IDs arrive as bare "cel04212" or canonical "path:cel04212"; normalize to "path:" prefix for DB.
  const rawId = $derived(page.params.id ?? '');
  const pathwayId = $derived(rawId.startsWith('path:') ? rawId : `path:${rawId}`);

  let kgml = $state<Kgml | null>(null);
  let imageUrl = $state<string | null>(null);
  let imageWidth = $state<number | null>(null);
  let imageHeight = $state<number | null>(null);
  let pathwayName = $state('');
  let memberCount = $state(0);
  let loading = $state(true);
  // entry.id -> worm genes. KEGG boxes can hold multiple orthologs (e.g. AMPK has 6 worm
  // subunits); KGML <graphics name="..."> truncates that list, so we rebuild from cel: IDs.
  type EntryGene = { wb: string; name: string };
  let entryGenes = $state<Map<string, EntryGene[]>>(new Map());

  // $effect re-runs on pathwayId changes; SvelteKit reuses the component across
  // dynamic-segment navigation so onMount would only fire once.
  let loadToken = 0;
  $effect(() => {
    const id = pathwayId;
    if (!id) return;
    untrack(async () => {
      const my = ++loadToken;
      // Clear stale state immediately to avoid flashing the previous pathway.
      loading = true;
      kgml = null;
      pathwayName = '';
      memberCount = 0;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = null;
      imageWidth = null;
      imageHeight = null;
      entryGenes = new Map();
      pinnedEntryReset();

      try {
        const rows = await query<{ xml: string; name: string }>(
          `SELECT k.xml, p.name FROM kegg_kgml k
             LEFT JOIN kegg_pathway p ON p.pathway_id = k.pathway_id
             WHERE k.pathway_id = ?`,
          [id],
        );
        if (my !== loadToken) return;
        if (!rows.length) {
          toast.error(`Pathway not found: ${id}`);
          loading = false;
          return;
        }
        pathwayName = rows[0].name ?? id;
        const parsed = parseKgml(rows[0].xml);
        kgml = parsed;
        const m = await query<{ n: number }>(
          'SELECT COUNT(DISTINCT wormbase_gene) AS n FROM gene_kegg_pathway WHERE pathway_id = ?',
          [id],
        );
        if (my !== loadToken) return;
        memberCount = m[0]?.n ?? 0;
        const img = await getPathwayImage(id);
        if (my !== loadToken) return;
        if (img) {
          const blob = new Blob([new Uint8Array(img.bytes)], { type: img.mime });
          imageUrl = URL.createObjectURL(blob);
          imageWidth = img.width;
          imageHeight = img.height;
        }
        await resolveEntryGenes(parsed, my);
        if (my !== loadToken) return;
      } catch (e) {
        if (my === loadToken) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === loadToken) loading = false;
      }
    });
  });

  // PathwayMap is keyed by pathwayId, so navigation creates a fresh instance with no popover state.
  function pinnedEntryReset() {}

  async function resolveEntryGenes(parsed: Kgml, token: number) {
    // Batched pass: resolve gene + ortholog entries, then expand group entries (KEGG complexes)
    // by unioning <component> children's genes. Result covers every clickable entry type.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seqTokens = new Set<string>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const koTokens = new Set<string>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const entrySeqs = new Map<string, string[]>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const entryKos = new Map<string, string[]>();
    for (const e of parsed.entries as KgmlEntry[]) {
      if (e.type === 'gene') {
        const seqs = entryKeggIds(e.name)
          .map((k) => k.replace(/^cel:/, ''))
          .map((s) => (s.startsWith('CELE_') ? s.slice(5) : s));
        entrySeqs.set(e.id, seqs);
        for (const s of seqs) seqTokens.add(s.toUpperCase());
      } else if (e.type === 'ortholog') {
        // ko_to_wb stores IDs with the "ko:" prefix; preserve it for IN-list matching.
        const kos = e.name.split(/\s+/).filter((t) => t.startsWith('ko:'));
        entryKos.set(e.id, kos);
        for (const k of kos) koTokens.add(k);
      }
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seqToGene = new Map<string, EntryGene>();
    if (seqTokens.size > 0) {
      const tokens = [...seqTokens];
      const placeholders = tokens.map(() => '?').join(',');
      const rows = await query<{
        sequence_name: string;
        wormbase_gene: string;
        gene_name: string | null;
      }>(
        `SELECT sequence_name, wormbase_gene, gene_name FROM annotations
           WHERE UPPER(sequence_name) IN (${placeholders})`,
        tokens,
      );
      if (token !== loadToken) return;
      for (const r of rows) {
        seqToGene.set(r.sequence_name.toUpperCase(), {
          wb: r.wormbase_gene,
          name: r.gene_name ?? r.wormbase_gene,
        });
      }
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const koToGenes = new Map<string, EntryGene[]>();
    if (koTokens.size > 0) {
      try {
        const tokens = [...koTokens];
        const placeholders = tokens.map(() => '?').join(',');
        const rows = await query<{
          ko_id: string;
          wormbase_gene: string;
          gene_name: string | null;
        }>(
          `SELECT k.ko_id, k.wormbase_gene, a.gene_name
             FROM ko_to_wb k LEFT JOIN annotations a ON a.wormbase_gene = k.wormbase_gene
             WHERE k.ko_id IN (${placeholders})`,
          tokens,
        );
        if (token !== loadToken) return;
        for (const r of rows) {
          const arr = koToGenes.get(r.ko_id) ?? [];
          if (!arr.find((x) => x.wb === r.wormbase_gene)) {
            arr.push({ wb: r.wormbase_gene, name: r.gene_name ?? r.wormbase_gene });
          }
          koToGenes.set(r.ko_id, arr);
        }
      } catch {
        // ko_to_wb absent in older DBs.
      }
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, EntryGene[]>();
    const dedupe = (xs: EntryGene[]) => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const seen = new Set<string>();
      return xs.filter((g) => (seen.has(g.wb) ? false : (seen.add(g.wb), true)));
    };
    for (const [eid, seqs] of entrySeqs) {
      const hits: EntryGene[] = [];
      for (const s of seqs) {
        const g = seqToGene.get(s.toUpperCase());
        if (g) hits.push(g);
      }
      map.set(eid, dedupe(hits));
    }
    for (const [eid, kos] of entryKos) {
      const hits: EntryGene[] = [];
      for (const k of kos) {
        const gs = koToGenes.get(k);
        if (gs) hits.push(...gs);
      }
      map.set(eid, dedupe(hits));
    }
    // Expand group entries: union resolved genes of each component.
    for (const e of parsed.entries as KgmlEntry[]) {
      if (e.type !== 'group' || e.components.length === 0) continue;
      const hits: EntryGene[] = [];
      for (const cid of e.components) {
        const gs = map.get(cid);
        if (gs) hits.push(...gs);
      }
      map.set(e.id, dedupe(hits));
    }

    if (token === loadToken) entryGenes = map;
  }

  const keggUrl = $derived(`https://www.kegg.jp/pathway/${pathwayId.replace(/^path:/, '')}`);
</script>

<svelte:head><title>{pathwayName || pathwayId} · wormie.rs.ht</title></svelte:head>

<div class="container mx-auto max-w-7xl space-y-4 p-4">
  {#if !KEGG_ENABLED}
    <Card>
      <CardHeader><CardTitle class="text-base">Pathway viewer unavailable</CardTitle></CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground">
          Kyoto Encyclopedia of Genes and Genomes (KEGG) pathway data is not included in this build,
          so the pathway viewer is disabled.
        </p>
      </CardContent>
    </Card>
  {:else}
    <header class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{pathwayName || pathwayId}</h1>
      <code class="text-sm text-muted-foreground">{pathwayId}</code>
      <a
        href={keggUrl}
        target="_blank"
        rel="noopener"
        class="text-sm text-primary underline hover:no-underline"
      >
        open at KEGG ↗
      </a>
      {#if memberCount > 0}
        <span class="text-sm text-muted-foreground">{memberCount} worm genes annotated</span>
      {/if}
    </header>

    {#if loading}
      <p class="text-muted-foreground">Loading…</p>
    {:else if kgml}
      <Card>
        <CardHeader><CardTitle class="text-base">Pathway map</CardTitle></CardHeader>
        <CardContent>
          {#key pathwayId}
            <PathwayMap
              {kgml}
              {imageUrl}
              {imageWidth}
              {imageHeight}
              {entryGenes}
              onEntryClick={(e) => {
                if (e.type === 'gene' || e.type === 'ortholog' || e.type === 'group') {
                  const genes = entryGenes.get(e.id) ?? [];
                  // Single gene: navigate; multiple: PathwayMap shows a pinned popover with chips.
                  if (genes.length === 1) goto(resolve(`/gene/${genes[0].wb}`));
                  else if (genes.length === 0) {
                    // Ortholog with no worm mapping: open the KEGG KO page instead.
                    if (e.type === 'ortholog') {
                      const m = e.name.match(/ko:(K\d+)/);
                      if (m) {
                        window.open(`https://www.kegg.jp/entry/${m[1]}`, '_blank', 'noopener');
                        return;
                      }
                    }
                    toast.message(e.labels.join(', ') || e.label, {
                      description: 'No mapped worm gene for this KEGG entry',
                    });
                  }
                  return;
                }
                if (e.type === 'map') {
                  // Subpathways may use organism-neutral "path:mapNNNNN"; always route to cel-prefixed.
                  const m = e.name.match(/path:[a-z]+(\d+)/);
                  if (m) goto(resolve(`/pathway/cel${m[1]}`));
                  return;
                }
                if (e.type === 'compound') {
                  const m = e.name.match(/cpd:(C\d+)/);
                  if (m) window.open(`https://www.kegg.jp/entry/${m[1]}`, '_blank', 'noopener');
                }
              }}
            />
          {/key}
          <p class="mt-2 text-xs text-muted-foreground">
            {#if imageUrl}
              Drawn on KEGG's pathway image (stored in the local database, so it works offline).
              Clickable areas from the KEGG Markup Language (KGML) file sit on top of the image. The
              layout is the same as on kegg.jp.
            {:else}
              Drawn from the box positions in the KEGG Markup Language (KGML) file only. The KEGG
              image is not available for this pathway.
            {/if}
          </p>
        </CardContent>
      </Card>
    {:else}
      <p class="text-muted-foreground">No pathway map available.</p>
    {/if}
  {/if}
</div>
