// Plain-language reading of the DESeq2 errors users actually hit, shown under the raw
// message so a failed fit says what to change rather than only what R reported.

const HINTS: { match: RegExp; hint: string }[] = [
  {
    match: /dispersion estimates are within 2 orders of magnitude/i,
    hint: 'Too few genes vary between samples for DESeq2 to fit its dispersion trend. Usually the pre-filter left very few genes, or the replicates are near-identical. Lower the pre-filter and check that the table holds raw counts.',
  },
  {
    match: /every gene contains at least one zero/i,
    hint: 'Every gene has a zero count in at least one sample, so size factors cannot be computed. This usually means one sample has almost no reads; check the library sizes in Sample QC.',
  },
  {
    match: /full rank/i,
    hint: 'The design cannot separate condition from batch: a condition appears in only one batch, or the batch labels repeat the conditions. Change the batch labels or untick the batch covariate.',
  },
  {
    match: /non-negative integer|must be integer/i,
    hint: 'DESeq2 needs raw counts: whole, non-negative numbers. TPM, FPKM or already-normalized values will not work.',
  },
];

export function deseq2ErrorHint(message: string): string | null {
  return HINTS.find((h) => h.match.test(message))?.hint ?? null;
}
