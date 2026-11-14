# Changelog

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
