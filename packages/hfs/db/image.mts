// image.mjs - the one name of a lite app's db image (slot app.db.image, rulings lite-official-postgres-image and lite-db-image-in-stacks):
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
