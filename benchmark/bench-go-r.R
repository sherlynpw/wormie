#!/usr/bin/env Rscript
# clusterProfiler arm of the propagated-GO comparison.
# Reads benchmark/results/go-wormie.json for the query and the exact background
# universe, runs enrichGO over the same genes, writes results/go-cp.json.
#   Rscript benchmark/bench-go-r.R

suppressMessages({
  library(jsonlite)
  library(clusterProfiler)
  library(org.Ce.eg.db)
})

here <- dirname(normalizePath(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))))
resultsDir <- file.path(here, "results")
wm <- fromJSON(file.path(resultsDir, "go-wormie.json"), simplifyVector = TRUE)

query <- as.character(wm$query)
universe <- as.character(wm$background)

# How much of WormIE's universe org.Ce.eg.db can even see. Any gene it does not
# know cannot contribute to enrichGO's N, so record the loss rather than hide it.
mapped <- suppressMessages(
  AnnotationDbi::select(org.Ce.eg.db, keys = universe, keytype = "WORMBASE", columns = "ENTREZID"))
mappedUniverse <- unique(mapped$WORMBASE[!is.na(mapped$ENTREZID)])
mappedQuery <- intersect(query, mappedUniverse)

t0 <- Sys.time()
ego <- enrichGO(
  gene = query,
  universe = universe,
  OrgDb = org.Ce.eg.db,
  keyType = "WORMBASE",
  ont = "ALL",
  pAdjustMethod = "BH",
  pvalueCutoff = 1,
  qvalueCutoff = 1,
  minGSSize = 1,
  maxGSSize = 100000,
  readable = FALSE)
elapsed <- as.numeric(difftime(Sys.time(), t0, units = "secs")) * 1000

df <- as.data.frame(ego)
parse_ratio <- function(x) as.numeric(sub("/.*", "", x))
parse_denom <- function(x) as.numeric(sub(".*/", "", x))

out <- list(
  generated = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
  clusterProfilerVersion = as.character(packageVersion("clusterProfiler")),
  orgDbVersion = as.character(packageVersion("org.Ce.eg.db")),
  goDbVersion = as.character(packageVersion("GO.db")),
  nQuery = length(query),
  nBackground = length(universe),
  nQueryMapped = length(mappedQuery),
  nBackgroundMapped = length(mappedUniverse),
  elapsedMs = elapsed,
  results = lapply(seq_len(nrow(df)), function(i) list(
    term_id = df$ID[i],
    name = df$Description[i],
    namespace = df$ONTOLOGY[i],
    k = parse_ratio(df$GeneRatio[i]),
    K = parse_ratio(df$BgRatio[i]),
    n = parse_denom(df$GeneRatio[i]),
    N = parse_denom(df$BgRatio[i]),
    p = df$pvalue[i],
    q = df$p.adjust[i])))

write(toJSON(out, auto_unbox = TRUE, digits = 12, na = "null"),
      file.path(resultsDir, "go-cp.json"))
cat(sprintf("clusterProfiler GO: %d/%d query mapped, %d/%d background mapped, %d terms tested, %d at q<0.05 (%.0fms)\n",
            length(mappedQuery), length(query), length(mappedUniverse), length(universe),
            nrow(df), sum(df$p.adjust < 0.05), elapsed))
cat("==> wrote benchmark/results/go-cp.json\n")
