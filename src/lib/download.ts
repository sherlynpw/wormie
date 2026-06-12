// Browser download helpers: create-anchor-click-revoke pattern.

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// TSV writer: tabs/newlines in cell text are replaced with spaces to preserve row structure.
export function downloadTsv<T>(
  filename: string,
  columns: { header: string; get: (row: T) => string | number | null | undefined }[],
  rows: T[],
) {
  const sanitize = (v: string | number | null | undefined): string => {
    if (v == null) return '';
    return String(v).replace(/[\t\n\r]+/g, ' ');
  };
  const headerLine = columns.map((c) => c.header).join('\t');
  const bodyLines = rows.map((row) => columns.map((c) => sanitize(c.get(row))).join('\t'));
  const text = headerLine + '\n' + bodyLines.join('\n') + '\n';
  downloadBlob(new Blob([text], { type: 'text/tab-separated-values' }), filename);
}
