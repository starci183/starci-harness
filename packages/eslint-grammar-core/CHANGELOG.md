# Changelog

## 0.15.12 - 2026-10-29

- Changed: the peer moves to the 0.15.12 cohort (eslint-canon-fe 9.5.1); the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12. No rule changed.
- Changed: the bundled rule catalog's R26 and R30 laws name the entity registry. No rule changed.

## 0.15.11 - 2026-10-29

- Changed: the peer moves to the 0.15.11 cohort; the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI. No rule changed.


## 0.15.10 - 2026-10-29

- Changed: `@starci/eslint-canon-fe` 9.4.9 is the peer dependency; the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`; the bundled rule catalog carries R326 and R327; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0. No rule changed.

## 0.15.9 - 2026-10-29

- Changed: `@starci/eslint-canon-fe` 9.4.8 is the peer dependency; the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9. No rule changed.

## 0.15.8 - 2026-10-29

- Changed: `starci-grammar/route-page-is-one-page` (R325) follows the owner ruling `page-frame` as rewritten: a route segment `layout` whose owner (`fe.feature`, kind `layouts`), its pure half or its one root block draws a `Page` whose `header` carries `tabs` is the one `Page` of every route under it. The rule finds the route `page` files that mount a page owner, walks up through the `layout` files of their segments and resolves each layout's owner one level deep. A page owner every route of which is so framed is not judged `missing`; one that draws a `Page` (or a root block that draws one) under such a layout is `twice`, and the message names the layout. A layout whose `Page` carries no `tabs` frames no segment.
- Changed: R325 also judges layout owners (`fe.feature`, kind `layouts`): a `Page` they draw has nothing beside it (`sibling`; a `PageHeader` block beside the segment's `Page` belongs in its `header`), no `Page` inside another (`twice`), and no bare `PageHeader` or `PageContainer` (`part`). A layout owner that draws no `Page` is never `missing`.
- Changed: `@starci/eslint-canon-fe` 9.4.7 is the peer dependency; versioned together with Grammar 0.15.8; the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6.
- Spec: `src/page.spec.ts`, `src/page-owners.spec.ts` (layout cases on the project fixture); docs: `docs/page.md`.

## 0.15.7 - 2026-10-29

- Changed: `starci-grammar/route-page-is-one-page` (R325) follows the owner ruling that a route draws exactly one `Page`, drawn by the page owner, its pure half (`./component`), or the one connected block (`fe.components`, kind `blocks`) the owner renders as its root, read one level deep (the block's connected half and its own pure half). A server page owner whose header needs client data renders that block and passes the page body as its children. An element that draws the `Page` with an element sibling stays `sibling`; a `Page` (or a block that draws one) inside another is the new finding `twice`.
- Changed: R325 does not judge a page owner as `missing` when every route `page` file that imports it lies under the route group `(auth)` with its own `layout`: that layout draws the auth frame, the page frame of its sign-in, sign-up, password and callback pages. A page owner that draws no JSX (it only calls `redirect()` or `notFound()`, or returns null) stays unjudged. Workbench pages get no exemption.
- Changed: `@starci/eslint-canon-fe` 9.4.6 is the peer dependency; versioned together with Grammar 0.15.7; the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6.
- Spec: `src/page.spec.ts`, `src/page-owners.spec.ts` (new, cross-file); docs: `docs/page.md`.

## 0.15.6 - 2026-10-28

- Changed: `starci-grammar/route-page-is-one-page` (R325) also refuses a page owner file that draws JSX but no `Page` and draws through no pure half of its own (an element imported from `./component`), with the message `missing` on its first element. The segment boundary owners of FE-BOUNDARY-1 (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`) are not judged for it; a file that draws a bare `PageHeader` or `PageContainer` is reported once, as `part`. Spec: `src/page.spec.ts`; docs: `docs/page.md`.
- Changed: the R324 message names link tabs (items with `href`) as the other form of `header.tabs`.
- Changed: versioned together with Grammar 0.15.6; the bundled canon pins name the Grammar family 0.15.6 and hfs 4.9.8.

## 0.15.5 - 2026-10-28

- Changed: versioned together with Grammar 0.15.5 (the family equality spec); `@starci/eslint-canon-fe` 9.4.5 is the peer dependency; the bundled canon pins name the Grammar family 0.15.5. No lint rule changed.
- Changed: the bundled rule catalog states R225 with the app pre-push hook's dependency push gate (`starci deps check`). No lint rule changed.

## 0.15.4 - 2026-10-28

- Added: `starci-grammar/page-tabs-in-header` (R324, `FE_PAGE_TABS_OUTSIDE_HEADER`): a `Tabs` that is the first element child of a `Page`, or the next element sibling of a `PageHeader`, is a page tab bar outside the band; pass it as `header.tabs`.
- Added: `starci-grammar/route-page-is-one-page` (R325, `FE_ROUTE_PAGE_OUTSIDE_PAGE`): a page owner (`fe.feature`, kind `pages`) draws one `Page` with no element sibling and no `PageHeader` or `PageContainer` of its own. Spec: `src/page.spec.ts`; docs: `docs/page.md`.
- Changed: versioned together with Grammar 0.15.4; `@starci/eslint-canon-fe` 9.4.4 is the peer dependency; the bundled rule catalog carries R324 and R325, and the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0).

## 0.15.3 - 2026-10-28

- Added: `starci-grammar/no-hand-rolled-page-header` (R323, `FE_PAGE_HEADER_HAND_ROLLED`): a `Breadcrumbs` followed by a `SectionHeader` among one parent's element children is a page head composed by hand; compose Grammar 0.15.3's `PageHeader`. Spec: `src/page-header.spec.ts`; docs: `docs/page-header.md`.
- Changed: versioned together with Grammar 0.15.3; `@starci/eslint-canon-fe` 9.4.3 is the peer dependency; the bundled rule catalog carries R323, and the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0).

## 0.15.2 - 2026-10-28

- Changed: versioned together with Grammar 0.15.2; `@starci/eslint-canon-fe` 9.4.2 is the peer dependency, and the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0) and pin no `starci-harness`. No rule changed.

## 0.15.1 - 2026-10-28

- Changed: versioned together with Grammar 0.15.1; `@starci/eslint-canon-fe` 9.4.1 is the peer dependency, and the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift. No rule changed.

## 0.15.0 - 2026-10-28

- Changed: versioned together with Grammar 0.15.0; `@starci/eslint-canon-fe` 9.4.0 is the peer dependency, and the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0, jest-preset 2.4.1, `@starci/ai-router` 0.2.1), so an app installs the released versions without pin drift.
- Changed: the source is TypeScript in `src/`, built to `dist/` (`npm run build`; `prepack` builds); the package ships `dist/`, `runtime/` and `docs/` and no hand-written JavaScript or `index.d.ts` (the build emits the declarations, with the same public types). No rule or behaviour changed; the exports and specifiers (`.` and the default plugin) are unchanged.
- Changed: the specs are `src/*.spec.ts`, typechecked first by `npm test`.
- Fixed: the built declarations name `.js`, not the `.ts` sources (`tsc` keeps a relative `.ts` specifier in a `.d.ts`, which a consumer tsc cannot read).

## 0.14.0 - 2026-10-27

- Changed: versioned together with Grammar 0.14.0; the bundled canon pins name the 0.14.0 Grammar family.
- Added: `starci-grammar/chip-label-starts-uppercase` (R322 `FE_CHIP_LABEL_CASE`): a literal `StatusDot` or `Badge` label starts with an uppercase letter, Vietnamese included; the fix uppercases it in place.
- Changed: `@starci/eslint-canon-fe` 9.3.0 is the peer dependency; the bundled canon pins name `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`) in place of the retired `@starci/cli`, the one command line a product installs for `starci app`, and follow hfs 4.9.0, canon-fe 9.3.0 and canon-be 3.5.0. No rule changes.

## 0.13.0 - 2026-10-27

- Changed: `@starci/eslint-canon-fe` is a peer dependency (9.2.0), installed by the app beside this package, instead of a nested dependency.
- Changed: the package lives in github.com/starci183/starci-harness under `packages/` and publishes from there; its bundled `runtime/` is committed source, edited in place (no generator, no `prepack`/`pretest` hook).
- Changed: owner ruling: there are exactly two Grammar families, `core` and `offset-pop`. This package is renamed from
  `@starci/eslint-grammar-starci` to `@starci/eslint-grammar-core`, and its factory from `starciGrammarConfig` to
  `coreGrammarConfig`, which loads for `sides.fe.grammar: core`.
- Removed: the ids `starci` and `starci-core` are not families and have no alias; an app that names them is refused.
  Migrate: `sides.fe.grammar: core`, depend on `@starci/eslint-grammar-core`, call `coreGrammarConfig`.

## 0.12.14 - 2026-10-27

- Changed: versioned together with Grammar 0.12.14; bundled canon pins moved.

## 0.12.13 - 2026-10-26

- Changed: versioned together with Grammar 0.12.13 (control height 40, shared scroll carets).

## 0.12.12 - 2026-10-26

- Changed: versioned with Grammar 0.12.12 (the family equality spec); the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 0.12.11 - 2026-10-26

- Changed: versioned with the other lint families; depends on the exact front-end canon 9.1.7; the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 0.12.10 - 2026-10-26

- Changed: versioned with Grammar 0.12.10; depends on the exact canon-fe 9.1.6; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.9 - 2026-10-26

- Changed: versioned with Grammar 0.12.9; depends on the exact canon-fe 9.1.5; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.8 - 2026-10-26

- Changed: versioned with Grammar 0.12.8; depends on the exact canon-fe 9.1.4; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.7 - 2026-10-26

- Changed: versioned with Grammar 0.12.7; depends on the exact canon-fe 9.1.3; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.6 - 2026-10-26

- Changed: versioned with Grammar 0.12.6; depends on @starci/eslint-canon-fe 9.1.2; the bundled runtime copies follow the new sources. No rule changes.

## 0.12.5 - 2026-10-26

- Changed: versioned with Grammar 0.12.5; depends on @starci/eslint-canon-fe 9.1.1; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.4 - 2026-10-26

- Changed: versioned with Grammar 0.12.4; no rule changes beyond the version pin.

## 0.12.3 - 2026-10-26

- Added: the StarCi Grammar lint package, released with Grammar 0.12.3. Concrete family laws move from the universal FE canon with their rule IDs and behavioral specs, including the Grammar 0.12.3 lane's `no-icon-size-class` and `destructive-menu-entry-needs-danger-tone` in their latest form. The R318 surface composition rules stay in the universal canon.
- Added: the `starciGrammarConfig` flat-config factory, complete error-level recommendations, ownership citations and a generated runtime closure.
- Shared: generic lint readers are imported from `@starci/eslint-canon-fe` 9.0.0.
