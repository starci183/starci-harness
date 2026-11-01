# syntax=docker/dockerfile:1
# Builds MinIO from source (unmodified upstream code, AGPL-3.0).
# Source of this image: https://github.com/starci183/minio
FROM golang:1.24.8-alpine3.22 AS build

# Upstream release this tree is pinned to (RELEASE.<MINIO_VERSION>) and its commit.
ARG MINIO_VERSION=2025-10-15T17-29-55Z
ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ARG TARGETOS
ARG TARGETARCH

ENV CGO_ENABLED=0 GOFLAGS=-mod=readonly
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
# Same flags as buildscripts/gen-ldflags.go, without needing a .git directory.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -o /out/minio -ldflags "-s -w \
      -X github.com/minio/minio/cmd.Version=${MINIO_VERSION} \
      -X github.com/minio/minio/cmd.CopyrightYear=${MINIO_VERSION%%-*} \
      -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.${MINIO_VERSION} \
      -X github.com/minio/minio/cmd.CommitID=${MINIO_COMMIT} \
      -X github.com/minio/minio/cmd.ShortCommitID=$(echo ${MINIO_COMMIT} | cut -c1-12)" .

FROM alpine:3.22

ARG MINIO_VERSION=2025-10-15T17-29-55Z
ARG IMAGE_VERSION=RELEASE.2025-10-15T17-29-55Z

LABEL org.opencontainers.image.title="minio" \
      org.opencontainers.image.description="MinIO object storage built from source (community fork, unmodified code)" \
      org.opencontainers.image.source="https://github.com/starci183/minio" \
      org.opencontainers.image.url="https://github.com/starci183/minio" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.vendor="starci183"

RUN apk add --no-cache ca-certificates \
 && addgroup -S -g 10001 minio \
 && adduser -S -u 10001 -G minio -h /data minio \
 && mkdir -p /data && chown minio:minio /data

COPY --from=build /out/minio /usr/bin/minio
COPY LICENSE NOTICE CREDITS /licenses/

ENV MINIO_CONFIG_ENV_FILE=/etc/config.env
USER minio:minio
WORKDIR /data
VOLUME ["/data"]
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
