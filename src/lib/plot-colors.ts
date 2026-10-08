// Direction pair: orange for up or positive, purple for down or negative. Both resolve through CSS
// variables (app.css) so light and dark mode each get their own shade; the range scale below uses
// the same two endpoints, so "high" and "up" read as one colour across the app.
export const UP_COLOR = 'hsl(var(--plot-up))';
export const DOWN_COLOR = 'hsl(var(--plot-down))';
export const upAlpha = (a: number) => `hsl(var(--plot-up) / ${a})`;
export const downAlpha = (a: number) => `hsl(var(--plot-down) / ${a})`;

// One palette for every categorical encoding: samples by condition, GO namespaces, STRING
// evidence channels, interaction types. Purple and orange first (the same two as the range scale
// and the direction pair), then muted companions from app.css, so a category keeps its colour
// across pages and both themes. Callers colouring conditions put the reference level first (see
// referenceFirst) so wild type is always the purple one.
export const CATEGORICAL_PALETTE = [
  DOWN_COLOR,
  UP_COLOR,
  'hsl(var(--plot-cat-3))',
  'hsl(var(--plot-cat-4))',
  'hsl(var(--plot-cat-5))',
  'hsl(var(--plot-cat-6))',
  'hsl(var(--plot-cat-7))',
  'hsl(var(--plot-cat-8))',
];
export const CONDITION_PALETTE = CATEGORICAL_PALETTE;

/** GO namespaces: BP purple, MF orange, CC maroon, anything else green. */
export const NAMESPACE_COLOR: Record<string, string> = {
  BP: CATEGORICAL_PALETTE[0],
  MF: CATEGORICAL_PALETTE[1],
  CC: CATEGORICAL_PALETTE[3],
  other: CATEGORICAL_PALETTE[5],
};
/** Tailwind classes for the namespace badges, tinted from the same variables. */
export const NAMESPACE_BADGE: Record<string, string> = {
  BP: 'bg-[hsl(var(--plot-down)/0.15)] text-[hsl(var(--plot-down))]',
  MF: 'bg-[hsl(var(--plot-up)/0.15)] text-[hsl(var(--plot-up))]',
  CC: 'bg-[hsl(var(--plot-cat-4)/0.15)] text-[hsl(var(--plot-cat-4))]',
};

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

/** Tailwind text classes for a signed value: orange when positive, purple when negative. */
export const UP_TEXT = 'text-[hsl(var(--plot-up))]';
export const DOWN_TEXT = 'text-[hsl(var(--plot-down))]';
export function signedText(v: number): string {
  return v >= 0 ? UP_TEXT : DOWN_TEXT;
}
