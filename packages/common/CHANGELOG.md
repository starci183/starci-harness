# Changelog

## 1.0.0 - 2026-11-08

The concepts every StarCi app and package share, lifted from the per-app templates and the per-package copies.

- Added: `DomainError<C>` (`code`, `params`, `cause`, `message` = the code, `name` = the built class), `DomainErrorInit`, `ErrorParams` and `isDomainError`, with the exact API the back-end skeleton's `platform/errors` used to declare.
- Added: `Outcome`, `OutcomeOk`, `OutcomeRefused`, `OutcomeErrorClass`, `ok`, `refused` and `unwrapOutcome`, the expected-refusal result of the skeleton's `platform/primitives`.
- Added: `isRecord` (a non-null object) and `isPlainRecord` (also not an array), the two behaviours the packages and the skeleton each wrote.
- Added: `eachInOrder`, the sequential runner of the skeleton's `platform/primitives`.
- Added: `ErrorKind`, the closed set of failure kinds a transport maps to a status.
