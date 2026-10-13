import { multilevelP } from '../../src/lib/db/fgsea-multilevel.ts';
const N = 2000,
  k = 30,
  NSIM = 400_000;
// Ranked statistic, descending, roughly normal-shaped magnitudes.
let s = 12345;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const stats = Array.from({ length: N }, () => {
  const u = rnd() || 1e-9,
    v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}).sort((a, b) => b - a);
const w = Float64Array.from(stats.map(Math.abs));
function es(pos: number[]) {
  pos.sort((a, b) => a - b);
  let tot = 0;
  for (const p of pos) tot += w[p];
  const miss = 1 / (N - k);
  let cur = 0,
    prev = -1,
    mx = 0,
    sg = 0;
  for (const p of pos) {
    cur -= (p - prev - 1) * miss;
    if (Math.abs(cur) > mx) {
      mx = Math.abs(cur);
      sg = cur;
    }
    cur += w[p] / tot;
    if (Math.abs(cur) > mx) {
      mx = Math.abs(cur);
      sg = cur;
    }
    prev = p;
  }
  return sg;
}
const nulls = new Float64Array(NSIM);
const pool = Array.from({ length: N }, (_, i) => i);
for (let i = 0; i < NSIM; i++) {
  for (let j = 0; j < k; j++) {
    const r = j + Math.floor(rnd() * (N - j));
    [pool[j], pool[r]] = [pool[r], pool[j]];
  }
  nulls[i] = es(pool.slice(0, k));
}
const pos = Array.from(nulls)
  .filter((x) => x >= 0)
  .sort((a, b) => b - a);
const signFrac = (pos.length + 1) / (NSIM + 1);
console.log(`sign fraction (ES>=0) = ${signFrac.toFixed(3)}`);
for (const target of [0.02, 0.005, 0.001]) {
  const esObs = pos[Math.floor(target * pos.length)];
  const cond = pos.filter((x) => x >= esObs).length / pos.length;
  const raws: number[] = [];
  for (let seed = 1; seed <= 8; seed++) raws.push(multilevelP(N, k, w, esObs, { seed }).p);
  const gm = Math.exp(raws.reduce((a, b) => a + Math.log(b), 0) / raws.length);
  console.log(
    `ES=${esObs.toFixed(3)}  brute-force conditional p=${cond.toExponential(2)}  multilevel raw=${gm.toExponential(2)} (ratio ${(gm / cond).toFixed(2)})  fixed raw/signFrac=${(gm / signFrac).toExponential(2)} (ratio ${(gm / signFrac / cond).toFixed(2)})`,
  );
}
