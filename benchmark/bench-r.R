#!/usr/bin/env Rscript
# Native-R reference arm. Reads benchmark/data, writes benchmark/results/r.json.
#   Rscript benchmark/bench-r.R [--repeats N] [--only deseq2,gsea,ora,ssgsea]

suppressMessages({
  library(jsonlite)
  library(DESeq2)
  library(fgsea)
})
hasGSVA <- requireNamespace("GSVA", quietly = TRUE)

args <- commandArgs(trailingOnly = TRUE)
repeats <- 10L
only <- NULL
if ("--repeats" %in% args) repeats <- as.integer(args[which(args == "--repeats") + 1])
if ("--only" %in% args) only <- strsplit(args[which(args == "--only") + 1], ",")[[1]]
want <- function(n) is.null(only) || n %in% only

here <- dirname(normalizePath(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))))
dataDir <- file.path(here, "data")
resultsDir <- file.path(here, "results")
dir.create(resultsDir, showWarnings = FALSE, recursive = TRUE)
manifest <- fromJSON(file.path(dataDir, "manifest.json"), simplifyVector = FALSE)
dpath <- function(rel) file.path(dataDir, rel)

read_counts <- function(rel) {
  m <- read.delim(dpath(rel), comment.char = "#", check.names = FALSE)
  rownames(m) <- m[[1]]
  as.matrix(m[, -(1:6), drop = FALSE])
}
read_gmt <- function(rel) {
  lines <- readLines(dpath(rel))
  sets <- lapply(lines, function(l) {
    f <- strsplit(l, "\t")[[1]]
    f[-(1:2)]
  })
  names(sets) <- vapply(lines, function(l) strsplit(l, "\t")[[1]][1], "")
  sets
}
timed <- function(expr, n, warmup = 1L) {
  e <- substitute(expr)
  pf <- parent.frame()
  total <- n + warmup
  ts <- numeric(total)
  res <- NULL
  for (i in seq_len(total)) {
    t <- system.time(res <- eval(e, pf))
    ts[i] <- t[["elapsed"]] * 1000
  }
  list(ms = tail(ts, n), warmup_ms = head(ts, warmup), result = res)
}

out <- list(generated = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"), repeats = repeats,
            deseq2 = list(), gsea = list(), ora = list(), ssgsea = list())

if (want("deseq2")) {
  for (c in manifest$deseq2) {
    counts <- read_counts(c$counts)
    design <- read.delim(dpath(c$design))
    coldata <- data.frame(condition = factor(design$condition, levels = c("WT", "TREAT")),
                          row.names = design$sample)
    counts <- counts[, rownames(coldata), drop = FALSE]
    run <- timed({
      dds <- DESeqDataSetFromMatrix(counts, coldata, ~condition)
      dds <- DESeq(dds, quiet = TRUE)
      res <- lfcShrink(dds, coef = "condition_TREAT_vs_WT", type = "apeglm", quiet = TRUE)
      as.data.frame(res)
    }, repeats)
    df <- run$result
    out$deseq2[[length(out$deseq2) + 1]] <- list(
      label = c$label, nGenes = c$nGenes, nSamples = c$nSamples,
      msMedian = median(run$ms), msAll = run$ms,
      rows = lapply(seq_len(nrow(df)), function(i) list(
        gene = rownames(df)[i], baseMean = df$baseMean[i],
        log2FoldChange = df$log2FoldChange[i],
        pvalue = df$pvalue[i], padj = df$padj[i])))
    cat(sprintf("-- deseq2 %s: %.1fs\n", c$label, median(run$ms) / 1000))
  }
}

if (want("gsea")) {
  for (g in manifest$gsea) {
    rk <- read.delim(dpath(g$ranked), header = FALSE)
    stats <- setNames(rk[[2]], rk[[1]])
    sets <- read_gmt(g$gmt)
    run <- timed(
      fgseaSimple(pathways = sets, stats = stats, nperm = g$nperm,
                  minSize = 1, maxSize = 100000, scoreType = "std"),
      repeats)
    fg <- run$result
    out$gsea[[length(out$gsea) + 1]] <- list(
      universe = g$universe, nSets = g$nSets, nperm = g$nperm,
      msMedian = median(run$ms), msAll = run$ms,
      results = lapply(seq_len(nrow(fg)), function(i) list(
        term_id = fg$pathway[i], size = fg$size[i], es = fg$ES[i],
        nes = fg$NES[i], p = fg$pval[i], q = fg$padj[i])))
    cat(sprintf("-- gsea u%d n%d: %.0fms\n", g$universe, g$nSets, median(run$ms)))
  }
}

if (want("ora")) {
  for (o in manifest$ora) {
    query <- readLines(dpath(o$query))
    query <- query[nzchar(query)]
    sets <- read_gmt(o$gmt)
    universe <- unique(unlist(sets))
    run <- timed(fora(pathways = sets, genes = query, universe = universe, minSize = 1),
                 repeats)
    fo <- run$result
    out$ora[[length(out$ora) + 1]] <- list(
      universe = o$universe, nSets = o$nSets, querySize = o$querySize,
      msMedian = median(run$ms), msAll = run$ms,
      results = lapply(seq_len(nrow(fo)), function(i) list(
        term_id = fo$pathway[i], k = fo$overlap[i], K = fo$size[i],
        p = fo$pval[i], q = fo$padj[i])))
    cat(sprintf("-- ora u%d n%d k%d: %.0fms\n", o$universe, o$nSets, o$querySize,
                median(run$ms)))
  }
}

if (want("ssgsea")) {
  for (s in manifest$ssgsea) {
    expr <- as.matrix(read.delim(dpath(s$expr), row.names = 1, check.names = FALSE))
    sets <- read_gmt(s$gmt)
    run <- timed({
      par <- GSVA::ssgseaParam(expr, sets, minSize = 1, maxSize = 100000)
      GSVA::gsva(par, verbose = FALSE)
    }, repeats)
    sc <- run$result
    out$ssgsea[[length(out$ssgsea) + 1]] <- list(
      universe = s$universe, nSets = s$nSets, nSamples = s$nSamples,
      msMedian = median(run$ms), msAll = run$ms,
      scores = lapply(seq_len(nrow(sc)), function(i) list(
        term_id = rownames(sc)[i], values = as.numeric(sc[i, ]))))
    cat(sprintf("-- ssgsea u%d n%d: %.0fms\n", s$universe, s$nSets, median(run$ms)))
  }
}

write(toJSON(out, auto_unbox = TRUE, digits = 10, na = "null"),
      file.path(resultsDir, "r.json"))
cat("==> wrote benchmark/results/r.json\n")
