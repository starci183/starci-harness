# Changelog

## 1.0.0 - 2026-11-08

The concepts every StarCi app and package share, lifted from the per-app templates and the per-package copies.

- Added: `DomainError<C>` (`code`, `params`, `cause`, `message` = the code, `name` = the built class), `DomainErrorInit`, `ErrorParams` and `isDomainError`, with the exact API the back-end skeleton's `platform/errors` used to declare.
- Added: `ErrorKind`, the closed set of failure kinds a transport maps to a status.
