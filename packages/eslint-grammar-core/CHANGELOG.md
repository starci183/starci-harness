# Changelog

## Unreleased (0.15.0 with the Grammar family)

- Unreleased: the Grammar family (`grammar`, `eslint-grammar-core`, `eslint-grammar-offset-pop`) keeps one version and `packages/grammar` is outside this lane, so the minor bump to 0.15.0 lands with the family's release; the package stays 0.14.0 until then.
- Changed: the source is TypeScript in `src/`, built to `dist/` (`npm run build`; `prepack` builds); the package ships `dist/`, `runtime/` and `docs/` and no hand-written JavaScript or `index.d.ts` (the build emits the declarations, with the same public types). No rule or behaviour changed; the exports and specifiers (`.` and the default plugin) are unchanged.
- Changed: the specs are `src/*.spec.ts`, typechecked first by `npm test`.

## 0.14.0 - 2026-10-27

- Changed: versioned together with Grammar 0.14.0; the bundled canon pins name the 0.14.0 Grammar family.
- Added: `starci-grammar/chip-label-starts-uppercase` (R322 `FE_CHIP_LABEL_CASE`): a literal `StatusDot` or `Badge` label starts with an uppercase letter, Vietnamese included; the fix uppercases it in place.

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
