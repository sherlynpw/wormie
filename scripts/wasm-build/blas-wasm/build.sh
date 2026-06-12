#!/usr/bin/env bash
# Spike: rebuild R-4.5.1's bundled reference BLAS as a WASM side module with
# SIMD vectorization enabled (-msimd128 -O3 -ffast-math). The default
# libRblas.so shipped in webr v0.5.9 was compiled without -msimd128 (verified
# via wasm-dis grep for v128/f64x2). Recompiling the same Fortran kernels with
# the autovectorizer enabled should give a modest speedup on dgemm/dgemv with
# zero code changes.
#
# Run inside the wb-wasm-build:v0.5.9 image:
#   docker run --rm --entrypoint bash \
#     -v "$PWD/scripts/wasm-build/blas-wasm:/work" \
#     -v "$PWD/out-blas:/out" \
#     wb-wasm-build:v0.5.9 /work/build.sh

set -euo pipefail

EMFC=/opt/flang/host/bin/flang
FORTRAN_RT=/opt/flang/wasm/lib/libFortranRuntime.a
BLAS_SRC=/opt/webr/R/build/R-4.5.1/src/extra/blas
OUT=${OUT:-/out}
WORK=$(mktemp -d)

CFLAGS="-O3 -msimd128 -ffast-math -fPIC"
FFLAGS="-O3 -ffast-math -fPIC -Xflang -target-feature -Xflang +simd128"

mkdir -p "${OUT}"
cp "${BLAS_SRC}"/*.f "${BLAS_SRC}"/*.f90 "${BLAS_SRC}"/*.c "${WORK}/"
rm -f "${WORK}/newAccelerate.c"

cd "${WORK}"

echo "==> compiling Fortran77 sources"
for f in blas.f cmplxblas.f; do
  echo "  -- ${f}"
  "${EMFC}" --target=wasm32-unknown-emscripten ${FFLAGS} -c "${f}" -o "${f%.f}.o"
done

echo "==> compiling Fortran90 sources"
for f in blas2.f90 cmplxblas2.f90; do
  echo "  -- ${f}"
  "${EMFC}" --target=wasm32-unknown-emscripten ${FFLAGS} -c "${f}" -o "${f%.f90}.o"
done

echo "==> linking libRblas.so"

emcc ${CFLAGS} \
  -sSIDE_MODULE=1 -sEXPORT_ALL=1 \
  -o libRblas.so \
  blas.o cmplxblas.o \
  blas2.o cmplxblas2.o \
  "${FORTRAN_RT}"

cp libRblas.so "${OUT}/libRblas.so"
ls -l "${OUT}/libRblas.so"

echo "==> verifying SIMD ops present"
/opt/emsdk/upstream/bin/wasm-dis "${OUT}/libRblas.so" >"${OUT}/libRblas.wat" 2>/dev/null
simd_count=$(grep -cE "v128|f64x2|f32x4|i64x2|i32x4" "${OUT}/libRblas.wat" || true)
echo "  SIMD ops in output: ${simd_count}"
rm -f "${OUT}/libRblas.wat"

echo "==> exported symbol count"
/opt/emsdk/upstream/bin/llvm-nm --defined-only --extern-only "${OUT}/libRblas.so" 2>/dev/null |
  grep -cE " [TWS] " || true

echo "==> top-level BLAS exports present?"
/opt/emsdk/upstream/bin/llvm-nm --defined-only --extern-only "${OUT}/libRblas.so" 2>/dev/null |
  grep -iE " [TWS] (dgemm|dgemv|ddot|daxpy|dscal)_" || echo "  !! missing core BLAS exports"
