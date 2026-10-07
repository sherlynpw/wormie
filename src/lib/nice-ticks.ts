// Axis ticks on round values (1, 2, 5 x 10^k) so plots never label an axis with data extremes.

export interface NiceTicks {
  values: number[];
  step: number;
  format: (v: number) => string;
}

/** Ticks inside [lo, hi]. `minStep` floors the step, e.g. 1 for count axes. */
export function niceTicks(lo: number, hi: number, target = 5, minStep = 0): NiceTicks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    const v = Number.isFinite(lo) ? lo : 0;
    return { values: [v], step: 1, format: (x) => String(x) };
  }
  const raw = (hi - lo) / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = Math.max(minStep, (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const values: number[] = [];
  // Integer multiples of the step avoid accumulating float error.
  const eps = step * 1e-9;
  for (let i = Math.ceil((lo - eps) / step); i * step <= hi + eps; i++) {
    values.push(Number((i * step).toFixed(decimals)));
  }
  const format = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return { values, step, format };
}
