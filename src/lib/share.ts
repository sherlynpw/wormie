// URL-safe gzip+base64url encoding for shareable gene-list links.
// WBGene IDs compress ~6x due to shared "WBGene000..." prefix.

const ID_PARAM = 'ids';
const GZ_PARAM = 'gz';

const READABLE_LIMIT = 1500; // chars; switch to compressed param beyond this

function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function encodeIds(ids: string[]): Promise<string> {
  const json = JSON.stringify(ids);
  const compressed = await gzip(new TextEncoder().encode(json));
  return base64urlEncode(compressed);
}

export async function decodeIds(token: string): Promise<string[]> {
  const compressed = base64urlDecode(token);
  const raw = await gunzip(compressed);
  const text = new TextDecoder().decode(raw);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Invalid id token payload');
  return parsed.filter((x) => typeof x === 'string');
}

// Returns "?ids=" (readable) or "?gz=" (compressed) based on READABLE_LIMIT.
export async function buildIdsQuery(ids: string[]): Promise<string> {
  const readable = ids.join(',');
  if (readable.length <= READABLE_LIMIT) {
    return `${ID_PARAM}=${readable}`;
  }
  const token = await encodeIds(ids);
  return `${GZ_PARAM}=${token}`;
}

export async function readIdsFromUrl(url: URL): Promise<string[]> {
  const gz = url.searchParams.get(GZ_PARAM);
  if (gz) {
    try {
      return await decodeIds(gz);
    } catch {
      return [];
    }
  }
  const idsParam = url.searchParams.get(ID_PARAM);
  if (!idsParam) return [];
  return idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
