// NOT-qualified GO annotations are stored for the gene page but must not count
// as positive evidence in enrichment (GAF qualifiers are pipe-separated, e.g.
// NOT|involved_in; propagated rows carry NULL).
export const GO_POSITIVE = "(qualifier IS NULL OR instr('|' || qualifier || '|', '|NOT|') = 0)";

// CeNGEN binary calls live at four FACS-calibrated thresholds (1=liberal, 2=medium,
// 3=conservative, 4=stringent). Cell-type sets use medium, the CeNGEN app's own default;
// raising it shrinks each neuron's set toward the most confident calls.
export const CENGEN_MIN_THRESHOLD = 2;
