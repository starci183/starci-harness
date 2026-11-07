# The branches of an app

An app repository (never the harness repository itself) has two long-lived branches and one way between them. This file owns the
rule; every other page links to it.

## PROJECT-BRANCH-1 An app has exactly two long-lived branches, `main` and `dev`

1. An app repository has exactly two long-lived branches: `main` and `dev`.
2. `main` is what is released on git. It moves only by a release (the annotated `v*` tag through `release push`), and only by
   fast-forward to a commit that is on `dev`.
3. `dev` is the working branch, forked from `main`, and always at or ahead of `main`: `main` is always an ancestor of `dev`, and
   the two never diverge.
4. Lane and feature branches fork from `dev` and merge back into `dev`. Nobody commits on `main` directly.
5. Promoting `dev` to `main` passes the full `starci app check` gate. The branch profile of `dev`
   ([lint.md](lint.md) PROJECT-LINT-2) never applies to `main`: a push of `main` or of a release tag is judged as `main` whatever branch
   is checked out, and a merge of `dev` into `main` cannot skip `app check`.

**Enforced by** (R388):

- the managed `.husky/pre-push` hook (`packages/hfs/templates/app/hooks/husky/pre-push`, rendered by `app sync`) through the bundled
  push gate (`scripts/guards/release-push-gate.mts`): a push of `main` is refused unless the pushed commit is reachable from `dev`,
  the local one and the remote-tracking one (or the dev pushed with it): `BRANCH_MAIN_NOT_ON_DEV`; unless it is the checked-out
  `HEAD`, the tree the hook's check judges: `BRANCH_MAIN_NOT_CHECKED_OUT`; and a push of `dev` is refused when it deletes `dev` or when
  `main` (local, remote-tracking or pushed with it) is not its ancestor: `BRANCH_DEV_NOT_ON_MAIN`. The first push of `main` into an empty
  remote is the one exception to "dev exists".
- the same hook runs plain `starci app check` with `STARCI_JUDGED_BRANCH=main` for a push of `main` or of a `v*` tag, so the full gate
  runs and the profile of the checked-out branch is ignored ([lint.md](lint.md) PROJECT-LINT-2 "Which profile a run is under").
- CI: a pull request into `main` and every push of `main` run the full gate ([cicd.md](cicd.md) "Triggers and what runs").
- `starci app check` warns `HFS_DEV_BRANCH_MISSING` when the repository has no `dev` branch, locally or on `origin`.

The harness repository has no managed app hook and no `dev` branch; this rule never applies to it.
