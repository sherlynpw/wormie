#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${REPO_DIR}/scripts/wasm-cran/webr-pthread/v0.5.9"
UPSTREAM="https://webr.r-wasm.org/v0.5.9"
LOCAL_BLAS="${REPO_DIR}/out-blas/libRblas.so"

mkdir -p "${DEST}"

FILES=(webr.mjs webr-worker.js R.js R.wasm libRblas.so libRlapack.so)

for f in "${FILES[@]}"; do
  echo "  -> ${f}"
  curl -fsSL --compressed -o "${DEST}/${f}.new" "${UPSTREAM}/${f}"
  mv "${DEST}/${f}.new" "${DEST}/${f}"
done

PKGS=(base compiler datasets grDevices graphics grid methods parallel splines
  stats stats4 tools translations utils webr)
echo "==> refreshing vfs/usr/lib/R/library/* (${#PKGS[@]} base packages)"
mkdir -p "${DEST}/vfs/usr/lib/R/library"
for p in "${PKGS[@]}"; do
  for ext in data.gz js.metadata; do
    target="${DEST}/vfs/usr/lib/R/library/${p}.${ext}"
    if ! curl -fsSL --compressed -o "${target}.new" "${UPSTREAM}/vfs/usr/lib/R/library/${p}.${ext}"; then
      echo "  !! ${p}.${ext} not found upstream (skipping)"
      rm -f "${target}.new"
      continue
    fi
    mv "${target}.new" "${target}"
  done
  echo "  + ${p}"
done

TRANS_META="${DEST}/vfs/usr/lib/R/library/translations.js.metadata"
TRANS_DATA="${DEST}/vfs/usr/lib/R/library/translations.data.gz"
TRANS_DIR="${DEST}/vfs/usr/lib/R/library/translations"
if [ -f "${TRANS_META}" ] && [ -f "${TRANS_DATA}" ]; then
  echo "==> extracting translations/* (LazyFile mode)"
  rm -rf "${TRANS_DIR}"
  raw=$(mktemp)
  gunzip -c "${TRANS_DATA}" >"${raw}"
  python3 - "${TRANS_META}" "${raw}" "${TRANS_DIR}" <<'PY'
import json, os, sys
meta_path, raw_path, outdir = sys.argv[1:4]
m = json.load(open(meta_path))
with open(raw_path, "rb") as fh:
    data = fh.read()
for f in m["files"]:
    fn = f["filename"].lstrip("/")
    target = os.path.join(outdir, fn)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as out:
        out.write(data[f["start"]:f["end"]])
print(f"  wrote {len(m['files'])} files")
PY
  rm -f "${raw}"
fi

cp "${DEST}/libRblas.so" "${DEST}/libRblas.reference.so"

if [ -f "${LOCAL_BLAS}" ]; then
  echo "  -> overlaying SIMD libRblas.so from ${LOCAL_BLAS}"
  cp "${LOCAL_BLAS}" "${DEST}/libRblas.so"
else
  echo "  !! no SIMD libRblas.so at ${LOCAL_BLAS} (run blas-wasm/build.sh first)"
fi

# The DESeq2 bundle is baked in CI and lives only in R2; without it /de loads
# WebR and then fails on library(DESeq2). Mirror the deployed copy for dev.
BUNDLE_DIR="${REPO_DIR}/scripts/wasm-cran"
SITE="https://wormie.rs.ht/wasm-cran"
echo "==> fetching deseq2 bundle from ${SITE}"
for f in deseq2-bundle.data deseq2-bundle.js.metadata; do
  echo "  -> ${f}"
  curl -fsSL -o "${BUNDLE_DIR}/${f}.new" "${SITE}/${f}"
  mv "${BUNDLE_DIR}/${f}.new" "${BUNDLE_DIR}/${f}"
done

echo "==> done. Listing:"
ls -lh "${DEST}"
ls -lh "${BUNDLE_DIR}"/deseq2-bundle.*
