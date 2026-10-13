# Benchmark report: browser/WASM vs native R

Browser run: 2026-10-13T02:26:15.733Z · R run: 2026-10-12T17:47:43
Repeats: browser 10, R 10. Timing as mean ± sd.

## Testbed

Apple M2, 8 physical / 8 logical cores, 24 GB RAM, Darwin 25.6.0 (arm64).
Browser arm: 148.0.7778.96. Native arm: R on the same host.

## DESeq2

| Tier | R (s)      | Browser warm (s) | Cold run 0 (s) | log2FC corr | padj corr | sign flips (padj<0.05) | max abs Δlog2FC |
| ---- | ---------- | ---------------- | -------------- | ----------- | --------- | ---------------------- | --------------- |
| XS   | 0.8 ± 0.02 | 4.4 ± 0.00       | 5.7            | 1.0000      | 1.0000    | 0                      | 0.0000          |
| S    | 2.1 ± 0.11 | 10.7 ± 0.13      | 10.6           | 1.0000      | 1.0000    | 0                      | 0.0000          |
| M    | 4.5 ± 0.22 | 21.2 ± 0.33      | 21.2           | 1.0000      | 1.0000    | 0                      | 0.0000          |

## GSEA (preranked)

| universe | nSets | R (ms)    | Browser (ms) | slowdown | NES corr | sig sets (R) | recovered | added | Jaccard |
| -------- | ----- | --------- | ------------ | -------- | -------- | ------------ | --------- | ----- | ------- |
| 2000     | 50    | 147 ± 7.1 | 41 ± 13.0    | 0.28x    | 1.0000   | 5            | 5         | 0     | 1.000   |
| 2000     | 500   | 182 ± 4.8 | 65 ± 5.5     | 0.36x    | 1.0000   | 54           | 51        | 1     | 0.927   |
| 10000    | 50    | 130 ± 0.8 | 29 ± 3.4     | 0.22x    | 0.9999   | 5            | 5         | 0     | 1.000   |
| 10000    | 500   | 178 ± 2.6 | 52 ± 6.9     | 0.29x    | 0.9999   | 50           | 50        | 1     | 0.980   |

## GSEA multilevel (p-values below the permutation floor)

WormIE with multilevel refinement against `fgseaMultilevel` at its defaults (eps = 1e-50). "Refined" sets are those whose permutation p sat within 3x of the floor, the ones WormIE re-estimates. Sets both tools report at the 1e-50 bound are counted separately and left out of the correlation and ratio.

| universe | nSets | -log10(p) corr (all) | refined sets | at bound (both / WormIE only / R only) | -log10(p) corr (refined) | median p ratio (refined, WormIE/R) | sig sets (R) | recovered | added |
| -------- | ----- | -------------------- | ------------ | -------------------------------------- | ------------------------ | ---------------------------------- | ------------ | --------- | ----- |
| 2000     | 50    | 0.9994               | 4            | 1 / 0 / 0                              | 0.9961                   | 1.22                               | 5            | 5         | 0     |
| 2000     | 500   | 0.9999               | 34           | 16 / 1 / 0                             | 0.9995                   | 0.74                               | 54           | 52        | 0     |
| 10000    | 50    | 0.9996               | 4            | 1 / 0 / 0                              | 0.9991                   | 1.55                               | 5            | 5         | 0     |
| 10000    | 500   | 0.9998               | 35           | 14 / 0 / 1                             | 0.9992                   | 1.03                               | 51           | 51        | 0     |

## ORA (hypergeometric)

| universe | nSets | querySize | R (ms)   | Browser (ms) | slowdown | -log10(p) corr | k exact-match | sig sets (R) | recovered | added |
| -------- | ----- | --------- | -------- | ------------ | -------- | -------------- | ------------- | ------------ | --------- | ----- |
| 2000     | 50    | 100       | 2 ± 0.3  | 2 ± 0.6      | 0.95x    | 1.0000         | 46/46         | 4            | 4         | 0     |
| 2000     | 50    | 500       | 3 ± 0.5  | 2 ± 0.2      | 0.85x    | 1.0000         | 50/50         | 6            | 6         | 0     |
| 2000     | 500   | 100       | 11 ± 0.5 | 16 ± 0.4     | 1.44x    | 1.0000         | 474/474       | 37           | 37        | 0     |
| 2000     | 500   | 500       | 14 ± 0.4 | 17 ± 0.4     | 1.23x    | 1.0000         | 500/500       | 41           | 41        | 0     |
| 10000    | 50    | 100       | 2 ± 0.4  | 1 ± 0.1      | 0.56x    | 1.0000         | 37/37         | 0            | 0         | 0     |
| 10000    | 50    | 500       | 2 ± 0.5  | 2 ± 0.1      | 0.92x    | 1.0000         | 48/48         | 1            | 1         | 0     |
| 10000    | 500   | 100       | 13 ± 0.5 | 14 ± 0.6     | 1.14x    | 1.0000         | 307/307       | 4            | 4         | 2     |
| 10000    | 500   | 500       | 15 ± 0.7 | 21 ± 0.7     | 1.43x    | 1.0000         | 461/461       | 24           | 24        | 0     |

## ssGSEA

| universe | nSets | nSamples | R (ms)   | Browser (ms) | slowdown | score corr | max abs Δ |
| -------- | ----- | -------- | -------- | ------------ | -------- | ---------- | --------- |
| 2000     | 50    | 12       | 28 ± 1.7 | 11 ± 4.1     | 0.41x    | 1.0000     | 0.0001    |
| 2000     | 500   | 12       | 72 ± 2.9 | 45 ± 6.2     | 0.62x    | 1.0000     | 0.0001    |
| 10000    | 50    | 12       | 39 ± 1.5 | 52 ± 6.2     | 1.33x    | 1.0000     | 0.0000    |
| 10000    | 500   | 12       | 90 ± 2.8 | 173 ± 10.7   | 1.92x    | 1.0000     | 0.0001    |

## WebR startup

Bundle 94.0 MB, served from localhost (vite). 3 repeats.

| setting                         | total (s)   | bundle (s) | WebR boot (s) | library(DESeq2) (s) |
| ------------------------------- | ----------- | ---------- | ------------- | ------------------- |
| first visit (empty OPFS)        | 16.6 ± 0.40 | 0.4 ± 0.09 | 0.7 ± 0.07    | 15.1 ± 0.22         |
| return visit (bundle in OPFS)   | 15.5 ± 0.44 | 0.1 ± 0.01 | 0.6 ± 0.03    | 14.5 ± 0.38         |
| extra pool instance (same page) | 10.7 ± 0.38 | 0.0 ± 0.00 | 0.4 ± 0.01    | 10.0 ± 0.35         |

The bundle leg is a localhost read here, so it is a lower bound on what a visitor pays over a network; the boot and library legs are compute-bound and representative. An extra instance reuses the in-page bundle, so it has no bundle leg.
