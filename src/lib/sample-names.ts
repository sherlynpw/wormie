/** featureCounts names columns after the BAM path ("/sample.bam"); show the bare sample name. */
export function prettySample(s: string): string {
  return s.replace(/^\//, '').replace(/\.bam$/i, '');
}

/**
 * Guesses a condition per sample by dropping a trailing run accession and replicate token
 * ("sin3_rep3_SRR123" -> "sin3"). Returns null unless that yields real groups: at least two,
 * and fewer than there are samples.
 */
export function inferGroups(samples: string[]): string[] | null {
  const groups = samples.map((s) =>
    prettySample(s)
      .replace(/[_\-. ](?:[SED]RR|GSM)\d+$/i, '')
      .replace(/[_\-. ]?(?:rep(?:licate)?|r)?[_\-. ]?\d+$/i, ''),
  );
  if (groups.some((g) => !g)) return null;
  const distinct = new Set(groups).size;
  return distinct >= 2 && distinct < samples.length ? groups : null;
}
