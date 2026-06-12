include /opt/webr/packages/webr-vars.mk

CC11 = emcc
CC17 = emcc
CC23 = emcc
CC90 = emcc
CC99 = emcc

C11FLAGS  = -std=gnu11 $(EM_CFLAGS)
C17FLAGS  = -std=gnu17 $(EM_CFLAGS)
C23FLAGS  = -std=gnu23 $(EM_CFLAGS)
C90FLAGS  = -std=gnu90 $(EM_CFLAGS)
C99FLAGS  = -std=gnu99 $(EM_CFLAGS)

SHLIB_CFLAGS    =
SHLIB_C11FLAGS  =
SHLIB_C17FLAGS  =
SHLIB_C23FLAGS  =
SHLIB_C90FLAGS  =
SHLIB_C99FLAGS  =

EM_GLIBC_SHIMS = -Dfopen64=fopen -Dftello64=ftello -Dfseeko64=fseeko -Doff64_t=off_t
EM_CFLAGS     += $(EM_GLIBC_SHIMS)
EM_CXX_FIXES  += $(EM_GLIBC_SHIMS)

WB_SIMD_FLAGS  = -msimd128 -O3
EM_CFLAGS     += $(WB_SIMD_FLAGS)
EM_CXX_FIXES  += $(WB_SIMD_FLAGS)

override CXXFLAGS    = -std=gnu++17 $(EM_CXX_FIXES) $(EM_CFLAGS)
override CXX11FLAGS  = -std=gnu++17 $(EM_CXX_FIXES) $(EM_CFLAGS)
override CXX14FLAGS  = -std=gnu++17 $(EM_CXX_FIXES) $(EM_CFLAGS)

override BLAS_LIBS   = -L/opt/webr/wasm/R-4.5.1/lib/R/lib -lRblas
override LAPACK_LIBS = -L/opt/webr/wasm/R-4.5.1/lib/R/lib -lRlapack
