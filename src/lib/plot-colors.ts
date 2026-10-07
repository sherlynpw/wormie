// Direction pair: orange for up or positive, purple for down or negative. Both resolve through CSS
// variables (app.css) so light and dark mode each get their own shade; the range scale below uses
// the same two endpoints, so "high" and "up" read as one colour across the app.
export const UP_COLOR = 'hsl(var(--plot-up))';
export const DOWN_COLOR = 'hsl(var(--plot-down))';
export const upAlpha = (a: number) => `hsl(var(--plot-up) / ${a})`;
export const downAlpha = (a: number) => `hsl(var(--plot-down) / ${a})`;

// One palette for every plot that colours samples by condition, so a condition keeps its colour
// across the PCA, boxplots and per-gene strip plot. The first two entries are the same purple and
// orange as the range scale and the direction pair, so one purple means one thing across the app;
// callers put the reference level first (see referenceFirst) so wild type is always the purple one.
export const CONDITION_PALETTE = [
  DOWN_COLOR,
  UP_COLOR,
  'hsl(180 60% 40%)',
  'hsl(0 72% 50%)',
  'hsl(220 70% 50%)',
  'hsl(140 60% 40%)',
  'hsl(320 60% 50%)',
  'hsl(60 70% 45%)',
];

// Three-point scale for every plot that encodes a range of numbers: purple for low or negative,
// a pale neutral midpoint, orange for high or positive. Mixed in CSS from the same variables as the
// direction pair, so the ends match and the dark theme swaps in its own shades.
/** Colour for t in [0, 1]: purple at 0, neutral at 0.5, orange at 1. */
export function rangeColor(t: number): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (x < 0.5) {
    return `color-mix(in oklab, hsl(var(--plot-mid)) ${Math.round(x * 200)}%, hsl(var(--plot-down)))`;
  }
  return `color-mix(in oklab, hsl(var(--plot-up)) ${Math.round((x - 0.5) * 200)}%, hsl(var(--plot-mid)))`;
}

/** Readable text colour on top of rangeColor(t); only the purple end needs the inverted colour. */
export function rangeTextColor(t: number): string {
  return t < 0.18 ? 'hsl(var(--plot-text-on-low))' : 'hsl(var(--plot-text))';
}

/** Moves the reference level to the front so it takes the first palette colour. */
export function referenceFirst(groups: string[], reference?: string | null): string[] {
  if (!reference || !groups.includes(reference)) return groups;
  return [reference, ...groups.filter((g) => g !== reference)];
}

/** Expression value with as many decimals as its size needs, so small values do not print as 0. */
export function fmtExpression(v: number): string {
  if (!Number.isFinite(v)) return 'NA';
  if (v >= 100) return Math.round(v).toLocaleString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
