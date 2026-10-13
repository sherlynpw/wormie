import fs from 'node:fs';
// argv: <multilevel module> <fgsea csv> <opts json> <ids file>
const mod = await import(new URL(process.argv[2], `file://${process.cwd()}/`).pathname);
const D = new URL('../data/', import.meta.url).pathname;
const m = JSON.parse(fs.readFileSync(D + 'manifest.json', 'utf8'));
const g = m.gsea.find((x: any) => x.universe === 2000 && x.nSets === 500);
const ranked = fs
  .readFileSync(D + g.ranked, 'utf8')
  .trim()
  .split('\n')
  .map((l) => {
    const [a, b] = l.split('\t');
    return { gene: a, score: +b };
  })
  .sort((a, b) => b.score - a.score);
const N = ranked.length,
  pos = new Map(ranked.map((r, i) => [r.gene, i]));
const w = Float64Array.from(ranked.map((r) => Math.abs(r.score)));
const gmt = new Map(
  fs
    .readFileSync(D + g.gmt, 'utf8')
    .trim()
    .split('\n')
    .map((l) => {
      const f = l.split('\t');
      return [f[0], f.slice(2)];
    }),
);
const fg = Object.fromEntries(
  fs
    .readFileSync(process.argv[3], 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => {
      const f = l.split(',');
      return [f[0].replace(/"/g, ''), +f[1]];
    }),
);
const opts = JSON.parse(process.argv[4] ?? '{}');
function es(p: number[], k: number) {
  let tot = 0;
  for (const i of p) tot += w[i];
  const miss = 1 / (N - k);
  let cur = 0,
    prev = -1,
    mx = 0,
    sg = 0;
  for (const i of p) {
    cur -= (i - prev - 1) * miss;
    if (Math.abs(cur) > mx) {
      mx = Math.abs(cur);
      sg = cur;
    }
    cur += w[i] / tot;
    if (Math.abs(cur) > mx) {
      mx = Math.abs(cur);
      sg = cur;
    }
    prev = i;
  }
  return sg;
}
let s = 11;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ids = fs.readFileSync(process.argv[5], 'utf8').trim().split('\n');
const lr: number[] = [];
let TOTALMS = 0;
for (const id of ids) {
  const set = gmt
    .get(id)!
    .map((x) => pos.get(x)!)
    .filter((x) => x !== undefined)
    .sort((a, b) => a - b);
  const k = set.length,
    obs = es(set, k);
  const pool = Array.from({ length: N }, (_, i) => i);
  let nPos = 0;
  const NS = 20000;
  for (let t = 0; t < NS; t++) {
    for (let j = 0; j < k; j++) {
      const r = j + Math.floor(rnd() * (N - j));
      [pool[j], pool[r]] = [pool[r], pool[j]];
    }
    if (
      es(
        pool.slice(0, k).sort((a, b) => a - b),
        k,
      ) >= 0
    )
      nPos++;
  }
  const sf = (nPos + 1) / (NS + 1);
  const t0 = performance.now();
  const lg = Array.from({ length: 8 }, (_, i) =>
    Math.log10(mod.multilevelP(N, k, w, obs, { ...opts, seed: 100 + i }).p / sf),
  );
  const mean = lg.reduce((a, b) => a + b) / lg.length,
    sd = Math.sqrt(lg.reduce((a, b) => a + (b - mean) ** 2, 0) / (lg.length - 1));
  lr.push(mean - Math.log10(fg[id]));
  TOTALMS += (performance.now() - t0) / lg.length;
  console.log(
    `${id} k=${k}  wormie geomean ${(10 ** mean).toExponential(2)}  sd ${sd.toFixed(3)}  | fgsea geomean ${fg[id].toExponential(2)}  ratio ${(10 ** mean / fg[id]).toFixed(2)}  ${((performance.now() - t0) / 10).toFixed(0)} ms/run`,
  );
}

const m_ = lr.reduce((a, b) => a + b) / lr.length;
const sd_ = Math.sqrt(lr.reduce((a, b) => a + (b - m_) ** 2, 0) / (lr.length - 1));
console.log(`total ms per run over all sets: ${TOTALMS.toFixed(0)}`);
console.log(
  `SETS ${lr.length}: mean log10(WormIE/fgsea) = ${m_.toFixed(3)} (ratio ${(10 ** m_).toFixed(2)}), SE ${(sd_ / Math.sqrt(lr.length)).toFixed(3)}, median ratio ${(10 ** [...lr].sort((a, b) => a - b)[Math.floor(lr.length / 2)]).toFixed(2)}`,
);
