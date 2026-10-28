# Changelog

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
