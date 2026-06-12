#!/usr/bin/env bash
# Rebuild R-4.5.1's bundled reference LAPACK as a WASM side module with
# SIMD vectorization, mirroring what blas-wasm/build.sh does for BLAS.
#
# Run inside the wormie-wasm-build:v0.5.9 image:
#   docker run --rm --entrypoint bash \
#     -v "$PWD/scripts/wasm-build/blas-wasm:/work" \
#     -v "$PWD/out-blas:/out" \
#     wormie-wasm-build:v0.5.9 /work/build-lapack.sh

set -euo pipefail

EMFC=/opt/flang/host/bin/flang
FORTRAN_RT=/opt/flang/wasm/lib/libFortranRuntime.a
LAPACK_SRC=/opt/webr/R/build/R-4.5.1/src/modules/lapack
OUT=${OUT:-/out}
WORK=$(mktemp -d)

CFLAGS="-O3 -msimd128 -ffast-math -fPIC"
FFLAGS="-O3 -ffast-math -fPIC -Xflang -target-feature -Xflang +simd128"
DLAMCH_FFLAGS="-O1 -fPIC"

mkdir -p "${OUT}"
cp "${LAPACK_SRC}"/*.f "${LAPACK_SRC}"/*.f90 "${WORK}/"

cd "${WORK}"

echo "==> compiling F90 modules"
for f in la_constants.f90 la_xisnan.f90 dlartg.f90 dlassq.f90 zlartg.f90 zlassq.f90; do
  echo "  -- ${f}"
  "${EMFC}" --target=wasm32-unknown-emscripten ${FFLAGS} -c "${f}" -o "${f%.f90}.o"
done

echo "==> compiling F77 sources (SIMD)"
for f in dlapack.f cmplx.f dgemmtr.f zgemmtr.f; do
  echo "  -- ${f}"
  "${EMFC}" --target=wasm32-unknown-emscripten ${FFLAGS} -c "${f}" -o "${f%.f}.o"
done

echo "==> compiling dlamch.f (SAFE flags, no fast-math)"
"${EMFC}" --target=wasm32-unknown-emscripten ${DLAMCH_FFLAGS} -c dlamch.f -o dlamch.o

echo "==> linking libRlapack.so"
emcc ${CFLAGS} \
  -sSIDE_MODULE=1 -sEXPORT_ALL=1 \
  -o libRlapack.so \
  la_constants.o la_xisnan.o \
  dlartg.o dlassq.o zlartg.o zlassq.o \
  dlapack.o cmplx.o dgemmtr.o zgemmtr.o \
  dlamch.o \
  "${FORTRAN_RT}"

cp libRlapack.so "${OUT}/libRlapack.so"
ls -lh "${OUT}/libRlapack.so"

echo "==> verifying SIMD ops + key exports"
/opt/emsdk/upstream/bin/wasm-dis "${OUT}/libRlapack.so" >"${OUT}/libRlapack.wat" 2>/dev/null
simd_count=$(grep -cE "v128|f64x2|f32x4|i64x2|i32x4" "${OUT}/libRlapack.wat" || true)
echo "  SIMD ops in output: ${simd_count}"
rm -f "${OUT}/libRlapack.wat"

/opt/emsdk/upstream/bin/llvm-nm --defined-only --extern-only "${OUT}/libRlapack.so" 2>/dev/null |
  grep -iE " [TWS] (dpotrf|dgetrf|dgesv|dgesvd|dgeqrf|dsyev|dlamch|dgeev|dorgqr|dtrtri)_" ||
  echo "  !! missing core LAPACK exports"
