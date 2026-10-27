# Format

How source text is laid out. The values are `@starci/prettier-config`'s (its README says why each was chosen); this
topic never restates them.

## SHARED-FORMAT-1 Prettier is the only formatter

The app's Prettier setting is the one line `"@starci/prettier-config"`, and Prettier lays out every file it reads:
indent, quotes, semicolons, wrapping, import layout. No ESLint rule judges layout, import order is not enforced, and
`prettier-ignore` does not exist. An op runs Prettier on the files it changed before it reports.

Why: a formatter that decides layout removes a class of review noise; and nothing between the op and the push checks
format (the runtime tier runs no format gate and the harness commit runs no hook, SHARED-SCRIPTS-4), so an unformatted file first fails
in CI's `format:check`.

```sh
npx prettier --write <changed files>
```

Enforced by: R19 HFS_FORMAT (the app's `format:check` in CI and its pre-commit hook), the `canon` gate (the Prettier
setting names the canon package), R18 for `prettier-ignore`.

## SHARED-FORMAT-2 Line endings and editor settings are managed files

Text files end lines with LF. `.gitattributes`, `.editorconfig` and `.prettierignore` are managed files
(SHARED-SCRIPTS-1); a file Prettier must skip (generated code, catalogs, lockfiles) is
listed there by the render, not by a comment.

Why: a Windows checkout with CRLF breaks the shell scripts mounted into Linux containers, and a hand edit of a managed
file is undone by the next sync.

Enforced by: R05 HFS_MANAGED_FILE_DRIFT.
