# Authority

Who may edit, commit, merge to main, push and publish, and which checks each role runs. This folder is the one owner of
those facts; every brief, role table and op file points here and restates none of it. The rules hold the same under both
runners of [harness/axes.md](../harness/axes.md), `inline` and `orca`, and the same for Debug's own lanes, the
Supervisor's workers and an app session: a mode or a role changes who acts, never which tier a step runs.

## Three tiers of checks

| tier | file | when | runs |
|---|---|---|---|
| 1, branch | [branch.md](branch.md) | every edit on any branch or worktree, by any role | at most a fast typecheck or lint of exactly the touched files |
| 2, wave | [wave.md](wave.md) | once a batch lands on one tree, before it moves to main or a workflow finishes | one scoped round on the merged tree, its scope written first |
| 3, CI | [ci.md](ci.md) | after the push | the full suite and the npm publish of new package versions |

Package and Grammar edits follow [packages.md](packages.md). Heavy work runs once, as late as it can and on the most
merged tree there is: a check a later tier runs anyway is not run earlier, and running everything by default is a defect.

## Roles

| role | edit | commit | merge to main | push | publish | tiers it runs |
|---|---|---|---|---|---|---|
| Owner | anything | yes | yes | yes | yes, through a push CI publishes | none required; CI judges |
| Debug | harness settings (`config set`); code through its own lanes | merge commits of what it lands | main: its lanes, a workflow's or `[Worker]`'s branch, a package edit branch | main (`release push`) | yes, by pushing the bumped version, which CI publishes; `release publish --publish` only as the fallback with the owner's yes | 2 after merging, once per batch it lands |
| Supervisor | nothing: it dispatches a `[Worker]` for any edit, a package edit included | no | no | no | no | none of its own: `supervisor accept` runs the worker's tier 1 verify |
| Kernel (an orca workflow's seat) | contracts and the workflow file; never product code | no: the harness commits a green task | no | no | no | 2 when a batch of tasks lands and before its handoff |
| Worker (an Op under a Kernel, a `[Worker]` under the Supervisor) | its contract's `allowPaths`, or a `@starci` package on its package edit branch | only on that package branch; the harness commits a green task (a `[Worker]`'s on `starci/<worker>`) | no | no | no | 1 |
| inline agent (the chat session that is Kernel and worker of an `inline` workflow) | its task's `allowPaths`, one task at a time | no: the harness commits a green task | no | no | no | 1 per task; 2 when a batch lands and before the workflow finishes |
| app session (a chat session working in a product repository outside a workflow) | the product, on its branch or worktree; a `@starci` package only on a package edit branch | yes, on its own branch | the product's main, for its own branch | the product's main (`release push`) | no: the package edit goes to Debug | 1 while editing; 2 before it pushes |

`inline` and `orca` follow the same tiers: the inline agent holds the worker's tier 1 and the Kernel's tier 2, and a
Kernel seat holds tier 2 for the Ops it coordinates. Mail, Op worktrees and the harness commit are
[harness/roles.md](../harness/roles.md)'s; a verb's own `roles` and `effect` ([cli/README.md](../../cli/README.md) "The
verb standard") are how the CLI holds this table where it holds it.

## Worktrees

Every worktree the harness creates is removed by the harness when its work ends, under `inline` and `orca` alike; no role
removes one by hand or keeps one alive past its owner. Before removal its uncommitted work is preserved as a red verify
preserves it (a patch and its untracked files, in the project's `preserved/`), its install links are unlinked as links
(never a recursive delete through one, never `robocopy /MIR`), and git prunes; a branch with commits that never landed
is kept.

| worktree | made by | removed when |
|---|---|---|
| an Op's (`<workflow>.ops/<task>`) | its seat start or inline step | its task settles: landed green, failed, cancelled, fenced or stalled |
| a workflow's (the Kernel's) | `kernel start` | the workflow is done or stopped and its Kernel closed; its branch stays for landing |
| a Supervisor's `[Worker]` | `supervisor dispatch` | the Supervisor accepts or rejects the worker; its branch stays for landing |
| a package edit (`pkg branch`) | `pkg branch` | Debug landed its handed-off head on main |
| a clean-verify checkout | `task verify` | its verdict is reached |

The collector `starci worktree gc` (run by every `supervisor tick`, and by `supervisor accept`, `reject` and a workflow step
of an ended workflow) finds every harness worktree whose owner ended and every orphan no ledger row owns, and removes it as
above; `--dry-run` lists them (`cli/src/harness/worktree-gc.ts`).

## Not enforced yet

The CLI holds part of this folder. Until the code below lands, the rest is held by review:

- `task verify` and the clean verify run the contract's checks as they stand: `check-run-green` runs the profile's whole
  runtime tier with one `tsc` per tsconfig rather than the touched files, `tests-pass` runs tests with changed-file
  coverage, and the clean checkout runs its own `npm ci` (`cli/src/harness/run-checks.ts`, `cli/src/harness/clean-verify.ts`,
  [ops/checks.yaml](../../ops/checks.yaml)).
- No verb records the wave's scope decision or reuses a green row by input digest; `workflow step` neither runs nor
  requires a wave round before a workflow finishes (`cli/src/core/workflow/engine.ts`).
