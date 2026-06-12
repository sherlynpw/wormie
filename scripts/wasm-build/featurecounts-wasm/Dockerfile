# Standalone featureCounts compiled to WASM with pthread support.
#
# Subread's featureCounts is a self-contained C program (no R needed). When
# built outside of WebR's MAIN_MODULE/SIDE_MODULE architecture, emscripten can
# fully enable -sUSE_PTHREADS=1 — giving us real intra-file parallelism via
# nested Web Workers, the same model native featureCounts uses.

ARG SUBREAD_VER=2.0.6
ARG EMSCRIPTEN_VER=4.0.8
FROM emscripten/emsdk:${EMSCRIPTEN_VER}

ARG SUBREAD_VER
ENV SUBREAD_VER=${SUBREAD_VER}

WORKDIR /build
RUN curl -fsSL "https://downloads.sourceforge.net/project/subread/subread-${SUBREAD_VER}/subread-${SUBREAD_VER}-source.tar.gz" -o subread.tar.gz \
 && tar xzf subread.tar.gz \
 && rm subread.tar.gz

WORKDIR /build/subread-${SUBREAD_VER}-source/src

# Override Makefile.Linux with an emscripten-targeted variant. The original
# uses -mtune=core2 (x86-only) and -lz from system libs. We replace with emcc,
# --use-port=zlib, glibc-only-symbol shims, and pthread.
COPY Makefile.emscripten Makefile.emscripten

# Build featureCounts only (skip the other ~15 tools in the subread suite).
RUN make -f Makefile.emscripten featureCounts 2>&1 | tail -30 \
 && ls -lah featureCounts.js featureCounts.wasm

# Entrypoint: ship the build outputs by copying to /out
ENTRYPOINT ["/bin/bash", "-c", "set -e; mkdir -p /out/featurecounts; cp -v /build/subread-${SUBREAD_VER}-source/src/featureCounts.js /build/subread-${SUBREAD_VER}-source/src/featureCounts.wasm /out/featurecounts/; ls -lah /out/featurecounts/"]
