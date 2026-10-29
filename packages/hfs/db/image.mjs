// image.mjs - the one name of a lite app's db image (slot app.db.image, ruling:lite-official-postgres-image): the managed db/Dockerfile
// builds it, `deploy.images.db` of .starcistacks/application-stacks.yaml names it as app `db`, and the stack build, the images and
// stack-deploy workflows, the local db container and the drift scratch database all build that one file.

/** The image app name a deploy block gives the db service. */
export const DB_IMAGE_APP = 'db';
/** The managed Dockerfile of the db image, app-relative. */
export const DB_DOCKERFILE = 'db/Dockerfile';
