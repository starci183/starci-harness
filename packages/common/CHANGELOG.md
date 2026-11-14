# Changelog

## 1.1.0 - 2026-11-14

The ports of the data standard (PROJECT-STACKS-14): what must be kept, where a copy is kept, and one export written to several copies.

- Added: `@starci/common/data`: the closed vocabulary (`StoreKind` database | storage, `DriverKind` git | s3, `DataPurpose` seed-standard | seed-backup, `StoreLevel`, `EntryForm`, the git copy cap `GIT_CAP_BYTES` 100 MiB with `GIT_WARN_BYTES` 80 MiB and `GIT_SHARD_BYTES` 4 MiB); `DataEntry`, `DataManifest` (`starci/data-manifest@1`), `ManifestBuilder`, `canonicalJson`, `recordEntry`, `blobEntry`, `setDigest`, `exportDigestOf`, `manifestProblems`; the `StoreAdapter` and `DriverAdapter` ports with `ImportReport`, `Holding`, `CopyRef`, `CopyReceipt`, `CopyVerdict` and the coded `DataRefusal` (retry class configuration | transient); `StoreAdapter.import` is an upsert by natural key that keeps each row's identity (`identityOf`; never delete-and-recreate; a key not named is left alone); the copy contract `exportOnce`, `unchangedSince`, `writeEverywhere` (each driver an isolated leg, outcome complete | partial | failed), `compareCopies`, `chooseCopy`, `restoreFrom`; the line protocol `starci/data-entries@1` (`serveStore` for an app's store command, `commandStore` for the harness side).
- Added: `@starci/common/data/testing`: `memoryStore`, `memoryDriver` (with failure and corruption switches), `memorySpool`, and the contract suites `storeContract` and `driverContract` every real adapter runs against its fakes.

## 1.0.1 - 2026-11-09

The package keeps the contract the apps' skeletons declared, and loads from CommonJS as well as ESM.

- Changed: the package ships CommonJS (`dist/cjs`) and ESM (`dist/esm`) behind an `exports` map with `import` and `require` conditions, each with its own `types`. A CommonJS consumer compiled with `module`/`moduleResolution` `node16` no longer fails TS1479. The ESM entry only re-exports the CommonJS build, so `DomainError` is one class whichever way it is loaded and `instanceof` and `isDomainError` hold across both (no dual-package hazard).
- Fixed: `DomainErrorInit.params` accepts `ErrorParams | undefined` (and `cause` `undefined`), so `params: maybeParams` compiles under `exactOptionalPropertyTypes`, as the skeleton's `readonly params?: ErrorParams | undefined` did.
- Fixed: `ErrorParams` is a named `interface` with an index signature (`{ readonly [name: string]: string | number }`), not a `Readonly<Record<...>>` alias, so a back-end method taking it is a named contract type and not an inline object input.

## 1.0.0 - 2026-11-08

The concepts every StarCi app and package share, lifted from the per-app templates and the per-package copies.

- Added: `DomainError<C>` (`code`, `params`, `cause`, `message` = the code, `name` = the built class), `DomainErrorInit`, `ErrorParams` and `isDomainError`, with the exact API the back-end skeleton's `platform/errors` used to declare.
- Added: `Outcome`, `OutcomeOk`, `OutcomeRefused`, `OutcomeErrorClass`, `ok`, `refused` and `unwrapOutcome`, the expected-refusal result of the skeleton's `platform/primitives`.
- Added: `isRecord` (a non-null object) and `isPlainRecord` (also not an array), the two behaviours the packages and the skeleton each wrote.
- Added: `eachInOrder`, the sequential runner of the skeleton's `platform/primitives`.
- Added: `ErrorKind`, the closed set of failure kinds a transport maps to a status.
