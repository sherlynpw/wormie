# WormIE

An offline-first browser tool to explore _C. elegans_ genes and analyze gene lists and RNA-seq data.

WormIE stands for Worm Integrated Explorer, and you can use it at https://wormie.bio.
Although you open it in a browser, everything runs on your own computer, so your data never leaves it.

## Status

The authors actively maintain WormIE, and a manuscript that describes it is under review.

## Using it

Open https://wormie.bio in a current browser.
You need no account, installation or programming skills.
On your first visit, the browser downloads the annotation database, which is about 83 MB.
After that, browsing and gene set analysis work offline.

Paste a gene list and WormIE tests it for over-representation, ranked-list enrichment and shared annotation.
Upload aligned reads and it counts them, runs DESeq2 and carries the result into the same analyses.
Each gene has one page that gathers its annotations from WormBase, the Alliance of Genome Resources and other sources.

## Running it locally

You need [Bun](https://bun.sh).

```sh
bun install
bun run build-db
bun run dev
```

Then open http://localhost:5173.
`build-db` downloads every public source and takes a while.
The sources and their licenses are listed on the About page of the site.

The public site leaves out KEGG pathway data, because the KEGG license does not allow us to redistribute it.
A local build downloads the KEGG data from KEGG itself and includes the pathway pages, unless you set `DISABLE_KEGG=1` on the build command.
If you keep KEGG on, please check the [KEGG license terms](https://www.kegg.jp/kegg/legal.html) for your own use.

## Data and results

- The annotation database that the paper reports is archived at https://doi.org/10.5281/zenodo.23850839.
- The benchmark against native R is at https://doi.org/10.5281/zenodo.23850843, and the harness is in [benchmark](benchmark/README.md).
- The files behind the case study are at https://doi.org/10.5281/zenodo.23850849.
- The curated inputs that the build reads from disk are described in [data](data/README.md).

## Help

Report a bug or suggest a correction in the [issue tracker](https://github.com/sherlynpw/wormie/issues).

## Citation

Please cite the paper when it is published.
Until then, cite the database record at https://doi.org/10.5281/zenodo.23850839.

## License

MIT, see [LICENSE](LICENSE).
The data that WormIE ships keep the licenses of their sources, and the About page credits each one.
