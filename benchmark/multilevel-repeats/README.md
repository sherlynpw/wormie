# Multilevel GSEA: repeated runs against fgsea

Backs the supplement's statement that WormIE's multilevel p-values below the permutation floor
average about 1.1 times `fgseaMultilevel`'s. Single runs are too noisy to compare at these depths
(fgsea's own estimate varies by up to a factor of four between runs near 1e-38), so each tool is
run several times on the same sets and the averages are compared on a log scale.

Run from the repository root after `node benchmark/gen-data.mjs`:

```sh
# fgsea, 8 seeds over the 36 refined sets of the 2,000-gene, 500-set configuration
Rscript benchmark/multilevel-repeats/fg_seeds_all.R benchmark/multilevel-repeats/fg_all36.csv benchmark/multilevel-repeats/ids36.txt
# WormIE, 8 seeds over the same sets; prints the mean log10(WormIE/fgsea) and its SE
bun benchmark/multilevel-repeats/wm_seeds.ts src/lib/db/fgsea-multilevel.ts benchmark/multilevel-repeats/fg_all36.csv '{}' benchmark/multilevel-repeats/ids36.txt
# Brute-force check against the true conditional p on a synthetic list (400,000 random sets)
bun benchmark/multilevel-repeats/check.ts
```

`ids34.txt` and `fg_all.csv` are the run before the refinement trigger was made per sign (34 sets); `ids36.txt` and `fg_all36.csv` are the current one (36 sets, ratio 1.11). `fg_seeds.R` is the first, five-set version of the fgsea run. `ml_variant.ts` is a copy of
`fgsea-multilevel.ts` with a `mutateAll` switch, used to show that mutating only the clones at each
level biases the estimate low (0.84x fgsea) and mutating every sample, as fgsea does, removes it
(1.12x, within noise); the shipped module now always mutates every sample, so pass it to
`wm_seeds.ts` in place of the real module to reproduce the comparison.
