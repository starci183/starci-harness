# {{project}}

One StarCi lite app: a Nest API in `be/`, one Next web app in `fe/`, and its own PostgreSQL with SQL migrations in `db/` as the schema authority.

## Overview

The starter keeps one deployable API and one web app, with the same code structure as a full app: the web app calls the API over GraphQL (`fe/apps/web/src/modules/api`, SWR hooks under `fe/apps/web/src/hooks/swr`) and signs in only through the API's own auth doors (`fe/apps/web/src/modules/auth`, which holds the access token in memory while the refresh token stays in an httpOnly cookie); every data read and write goes through the API, which verifies the access token against its own keys.

## Stack

TypeScript everywhere, NestJS in `be/`, Next.js with next-intl in `fe/`, PostgreSQL (the `db` service: the official postgres image plus pgvector, built from `.starcistacks/images/db/Dockerfile`), Passport for Google and password sign-in, S3-compatible storage (MinIO), npm workspaces, and Turbo for front-end tasks.

## Repository layout

- `db/`: forward-only SQL migrations, seed data, and generated database types.
- `be/`: the API, shared platform capabilities, verified identity admission, and the passport and storage integrations.
- `fe/`: the web app; it holds no credential, signs in through `fe/apps/web/src/modules/auth` and reaches data through `fe/apps/web/src/modules/api`.
- `.starcistacks/`: value-free environment metadata and encrypted-secret custody.
- `.starciwork/`: `.gitignore`, `.starciwork/workspace.yaml` project metadata and repo roles, and optional brand drawing records, references, and assets.

## Status badges

Declare `ci.github.repository` and `ci.github.defaultBranch` in `.starcistacks/application-stacks.yaml` (or set the GitHub `repository` URL in `package.json`), then run `npx starci app sync --write`. Sync inserts a managed badge block after the title; `npx starci app sync --check` verifies it.

## Development

Every development dependency runs in Docker Linux containers. Create the local database once with `npm run db:create`, start it with `npm run db:start` (one container of the image `.starcistacks/images/db/Dockerfile` builds, on 127.0.0.1:54322), export `DATABASE_URL=postgresql://postgres@127.0.0.1:54322/postgres` and apply `db/bootstrap.sql` and the migrations with `npm run db:push`; start any other declared dependency through its managed `<dep>:create`, `<dep>:start` and `<dep>:stop` scripts or the declared container model. Compose is an implementation detail. Configure the local environment and start the API and web app using the package scripts for the declared development profile. In production, the app and its dependencies, the database included, run on Docker Swarm; pgvector owns vector search.

```sh
npm install
npm run contract:emit
npm run typecheck
npm run lint
npm test
npm run build:be
npm run build:fe
```

The API reads `PORT`, `HTTP_SECURITY_ALLOWED_ORIGINS`, `PRIMARY_DB_URL`, `PRIMARY_DB_SCHEMA`, the Google OAuth keys `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL`, its own token keys `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_KEY_ID` and `AUTH_JWT_PRIVATE_KEY`, and the storage keys `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`. The database tooling reads `DATABASE_URL`. The web app reads `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, and, once the first GraphQL operation exists, `NEXT_PUBLIC_GRAPHQL_URL`. Missing configuration stops the relevant process with a named error; no template supplies credential defaults.

Production browser build values live in `.starcistacks/application-stacks.yaml` under `environments.production.deploy.images.web.buildArgs.values`. Before building deployment images, replace the placeholders with your site's and your API's public origins. These values reach every browser; every credential stays in sealed runtime custody.

`npm test` runs the back end's unit specs with per-file coverage. Optional integration specs run with `npm run test:integration` against the local database (`npm run db:start`, then `npm run db:push`); a lite app has no e2e world.

The public runtime template tracks only sealed member names. Scaffolding creates this app's own age recipient and encrypts generated placeholder values into the declared `.starcistacks/<environment>/secrets/*.enc` members. Keep the matching host age identity in untracked local custody, then use `starci app secret set` to replace each placeholder with an actual value before deployment. Product apps retain sealed member custody. Runtime specs use disposable copies with ephemeral identities and remove them afterwards.

## Database changes

Create a forward-only migration with `npm run db:new -- <kebab-name>` (it lands in `db/migrations`), keep each table's RLS policies and grants beside the table, apply it with `npm run db:push`, and run `npm run contract:emit` to refresh `db/types/database.types.ts`. `starci app add table <name> --fe` adds the table with its GraphQL feature on the API and its operations and SWR hooks in the web app; `npm run codegen:graphql` regenerates the web app's wire types from `be/contracts/<app>/schema.graphql`.

## Work

Brand records live in `.starciwork/brand/`. `.starciwork/workspace.yaml` supplies the project id and repo roles so Work tools
can locate the app root and map brand records to the front end. Lite permits this metadata without brand records; the tree
is required only when brand records exist, and workspace metadata remains optional.
