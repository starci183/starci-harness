# Hard rules

These hold for every role and every task. A rule with a gate names it; the others are held by review.

1. **No secret is read, printed or committed.** Never open a file that `policy/security.yaml` `neverRead` lists
   (`.env`, keys, credentials); judge it by name, and a contract whose `allowPaths` names one is unfit
   (`contractProblems`). Never echo a token. `starci check secrets`, `task verify` (on the files a candidate changes) and
   `release push` scan for leaks; this repository is public and tracks no secret envelope.
2. **No loosening.** No inline disable, `ts-ignore`, `NOSONAR`, skipped or focused test, `|| true`, `--no-verify` or
   widened allowlist. Change the code, not the gate. `starci check loosening` reads the tree as it stands and
   `task verify` the files a candidate changes; an exception lives only in `policy/loosening.yaml`, one file, one marker and the reason.
3. **No stash, force or reset in a dirty tree.** Never `git stash`, `reset --hard`, `checkout -- .`, `clean -f`, a
   force push or a branch switch in a checkout that holds someone's uncommitted work. Work in your own worktree.
4. **Two tools never touch the same files.** Parallel agents, seats or tools write disjoint paths; the harness enforces
   it for tasks with path leases (`LEASE_CONFLICT`). A defect found outside your paths goes into your report.
5. **Public actions need the owner's approval.** Publishing a package (`release publish --publish`), deploying, and
   anything posted outside the repository wait for the owner's yes. Pushing main after a green scoped check follows
   [CONTRIBUTING.md](../../CONTRIBUTING.md).
6. **No examples.** The harness ships no example apps and no `examples/` tree. A behaviour is proved by running the
   built CLI against a scratch repository; a package keeps its own specs.
7. **Machine actions are the harness's.** An agent never installs Playwright or browsers, or runs Docker by hand: a
   `uat` worker writes a short Playwright script and calls `starci uat run`, which runs it in the image pinned in
   [ops/uat.yaml](../../ops/uat.yaml) and keeps the playwright package inside that image, never in the product.
