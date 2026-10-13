// Plot export helpers: SVG/PNG download and PDF via print dialog (browsers produce vector PDF when "Save as PDF" is chosen).

const NS = 'http://www.w3.org/2000/svg';

// Snapshot SVG as self-contained: inline computed fill/stroke/font element-by-element
// so the export doesn't depend on Tailwind CSS variables, then set explicit width/height.
function snapshot(svgEl: SVGSVGElement): SVGSVGElement {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const liveAll = svgEl.querySelectorAll('*');
  const cloneAll = clone.querySelectorAll('*');
  for (let i = 0; i < liveAll.length && i < cloneAll.length; i++) {
    const live = liveAll[i] as Element;
    const c = cloneAll[i] as Element;
    const cs = window.getComputedStyle(live);
    // stroke/fill on shape elements
    const tag = c.tagName.toLowerCase();
    if (
      tag === 'circle' ||
      tag === 'rect' ||
      tag === 'line' ||
      tag === 'path' ||
      tag === 'polygon' ||
      tag === 'polyline'
    ) {
      if (cs.fill) c.setAttribute('fill', cs.fill);
      if (cs.stroke && cs.stroke !== 'none') c.setAttribute('stroke', cs.stroke);
      if (cs.strokeWidth) c.setAttribute('stroke-width', cs.strokeWidth);
    }
    if (tag === 'text') {
      if (cs.fill) c.setAttribute('fill', cs.fill);
      if (cs.fontSize) c.setAttribute('font-size', cs.fontSize);
      if (cs.fontWeight && cs.fontWeight !== 'normal') c.setAttribute('font-weight', cs.fontWeight);
      c.setAttribute('font-family', cs.fontFamily || 'sans-serif');
    }
  }

  // Interaction-only layers (hover hit areas, selection highlights) stay out of exports.
  for (const el of clone.querySelectorAll('[data-export-skip]')) el.remove();

  // Explicit width/height required for rasterization and PDF print.
  const bb = svgEl.getBoundingClientRect();
  const vb = svgEl.getAttribute('viewBox');
  if (!vb && bb.width > 0 && bb.height > 0) {
    clone.setAttribute('viewBox', `0 0 ${bb.width} ${bb.height}`);
  }
  if (vb) {
    const parts = vb.split(/\s+/).map(Number);
    if (parts.length === 4) {
      clone.setAttribute('width', String(parts[2]));
      clone.setAttribute('height', String(parts[3]));
    }
  } else {
    clone.setAttribute('width', String(bb.width));
    clone.setAttribute('height', String(bb.height));
  }
  clone.setAttribute('xmlns', NS);
  // Inline body background so PNG/PDF aren't transparent.
  const bg = window.getComputedStyle(document.body).backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    const rect = document.createElementNS(NS, 'rect');
    const w = clone.getAttribute('width') ?? '100%';
    const h = clone.getAttribute('height') ?? '100%';
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
  }
  return clone;
}

function serializeToString(svg: SVGSVGElement): string {
  const s = new XMLSerializer().serializeToString(svg);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
}

export function exportSvg(svgEl: SVGSVGElement, baseName: string) {
  const snap = snapshot(svgEl);
  const str = serializeToString(snap);
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  download(blob, `${baseName}_${timestamp()}.svg`);
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Snapshot every visible SVG on the page (anything with `aria-label`) and
 * download them as one zip. Names come from each svg's aria-label; collisions
 * are disambiguated with a numeric suffix.
 */
export async function exportSvgBundle(baseName: string): Promise<number> {
  const svgs = Array.from(document.querySelectorAll<SVGSVGElement>('svg[aria-label]'));
  if (svgs.length === 0) return 0;
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const seen = new Map<string, number>();
  for (const svg of svgs) {
    const rawName = safeFilename(svg.getAttribute('aria-label') || 'plot') || 'plot';
    const n = (seen.get(rawName) ?? 0) + 1;
    seen.set(rawName, n);
    const name = n === 1 ? rawName : `${rawName}_${n}`;
    const snap = snapshot(svg);
    const str = serializeToString(snap);
    files[`${name}.svg`] = strToU8(str);
  }
  const zipped = zipSync(files);
  download(new Blob([zipped], { type: 'application/zip' }), `${baseName}_${timestamp()}.zip`);
  return svgs.length;
}

export async function exportPng(svgEl: SVGSVGElement, baseName: string, scale = 2) {
  const snap = snapshot(svgEl);
  const str = serializeToString(snap);
  const w = Number(snap.getAttribute('width')) || svgEl.clientWidth || 800;
  const h = Number(snap.getAttribute('height')) || svgEl.clientHeight || 600;

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG → image load failed'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas.toBlob returned null'));
      download(blob, `${baseName}_${timestamp()}.png`);
      resolve();
    }, 'image/png');
  });
}

export function exportPdf(svgEl: SVGSVGElement, baseName: string) {
  // Writes SVG into a hidden iframe and triggers print; "Save as PDF" produces a vector PDF without a library.
  const snap = snapshot(svgEl);
  const str = serializeToString(snap);
  const w = Number(snap.getAttribute('width')) || 800;
  const h = Number(snap.getAttribute('height')) || 600;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const html = `<!DOCTYPE html><html><head><title>${baseName}</title>
<style>
  @page { margin: 1cm; size: ${w > h ? 'landscape' : 'portrait'}; }
  html, body { margin: 0; padding: 0; background: white; }
  body { display: flex; align-items: center; justify-content: center; }
  svg { width: 100%; height: auto; max-width: 100%; }
</style></head><body>${str}</body></html>`;

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };
  const win = iframe.contentWindow!;
  const trigger = () => {
    try {
      win.focus();
      win.print();
    } finally {
      cleanup();
    }
  };
  if (doc.readyState === 'complete') {
    setTimeout(trigger, 100);
  } else {
    win.addEventListener('load', () => setTimeout(trigger, 100));
  }
}
