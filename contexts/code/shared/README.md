# Shared patterns

The coding rules both sides of an app follow, back end and front end alike: one rule here replaces a copy on each side.
A fact moves here only when both sides hold it in the same words; where the sides differ, each side keeps its own rule
and this folder says nothing. The side topics ([be](../be/README.md), [fe](../fe/README.md)) cite these ids instead of
restating them.

Read by: every op that writes code or tests, before its side's README: this table and the core topics in its base, the
others opened when a task meets them (a formatter the canon applies, an app script, CI or generated code). The topics apply
to every slot of both sides, so they carry no front matter.

| Topic | Decides | Rules | Read |
| --- | --- | --- | --- |
| [typing.md](typing.md) | the strict tsconfig, no type escape, `Array<T>`, the type-aware lint | SHARED-TYPING-1 … 4 | core |
| [format.md](format.md) | Prettier as the only layout, line endings and the managed editor files | SHARED-FORMAT-1, 2 | on demand |
| [loosening.md](loosening.md) | no inline suppression or escape marker; a wrong rule is changed in its canon | SHARED-LOOSENING-1, 2 | core |
| [comment.md](comment.md) | the export docblock, line comments that say why, English source | SHARED-COMMENT-1 … 3 | core |
| [naming.md](naming.md) | identifier case, named exports, arrow functions | SHARED-NAMING-1 … 3 | core |
| [imports.md](imports.md) | owner entries and aliases, `import type`, no unused export | SHARED-IMPORTS-1 … 3 | core |
| [test.md](test.md) | which side has tests, what an op tests and runs | SHARED-TEST-1 … 3 | core |
| [scripts.md](scripts.md) | the app scripts, the CI the app runs, generated code, commits | SHARED-SCRIPTS-1 … 4 | on demand |
