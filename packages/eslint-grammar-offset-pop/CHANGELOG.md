# Changelog

## 0.15.16 - 2026-10-29

- Changed: the peer moves to the 0.15.16 cohort; the bundled canon pins name @starci/test-world 1.3.0 (HTTPS fakes over the run's ephemeral fake CA), hfs 4.11.4, eslint-canon-be 3.8.3, eslint-canon-fe 9.5.5 and the Grammar family 0.15.16. No rule changed.

## 0.15.15 - 2026-10-29

- Changed: the peer moves to the 0.15.15 cohort; the bundled slot manifest 3.13.0 admits `pgmq` in `ruleParams.db.extensions` (the lite event bus, ruling lite-pgmq-bus-bullmq-jobs), retires `ruleParams.db.queueOutbox` and `sides.be.queueOutbox` with the pg_cron half of R258, lists `public.event_bus_send`, `public.event_bus_read`, `public.event_bus_archive`, `public.event_bus_bury`, `public.event_bus_dead_letters` and `public.event_bus_requeue` in place of `public.event_bus_write` in `ruleParams.be.dbFunctions`, and moves slot `app.db.image` to `.starcistacks/images/db/Dockerfile` (ruling lite-db-image-in-stacks, admitted by the lite `app.starcistacks` allows); the bundled rule catalog keeps R258 `DB_PGMQ_DECLARED` as the event-bus law, retires `DB_CRON_OWNED` and adds R336 `BE_EVENT_BUS_LITE_SHAPE`; the bundled canon pins name hfs 4.11.3, eslint-canon-be 3.8.2, eslint-canon-fe 9.5.4 and the Grammar family 0.15.15. No rule changed.

## 0.15.14 - 2026-10-29

- Changed: the peer moves to the 0.15.14 cohort; the bundled slot manifest 3.12.0 lists the canon's database functions of R334 schema-qualified (`public.job_claim`, `public.job_tick_claim`) beside the pg built-ins it names bare (`gen_random_uuid` joins them), and its shape (`rule-params-shape.mjs`, `declaration-shape.mjs`) with the manifest check of `slots.mjs` refuses in hfs.json `sides.be.dbFunctions` a `pg_catalog` name and any bare name that is not a built-in the canon lists; the manifest bump is minor although that refusal is stricter, since R334 is new on manifest major 3 and its one app (nivo-lite) lists only names it admits (its one bare name, `gen_random_uuid`, is now a canon built-in); the bundled canon pins name hfs 4.11.2, eslint-canon-be 3.8.1, eslint-canon-fe 9.5.3 and the Grammar family 0.15.14. No rule changed.
- Changed: the bundled canon pins also carry the hfs 4.11.1 re-pin of db baseline --squash (R213 transaction control in migrations, extensions schema in the bootstrap), which bumped no eslint package.

## 0.15.13 - 2026-10-29

- Changed: the peer moves to the 0.15.13 cohort; the bundled slot manifest 3.11.0 adds the managed lite slot `app.db.image` (`db/Dockerfile`), narrows `ruleParams.db.extensions` to what the official postgres image plus pgvector carries (pgcrypto, pg_trgm, vector, uuid-ossp, unaccent, btree_gist; no pgmq, pg_cron, pg_net or supabase_vault) and gives `@nestjs/schedule` and `cron` one owner, `platform/jobs`, in `infraOwners`; the bundled rule catalog adds R335 `BE_JOBS_SCHEDULER_OWNER` and its R250 and R276 laws name the platform/jobs tick and the db image; the bundled canon pins name hfs 4.11.0, eslint-canon-be 3.8.0, eslint-canon-fe 9.5.2 and the Grammar family 0.15.13 and pin `@nestjs/schedule` 6.1.3 (CommonJS on the Nest 11 line) and `cron` 4.4.0. No rule changed.

## 0.15.12 - 2026-10-29

- Changed: the peer moves to the 0.15.12 cohort; the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12. No rule changed.

## 0.15.11 - 2026-10-29

- Changed: the peer moves to the 0.15.11 cohort; the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI. No rule changed.


## 0.15.10 - 2026-10-29

- Changed: `@starci/eslint-grammar-core` 0.15.10 is the peer dependency; the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0. No rule changed.

## 0.15.9 - 2026-10-29

- Changed: `@starci/eslint-grammar-core` 0.15.9 is the peer dependency; the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9. No rule changed.

## 0.15.8 - 2026-10-29

- Changed: versioned together with Grammar 0.15.8; `@starci/eslint-grammar-core` 0.15.8 is the peer dependency, so Offset Pop apps inherit R325's segment layout `Page` and the layout owner checks; the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6.

## 0.15.7 - 2026-10-29

- Changed: versioned together with Grammar 0.15.7; `@starci/eslint-grammar-core` 0.15.7 is the peer dependency, so Offset Pop apps inherit R325's one-level root block, the `twice` finding and the `(auth)` route group exemption; the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6.

## 0.15.6 - 2026-10-28

- Changed: versioned together with Grammar 0.15.6; `@starci/eslint-grammar-core` 0.15.6 is the peer dependency, so Offset Pop apps inherit the R325 refusal of a page owner that draws no `Page`, and the bundled canon pins name the Grammar family 0.15.6 and hfs 4.9.8.

## 0.15.5 - 2026-10-28

- Changed: versioned together with Grammar 0.15.5; `@starci/eslint-grammar-core` 0.15.5 is the peer dependency, and the bundled canon pins name the Grammar family 0.15.5. No rule changes.

## 0.15.4 - 2026-10-28

- Changed: versioned together with Grammar 0.15.4; `@starci/eslint-grammar-core` 0.15.4 is the peer dependency, so Offset Pop apps inherit `page-tabs-in-header` and `route-page-is-one-page`, and the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0).

## 0.15.3 - 2026-10-28

- Changed: versioned together with Grammar 0.15.3; `@starci/eslint-grammar-core` 0.15.3 is the peer dependency, so Offset Pop apps inherit `no-hand-rolled-page-header`, and the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0).

## 0.15.2 - 2026-10-28

- Changed: versioned together with Grammar 0.15.2; `@starci/eslint-grammar-core` 0.15.2 is the peer dependency, and the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0) and pin no `starci-harness`. Offset Pop is unchanged.

## 0.15.1 - 2026-10-28

- Changed: versioned together with Grammar 0.15.1; `@starci/eslint-grammar-core` 0.15.1 is the peer dependency, and the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift. Offset Pop is unchanged.

## 0.15.0 - 2026-10-28

- Changed: versioned together with Grammar 0.15.0; `@starci/eslint-grammar-core` 0.15.0 is the peer dependency, and the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0, jest-preset 2.4.1, `@starci/ai-router` 0.2.1), so an app installs the released versions without pin drift. Offset Pop is unchanged.
- Changed: the source is TypeScript in `src/`, built to `dist/` (`npm run build`; `prepack` builds); the package ships `dist/` and `runtime/` and no hand-written JavaScript or `index.d.ts` (the build emits the declarations, with the same public types: the re-exports of `@starci/eslint-grammar-core` and `offsetPopGrammarConfig`). No rule or behaviour changed; the exports and specifiers (`.` and `./package.json`) are unchanged.
- Changed: the spec is `src/inheritance.spec.ts`, typechecked first by `npm test`; it resolves `@starci/eslint-grammar-core` through its built `dist/`, so build that package first.
- Fixed: the built declarations name `.js`, not the `.ts` sources (`tsc` keeps a relative `.ts` specifier in a `.d.ts`, which a consumer tsc cannot read).

## 0.14.0 - 2026-10-27

- Changed: versioned together with Grammar 0.14.0; `@starci/eslint-grammar-core` 0.14.0 is the peer dependency and the bundled canon pins name the 0.14.0 Grammar family. Offset Pop is unchanged.
- Changed: the bundled canon pins name `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`) in place of the retired `@starci/cli`, the one command line a product installs for `starci app`, and follow hfs 4.9.0, canon-fe 9.3.0 and canon-be 3.5.0. No rule changes.

## 0.13.0 - 2026-10-27

- Changed: versioned together with Grammar 0.13.0; `@starci/eslint-grammar-core` 0.13.0 is a peer dependency, installed by the app beside this package. Offset Pop is unchanged and refuses `core`.
- Changed: the package lives in github.com/starci183/starci-harness under `packages/` and publishes from there; its bundled `runtime/` is committed source, edited in place (no generator, no `prepack`/`pretest` hook).


## 0.12.14 - 2026-10-27

- Fixed: the bundled runtime copy now carries the static import closure of its slot view, so the slot modules it imports are present.

## 0.12.13 - 2026-10-26

- Changed: versioned together with Grammar 0.12.13.

## 0.12.12 - 2026-10-26

- Changed: versioned with Grammar 0.12.12; depends on the exact StarCi family lint 0.12.12; the bundled canon pins follow the final package versions. No rule changes.

## 0.12.11 - 2026-10-26

- Changed: versioned with the other lint families; depends on the exact StarCi family lint 0.12.11; the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 0.12.10 - 2026-10-26

- Changed: versioned with Grammar 0.12.10; depends on the exact StarCi family lint 0.12.10; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.9 - 2026-10-26

- Changed: versioned with Grammar 0.12.9; depends on the exact StarCi family lint 0.12.9; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.8 - 2026-10-26

- Changed: versioned with Grammar 0.12.8; depends on the exact StarCi family lint 0.12.8; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.7 - 2026-10-26

- Changed: versioned with Grammar 0.12.7; depends on the exact StarCi family lint 0.12.7; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.6 - 2026-10-26

- Changed: versioned with Grammar 0.12.6; depends on the exact StarCi family lint 0.12.6; the bundled runtime copies follow the new sources. No rule changes.

## 0.12.5 - 2026-10-26

- Changed: versioned with Grammar 0.12.5; depends on the exact StarCi family lint 0.12.5; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.4 - 2026-10-26

- Changed: versioned with Grammar 0.12.4; no rule changes beyond the version pin of the exact StarCi family lint dependency.

## 0.12.3 - 2026-10-26

- Added: the Offset Pop flat config, inheriting Common API checks from the exact matching Grammar lint version without copying implementations.
- Added: package regression coverage for an inherited status-tone check and mandatory rule attachment.
