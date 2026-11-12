# Changelog

## 0.4.0 - 2026-11-13

- Changed: ten icons are named by their shape, not by one app's features: `InsetHomeIcon`, `OpenBookLinesIcon`, `PodiumIcon`, `QuestionAnswerIcon`, `SplitPaneIcon`, `CodeWindowIcon`, `CardStackIcon`, `MicNotesIcon`, `FoundationBlocksIcon`, `SandboxIcon` (24/outline and 16/solid). The old names (`CourseOverviewIcon`, `CourseContentIcon`, `CourseLeaderboardIcon`, `CourseQaIcon`, `CourseRailIcon`, `PersonalProjectIcon`, `FlashcardsIcon`, `MockInterviewIcon`, `FoundationsIcon`, `PlaygroundIcon`) stay as deprecated aliases for this minor and go with the next.

## 0.3.6 - 2026-11-07

- A patch: a spec title states its rule without ruling history; nothing it ships changed.

## 0.3.5 - 2026-10-30

- Changed: the package spec is TypeScript (src/package-boundary.spec.ts, run by Node's type stripping); no glyph change.

## 0.3.4 - 2026-10-13

- Changed: the package spec (run by `prepack`) refuses a custom cut named like an `@heroicons/react` icon: `@heroicons/react` is the base icon set and this package carries only the glyphs it lacks.
