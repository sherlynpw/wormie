// In-memory /counts -> /de -> /enrichment handoff (TSVs exceed sessionStorage quota).
// A hard reload clears the handoff; each page accepts paste/upload as fallback.

interface HandoffSlot<T> {
  set(value: T): void;
  consume(): T | null;
  peek(): T | null;
}

function slot<T>(): HandoffSlot<T> {
  let v: T | null = null;
  return {
    set: (value) => {
      v = value;
    },
    consume: () => {
      const out = v;
      v = null;
      return out;
    },
    peek: () => v,
  };
}

export const handoff = {
  /** featureCounts output handed off from /counts to /de. */
  counts: slot<{
    tsv: string;
    samples: string[];
    // Optional design entered on /counts, parallel to `samples`.
    conditions?: string[];
    reference?: string;
  }>(),
  /** DESeq2 results table handed off from /de to /enrichment. */
  deseq2: slot<{ tsv: string }>(),
  /** Ranked list from /de to /gsea. Score is the Wald stat (signed effect magnitude, mirrors fgsea's recommended input). */
  gsea: slot<{ contrastName: string; rows: { gene: string; score: number }[] }>(),
  /** VST expression matrix handed off from /de to /ssgsea. */
  ssgsea: slot<{ tsv: string; label: string }>(),
  /** Two contrasts handed off from /de to /de/diff. */
  deseqDiff: slot<{ a: { name: string; tsv: string }; b: { name: string; tsv: string } }>(),
  /** Current enrichment result table (as clusterProfiler CSV) handed off from /enrichment to /enrichment/overlap. */
  enrichmentOverlap: slot<{ name: string; csv: string }>(),
};

// Expose to window in dev for Playwright to seed handoffs without a hard reload.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { __pipelineHandoff: typeof handoff }).__pipelineHandoff = handoff;
}
