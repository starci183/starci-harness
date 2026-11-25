# Changelog

Versioned history starts at beta; earlier history is in git.

## 2.12.2 - 2026-11-25

- Changed (h-coverage-tiers, owner 2026-11-25, BE-TEST-13): the per-file threshold is the rendered `coverage.perFile` ({ lines, branches, functions, statements }, the canon floor of @starci/hfs knowledge/sonar-gate.yaml) instead of a fixed 100; a scope rendered without it is refused (run `starci app sync`). `COVERAGE_THRESHOLD` is removed.

## 2.12.1 - 2026-11-25

- The StarCi jest config for Nest repositories and the shared unit-test double kit.
- The ESM-only dependency list names @starci/auth alone for both sign-ins.
