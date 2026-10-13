suppressMessages(library(fgsea)); library(jsonlite)
m <- fromJSON("benchmark/data/manifest.json", simplifyVector = FALSE)
g <- Filter(function(x) x$universe == 2000 && x$nSets == 500, m$gsea)[[1]]
rk <- read.delim(file.path("benchmark/data", g$ranked), header = FALSE); stats <- setNames(rk[[2]], rk[[1]])
lines <- readLines(file.path("benchmark/data", g$gmt))
sets <- lapply(lines, function(l) strsplit(l, "\t")[[1]][-(1:2)]); names(sets) <- sapply(lines, function(l) strsplit(l, "\t")[[1]][1])
ids <- readLines(commandArgs(TRUE)[2])
res <- sapply(1:8, function(s) { set.seed(s); r <- suppressWarnings(fgseaMultilevel(sets[ids], stats, minSize = 1, maxSize = 1e5)); r$pval[match(ids, r$pathway)] })
rownames(res) <- ids
out <- data.frame(id = ids, geomean = 10^rowMeans(log10(res)), sd_log10 = apply(log10(res), 1, sd), min = apply(res, 1, min), max = apply(res, 1, max))
print(out, digits = 3, row.names = FALSE)
write.csv(out, commandArgs(TRUE)[1], row.names = FALSE)
