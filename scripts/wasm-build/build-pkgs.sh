#!/usr/bin/env bash

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "usage: build-pkgs <pkg1> [pkg2 ...]" >&2
  exit 1
fi

PKGS=("$@")
OUT=/out
BIN_DIR="${OUT}/bin/emscripten/contrib/4.5"
mkdir -p "${BIN_DIR}"

SRC_DIR=$(mktemp -d)
WORK_LIB=$(mktemp -d)

INSTALLED_FLAG_DIR=$(mktemp -d)

install_dep_native() {
  local dep="$1"
  if [ -e "${INSTALLED_FLAG_DIR}/${dep}" ]; then
    echo "  -> ${dep} already installed natively in this run, skipping"
    return 0
  fi
  echo "  -> installing ${dep} natively into host R (build-time crutch)"
  env -u R_MAKEVARS_USER -u WASM_TOOLS -u R_SOURCE "${RSCRIPT}" -e "
    pkg <- '${dep}'
    repos_release <- c(
      BiocReleaseBioc = 'https://bioconductor.org/packages/release/bioc',
      BiocReleaseAnno = 'https://bioconductor.org/packages/release/data/annotation',
      CRAN            = 'https://cloud.r-project.org'
    )
    repos_devel <- c(
      BiocDevelBioc = 'https://bioconductor.org/packages/devel/bioc',
      BiocDevelAnno = 'https://bioconductor.org/packages/devel/data/annotation',
      CRAN          = 'https://cloud.r-project.org'
    )
    ok <- tryCatch({
      install.packages(pkg, repos = repos_release, type = 'source',
                       dependencies = NA, quiet = TRUE)
      requireNamespace(pkg, quietly = TRUE)
    }, error = function(e) FALSE, warning = function(w) FALSE)
    if (!isTRUE(ok)) {
      ok <- tryCatch({
        install.packages(pkg, repos = repos_devel, type = 'source',
                         dependencies = NA, quiet = TRUE)
        requireNamespace(pkg, quietly = TRUE)
      }, error = function(e) FALSE, warning = function(w) FALSE)
    }
    invisible(library(pkg, character.only = TRUE))
  " 2>&1 | tail -5 || true
  touch "${INSTALLED_FLAG_DIR}/${dep}"
}

# Helper: parse Depends/Imports/LinkingTo from a source tarball's DESCRIPTION.
list_install_deps() {
  local src_tgz="$1"
  "${RSCRIPT}" -e "
    td <- tempfile(); dir.create(td)
    untar('${src_tgz}', exdir = td)
    d <- read.dcf(file.path(list.files(td, full.names = TRUE)[1], 'DESCRIPTION'))
    fields <- intersect(c('Depends','Imports','LinkingTo'), colnames(d))
    raw <- paste(unlist(d[1, fields]), collapse=',')
    pkgs <- gsub('\\\\s|\\\\([^)]*\\\\)', '', strsplit(raw, ',')[[1]])
    pkgs <- pkgs[nzchar(pkgs) & pkgs != 'R']
    bundled <- c('base','compiler','datasets','grDevices','graphics','grid',
                 'methods','parallel','splines','stats','stats4','tcltk',
                 'tools','translations','utils','webr')
    pkgs <- setdiff(pkgs, bundled)
    cat(paste(pkgs, collapse=' '))
  " 2>/dev/null
}

for PKG in "${PKGS[@]}"; do
  echo "==> [${PKG}] downloading source (CRAN → Bioconductor → r-universe-bioc fallback)"
  "${R_HOST_EXE}" --quiet --no-save -e "
    options(repos = c(CRAN = 'https://cloud.r-project.org'))
    res <- tryCatch({
      r <- download.packages('${PKG}', destdir = '${SRC_DIR}', type = 'source')
      if (nrow(r) > 0 && r[1, 2] != '') 'cran' else stop('not on CRAN')
    }, error = function(e) e\$message)
    if (res != 'cran') {
      # Try Bioconductor in the three channels (software, annotation data,
      # experiment data) across release + devel. GenomeInfoDbData and friends
      # live under data/annotation, not bioc.
      branches <- c('release', '3.21', 'devel', '3.22')
      channels <- c('bioc', 'data/annotation', 'data/experiment')
      for (bv in branches) {
        for (ch in channels) {
          url <- paste0('https://bioconductor.org/packages/', bv, '/', ch)
          ok <- tryCatch({
            r <- download.packages('${PKG}', destdir = '${SRC_DIR}',
                                   repos = url, type = 'source')
            nrow(r) > 0 && r[1, 2] != ''
          }, error = function(e) FALSE)
          if (isTRUE(ok)) { cat('Got from Bioconductor', bv, ch, '\\n'); break }
        }
        if (length(list.files('${SRC_DIR}', pattern = paste0('^', '${PKG}', '_.*\\\\.tar\\\\.gz$'))) > 0) break
      }
    }
  "
  SRC_TGZ=$(ls "${SRC_DIR}/${PKG}"_*.tar.gz 2>/dev/null | head -1 || true)
  if [ -z "${SRC_TGZ}" ]; then
    echo "  !! could not find source for ${PKG} on CRAN or Bioconductor" >&2
    exit 1
  fi
  echo "==> [${PKG}] source: ${SRC_TGZ}"

  echo "==> [${PKG}] resolving install-time deps"
  DEPS=$(list_install_deps "${SRC_TGZ}")
  if [ -n "${DEPS}" ]; then
    echo "==> [${PKG}] deps to pre-seed in WORK_LIB: ${DEPS}"
    for D in ${DEPS}; do
      install_dep_native "${D}" || true
    done
  fi

  echo "==> [${PKG}] compiling to WASM with webr-vars.mk"
  # Diagnostic: confirm env is set and Makevars file is readable
  echo "  [env] WASM_TOOLS=${WASM_TOOLS}"
  echo "  [env] R_SOURCE=${R_SOURCE}"
  echo "  [env] R_MAKEVARS_USER=${R_MAKEVARS_USER}"
  echo "  [env] Makevars exists: $(test -r "${R_MAKEVARS_USER}" && echo yes || echo NO)"
  echo "  [env] webr's own setting via R: $(env WASM_TOOLS="${WASM_TOOLS}" R_SOURCE="${R_SOURCE}" R_MAKEVARS_USER="${R_MAKEVARS_USER}" "${R_HOST_EXE}" CMD config CC)"
  export WASM_TOOLS R_SOURCE R_MAKEVARS_USER
  R_INSTALL_NO_BYTE_COMPILE=true \
    "${R_HOST_EXE}" CMD INSTALL \
    --library="${WORK_LIB}" \
    --no-docs \
    --no-test-load \
    --no-staged-install \
    --no-byte-compile \
    --no-help \
    --configure-args="--host=wasm32-unknown-emscripten --build=$(uname -m)-pc-linux-gnu" \
    "${SRC_TGZ}"

  echo "==> [${PKG}] packaging .tgz for WebR"
  VER=$(
    "${RSCRIPT}" -e "
      cat(read.dcf(file.path('${WORK_LIB}/${PKG}', 'DESCRIPTION'), 'Version'))
    "
  )
  TGZ_NAME="${PKG}_${VER}.tgz"
  (cd "${WORK_LIB}" && tar czf "${BIN_DIR}/${TGZ_NAME}" "${PKG}")
  echo "==> [${PKG}] emitted ${BIN_DIR}/${TGZ_NAME}"

  rm -rf "${WORK_LIB:?}/${PKG}"
done

echo "==> writing PACKAGES index"
"${RSCRIPT}" -e "tools::write_PACKAGES('${BIN_DIR}', type = 'mac.binary')"

echo ""
echo "==> done. Repo layout:"
find "${OUT}" -type f | sort
