# Benchmark report: browser/WASM vs native R

Browser run: 2026-10-24T04:51:50.010Z · R run: 2026-10-23T00:21:13
Repeats: browser 10, R 10. Timing as mean ± sd.

## Testbed

Apple M2, 8 physical / 8 logical cores, 24 GB RAM, Darwin 25.6.0 (arm64).
Browser arm: 148.0.7778.96. Native arm: R on the same host.

## DESeq2

| Tier | R (s)      | Browser warm (s) | Cold run 0 (s) | log2FC corr | padj corr | sign flips (padj<0.05) | max abs Δlog2FC |
| ---- | ---------- | ---------------- | -------------- | ----------- | --------- | ---------------------- | --------------- |
| XS   | 0.7 ± 0.01 | 4.4 ± 0.00       | 5.6            | 1.0000      | 1.0000    | 0                      | 0.0000          |
| S    | 2.0 ± 0.10 | 10.6 ± 0.08      | 10.6           | 1.0000      | 1.0000    | 0                      | 0.0000          |
| M    | 4.2 ± 0.12 | 20.5 ± 0.04      | 20.6           | 1.0000      | 1.0000    | 0                      | 0.0000          |

## GSEA (preranked)

| universe | nSets | R (ms)     | Browser (ms) | slowdown | NES corr | sig sets (R) | recovered | added | Jaccard |
| -------- | ----- | ---------- | ------------ | -------- | -------- | ------------ | --------- | ----- | ------- |
| 2000     | 50    | 135 ± 3.3  | 25 ± 1.9     | 0.18x    | 1.0000   | 5            | 5         | 0     | 1.000   |
| 2000     | 500   | 173 ± 2.5  | 40 ± 1.0     | 0.23x    | 1.0000   | 52           | 51        | 1     | 0.962   |
| 10000    | 50    | 122 ± 1.2  | 25 ± 1.3     | 0.21x    | 1.0000   | 5            | 5         | 0     | 1.000   |
| 10000    | 500   | 186 ± 15.3 | 42 ± 4.6     | 0.23x    | 0.9999   | 51           | 51        | 0     | 1.000   |

## GSEA multilevel (p-values below the permutation floor)

WormIE with multilevel refinement against `fgseaMultilevel` at its defaults (eps = 1e-50). "Refined" sets are those whose permutation p sat within 3x of the floor, the ones WormIE re-estimates. Sets both tools report at the 1e-50 bound are counted separately and left out of the correlation and ratio.

| universe | nSets | -log10(p) corr (all) | refined sets | at bound (both / WormIE only / R only) | -log10(p) corr (refined) | median p ratio (refined, WormIE/R) | sig sets (R) | recovered | added |
| -------- | ----- | -------------------- | ------------ | -------------------------------------- | ------------------------ | ---------------------------------- | ------------ | --------- | ----- |
| 2000     | 50    | 0.9997               | 4            | 1 / 0 / 0                              | 0.9985                   | 1.52                               | 5            | 5         | 0     |
| 2000     | 500   | 0.9999               | 36           | 16 / 1 / 0                             | 0.9996                   | 0.83                               | 53           | 53        | 0     |
| 10000    | 50    | 0.9998               | 4            | 1 / 0 / 0                              | 0.9998                   | 1.92                               | 5            | 5         | 0     |
| 10000    | 500   | 0.9998               | 36           | 14 / 0 / 0                             | 0.9993                   | 0.60                               | 51           | 51        | 0     |

## ORA (hypergeometric)

| universe | nSets | querySize | R (ms)   | Browser (ms) | slowdown | -log10(p) corr | k exact-match | sig sets (R) | recovered | added |
| -------- | ----- | --------- | -------- | ------------ | -------- | -------------- | ------------- | ------------ | --------- | ----- |
| 2000     | 50    | 100       | 2 ± 0.0  | 2 ± 0.6      | 1.02x    | 1.0000         | 47/47         | 3            | 3         | 0     |
| 2000     | 50    | 500       | 2 ± 0.5  | 2 ± 0.1      | 0.72x    | 1.0000         | 50/50         | 4            | 4         | 0     |
| 2000     | 500   | 100       | 11 ± 0.5 | 16 ± 0.8     | 1.46x    | 1.0000         | 474/474       | 37           | 37        | 0     |
| 2000     | 500   | 500       | 13 ± 0.5 | 16 ± 0.4     | 1.19x    | 1.0000         | 500/500       | 41           | 41        | 0     |
| 10000    | 50    | 100       | 2 ± 0.3  | 1 ± 0.1      | 0.52x    | 1.0000         | 30/30         | 3            | 3         | 0     |
| 10000    | 50    | 500       | 2 ± 0.5  | 2 ± 0.1      | 0.71x    | 1.0000         | 49/49         | 3            | 3         | 0     |
| 10000    | 500   | 100       | 11 ± 0.5 | 13 ± 0.5     | 1.10x    | 1.0000         | 307/307       | 4            | 4         | 2     |
| 10000    | 500   | 500       | 14 ± 0.5 | 20 ± 0.4     | 1.46x    | 1.0000         | 461/461       | 24           | 24        | 0     |

## ssGSEA

| universe | nSets | nSamples | R (ms)   | Browser (ms) | slowdown | score corr | max abs Δ |
| -------- | ----- | -------- | -------- | ------------ | -------- | ---------- | --------- |
| 2000     | 50    | 12       | 29 ± 1.8 | 14 ± 3.9     | 0.47x    | 1.0000     | 0.0001    |
| 2000     | 500   | 12       | 69 ± 1.0 | 51 ± 6.9     | 0.74x    | 1.0000     | 0.0001    |
| 10000    | 50    | 12       | 39 ± 0.6 | 76 ± 24.9    | 1.96x    | 1.0000     | 0.0000    |
| 10000    | 500   | 12       | 87 ± 0.4 | 216 ± 53.4   | 2.48x    | 1.0000     | 0.0001    |

## WebR startup

Bundle 94.0 MB, served from localhost (vite). 10 repeats.

| setting                         | total (s)   | bundle (s) | WebR boot (s) | library(DESeq2) (s) |
| ------------------------------- | ----------- | ---------- | ------------- | ------------------- |
| first visit (empty OPFS)        | 15.5 ± 0.14 | 0.3 ± 0.01 | 0.6 ± 0.00    | 14.2 ± 0.14         |
| return visit (bundle in OPFS)   | 15.0 ± 0.14 | 0.1 ± 0.01 | 0.6 ± 0.01    | 14.1 ± 0.14         |
| extra pool instance (same page) | 10.4 ± 0.06 | 0.0 ± 0.00 | 0.3 ± 0.01    | 9.7 ± 0.03          |

The bundle leg is a localhost read here, so it is a lower bound on what a visitor pays over a network; the boot and library legs are compute-bound and representative. An extra instance reuses the in-page bundle, so it has no bundle leg.
