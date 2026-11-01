# Benchmark: browser/WASM vs native R

Measures the four analysis pipelines (DESeq2, preranked GSEA, hypergeometric
ORA, ssGSEA) in two arms: the real wormie.bio engines driven headlessly, and
native R/Bioconductor as the reference. See `../docs/paper/benchmark-plan.md`
for the methodology.

## Run it

```sh
node benchmark/gen-data.mjs          # synthetic inputs -> benchmark/data/
Rscript benchmark/bench-r.R          # native arm       -> results/r.json
node benchmark/bench-browser.mjs     # browser arm      -> results/browser.json
node benchmark/bench-startup.mjs     # WebR startup     -> results/startup.json
node benchmark/compare.mjs           # concordance      -> results/report.md
```

The propagated-GO comparison against clusterProfiler is a separate pair of arms,
because it runs on real annotations rather than synthetic sets:

```sh
bun benchmark/bench-go-wormie.ts <wormie.sqlite> <genes.txt>  # -> results/go-wormie.json
Rscript benchmark/bench-go-r.R                                # -> results/go-cp.json
node benchmark/compare-go.mjs                                 # -> results/report-go.md
```

`bench-go-wormie.ts` needs an uncompressed database (`gunzip -c
static/data/wormie.sqlite.gz > wormie.sqlite`) and emits the exact background
universe it used, so the R arm scores `enrichGO` over the identical gene set.

Add `--full` to `gen-data.mjs` for the L/XL stress tiers. `bench-r.R` and
`bench-browser.mjs` accept `--repeats N` and `--only deseq2,gsea,ora,ssgsea`.

## Files

| File                 | Role                                                          |
| -------------------- | ------------------------------------------------------------- |
| `gen-data.mjs`       | deterministic synthetic counts, GMTs, ranked lists, queries   |
| `bench-r.R`          | native R: DESeq2, fgseaSimple, clusterProfiler enricher, GSVA |
| `bench-browser.mjs`  | Playwright driver calling `window.__bench` (dev build)        |
| `bench-startup.mjs`  | WebR startup: bundle, boot, `library(DESeq2)`, pool member    |
| `compare.mjs`        | joins both arms, emits `results/report.md`                    |
| `bench-go-wormie.ts` | production enrichment module on the shipped GO annotations    |
| `bench-go-r.R`       | `clusterProfiler::enrichGO` on the same genes and universe    |
| `compare-go.mjs`     | joins the GO arms, emits `results/report-go.md`               |
| `data/`, `results/`  | generated, git-ignored; `report.md` is the paper artifact     |

A tenth of the generated gene sets are concentrated at the top of the ranked
list, and a few of them are over-represented in the ORA query. Without that
planted signal neither arm calls anything significant, and set-level agreement
degenerates to comparing two empty sets.

The browser arm relies on the DEV-only `window.__bench` hook in
`src/lib/bench.ts`, wired into `+layout.svelte`. All four pipelines (including
ssGSEA, via `runCustomSsgsea`) have a browser arm.

## Requirements

- Node + Playwright (system Chromium at `/usr/sbin/chromium` is auto-detected)
- R with `DESeq2`, `apeglm`, `fgsea`, `GSVA`, `clusterProfiler`, `jsonlite`
- For the GO comparison: `clusterProfiler`, `org.Ce.eg.db`

### Matching the browser's DESeq2

The native arm must run the same DESeq2 and apeglm the WebAssembly bundle
carries, or the comparison measures one Bioconductor release as well as the
runtime. The bundle is baked from `bioc.r-universe.dev`, so its versions can be
ahead of whatever Bioconductor release the host R is pinned to: read them from
`scripts/wasm-cran/deseq2-bundle.manifest.json` and install those exact
tarballs into a library used only by the benchmark, leaving the host library
untouched.

```sh
LIB=$(mktemp -d)/rlib && mkdir -p "$LIB"
curl -sLO https://bioconductor.org/packages/3.23/bioc/src/contrib/DESeq2_1.52.0.tar.gz
curl -sLO https://bioconductor.org/packages/3.23/bioc/src/contrib/apeglm_1.34.0.tar.gz
R_LIBS="$LIB" Rscript -e "install.packages(c('DESeq2_1.52.0.tar.gz','apeglm_1.34.0.tar.gz'), lib='$LIB', repos=NULL, type='source')"
R_LIBS="$LIB" Rscript benchmark/bench-r.R
```

Building DESeq2 from source on macOS needs a Fortran compiler (`brew install
gcc`), and R looks for one at `/opt/gfortran`. Point it elsewhere with a
scratch `Makevars` via `R_MAKEVARS_USER` rather than editing `~/.R/Makevars`.
