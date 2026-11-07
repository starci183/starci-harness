# Tier 1: a branch

Every edit on any branch or worktree, by any role and under either runner, is code, then at most one fast check of what
it touched, then a commit and a hand-off. The heavy rounds belong to the merged tree ([wave.md](wave.md)) and to CI
([ci.md](ci.md)), which run them once for every branch at the price one branch would pay.

## What a branch runs

1. Write the change inside your paths (a contract's `allowPaths`, your package edit branch, your own worktree).
2. At most a typecheck or a lint of exactly the files you touched, and only when they are TypeScript or a linted file.
   The cheapest command that covers them wins; with nothing to type or lint, run nothing. On an app branch with a branch
   profile ([project/lint.md](../project/lint.md) PROJECT-LINT-2) a finding the check marks report-only is read and never
   chased: you fix every finding of a blocking gate and every `LINT_RATCHET_RAISED`, so a file you touch keeps no more lint
   findings than it had.
3. Commit (a worker files its result and the harness commits; a package edit commits on its own branch), then hand off:
   a result, a `pkg handoff`, or the branch named to whoever merges it ([README.md](README.md) "Roles"). In a checkout
   another agent shares, commit only your paths, through a temporary index (`GIT_INDEX_FILE`), never the shared index.

The harness's cheap state checks, `check secrets` and `check loosening`, belong here too: they read text and never build.

## What a branch never runs

No tests, no coverage, no build, no Storybook plays or DNA measurement, no full lint and no full typecheck. The
one build a branch takes is the one that publishes a package edit to the local registry ([packages.md](packages.md)). A branch never runs
its own `npm ci` or `npm install` where a shared install exists (the main checkout's, the workflow worktree's, or the
harness's install cache, one of which the harness links into each Op worktree, and replaces by the install of the worktree's own
lockfile once the task changed it); it reuses that install.

Running everything by default is a defect, not diligence: it blocks the host's CPU and memory for every other lane and
proves nothing the wave or CI does not prove again. A test the change needs is written on the branch and run by CI.
