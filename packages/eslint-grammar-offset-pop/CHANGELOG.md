# Changelog

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
