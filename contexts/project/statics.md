# Statics: the repo-owned media of an app

An app's own images and videos (empty-state illustrations, hero art, a product video) are not code and not user data. They are authored in the
repository, reviewed in a pull request, and served from the project's own object store. This file is the contract of that folder, of the image that
carries it into the store and of the checks that hold both. It is the same in both editions. The brand the images are drawn in is
[brand.md](brand.md); how an image is addressed in code is the Grammar's `staticsKey`.

## PROJECT-STATICS-1 The statics folder

`statics/` sits at the app root, beside `fe/` and `be/` (slot `app.statics`, optional, tracked; `statics/` is forbidden inside a side, slot
`repo.side-root-forbidden`). Its files are media and their prompts, nothing else:

- **Media**: `statics/<area>/**/<name>.{png,jpg,jpeg,webp,avif,gif,svg,mp4,webm}`. Every segment, the file name before its extension included, is lowercase
  kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), the extension is lowercase, and the first segment is an area folder (`illustrations`, `brand`, `video`).
  The path under `statics/` is the **staticsKey**: `illustrations/empty/customers-v2.png`. Code and data hold the key and nothing else; the URL is
  `${base}/${staticsKey}` (PROJECT-STATICS-4).
- **`<name>.prompt.yaml`**, beside an AI-made image of that name: the `prompt` that made it (a non-empty string). Its `subject` and the `basePrompt` version
  it was prompted with are judged against `.starcistacks/brand/` ([brand.md](brand.md) PROJECT-BRAND-2). A prompt file is never loaded into the store.
- **`.gitkeep`**, the starter file that keeps an empty folder in git. `starci app sync --execute` adds it when the folder is missing, because the storage
  image copies the folder.
- **Cache: change the key when the art changes.** Keys are not content-hashed and no `Cache-Control` is set. A redrawn image gets a new key
  (`customers-v2.png`), and the code that shows it changes with it. There is no hash mechanism.
- **Sizes**: a file above 2 MiB is a warning, above 10 MiB an error; the folder above 256 MiB is an error.
- `.gitattributes` marks `statics/** binary` and the prompt files `text eol=lf`.

Why: one folder is the one place media is authored, so it can be sized, named and reviewed, and the store has one thing to load. A name is a URL and a
key held in data for years, so it is fixed in shape on the first day.

Enforced by: R438 (`statics-shape`: `HFS_STATICS_FILE_KIND`, `HFS_STATICS_KEY`, `HFS_STATICS_FILE_SIZE`, `HFS_STATICS_TREE_SIZE`, `HFS_STATICS_PROMPT_ORPHAN`,
`HFS_STATICS_PROMPT_SCHEMA`); the folder's place by the slot manifest (`HFS_ROOT_ENTRY_FORBIDDEN`).

## PROJECT-STATICS-2 The storage image and its condition

**Every project ships its own MinIO, in development and in production, on one condition: it has `statics/` or its back end needs object storage.**
The condition holds when `statics/` holds a file other than `.gitkeep`, or the root `package.json` depends on `@starci/object-storage`, or the stack
declaration holds a `storage` custody member (or a sealed `storage-*` production secret). When it holds, the project declares a `storage` service in its
dev compose and, in a lite app, `deploy.images.storage: {app: storage}` in production. When it does not hold, there is no MinIO: a project that declares
a storage service anyway gets a warning that nothing uses it. The one function that answers is `scripts/lib/storage-need.mts`; `starci app sync` and R440
both read it, so what sync renders and what the check demands never differ.

The store is built from the managed `.starcistacks/images/storage/Dockerfile` (slot `app.storage.image`, rendered by `starci app sync` from
`templates/app/storage-image/`, held by `HFS_MANAGED_FILE_DRIFT`; the file beside it, `Dockerfile.dockerignore`, is managed the same way). The image:

- starts from the pinned StarCi MinIO (`contexts/stack/pins.yaml` `minio`) and adds an `mc` client **compiled in a builder stage of the same Dockerfile**
  from a pinned source tag (`ADD --checksum` on the source tarball, a Go image pinned by digest). The base image ships no S3 client. The recipe can
  move to a `starci183/mc` fork image published like the MinIO one (`images/sources.json`) without any change to an app.
- copies `statics/` to `/statics` and, in its entrypoint, starts MinIO and then loads the folder **through the S3 API**: it creates the bucket when
  missing, runs `mc mirror --overwrite` with no `--remove` into `<bucket>/<prefix>` (adding and overwriting only), sets a download policy on that prefix
  and on nothing else (`mc anonymous set download`), and marks `/tmp/statics-ready`. The mirror is skipped when the bucket already holds this image's
  statics digest. Statics are never copied into `/data`: MinIO keeps objects in its own format, so a copied file is not an object.
- **Never deletes.** An object an app uploaded under any key, and a static removed from the repository, stay. Pruning a stale static is a manual act.
- **Public read is the prefix only.** `STATICS_PUBLIC` is `download` (the default) or `none`; the bucket as a whole stays private, so presigned links
  for app uploads (PROJECT-STACKS-15) are unchanged.
- **Build context and ignore.** The context is the app root, so `statics/` is reachable. `Dockerfile.dockerignore` (`*`, then `!statics/`) replaces the
  root ignore for this build, so nothing but `statics/` can enter the image, and no secret can. The prompt files and `.gitkeep` are removed inside.
- **Environment**: `STATICS_BUCKET` (the environment's bucket, `<project>-dev` or `<project>-production`), `STATICS_PREFIX` (kebab-case, `statics`) and
  `STATICS_PUBLIC`; the root credentials are the `storage` member's files (`MINIO_ROOT_USER_FILE`, `MINIO_ROOT_PASSWORD_FILE`).
- **Failure**: a failed mirror stops the container; the healthcheck needs `/tmp/statics-ready`, so `starci app stack up` fails on the service health it
  already waits for. The harness has no loader and no second step.

Fresh volume: the full mirror runs (the statics are in the store when the container is healthy). Unchanged `up`: nothing runs. Changed statics: `up`
rebuilds (`compose up --build`, cached otherwise), the new image recreates the container and the mirror adds and overwrites.

Why: statics must exist in the store the app reads, on a fresh machine and after a change, without a step a person can forget, and the store must stay
the project's own (so an app reads one origin for statics and for its uploads). A harness loader would be a second path into the store; the image
entrypoint is the only one.

Enforced by: R440 (`storage-image`: `STACK_STORAGE_MISSING`, `STACK_STORAGE_UNUSED`, `STACK_STORAGE_IMAGE_UNUSED`, `STACK_STORAGE_IMAGE_SHAPE`),
`HFS_MANAGED_FILE_DRIFT` for the two managed files, `packages/hfs/src/dev-storage.spec.mts` for the pin.

## PROJECT-STATICS-3 Media lives in statics, never beside the code

A tracked media file under `fe/**/public/**` or `{fe,be}/**/src/**` is `HFS_STATIC_ASSET_OUTSIDE_STATICS`: move it to `statics/<area>/` and reference it
by its staticsKey, so the store serves it and a page never bundles it. Exempt: the route metadata files Next.js reads by name
(`src/app/{icon,favicon,apple-icon,opengraph-image,twitter-image}.*`), `public/favicon.ico`, and the small build-time binaries a back end keeps under
`be/**/src/assets/` (slot `be.assets`, `HFS_ASSET_KIND`).

Why: one folder for media is the only way the size, name and prompt rules above hold.

Enforced by: R439 (`statics-outside`: `HFS_STATIC_ASSET_OUTSIDE_STATICS`).

## PROJECT-STATICS-4 Serving: one base, keys only

The front end reads one public base, `NEXT_PUBLIC_STATICS_URL` (the gallery: `VITE_STATICS_URL`), the full prefix of the statics in the store:
`<public storage origin>/<bucket>/<prefix>`. In dev without a tunnel that is `http://localhost:${port.storage}/<project>-dev/statics`; with a tunnel
declared it is `https://<the storage route host>/<project>-dev/statics` (R428, PROJECT-STACKS-15). The env owner module of the front end reads it once
and exposes `staticsUrl(key)`; `next.config` derives `images.remotePatterns` from its origin and path. Code and data hold keys only, never a URL.

Enforced by: R428 (`STORAGE_PUBLIC_LINK_INTERNAL` for a statics base that is not a storage route host), R49 for the env module.

## PROJECT-STATICS-5 Production: the same image

A lite app that meets the condition runs its own MinIO in production: `deploy.images.storage: {app: storage}` builds the one
`.starcistacks/images/storage/Dockerfile` (`starci app stack build` resolves `.starcistacks/images/<app>/Dockerfile` for any app that has one), and the
swarm stack runs it as the `storage` service: one replica, `stop-first` updates with rollback, the volume `<project>-production-storage-data` with a
backup entry, the sealed `storage-access-key-id` and `storage-secret-access-key` as root credentials, `STATICS_BUCKET: <project>-production`. The ingress
routes `storage.<project>` to port 9000, never the console. The api writes through `http://storage:9000` and builds links on
`https://storage.<project>`. A deploy with changed statics ships a new image digest; the task is recreated and the entrypoint adds and overwrites,
never deleting. This replaces "lite production storage is an external S3 endpoint" ([lite.md](lite.md) "Backing services") for a project that meets
the condition. The full edition's production stack does not run the store yet; R440 judges a full app's dev environment only.

Enforced by: R440 (`STACK_STORAGE_MISSING`, `STACK_STORAGE_IMAGE_SHAPE` over `deploy.images.storage`).

## Read with

[brand.md](brand.md), [stacks.md](stacks.md) PROJECT-STACKS-10, -11 and -15, [lite.md](lite.md); slots `app.statics` and `app.storage.image` in
[hfs/slots.yaml](../hfs/slots.yaml); R438 to R440 in [hfs/rules.yaml](../hfs/rules.yaml).
