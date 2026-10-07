/** Splits a label over at most two lines at word boundaries; only the second line is ever cut. */
export function wrapLabel(s: string, maxChars: number): string[] {
  if (s.length <= maxChars) return [s];
  let cut = s.lastIndexOf(' ', maxChars);
  if (cut <= 0) cut = maxChars;
  const first = s.slice(0, cut).trimEnd();
  const rest = s.slice(cut).trimStart();
  return [first, rest.length > maxChars ? rest.slice(0, maxChars - 1) + '…' : rest];
}
