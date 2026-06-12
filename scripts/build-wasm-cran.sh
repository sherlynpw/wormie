#!/usr/bin/env bash
# Build WASM binaries for CRAN packages and (optionally) bake a prebuilt
# WebR filesystem bundle for DESeq2 + apeglm.
#
# Usage:
#   scripts/build-wasm-cran.sh                    # build default packages (locfit)
#   scripts/build-wasm-cran.sh foo bar            # build specific packages
#   scripts/build-wasm-cran.sh --bake             # build packages, then bake bundle
#   scripts/build-wasm-cran.sh --bake-only        # skip package build, only bake
#
# Output: scripts/wasm-cran/{bin/emscripten/contrib/4.5/*.tgz, deseq2-bundle.{data,js.metadata}}

set -euo pipefail

DEFAULT_PKGS=(locfit)

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_DIR}/scripts/wasm-cran"
BUILD_CTX="${REPO_DIR}/scripts/wasm-build"
IMAGE_TAG="wb-wasm-build:v0.5.9"
HOST_RLIB_CACHE="${REPO_DIR}/.cache/wasm-host-rlib"

MODE=build # build | build+bake | bake-only
PKGS=()
for arg in "$@"; do
  case "${arg}" in
  --bake) MODE=build+bake ;;
  --bake-only) MODE=bake-only ;;
  *) PKGS+=("${arg}") ;;
  esac
done
if [ ${#PKGS[@]} -eq 0 ]; then PKGS=("${DEFAULT_PKGS[@]}"); fi

mkdir -p "${OUT_DIR}"

echo "==> building image ${IMAGE_TAG}"
docker build -t "${IMAGE_TAG}" "${BUILD_CTX}"

if [ "${MODE}" != "bake-only" ]; then
  echo "==> building local CRAN packages: ${PKGS[*]}"
  mkdir -p "${HOST_RLIB_CACHE}"
  if [ ! -e "${HOST_RLIB_CACHE}/base" ]; then
    echo "==> seeding host R library cache from image (one-time, ~30s)"
    docker run --rm --entrypoint /bin/sh \
      -v "${HOST_RLIB_CACHE}":/cache \
      "${IMAGE_TAG}" \
      -c 'cp -a /opt/webr/host/R-4.5.1/lib/R/library/. /cache/'
  fi
  docker run --rm \
    -v "${OUT_DIR}":/out \
    -v "${HOST_RLIB_CACHE}":/opt/webr/host/R-4.5.1/lib/R/library \
    "${IMAGE_TAG}" build-pkgs "${PKGS[@]}"
fi

if [ "${MODE}" = "build+bake" ] || [ "${MODE}" = "bake-only" ]; then
  echo "==> baking deseq2-bundle"
  docker run --rm -v "${OUT_DIR}":/out "${IMAGE_TAG}" bake-bundle
fi

echo ""
echo "==> done. Output:"
find "${OUT_DIR}" -maxdepth 4 -type f -printf '%P\t%s bytes\n' | sort
