#!/usr/bin/env bash
# Build standalone featureCounts.wasm with pthread support.
# Output: scripts/wasm-cran/featurecounts/featureCounts.{js,wasm,worker.js}
set -euo pipefail

SUBREAD_VER="${SUBREAD_VER:-2.0.6}"
REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT_DIR="${REPO_DIR}/scripts/wasm-cran"
BUILD_CTX="${REPO_DIR}/scripts/wasm-build/featurecounts-wasm"
IMAGE_TAG="wb-featurecounts:${SUBREAD_VER}"

mkdir -p "${OUT_DIR}"

echo "==> building image ${IMAGE_TAG}"
docker build --build-arg SUBREAD_VER="${SUBREAD_VER}" -t "${IMAGE_TAG}" "${BUILD_CTX}"

echo "==> extracting artifacts"
docker run --rm -v "${OUT_DIR}":/out -e SUBREAD_VER="${SUBREAD_VER}" "${IMAGE_TAG}"

echo ""
echo "==> done. Output:"
ls -lh "${OUT_DIR}/featurecounts/" 2>/dev/null
