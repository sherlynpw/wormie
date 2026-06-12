# Benchmark: browser/WASM vs native R

Measures the four analysis pipelines (DESeq2, preranked GSEA, hypergeometric
ORA, ssGSEA) in two arms: the real wormie.rs.ht engines driven headlessly, and
native R/Bioconductor as the reference. See `../docs/paper/benchmark-plan.md`
for the methodology.

## Run it

```sh
node benchmark/gen-data.mjs          # synthetic inputs -> benchmark/data/
Rscript benchmark/bench-r.R          # native arm       -> results/r.json
node benchmark/bench-browser.mjs     # browser arm      -> results/browser.json
node benchmark/compare.mjs           # concordance      -> results/report.md
```

Add `--full` to `gen-data.mjs` for the L/XL stress tiers. `bench-r.R` and
`bench-browser.mjs` accept `--repeats N` and `--only deseq2,gsea,ora,ssgsea`.

## Files

| File                | Role                                                        |
| ------------------- | ----------------------------------------------------------- |
| `gen-data.mjs`      | deterministic synthetic counts, GMTs, ranked lists, queries |
| `bench-r.R`         | native R: DESeq2, fgseaSimple, fora, GSVA ssgsea            |
| `bench-browser.mjs` | Playwright driver calling `window.__bench` (dev build)      |
| `compare.mjs`       | joins both arms, emits `results/report.md`                  |
| `data/`, `results/` | generated, git-ignored; `report.md` is the paper artifact   |

The browser arm relies on the DEV-only `window.__bench` hook in
`src/lib/bench.ts`, wired into `+layout.svelte`. All four pipelines (including
ssGSEA, via `runCustomSsgsea`) have a browser arm.

## Requirements

- Node + Playwright (system Chromium at `/usr/sbin/chromium` is auto-detected)
- R with `DESeq2`, `apeglm`, `fgsea`, `GSVA`, `jsonlite`
