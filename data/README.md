# Curated inputs to the database build

Every other source the build reads is fetched from its distributor as
`scripts/build-db.sh` runs. The three files here are the exception: they are
committed to the repository and read from disk, so a clean checkout can rebuild
the database without them being available anywhere else.

Each is overridable, so a laboratory can substitute its own curation without
editing the script:

```sh
WORMCAT_CSV=... NEURONAL_CSV=... SYNAPTO_TSV=... bun run build-db
```

## `wormcat_whole_genome_v2.csv`

**Not our work.** Redistributed from the WormCat project at
https://github.com/dphiggs01/Wormcat, copyright 2020 Daniel Higgins, under the
MIT licence. The full notice is in `WORMCAT-LICENSE` in this directory and must
travel with any further copy of this file.

Cite WormCat itself rather than this repository when the annotation is used:

> Holdorf AD, Higgins DP, Hart AC, et al. WormCat: an online tool for annotation
> and visualization of _Caenorhabditis elegans_ genome-scale data. _Genetics_
> 214(2):279-294, 2020. doi:10.1534/genetics.119.302919

31,389 gene assignments across three nested category levels.

## `neuronal_genes.csv`

Ours, under this repository's licence, following a published classification.

The gene classes are those set out in Hobert's survey of the neuronal genome
(_WormBook_, 2013, doi:10.1895/wormbook.1.161.1). The file assigns WormBase
identifiers to those classes; the classification itself is Hobert's and should
be cited alongside any use of the panel.

1,345 rows covering 1,281 genes across 34 categories. The database carries 1,312
of them: the build keys on `wormbase_id` and skips the 32 rows that have none,
and one further row is a duplicate gene and category pair that collapses on
insert.

## `synaptogenesis_genes.tsv`

Ours, under this repository's licence, curated for this work.

No maintained resource groups _C. elegans_ synapse development and function
genes by the role they play, so this panel was assembled from the primary
literature. 178 genes across 12 classes (v6), drawn from 139 publications. Each
gene's `refs` column names at least one primary research article, by the ids in
`src/lib/synaptogenesis-references.ts`, and the interface shows those papers
beside the gene, so an assignment can be checked against its source rather than
taken on trust. The file, table, search prefix (`syn:`) and enrichment key keep
the historical name `synaptogenesis`; the interface calls the panel "Synapse
development and function".
