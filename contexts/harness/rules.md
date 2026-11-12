# Hard rules

These hold for every role and every task. A rule with a gate names it; the others are held by review.

1. **No secret is read, printed or committed.** Never open a file that `policy/security.yaml` `neverRead` lists
   (`.env`, `secret.env`, keys, credentials); judge it by name, and a contract whose `allowPaths` names one is unfit
   (`contractProblems`). A verb that needs a credential gets it from the CLI's secret loader, which alone reads the keys
   `secretKeys` lists (`cli/src/harness/secret-env.ts`). Never echo a token. `starci check secrets`, `task verify` (on the files a candidate changes) and
   `release push` scan for leaks; this repository is public and tracks no secret envelope.
2. **No loosening.** No inline disable, `ts-ignore`, `NOSONAR`, skipped or focused test, `|| true`, `--no-verify` or
   widened allowlist. Change the code, not the gate. `starci check loosening` reads the tree as it stands and
   `task verify` the files a candidate changes; an exception lives only in `policy/loosening.yaml`, pinned to the exact lines of a fixture, template or detector file, or of a file a rule of the rule book covers, citing that rule,
   and so does the one exception that lowers a gate: its `branchProfiles`, the polish gates (lint, sonar, codecov) an app's
   branch profile may report or turn off on the branches it names, never main and never a safety gate
   ([contexts/project/lint.md](../project/lint.md) PROJECT-LINT-2).
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
7. **Look the rule up; never quote it from memory.** Before an answer, a plan or a brief, and again after a context
   compaction, translate the request into English and look it up as [contexts/README.md](../README.md) "Looking a rule up"
   says (several phrasings through `starci contexts search --also`, the area's scope and index); open the hit's file and
   cite its rule id and path. A brief's "never", "must" or "wait for" carries that citation, and a subagent's brief tells
   it to look up the same way. A rule found missed is recorded and hardened as "When a rule was missed" says. The step is
   the agent's own, the same for every runtime (Claude, Codex, Devin): it lives in this file, which
   [AGENTS.md](../../AGENTS.md) links for every host, never in one runtime's hooks or settings. Held by review (the brief check of "Looking a
   rule up"); `starci contexts search --eval` measures that every recorded miss is found.
8. **Machine actions are the harness's.** An agent never installs Playwright or browsers, or runs Docker by hand: a
   `uat` worker writes a short Playwright script and calls `starci uat run`, which runs it in the image pinned in
   [ops/uat.yaml](../../ops/uat.yaml) and keeps the playwright package inside that image, never in the product.
9. **The harness holds no app's business.** No source of this repository (`cli/`, `ops/`, `policy/`, `contexts/`,
   `packages/`, `skills/`, `app/`, `images/`, the templates and the root documents) names or encodes one app: no product
   or app name, no named third-party provider an app integrates, no business domain rule, and no rule, check, template,
   generator, fixture or example whose only reason is one app. The harness holds the mechanism every app shares; what one
   app needs beyond it (its own code generation, its own rules, its provider integrations, its domain vocabulary) lives in
   that app's repository and is recorded in its `.starciwork/concepts`
   ([contexts/project/work.md](../project/work.md) PROJECT-WORK-7). To apply it: before adding anything here, ask
   whether a second, unrelated app would use it unchanged; when it would, write it with neutral names (`an app`, `item`,
   `gateway`); when it would not, it goes to the app, and the harness gains at most the generic hook the app plugs into.
   A rule that holds for one app or one package of it lives in that app: a package's own rules sit in the package's own
   hfs configuration (its `packages/<name>/slots.yaml`, and a rule pack hfs.json `rulePacks` names), and the harness only
   runs them, in every `starci app check`, the pre-push hook and CI ([contexts/project/lint.md](../project/lint.md)
   PROJECT-LINT-3; R381, R382). A rule one app asked for stays when it is generic, with its examples neutral. Why: a business word in a shared rule
   makes every other app inherit one app's decisions, and an agent reads an example as the law. R206
   (`RT_PRODUCT_NAME_IN_SOURCE`) refuses the closed list of product names `PRODUCT_NAMES` of
   `packages/hfs/runtime/scripts/lib/example-refs.mts` in the hfs runtime; every other source is held by review.
10. **Read the repository's concepts before changing it.** Before any change in a repository, read that repository's
   `.starciwork/concepts`: `concepts/index.yaml` first, then every concept the task touches
   ([contexts/project/work.md](../project/work.md) PROJECT-WORK-7). They hold the owner's decisions for that repository. A
   task that spans repositories reads each repository's concepts before editing it, and a brief names the concepts its
   reader opens. The rules of this tree are generic: they say how any app is built and never stand in for a concept or
   overrule one. A harness rule and a concept that cannot both hold are a contradiction put to the owner with both
   statements, and the concept stands until the owner answers. Why: a decision kept in a concept and not read is rebuilt
   the way the owner already refused, and a generic rule applied over it undoes the decision silently. Held by review.
