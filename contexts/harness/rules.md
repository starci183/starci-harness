# Hard rules

These hold for every role and every task. A rule with a gate names it; the others are held by review.

1. **No secret is read, printed or committed.** Never open a file that `policy/security.yaml` `neverRead` lists
   (`.env`, `secret.env`, keys, credentials); judge it by name, and a contract whose `allowPaths` names one is unfit
   (`contractProblems`). A verb that needs a credential gets it from the CLI's secret loader, which alone reads the keys
   `secretKeys` lists (`cli/src/harness/secret-env.ts`). Never echo a token. `starci check secrets`, `task verify` (on the files a candidate changes) and
   `release push` scan for leaks; this repository is public and tracks no secret envelope.
2. **No loosening.** No inline disable, `ts-ignore`, `NOSONAR`, skipped or focused test, `|| true`, `--no-verify` or
   widened allowlist. Change the code, not the gate. `starci check loosening` reads the tree as it stands and
   `task verify` the files a candidate changes; an exception lives only in `policy/loosening.yaml`, pinned to the exact lines of a fixture, template or detector file, or of a file a live owner ruling covers.
3. **No stash, force or reset in a dirty tree.** Never `git stash`, `reset --hard`, `checkout -- .`, `clean -f`, a
   force push or a branch switch in a checkout that holds someone's uncommitted work. Work in your own worktree.
4. **Two tools never touch the same checkout.** Parallel agents, seats or tools each write in a checkout of their own; the
   harness gives every task of a workflow its own Op worktree and lands it on the workflow's branch through a rebase,
   returning a textual conflict as `conflict` (`harness/land.ts`). A defect found outside your paths goes into your report.
5. **Public actions need the owner's approval.** Publishing a package from a workstation (`release publish --execute`),
   deploying, and anything posted outside the repository wait for the owner's yes. Who pushes main, and after which
   checks, is [contexts/authority/](../authority/README.md); on the harness that push publishes, through CI, every package
   version it raised ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20).
6. **No examples.** The harness ships no example apps and no `examples/` tree. A behaviour is proved by running the
   built CLI against a scratch repository; a package keeps its own specs.
7. **Machine actions are the harness's.** An agent never installs Playwright or browsers, or runs Docker by hand: a
   `uat` worker writes a short Playwright script and calls `starci uat run`, which runs it in the image pinned in
   [ops/uat.yaml](../../ops/uat.yaml) and keeps the playwright package inside that image, never in the product.
