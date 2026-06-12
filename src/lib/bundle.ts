// URL bundles: gzip-compressed JSON in the URL fragment (#b=<urlsafe-base64(gzip(json))>).
// Fragment never leaves the browser, keeping large payloads private across tabs.
// Tested sizes: 27k-row ranked list ~100 KB gzip / ~135 KB base64;
//               5k-row gene list ~22 KB gzip / ~30 KB base64.
// Browsers cap URLs ~64 KB, so practical ceiling is ~5k-10k genes; larger payloads should use Datasets.

const HASH_KEY = 'b';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const blob = new Blob([new Uint8Array(input)]);
  const stream = blob.stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const blob = new Blob([new Uint8Array(input)]);
  const stream = blob.stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeBundle<T>(payload: T): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const gz = await gzip(json);
  return toBase64Url(gz);
}

export async function decodeBundle<T>(encoded: string): Promise<T | null> {
  try {
    const gz = fromBase64Url(encoded);
    const json = await gunzip(gz);
    return JSON.parse(new TextDecoder().decode(json)) as T;
  } catch {
    return null;
  }
}

export function readBundleFromHash(): {
  encoded: string | null;
  term: string | null;
  kind: string | null;
} {
  if (typeof window === 'undefined' || !window.location.hash) {
    return { encoded: null, term: null, kind: null };
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    encoded: params.get(HASH_KEY),
    term: params.get('term'),
    kind: params.get('kind'),
  };
}

export function buildShareUrl(
  encoded: string,
  opts: { term?: string; kind?: string } = {},
): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  params.set(HASH_KEY, encoded);
  if (opts.term) params.set('term', opts.term);
  if (opts.kind) params.set('kind', opts.kind);
  url.hash = params.toString();
  return url.toString();
}

export function clearBundleHash(): void {
  if (typeof window === 'undefined') return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
