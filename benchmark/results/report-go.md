# GO over-representation: WormIE vs clusterProfiler::enrichGO

WormIE run: 2026-09-09T20:48:45.880Z · clusterProfiler run: 2026-09-09T13:13:58
Gene list: `classI_up_wbgenes.txt` (1664 genes). WormIE database 20260909-030733 (GO 2026-07-26, WS298); clusterProfiler 4.18.4, org.Ce.eg.db 3.22.0, GO.db 3.22.0.

## Universe

| aspect | WormIE query / background | clusterProfiler query / background |
| ------ | ------------------------- | ---------------------------------- |
| BP     | 743 / 9606                | 756 / 9322                         |
| MF     | 830 / 9496                | 850 / 9359                         |
| CC     | 831 / 10215               | 977 / 10217                        |

Gene pool before aspect scoping: 12107 (WormIE) vs 12095 genes org.Ce.eg.db can map. GO terms tested: 3594 vs 3611, 3432 by both.

## Set-level agreement at q < 0.05

- clusterProfiler calls **171** terms significant; WormIE calls **184**.
- WormIE **recovers 149 of clusterProfiler's 171** significant terms while adding **35** that clusterProfiler does not call.
- Misses: 22. Jaccard: 0.723.
- Recovered by aspect: {"BP":116,"CC":7,"MF":26}.
- Added by aspect: {"MF":12,"BP":21,"CC":2}.
- Missed by aspect: {"BP":20,"CC":2}.

## Term-level agreement on the terms both tested

- -log10(p) Pearson r: **0.9214** (n = 3432).
- -log10(p) Spearman rho: **0.9639**.
- Query hits k identical: **2636/3432**; max |dk| = 59.
- Background members K identical: **1358/3432**; max |dK| = 907.
- Where K differs, WormIE is larger on 928 terms and smaller on 1146, so the two snapshots disagree in both directions rather than one being a subset of the other.
- The two universes differ by 12 genes (N = 12107 vs 12095), so identical p values are not expected even where the members agree. The hypergeometric arithmetic itself is checked against `phyper` in the main report.

## Largest disagreements by p-value rank

| GO         | aspect | name                                         | WormIE k/K | cP k/K   | WormIE q | cP q     |
| ---------- | ------ | -------------------------------------------- | ---------- | -------- | -------- | -------- |
| GO:0006082 | BP     | organic acid metabolic process               | not tested | 78/386   | n/a      | 1.50e-11 |
| GO:0043603 | BP     | amide metabolic process                      | not tested | 45/178   | n/a      | 8.05e-10 |
| GO:0005506 | MF     | iron ion binding                             | 36/121     | 11/61    | 1.03e-8  | 2.30e-1  |
| GO:0020037 | MF     | heme binding                                 | 41/153     | 16/91    | 1.12e-8  | 1.36e-1  |
| GO:0046906 | MF     | tetrapyrrole binding                         | 41/156     | 16/94    | 1.31e-8  | 1.51e-1  |
| GO:0004497 | MF     | monooxygenase activity                       | 32/109     | 7/46     | 6.60e-8  | 4.38e-1  |
| GO:0016705 | MF     | oxidoreductase activity, acting on paired do | 36/145     | 11/87    | 6.43e-7  | 4.50e-1  |
| GO:0006805 | BP     | xenobiotic metabolic process                 | 16/42      | 1/5      | 7.69e-6  | 7.41e-1  |
| GO:0071466 | BP     | cellular response to xenobiotic stimulus     | 16/42      | 1/5      | 7.69e-6  | 7.41e-1  |
| GO:0016712 | MF     | oxidoreductase activity, acting on paired do | 16/41      | 1/4      | 1.24e-5  | 6.15e-1  |
| GO:0009410 | BP     | response to xenobiotic stimulus              | 17/58      | 2/23     | 8.43e-5  | 9.02e-1  |
| GO:0003824 | MF     | catalytic activity                           | 441/4396   | 393/4009 | 1.57e-3  | 2.29e-1  |
| GO:0005737 | CC     | cytoplasm                                    | 444/4750   | 428/4718 | 1.76e-3  | 1.00e+0  |
| GO:0016053 | BP     | organic acid biosynthetic process            | not tested | 23/123   | n/a      | 4.22e-3  |
| GO:0042302 | MF     | structural constituent of cuticle            | 29/158     | 29/185   | 4.36e-3  | 8.36e-2  |

## Timing

WormIE 601 ms, clusterProfiler 10124 ms (single run, not repeated).
