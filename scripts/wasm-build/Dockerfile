ARG WEBR_VER=v0.5.9
FROM ghcr.io/r-wasm/webr:${WEBR_VER}

# R version inside this webr image. webr v0.5.9 ships R 4.5.1.
ENV R_VERSION=4.5.1
ENV WEBR_ROOT=/opt/webr
ENV WASM_TOOLS=${WEBR_ROOT}/tools
ENV R_SOURCE=${WEBR_ROOT}/R/build/R-${R_VERSION}
ENV R_MAKEVARS_USER=/build/webr-vars-augment.mk
ENV R_HOST_EXE=${WEBR_ROOT}/host/R-${R_VERSION}/bin/R
ENV RSCRIPT=${WEBR_ROOT}/host/R-${R_VERSION}/bin/Rscript
ENV R_WASM_LIB=${WEBR_ROOT}/wasm/R-${R_VERSION}/lib/R/library
ENV PATH=/opt/emsdk/upstream/emscripten:${PATH}

# Tools we need for the build harness itself: download + repo packaging.
RUN ${R_HOST_EXE} -e 'install.packages(c("desc","jsonlite"), repos="https://cloud.r-project.org")' \
 && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY webr-vars-augment.mk /build/webr-vars-augment.mk
COPY build-pkgs.sh /usr/local/bin/build-pkgs
COPY bake-bundle.sh /usr/local/bin/bake-bundle
RUN chmod +x /usr/local/bin/build-pkgs /usr/local/bin/bake-bundle

ENTRYPOINT ["/bin/bash", "-c", "case \"$1\" in bake-bundle) exec /usr/local/bin/bake-bundle ;; build-pkgs) shift; exec /usr/local/bin/build-pkgs \"$@\" ;; *) exec /usr/local/bin/build-pkgs \"$@\" ;; esac", "--"]
CMD ["build-pkgs", "locfit"]
