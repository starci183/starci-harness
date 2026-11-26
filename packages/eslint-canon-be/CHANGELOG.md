# Changelog

Versioned history starts at beta; earlier history is in git.

## 3.28.6 - 2026-11-25

- Added (h-logging-enforce, BE-ERROR-4): `no-domain-error-logged` refuses a `Logger.error` whose cause is typed as a `DomainError` (built in place, held in a variable of that type, or narrowed by `instanceof`) outside `platform/errors`; and `catch-must-account` refuses, as `loggedAndThrown`, a catch that both logs through the `Logger` and lets a throw escape, outside `platform/errors`, `platform/logging`, `platform/cqrs` and `platform/jobs`.
- Added (h-coverage-tiers): `levels`, the level of every rule the config sets (its own and the borrowed ones), which the check cache of @starci/hfs replays findings at.
- Changed (h-coverage-tiers, owner 2026-11-25, PROJECT-LINT-6): the pure style rules ship at `warn` (`STYLE` of lib/config.ts): `@typescript-eslint/array-type`, `require-export-jsdoc`, `require-enum-member-jsdoc`, `require-public-member-jsdoc`, `no-restated-name-jsdoc`, `no-version-in-name`, `no-default-export`. Every bug and architecture rule stays `error`; the factory refuses a recommendation in which any rule is at another level than its canon level.

## 3.28.5 - 2026-11-25

- Back-end canon lint rules for apps on @starci/hfs.
- The rules read type arguments in the current parser spelling only (`typeArguments`).
