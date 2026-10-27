# Scripts, CI and commits

What an op runs in an app, what the app's CI runs after the push, and who commits. Which gates a task waits for is
[project/lint.md](../../project/lint.md); the harness verbs are `starci explain`.

## SHARED-SCRIPTS-1 The app's scripts are managed; an op calls them by name

The root `package.json` scripts, the CI workflow, the git hooks, the tool configs and the editor files are managed
files: the app CLI
the app pins (`starci-harness`, `starci app sync`) renders them and an op never edits them. An op calls a script by its
name instead of re-deriving the tool command: `typecheck`, `lint`, `format`, `format:check`, `test`,
`typecheck:tests`, `test:integration`, `build:be`, `build:fe`, `codegen`, and in lite the `db:*` scripts. A command
the app lacks is reported, never added by hand.

Why: one rendered script set makes every app answer the same commands, and a hand-edited script is undone by the next
sync or drifts from CI.

```sh
npm run codegen --silent
npm run typecheck
```

Enforced by: R05 HFS_MANAGED_FILE_DRIFT (slots `app.package-manifest`, `app.ci`, the hooks and configs).

## SHARED-SCRIPTS-2 Generated code is produced by its command, never written by hand

GraphQL documents' types (`npm run codegen`, into the ignored `__generated__/`), the Supabase row types
(`npm run db:types`, committed under `supabase/types/`) and the back end's contract snapshot (`starci app emit`,
committed under `be/contracts/`) come only from their commands. An op that changes a source of generated code runs the
command and lands its output; it never edits a generated file. A contract whose clean checkout lacks generated code
declares the commands in `context.setup` ([project/README.md](../../project/README.md) "Life cycle").

Why: a hand edit of generated code is overwritten by the next run and hides a contract the source does not hold.

Enforced by: R23 HFS_CONTRACT_SNAPSHOT_DRIFT; the lite CI job `db-types` (regenerates the row types and fails on a
diff); R52 FE_WIRE_GENERATED.

## SHARED-SCRIPTS-3 CI judges the app after the push

The app's one workflow (`.github/workflows/ci.yml`, managed) runs on main: a fast job (production dependency audit,
`format:check`, `typecheck`), lint per side, the unit suite in shards with one coverage merge proving 100 per measured
file, the build of the back end and of each front-end app, the Sonar gate on `v*` tags, and in lite the database
migration checks and the row types. An op neither waits for it nor edits it; a red CI becomes its own task scoped to
the red checks.

Why: the runtime tier keeps a task fast; everything slower is judged once, on main, by the same workflow in every app.

Enforced by: R05 (slot `app.ci`); `starci release ci-status` reads the result.

## SHARED-SCRIPTS-4 An op never commits; the harness does

An op writes files inside its `allowPaths` and stops there: no `git commit`, push, merge, stash, reset, checkout of
other paths or branch switch. The harness verifies the result on a clean checkout and commits exactly those paths. That
commit runs no git hook, so the op leaves its files formatted (SHARED-FORMAT-1) and lint-clean itself.

Why: the harness commit is the evidence that what landed is what was verified; a commit by the op would land code no
clean verify judged.

Enforced by: the `paths-only` check and the clean verify ([contexts/harness/roles.md](../../harness/roles.md)); `--no-verify`
by the `loosening` gate.
