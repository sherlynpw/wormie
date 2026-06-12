#!/usr/bin/env bash
# Bake a prebuilt WebR filesystem image containing DESeq2 + apeglm + ashr + all deps,
# including our locally-built locfit. The resulting deseq2-bundle.data /
# deseq2-bundle.js.metadata pair is mounted at the WebR client via
# FS.mount('WORKERFS', ...), giving zero install time on every visit.
#
# Runs inside the wb-wasm-build Docker image. Inputs: pre-built local packages
# at /out (e.g. locfit_*.tgz). Outputs: /out/deseq2-bundle.{data,js.metadata}.

set -euo pipefail

OUT=/out
LOCAL_REPO_DIR="${OUT}/bin/emscripten/contrib/4.5"
LIB_DIR=$(mktemp -d) # the staging library
WORK=$(mktemp -d)
FILE_PACKAGER=/opt/emsdk/upstream/emscripten/tools/file_packager

MOUNT_PATH="/usr/lib/R/library"

echo "==> step 1: enumerate full WASM package set for DESeq2 + apeglm"
"${RSCRIPT}" - <<RSCRIPT
ap_cran <- tryCatch(
  available.packages(repos = "https://repo.r-wasm.org/", type = "source"),
  error = function(e) NULL
)
ap_bioc <- tryCatch(
  available.packages(repos = "https://bioc.r-universe.dev", type = "source"),
  error = function(e) NULL
)
if (is.null(ap_cran)) stop("cannot reach repo.r-wasm.org")
ap_all <- if (is.null(ap_bioc)) ap_cran else rbind(
  ap_cran,
  ap_bioc[!rownames(ap_bioc) %in% rownames(ap_cran), , drop = FALSE]
)
deps <- tools::package_dependencies(
  c("DESeq2", "apeglm", "ashr", "Rsubread"),
  db = ap_all,
  which = c("Depends","Imports"),
  recursive = TRUE
)
## Foundational Bioconductor packages that DESeq2 transitively depends on.
## bioc.r-universe.dev's WASM channel currently doesn't ship .tgz binaries for
## these (verified May 2026: PACKAGES file only lists ~50 higher-level pkgs,
## none of the foundational ones). We build them locally via build-pkgs.sh and
## list them explicitly here so the bake manifest picks them up even when
## $(tools::package_dependencies) returns nothing for them.
foundational_bioc <- c("BiocGenerics","S4Vectors","IRanges","XVector","zlibbioc",
                       "GenomeInfoDb","GenomeInfoDbData","GenomicRanges","Seqinfo",
                       "MatrixGenerics","DelayedArray","S4Arrays","SparseArray",
                       "Biobase","BiocParallel","SummarizedExperiment")
all_pkgs <- unique(c("DESeq2", "apeglm", "ashr", "Rsubread", "locfit",
                     foundational_bioc, unlist(deps)))
# Drop base + recommended that ship with WebR core
bundled <- c('base','compiler','datasets','grDevices','graphics','grid',
             'methods','parallel','splines','stats','stats4','tcltk',
             'tools','translations','utils','webr')
all_pkgs <- setdiff(all_pkgs, bundled)

## ap_all[all_pkgs, "Version"] would error with subscript-out-of-bounds when
## an entry in all_pkgs (foundational_bioc additions) isn't in rownames(ap_all);
## use match() so missing entries land as NA. The LOCAL detection loop below
## fills in the real version from the local .tgz filename.
ap_idx <- match(all_pkgs, rownames(ap_all))
manifest <- data.frame(
  name = all_pkgs,
  version = ap_all[ap_idx, "Version"],
  repo = ifelse(all_pkgs %in% rownames(ap_bioc),
                "https://bioc.r-universe.dev",
                "https://repo.r-wasm.org"),
  stringsAsFactors = FALSE
)
# Mark any package as LOCAL when a built .tgz exists in our local repo.
# Currently this auto-tags locfit and Rsubread (built via build-pkgs.sh) so
# the bake reaches for the local copy first instead of a 404 on r-universe.
local_dir <- "${LOCAL_REPO_DIR}"
if (dir.exists(local_dir)) {
  for (i in seq_len(nrow(manifest))) {
    nm <- manifest\$name[i]; vr <- manifest\$version[i]
    if (file.exists(file.path(local_dir, paste0(nm, "_", vr, ".tgz")))) {
      manifest\$repo[i] <- "LOCAL"
      next
    }
    # Also accept a different version in the local repo (e.g. CRAN bumps before
    # we rebuild). Pick whatever's there.
    cands <- list.files(local_dir, pattern = paste0("^", nm, "_.*\\\\.tgz$"))
    if (length(cands) >= 1) {
      manifest\$repo[i] <- "LOCAL"
      manifest\$version[i] <- sub("\\\\.tgz$", "", sub(paste0("^", nm, "_"), "", cands[1]))
    }
  }
}
write.table(manifest, file = "${WORK}/manifest.tsv", sep = "\\t",
            quote = FALSE, row.names = FALSE)
cat("wrote ", nrow(manifest), " entries\\n")
RSCRIPT

echo "==> step 2: download and extract every WASM .tgz into staging library"
mkdir -p "${LIB_DIR}"
while IFS=$'\t' read -r name version repo; do
  [ "${name}" = "name" ] && continue # header
  if [ "${repo}" = "LOCAL" ]; then
    src="${LOCAL_REPO_DIR}/${name}_${version}.tgz"
    if [ ! -f "${src}" ]; then
      echo "  !! local ${name}_${version}.tgz missing at ${src}" >&2
      echo "     run scripts/build-wasm-cran.sh first" >&2
      exit 1
    fi
    echo "  + ${name} ${version} (local)"
    tar -xzf "${src}" -C "${LIB_DIR}"
  else
    url="${repo}/bin/emscripten/contrib/4.5/${name}_${version}.tgz"
    echo "  + ${name} ${version} ($(basename "${repo}"))"
    if ! curl -fsSL -o "${WORK}/${name}.tgz" "${url}"; then
      # Try alt path (some r-universe repos serve under a different prefix)
      alt="${repo}/bin/wasm/contrib/4.5/${name}_${version}.tgz"
      if ! curl -fsSL -o "${WORK}/${name}.tgz" "${alt}"; then
        echo "  !! ${name} ${version}: 404 at ${url}" >&2
        echo "     check if it needs a local build (add to scripts/build-wasm-cran.sh)" >&2
        continue
      fi
    fi
    tar -xzf "${WORK}/${name}.tgz" -C "${LIB_DIR}"
  fi
done <"${WORK}/manifest.tsv"

INSTALLED=$(find "${LIB_DIR}" -maxdepth 1 -mindepth 1 -type d | wc -l)
echo "==> staged ${INSTALLED} packages in ${LIB_DIR}"
echo "    size: $(du -sh "${LIB_DIR}" | cut -f1)"

echo "==> step 3: build Emscripten filesystem bundle"
cd "${LIB_DIR}"
"${FILE_PACKAGER}" "${OUT}/deseq2-bundle.data" \
  --preload "${LIB_DIR}@${MOUNT_PATH}" \
  --separate-metadata \
  --js-output="${OUT}/deseq2-bundle.js" \
  --export-name=Module

rm -f "${OUT}/deseq2-bundle.js"

DATA_SIZE=$(du -sh "${OUT}/deseq2-bundle.data" | cut -f1)
META_SIZE=$(du -sh "${OUT}/deseq2-bundle.js.metadata" | cut -f1)
echo ""
echo "==> bundle baked:"
echo "    ${OUT}/deseq2-bundle.data         (${DATA_SIZE})"
echo "    ${OUT}/deseq2-bundle.js.metadata  (${META_SIZE})"
echo ""
echo "==> manifest of packages in bundle:"
column -t -s $'\t' <"${WORK}/manifest.tsv"
