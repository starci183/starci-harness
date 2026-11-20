// image.mts - the one name of an app's db image (slot app.db.image):
// the managed .starcistacks/images/db/Dockerfile builds it, `deploy.images.db` of .starcistacks/application-stacks.yaml names it as app
// `db`, and the stack build, the images and stack-deploy workflows, the local db container, the drift scratch database and the squash
// replay all build that one file. db/ keeps only schema and data (migrations, bootstrap, seed).

/** The image app name a deploy block gives the db service. */
export const DB_IMAGE_APP = 'db';
/** The build context of the db image, app-relative: the folder of its Dockerfile, which copies nothing from it. */
export const DB_IMAGE_CONTEXT = '.starcistacks/images/db';
/** The managed Dockerfile of the db image, app-relative. */
export const DB_DOCKERFILE = `${DB_IMAGE_CONTEXT}/Dockerfile`;
/** Where the db image's Dockerfile lived before it moved into the stacks; `starci app sync --execute` removes it. */
export const RETIRED_DB_DOCKERFILE = 'db/Dockerfile';

// The storage image (slot app.storage.image, PROJECT-STATICS-2): the managed .starcistacks/images/storage/Dockerfile of an app that has statics/ or
// whose back end needs object storage. Unlike the db image its build context is the APP ROOT, so statics/ is reachable; the Dockerfile-specific
// ignore file beside it (Dockerfile.dockerignore) admits statics/ only, so no other file of the repository can enter the image.
/** The image app name a deploy block gives the storage service. */
export const STORAGE_IMAGE_APP = 'storage';
/** The folder of the storage image's managed files, app-relative. */
export const STORAGE_IMAGE_DIR = '.starcistacks/images/storage';
/** The managed Dockerfile of the storage image, app-relative. */
export const STORAGE_DOCKERFILE = `${STORAGE_IMAGE_DIR}/Dockerfile`;
/** The local tag the development storage container runs, built from the app's .starcistacks/images/storage/Dockerfile. */
export const storageLocalImage = (project: string): string => `${project}-storage:local`;
/**
 * The `mc` client the storage image compiles from source in a builder stage (the pinned MinIO image ships none). `tag` is the upstream release,
 * `sha256` the digest of its source tarball (verified when Docker adds it), `buildImage` the Go toolchain image by digest. It can move to a
 * `starci183/mc` fork image published like the MinIO one (images/sources.json) without any change to the app: only this recipe changes.
 */
export const MC = Object.freeze({
  tag: 'RELEASE.2025-08-13T08-35-41Z',
  source: 'https://github.com/minio/mc/archive/refs/tags/RELEASE.2025-08-13T08-35-41Z.tar.gz',
  sha256: '29db22500374169a43951c7cef09daf19e7291ea5ba00ac10f321371b0a35b32',
  buildImage: 'golang:1.24.8-alpine3.22@sha256:3d78beb141d98f42337f1252ecf2a5f20374109929a4c3f6817f9e4179cc0ae5',
});
