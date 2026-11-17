# syntax=docker/dockerfile:1.7
# Managed by starci app sync (slot app.storage.image); do not edit: run "npx starci app sync --execute".
# The image of the storage service of an app that has statics/ or whose back end needs object storage (PROJECT-STATICS-2): the pinned StarCi
# MinIO, plus an `mc` client compiled from its pinned source tag (the base image ships none; it can move to a starci183/mc fork image later),
# plus the repo-owned statics/ folder. MinIO stores objects in its own format, so the statics are written through the S3 API by this entrypoint
# once the server is up, never copied into /data. The build context is the app root; Dockerfile.dockerignore beside this file admits statics/
# only, so nothing else of the repository (no secret) enters the image. The dev stack and the production stack both build this one file.
FROM {{mcBuildImage}} AS mc
ADD --checksum=sha256:{{mcSha256}} {{mcSource}} /tmp/mc.tar.gz
RUN mkdir /src \
    && tar -xzf /tmp/mc.tar.gz -C /src --strip-components=1 \
    && cd /src \
    && CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -o /out/mc \
       -ldflags "-s -w -X github.com/minio/mc/cmd.ReleaseTag={{mcTag}}" .

FROM {{minioImage}}
COPY --from=mc /out/mc /usr/bin/mc
COPY --chown=minio:minio statics/ /statics/
COPY --chmod=0755 <<'SCRIPT' /usr/local/bin/starci-storage
#!/bin/sh
# Starts MinIO, then loads the baked statics once the server answers: create the bucket when missing, mirror /statics into <bucket>/<prefix>
# adding and overwriting only (never --remove, so an app's uploads and statics deleted from the repository stay), give that prefix, and only
# it, a public download policy, and mark ready. The mirror is skipped when the bucket already holds this image's statics digest.
set -eu
export MC_CONFIG_DIR=/tmp/.mc
minio server /data --console-address :9001 &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT
until wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live; do
  kill -0 "$pid" 2>/dev/null || exit 1
  sleep 1
done
mc alias set local http://127.0.0.1:9000 "$(cat "$MINIO_ROOT_USER_FILE")" "$(cat "$MINIO_ROOT_PASSWORD_FILE")" >/dev/null
: "${STATICS_BUCKET:?}" "${STATICS_PREFIX:=statics}" "${STATICS_PUBLIC:=download}"
mc mb --ignore-existing "local/$STATICS_BUCKET" >/dev/null
digest=$(cat /statics.sha256)
current=
if mc stat "local/$STATICS_BUCKET/.starci/statics.sha256" >/dev/null 2>&1; then current=$(mc cat "local/$STATICS_BUCKET/.starci/statics.sha256"); fi
if [ "$current" != "$digest" ]; then
  mc mirror --overwrite --quiet /statics "local/$STATICS_BUCKET/$STATICS_PREFIX"
  echo "$digest" | mc pipe "local/$STATICS_BUCKET/.starci/statics.sha256" >/dev/null
fi
[ "$STATICS_PUBLIC" = none ] || mc anonymous set "$STATICS_PUBLIC" "local/$STATICS_BUCKET/$STATICS_PREFIX/" >/dev/null
touch /tmp/statics-ready
wait "$pid" || wait "$pid"
SCRIPT
USER root
RUN find /statics \( -name '*.yaml' -o -name .gitkeep \) -delete \
    && (cd /statics && find . -type f -exec sha256sum {} + | sort) | sha256sum | cut -d' ' -f1 > /statics.sha256
USER minio:minio
ENTRYPOINT ["/usr/local/bin/starci-storage"]
