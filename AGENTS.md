# StarCi harness bootstrap

Before planning, reading source or running a verb, read [contexts/README.md](contexts/README.md) and follow its load order. It names
what to read for your task, where state lives, how a project is found and the hard rules.

This checkout is the runtime root: the `starci` CLI is `node cli/dist/main.js` after `npm ci` in `cli/`, and harness
state lives in `.runtime/` here, never in a product repository. When you delegate or change directory, pass this
checkout's path and the project root on explicitly.

## Where the rules are

- Look a rule up before you act, in English and in several phrasings, and after every context compaction:
  [contexts/harness/rules.md](contexts/harness/rules.md) rule 7, as [contexts/README.md](contexts/README.md) "Looking a rule up" says.
- Before changing anything in a repository, read its `.starcistacks/application-stacks.yaml` WHOLE (gates declared off with
  their reasons, components, environments, ports, tunnel, secret members, backing services) and the `.starcistacks/<env>/README.md`
  of each environment the task touches; then its `.starciwork/concepts` (`concepts/README.md`, the `conventions` concept, then
  the concept of every folder the task touches); only then its code. They hold its persistent shared context (terms, data model,
  naming, business rules), and a task across repositories reads each one's. A task that contradicts a declaration stops and asks:
  [contexts/harness/rules.md](contexts/harness/rules.md) rule 10. The harness itself holds no app's business: rule 9.
- Every reply to the owner states what you believe after checking, grounded in the code, the data or the settled
  decisions; no alternative directions, "later we could switch" asides or objections you do not hold; name the real cost
  of what you recommend, and change a position only for a new argument or fact: [contexts/harness/rules.md](contexts/harness/rules.md) rule 11.
- A question to the owner that has a shape (UI options, a flow, an architecture, a before/after, a comparison) is drawn: in
  Claude `show_widget` or an Artifact, in Codex or ChatGPT an attached image or small HTML page; options side by side, the
  recommended one marked, then one short question. A plain yes/no or a credential step needs none:
  [contexts/harness/rules.md](contexts/harness/rules.md) rule 12.
- What your role may edit, commit, merge and push: [contexts/authority/README.md](contexts/authority/README.md); a branch:
  [contexts/authority/branch.md](contexts/authority/branch.md); a package edit and its local build:
  [contexts/authority/packages.md](contexts/authority/packages.md); removing a worktree: [contexts/authority/README.md](contexts/authority/README.md) "Worktrees".
- Integration and e2e suites run on request only (a `starci` verb or npm script the person invokes, `npm run test:e2e`), never in CI, a
  hook or a default gate row: an agent proves a change by the typecheck and the gates its contract declares, and runs a suite only
  when asked: [contexts/project/cicd.md](contexts/project/cicd.md) "Triggers and what runs" (R12).
- Run `starci app check` (`--env local`, the default) while you work; the pre-push hook, CI and the release gate run `--env prod`
  ([contexts/project/check-cache.md](contexts/project/check-cache.md) "The operating procedure").
- An app's branches, `main` and `dev`: [contexts/project/branches.md](contexts/project/branches.md) PROJECT-BRANCH-1; the `dev` branch profile: [contexts/project/lint.md](contexts/project/lint.md) PROJECT-LINT-2.
- The host environment (Windows shims, Devin's `ACP_BACKEND`, `robocopy`, PowerShell encodings):
  [contexts/harness/host.md](contexts/harness/host.md).

## Dev and prod: two flows that never wait for each other

The owner's rules, in his words:

> ".claude nói rõ tách biệt quy trình dev (đưa lên cloudflare) và prod riêng biệt ko đợi nhau. npm cũng vào local và dev server mở thẳng lun"

> "prod tối cũng dc, tập trung dev cho thầy trc!!!"

> "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn"

> "dồn!!! nhiều changes thì gộp 1 commit duy nhất và ci làm kiểu nếu push commit mới thì cancel lun commit cũ"

> "dev thì chạy trên nhánh dev, code xong cứ merge vào dev, mở server local ra test (build từ code dev hiện tại và chạy để tránh hot-reload), trong quá trình làm có thể upgrade grammars,hfs,... nhưng mà đơn giản là publish local nên dev trơn tru. và cứ từ từ đưa lên .claude các bản vá, đưa lên code, check kĩ, build docker, app check,.. để dần dần lên prod sau dev"

> "merge hết vô local dc không? pin 1 lần prod phát hành ntn kệ nó, và update .claude để tối đa hóa thời gian code local"

> "dồn!!! nhiều changes thì gộp 1 commit duy nhất và ci làm kiểu nếu push commit mới thì cancel lun commit cũ"

In short: dev and prod are separate pipelines. Dev is the fast path and comes first: finished work merges into `dev` and
the owner tests it on the running dev server at once. Prod is the slow, careful path and may run later (in the evening
is fine). Neither one waits for the other, and neither moves the other's checkout.

**Dev (fast, first).** Lanes -> the batch lander (`starci lane land`) -> the `dev` branch -> the app's main dev checkout
-> the dev stack, exposed through its Cloudflare tunnel.

1. A lane gates and registers (`starci lane gate --push --ready`); the lander merges the ready lanes, runs one
   `app check --env prod --level dev` and pushes `dev` as ONE commit listing the lanes and their shas
   ([contexts/project/branches.md](contexts/project/branches.md) PROJECT-BRANCH-2). A new push of a lane cancels its
   running gate, and a lane registered again cancels its old batch gate; the status says `superseded by <sha>`.
   **Two-level gate.** Landing on dev runs the FAST level once per push (`app check --level dev`: deps, types with its
   builds and codegen, the lane's own tests, db, the owner's design approval). It names what it skips: the hfs rule
   sweep, the rule-188 first audits, the ui-audit blocks, the nivoos package checks, the whole test suite, sonar and
   coverage. Those run ONCE at the main cut (`--level full`: a push of main, `release cut`, `release push`,
   `app release`), and a red full run is fixed in a hardening lane before the cut.
2. `starci dev sync --execute` in the app's main dev checkout fast-forwards it to `origin/dev`, runs `npm ci`, installs
   each `--local <pkg>` from the local npm registry, builds the workspace packages (the app's `codegen` and `build:modules`), migrates the dev database when new migrations arrived (`app stack up`), then **builds** the api and the web from that code and runs the
   built artifacts (`next start`, `node dist/...`; never `next dev`, `ts-node-dev` or another watcher). It restarts only
   the changed side, waits for its health (over the tunnel hostname when one routes it) and keeps the database, the
   storage and the tunnel up. It prints any local overlay in effect. A plain `dev sync` (no `--local`) puts every
   `@starci` package back to its registry version, so an overlay never outlives a sync that does not name it again.
   It is a dry run until `--execute`.
3. When this machine's local settings turn it on (`devSync.afterLand: true` in `.runtime/local-settings.json`,
   git-ignored, off by default), the lander runs that sync on its own once a batch lands. Consecutive batches are
   debounced into one sync.
4. **Local first.** A harness change (Grammar, hfs, the CLI, ...) is published to the local registry at once
   (`starci deps publish-local --execute --package <pkg>` in the harness checkout), and apps adopt it on dev at once:
   `starci deps install-local <pkg> --execute` in a lane, with `"deps": { "devAllowsLocalRegistry": true }` in the app's
   `hfs.json` so `dev` and lane branches may commit those local pins. `devSync.local` (`.runtime/local-settings.json`) is
   the default way the dev checkout runs harness builds. A lane NEVER waits for npm. `deps install-local --restore` is
   needed only for main and a prod cut: main, release branches, tags and prod deploys still refuse local pins.
5. Hot reload is opt-in, for live coding only: `starci app stack up --env dev --execute --watch`.

**Prod (slow, careful, after dev).** npm is published once per release train, for prod only (`starci release push` /
`release publish` on the harness). Prod pins npm versions ONCE, at release time: the cut bumps the app's local pins to the
npm versions (`deps install-local --restore`, then the npm version of each). Then the app code is pushed, fully checked, its docker images built, `app check --env prod --level full`, staging, the tag,
CI, prod. The release is cut from a fixed sha with `starci release cut --from <sha> --execute`, in its own temporary
worktree that is removed afterwards. The dev checkout never moves for prod work, and prod never waits for dev to go quiet.

**The harness itself: dev and main.** The owner, in his words:

> "bản thân .claude cũng tách thành dev main được không? dev code xong merge nhanh để xài local"

The harness repository has `dev` and `main` too ([contexts/project/branches.md](contexts/project/branches.md) PROJECT-BRANCH-3). Harness lanes
fork from `origin/dev` and land through the batch lander exactly as an app's do, under the harness profile: the gate is the harness FAST gate
(`starci release gate --level dev`: build, typecheck and tests of the changed packages and their dependents), the push `git push origin HEAD:dev`.
With `devSync.publishLocal: true` in `.runtime/local-settings.json`, every landed batch is published to the local registry as the dev line
(`starci deps publish-dev --execute`: `X.Y.Z-dev.N` of each changed package and of every package that pins one, pinned to each other exactly in
the publish copies, never in committed files) and `devSync.local` names exactly those versions, so the after-land dev sync runs them in the app at
once. A train moves `dev` to `main` after `starci release gate --level full`; `release push` and publish.yml publish the plain versions; then
`starci release back-merge --execute` brings `main` back into `dev`. Which branch `D:/.claude` has checked out is the owner's choice: it runs on
`dev` today.

**CI.** Many changes are gathered into one commit, and a newer push cancels the CI run of the commit it supersedes (the harness's ci.yml runs
the FAST level on `dev`, the FULL level on `main`); a run
that deploys or publishes (a release tag run, `stack-deploy.yml`, the harness `publish.yml`) is never cancelled.

The full design: [contexts/project/cicd.md](contexts/project/cicd.md) "Dev and prod".
