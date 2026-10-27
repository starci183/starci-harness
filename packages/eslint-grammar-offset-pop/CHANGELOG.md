# Changelog

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
