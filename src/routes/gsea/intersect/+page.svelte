<script lang="ts">
  // Ranked-list consensus across comparisons: accepts .bundle.json files from the GseaResults "JSON" button,
  // reports terms passing in K-of-N bundles, ranked by |median NES| x mean leading-edge Jaccard.
  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { toast } from 'svelte-sonner';
  import LoadDatasetPicker from '$lib/components/LoadDatasetPicker.svelte';
  import Upload from 'lucide-svelte/icons/upload';
  import X from 'lucide-svelte/icons/x';
  import PageHint from '$lib/components/PageHint.svelte';
  import ControlHint from '$lib/components/ControlHint.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { signedText } from '$lib/plot-colors';

  type BundleTerm = {
    term_id: string;
    name: string;
    namespace: string | null;
    size: number;
    nes: number;
    q: number;
    leading_edge: string[];
  };

  type Bundle = {
    format: 'wb.gsea.bundle.v1';
    kind: string;
    params: Record<string, unknown>;
    n_genes: number;
    built_at: string;
    terms: BundleTerm[];
  };

  type LoadedBundle = {
    label: string;
    bundle: Bundle;
  };

  let bundles = $state<LoadedBundle[]>([]);
  let qCutoff = $state<number>(0.25);
  let minK = $state<number>(2);
  let jaccardThreshold = $state<number>(0.3);
  let dragOver = $state(false);

  function ingestText(txt: string, label: string) {
    try {
      const b = JSON.parse(txt) as Bundle;
      if (b.format !== 'wb.gsea.bundle.v1') {
        toast.error('Not a wb.gsea bundle', { description: label });
        return;
      }
      bundles = [...bundles, { label, bundle: b }];
      toast.success('Loaded', { description: `${label}: ${b.terms.length} ${b.kind} terms` });
    } catch (e) {
      toast.error('Could not parse bundle', { description: String(e) });
    }
  }

  async function ingestFile(f: File) {
    ingestText(await f.text(), f.name.replace(/\.bundle\.json$/, ''));
  }

  // The datasets page sends "Open in -> Ranked-list consensus" as ?load=bundle&id=.
  onMount(async () => {
    const params = page.url.searchParams;
    const id = params.get('id');
    if (params.get('load') !== 'bundle' || !id) return;
    const { datasets } = await import('$lib/stores/datasets.svelte');
    const ds = await datasets.getById(id);
    if (ds) ingestText(ds.body, ds.name);
  });

  async function onPick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const f of files) await ingestFile(f);
    input.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) void ingestFile(f);
  }

  function removeBundle(idx: number) {
    bundles = bundles.filter((_, i) => i !== idx);
  }

  // Intersect table: terms in >= minK bundles with q <= cutoff and same-sign NES,
  // scored by median |NES| x mean pairwise Jaccard (consistent + overlapping beats single big hits).
  type IntersectRow = {
    term_id: string;
    name: string;
    namespace: string | null;
    hits: number;
    medianNes: number;
    meanJaccard: number;
    consensusLeading: string[];
    perBundle: { label: string; nes: number; q: number; leading_edge: string[] }[];
  };

  const intersected = $derived.by<IntersectRow[]>(() => {
    if (bundles.length < 2) return [];
    // Group by term_id
    /* eslint-disable svelte/prefer-svelte-reactivity */
    const groups = new Map<string, IntersectRow['perBundle']>();
    const meta = new Map<string, { name: string; namespace: string | null }>();
    /* eslint-enable svelte/prefer-svelte-reactivity */
    for (const lb of bundles) {
      for (const t of lb.bundle.terms) {
        if (!(t.q <= qCutoff)) continue;
        if (!groups.has(t.term_id)) groups.set(t.term_id, []);
        groups.get(t.term_id)!.push({
          label: lb.label,
          nes: t.nes,
          q: t.q,
          leading_edge: t.leading_edge,
        });
        if (!meta.has(t.term_id)) meta.set(t.term_id, { name: t.name, namespace: t.namespace });
      }
    }
    const out: IntersectRow[] = [];
    for (const [term, entries] of groups) {
      if (entries.length < minK) continue;
      // Require sign agreement across bundles; mixed-sign hits are not a real consensus.
      const signs = new Set(entries.map((e) => Math.sign(e.nes)));
      if (signs.size > 1) continue;
      // Pairwise Jaccard
      const sets = entries.map((e) => new Set(e.leading_edge));
      let pairs = 0,
        jSum = 0;
      for (let i = 0; i < sets.length; i++) {
        for (let j = i + 1; j < sets.length; j++) {
          const a = sets[i],
            b = sets[j];
          let inter = 0;
          const small = a.size <= b.size ? a : b;
          const big = small === a ? b : a;
          for (const g of small) if (big.has(g)) inter++;
          const union = a.size + b.size - inter || 1;
          jSum += inter / union;
          pairs++;
        }
      }
      const meanJ = pairs > 0 ? jSum / pairs : 0;
      if (meanJ < jaccardThreshold) continue;
      // Consensus leading edge: genes in >= ceil(n/2) contributing bundles.
      const need = Math.ceil(sets.length / 2);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const counts = new Map<string, number>();
      for (const s of sets) for (const g of s) counts.set(g, (counts.get(g) ?? 0) + 1);
      const consensus = [...counts.entries()]
        .filter(([, n]) => n >= need)
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => g);
      const nes = entries.map((e) => e.nes).sort((a, b) => a - b);
      const median = nes[Math.floor(nes.length / 2)];
      out.push({
        term_id: term,
        name: meta.get(term)!.name,
        namespace: meta.get(term)!.namespace,
        hits: entries.length,
        medianNes: median,
        meanJaccard: meanJ,
        consensusLeading: consensus,
        perBundle: entries,
      });
    }
    out.sort(
      (a, b) => Math.abs(b.medianNes) * b.meanJaccard - Math.abs(a.medianNes) * a.meanJaccard,
    );
    return out;
  });

  const kindsMixed = $derived.by(() => {
    const kinds = new Set(bundles.map((b) => b.bundle.kind));
    return kinds.size > 1;
  });
</script>

<svelte:head>
  <title>Ranked-list consensus · wormie.rs.ht</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Ranked-list consensus</h1>
    <p class="text-sm text-muted-foreground">
      Gene sets that score in the same direction in several saved ranked-list runs
    </p>
  </header>

  <PageHint id="gsea-intersect" title="Gene sets that agree across ranked-list results">
    Input: two or more results from ranked-list enrichment (gene set enrichment analysis, GSEA).
    Save a bundle from any run with the <b>Save</b> button on its results, or export a
    <code>.bundle.json</code> file with <b>JSON</b>, then load the files here. Output: the gene sets
    whose q-value (false discovery rate, FDR) is at or below the cutoff in at least K bundles, with
    the same sign of normalized enrichment score (NES) in each. Their leading edges (the genes that
    drive the score) must also overlap: the mean Jaccard index (shared genes divided by all genes in
    both sets) must reach the threshold. Rows are sorted by the absolute median NES times the mean
    Jaccard index. Choose this page to see which gene sets agree across several comparisons.
  </PageHint>

  <Card>
    <CardHeader>
      <CardTitle class="text-xl">Consensus across ranked-list results</CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <p class="text-sm text-muted-foreground">
        Drop two or more bundles (the JSON button on a ranked-list enrichment result). The table
        lists gene sets that pass the q-value cutoff in at least K bundles, with the same direction
        and overlapping leading edges.
      </p>

      <div
        class="rounded-lg border-2 border-dashed p-6 text-center {dragOver
          ? 'border-primary bg-primary/5'
          : 'border-border'}"
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
        role="region"
        aria-label="Bundle drop zone"
      >
        <div class="flex flex-col items-center gap-2 text-sm">
          <Upload class="h-6 w-6 text-muted-foreground" />
          <div>Drag <code class="rounded bg-muted px-1 text-xs">.bundle.json</code> files here</div>
          <label class="cursor-pointer text-xs text-primary hover:underline">
            or browse
            <input
              type="file"
              multiple
              accept="application/json,.json"
              class="hidden"
              onchange={onPick}
            />
          </label>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            or
            <LoadDatasetPicker
              type="gsea-bundle"
              label="load a saved bundle"
              onload={(ds) => ingestText(ds.body, ds.name)}
            />
          </div>
        </div>
      </div>

      {#if bundles.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each bundles as b, i (b.label + i)}
            <span class="inline-flex items-center gap-1.5 rounded border bg-card px-2 py-1 text-xs">
              <span class="font-medium">{b.label}</span>
              <Badge variant="muted" class="py-0 text-[0.55rem]">{b.bundle.kind}</Badge>
              <span class="text-muted-foreground">· {b.bundle.terms.length} terms</span>
              <button
                type="button"
                class="text-muted-foreground hover:text-destructive"
                onclick={() => removeBundle(i)}
                aria-label="Remove bundle"
              >
                <X class="h-3 w-3" />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      {#if kindsMixed}
        <div class="text-xs text-amber-700 dark:text-amber-400">
          Bundles mix kinds (for example GO and WormCat). Term IDs from different kinds do not
          match, so those terms are not combined. Load one kind at a time.
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
        <label class="inline-flex items-center gap-1">
          q ≤
          <input
            type="number"
            step="0.05"
            min="0.01"
            max="1"
            bind:value={qCutoff}
            class="w-16 rounded border bg-card px-1 py-0.5 font-mono text-xs"
          />
          <ControlHint id="intersect-q" title="q-value threshold">
            A gene set only counts in a bundle if its q-value (p-value adjusted for testing many
            gene sets, the false discovery rate) is at or below this cutoff in that bundle. Typical:
            0.05 strict, 0.1 lenient, 0.25 exploratory.
          </ControlHint>
        </label>
        <label class="inline-flex items-center gap-1">
          min K
          <input
            type="number"
            min="2"
            max={Math.max(2, bundles.length)}
            bind:value={minK}
            class="w-14 rounded border bg-card px-1 py-0.5 font-mono text-xs"
          />
          <ControlHint id="intersect-k" title="Minimum hits">
            A gene set must pass the q-value cutoff in at least <code>K</code> of the loaded bundles to
            appear. Set K to the number of loaded bundles to require it in every bundle.
          </ControlHint>
        </label>
        <label class="inline-flex items-center gap-1">
          J ≥
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            bind:value={jaccardThreshold}
            class="w-16 rounded border bg-card px-1 py-0.5 font-mono text-xs"
          />
          <ControlHint id="intersect-j" title="Leading-edge Jaccard index">
            The leading edge is the set of genes that drive a gene set's score. The Jaccard index of
            two leading edges is the genes they share divided by all genes in either. This is the
            mean over all pairs of qualifying bundles. It removes gene sets that pass in K bundles
            but for different genes. The default is 0.3.
          </ControlHint>
        </label>
        <span class="ml-auto">
          {intersected.length} consensus term{intersected.length === 1 ? '' : 's'}
        </span>
      </div>
    </CardContent>
  </Card>

  {#if bundles.length < 2}
    <Card>
      <CardContent class="pt-6 text-sm text-muted-foreground">
        Add at least two bundles to compare.
      </CardContent>
    </Card>
  {:else if intersected.length === 0}
    <Card>
      <CardContent class="pt-6 text-sm text-muted-foreground">
        No terms passed q ≤ {qCutoff}, min K = {minK}, J ≥ {jaccardThreshold} across these bundles. Relax
        the thresholds, or check that the bundles come from the same kind of analysis.
      </CardContent>
    </Card>
  {:else}
    <Card>
      <CardContent class="pt-3">
        <table class="w-full text-sm">
          <thead class="border-b">
            <tr class="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              <th class="px-2 py-1.5 text-left">Term</th>
              <th
                class="px-2 py-1.5 text-right"
                title="How many of the loaded bundles call this term significant at the q cutoff."
                >hits</th
              >
              <th
                class="px-2 py-1.5 text-right"
                title="Median normalized enrichment score (NES) across the bundles that call this term. Positive means shifted toward the top of the ranking."
                >median NES</th
              >
              <th
                class="px-2 py-1.5 text-right"
                title="Mean pairwise Jaccard of the leading-edge gene sets across the bundles that call this term. High means they agree on which genes drive it."
                >mean J</th
              >
              <th
                class="px-2 py-1.5 text-right"
                title="Number of genes found in the leading edge of at least half of the bundles that call this term."
                >consensus</th
              >
            </tr>
          </thead>
          <tbody>
            {#each intersected as row (row.term_id)}
              <tr class="border-b last:border-b-0 hover:bg-muted/30">
                <td class="px-2 py-1.5">
                  <div class="flex flex-wrap items-baseline gap-2">
                    <span class="font-mono text-[0.65rem] text-muted-foreground">{row.term_id}</span
                    >
                    <span class="font-medium">{row.name}</span>
                    {#if row.namespace}
                      <Badge variant="muted" class="py-0 text-[0.55rem]">{row.namespace}</Badge>
                    {/if}
                  </div>
                  <div class="mt-0.5 text-[0.7rem] text-muted-foreground">
                    {#each row.perBundle as pb, i (pb.label + i)}
                      {#if i > 0}<span class="text-muted-foreground/50"> · </span>{/if}
                      <span class="font-mono">
                        {pb.label}: NES {pb.nes.toFixed(2)}, q {pb.q.toExponential(1)}
                      </span>
                    {/each}
                  </div>
                </td>
                <td class="px-2 py-1.5 text-right font-mono text-xs tabular-nums"
                  >{row.hits}/{bundles.length}</td
                >
                <td
                  class="px-2 py-1.5 text-right font-mono text-xs tabular-nums {signedText(
                    row.medianNes,
                  )}"
                >
                  {row.medianNes.toFixed(2)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono text-xs tabular-nums"
                  >{row.meanJaccard.toFixed(2)}</td
                >
                <td class="px-2 py-1.5 text-right font-mono text-xs tabular-nums"
                  >{row.consensusLeading.length} genes</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </CardContent>
    </Card>
  {/if}
</div>
