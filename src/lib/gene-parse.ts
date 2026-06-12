// Canonical tokenizer for pasted gene-list input.
// Splits on whitespace, comma, semicolon, pipe, slash. Slash prevents
// accidentally-pasted paths from yielding one invalid token; gene symbols
// don't contain slashes (hyphens like `unc-13` survive).

export function parseGeneList(text: string): string[] {
  return text
    .split(/[\s,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
