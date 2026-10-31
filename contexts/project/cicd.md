# The delivery pipeline of an app

Every StarCi app gets one delivery pipeline in its `.github/`, rendered by `starci app sync` from the `@starci/hfs`
templates: a release push builds the release's images and pushes them to the registry the app declares, and once every
required check of that commit is green it deploys them to the app's Docker Swarm environments, verifies the release and
rolls it back by itself when the verification fails. This is a design awaiting the owner's approval (ruling
`app-cicd-auto-deploy`, status proposed): nothing below is built yet, and the templates, verbs, rules and slots it names
change in the work packages at the end. It builds on the committed check cache of [check-cache.md](check-cache.md) and
on the Swarm verbs of `starci app stack`, and it changes neither: it adds the order they run in.

Owner, 2026-10-31: "cắm 1 opus nghiên cứu pattern ci cd chuẩn cho .github của từng dự án nhé — push cái build image
mới push lên registry và tất cả pass, sau đó deploy lun, fail thì rollback trong môi trường dockerswarm."

## What an app has today

| file | trigger | does | problem |
|---|---|---|---|
| `ci.yml` | push of `main`, `release/candidate-*`, tags `v*`; dispatch | fast, lint per side, 6 test shards, coverage, build, Sonar (tags only) | the main push and the tag push of one release run the whole suite twice on the same commit; Dependabot pull requests get no CI at all |
| `images.yml` | tags `v*` | builds every image with SBOM and provenance into OCI tarballs, never pushes | a third build of the same commit; the attested images are never the ones deployed |
| `stack-deploy.yml` | dispatch only, from a `v*` tag | builds and pushes again (provenance off), then `stack deploy` (render, provision, converge, post-deploy, verify, accept; a red step redeploys the previous release) or `stack rollback` | manual; the deployed digests carry no SBOM or provenance; it waits for CI only through `requireCi` |
| `db-deploy.yml` | dispatch only, from a `v*` tag | materializes `DATABASE_URL` and migrates from the runner after a tracked backup receipt | separate from the deploy, so a release can run against an unmigrated schema; needs the database reachable from the runner, which an in-stack self-hosted database is not |
| `stack-key-restore.yml` | dispatch | restores the server's age identity from its GitHub Environment copy | none; kept |
| `dependabot.yml` | schedule | npm, actions and docker updates | its pull requests are judged by nothing |

The deploy verb already holds the hard parts: an immutable release whose id is the sha256 of the rendered stack,
digests only (`STACK_DEPLOY_PLACEHOLDER`), pre-pull, convergence judged on the new task spec, the stored previous release
redeployed from its bytes, the `current` pointer moved only after verification. What is missing is the trigger, one
build per commit, the database step, a lock shared with the owner's urgent deploy, and records that say what really runs.

## Triggers and what runs

Every push to an app's `main` already carries a release tag: the canon pre-push hook lets `main` and `v*` through only
for a HEAD with its annotated tag and its L4 record, and `release push` sends both in one atomic push. So "on push" means
on the release tag; the tag run is the release run, and the pipeline keys every decision on the commit sha.

| event | checks | images | deploy |
|---|---|---|---|
| `pull_request` to `main` (Dependabot, an owner branch) | diff-only against the merge-base cache | built, not pushed (proves the Dockerfiles) | never |
| push of `main` whose sha a `v*` tag points at | skipped: the `plan` job sees the tag and defers to the tag run | none | none |
| push of `main` with no tag (only when the hook was bypassed) | diff-only against the first parent | none | none |
| push of `release/candidate-<version>` (apps with `release.requireCi: true`) | full | built and pushed under `sha-<sha>` | none; the candidate verdict is reused by the tag run |
| push of tag `v<version>` | full (the release run of check-cache.md), or reused from a green candidate run of the same sha | built once, pushed with SBOM and provenance | every environment with `deploy.auto: true`, in declared order, after every required job is green |
| push of tag `v<version>` whose annotation carries `Starci-Urgent:` | full: this run is the back-fill | built and pushed | skipped when the environment's accepted release already has this sha (the urgent deploy did it); otherwise as a normal tag |
| `workflow_dispatch` of `stack-deploy.yml` | none; it requires a tag whose CI run is green (or an urgent annotation) | reused by digest from that run | `deploy`, `redeploy` or `rollback` of one environment |

`pull_request` is a new trigger for app workflows (R221 and R251 admit only tags, candidate branches, `main` for
`ci.yml` and dispatch). It runs with read-only permissions, no environment and no secret; a fork's or Dependabot's run
gets none anyway. `pull_request_target`, `workflow_run`, schedules and path filters stay refused.

**One sha is judged once.** The first job, `plan`, reads the event and the refs and decides: `full`, `diff` (with its
trusted base, per check-cache.md "Trust"), `defer` (main push of a tagged sha) or `reuse` (a successful `ci.yml` run of
the same sha on its candidate branch, found through the API, whose run id becomes the evidence). Its outputs drive every
other job's `if:`; a skipped check job never means a green one, because the deploy gate below reads the evidence, not
the job graph.

**Concurrency.** The run is grouped `ci-${{ github.ref }}` with `cancel-in-progress` true for pull requests only and false
for every other ref (a release run is never cancelled). Each deploy job has its own group `deploy-<app>-<env>`,
`cancel-in-progress: false`: at most one deploy runs per environment, and a newer waiting release replaces an older
waiting one, which is the behaviour a deploy wants (the latest green release wins; [concurrency]). The Actions group
does not cover the owner's urgent deploy from his machine, so the deploy verb also takes a lock on the manager (below).

## The pipeline graph

```text
plan ──► fast ─┐
     ├─► lint (be, fe) ─┐
     ├─► test (shards) ─► coverage ─┐
     ├─► build ─────────────────────┼─► sonar ─┐
     ├─► images (matrix, push) ─────┘          ├─► verdict ─► deploy <env 1> ─► deploy <env 2> ...
     └───────────────────────────────────────────┘
```

**Checks.** The jobs stay the CI standard's shape (`fast`, `lint`, `test`, `coverage`, `build`, `sonar`; ci-standard.yaml
`jobs`). Under `diff` they run `app check` and `app lint` against the trusted base cache and the test shards run only
the specs whose closure changed; under `full` (every tag run, every candidate run) they pass `--full`, shard the units
(`--test --full --shard <i>/<n>`) and the coverage job judges the merged report with `--coverage-from`. Sonar and the
Codecov upload run on every `full` run, so a release is analysed before it ships rather than only on tags after the fact,
and the quality gate's verdict, never the scanner's exit, is the job's result (PROJECT-STACKS-8). The verdicts follow
`gate-threshold-20`: `app check` and `app lint` are green under 20 error findings with no hard blocker; typecheck, build,
tests, coverage and the Sonar gate are binary.

**Images.** One job per declared image (`deploy.images` of every environment, merged by app), in parallel with the
checks, so the deploy waits for `max(checks, images)` instead of their sum. Each builds with `docker/setup-buildx-action`
and `docker/build-push-action` and pushes to the declared registry (`services.registry`, GHCR by default, logged in
with the job's `GITHUB_TOKEN` and `packages: write`):

- tags `sha-<40 hex>` always, `v<version>` on a tag run; no mutable environment tag is ever deployed or written (the
  release record holds the digests, and a moving `production` tag would be a second, unverified source of truth);
- `sbom: true` and `provenance: mode=max`, pushed as the image's attestations, so the deployed digest is the attested one
  and `images.yml`'s OCI tarballs go away; build arguments are public values only (secret build inputs are BuildKit
  `secrets:` mounts and never reach the provenance);
- platforms from `deploy.platforms` (default `[linux/amd64]`, the VPS's architecture); a multi-architecture build (QEMU
  or a native arm runner) only when an environment declares a node of another architecture; the release record keeps
  the index digest and each platform's;
- cache `type=gha,scope=<image>,mode=max` per image ([buildx gha]), and `type=registry,ref=<repo>:buildcache,mode=max` when
  the manifest says `ci.imageCache: registry` (several large Next.js images can exceed the repository's Actions cache);
- the job's outputs are `<service>=<repo>@sha256:<digest>` per image, the only form the deploy accepts.

Pushing before the checks are green is deliberate (the owner's order: build, push, all pass, deploy): an image under
`sha-<sha>` is immutable and inert until a release record names it. On a pull request the images build with
`push: false` and no attestations.

**Verdict.** One job, `verdict`, needs every check job and the images and fails unless each required job succeeded or
`plan` reused a green run. It is the single check name branch protection requires and the only job a deploy needs.

**Deploy.** One job per auto environment, `needs: verdict`, bound to the GitHub Environment of that name
(`environment: {name: <env>, url: <first verify url>}`, so GitHub records a deployment with its link), calling the
reusable `stack-deploy.yml` (`workflow_call`), which also keeps its `workflow_dispatch` for the owner's manual
operations. The job assembles arguments only; the verb does the work:

```text
starci app stack deploy --env <env> --image <svc>=<ref>@sha256:<digest> ... --sha <sha> --ci-run <run id> --execute
```

`--ci-run` replaces the `requireCi` lookup inside a run that is still in progress: the CLI reads that run's jobs through
the API with the job's token and accepts only when every job the CI standard requires concluded `success` for this sha
(or the reused run named by `plan` is green), so editing the workflow to skip a check gains nothing. The verb then runs
its phases, each one a recorded step:

| phase | does | on failure |
|---|---|---|
| lock | takes `/srv/<stack>/deploy.lock` on the manager (flock, held for the run; the owner's urgent deploy takes the same) | waits up to 10 minutes, then refuses `STACK_DEPLOY_LOCKED`; nothing changed |
| preflight | render and inspect locally, provision, store the release, pre-pull its images, and confirm the rollback target's images still pull | refuses; services untouched |
| idempotence | when the accepted release already has this `sourceSha`, prints `already current` and ends green | none |
| backup | when the migrate preview has pending migrations: a fresh encrypted dump of the database, receipt verified, a test decrypt on the manager with its own identity (the urgent floor's steps) | refuses; services untouched |
| migrate | `app db migrate` preview, then execute, inside the database service's own container through the Docker transport (expand migrations only) | refuses; services untouched; the applied part stays and the backup is its way back |
| deploy | `docker stack deploy` of the stored bytes; Swarm's `update_config` rolls a failing service back on its own | stack rollback |
| converge | desired against running, update state `completed`, no failed task of the new spec, twice | stack rollback |
| post-deploy | the declared idempotent release tasks | stack rollback |
| verify | the declared HTTP journeys and in-task checks (`deploy.verify`), health and readiness first | stack rollback |
| accept | moves `current`, keeps `previous`, prunes superseded secrets and configs | none (verified already) |
| contract | the release's `*_contract_*` migrations, only after accept (below) | red job, the release stays accepted; the owner decides |

**Rollback.** Two layers, because each catches what the other cannot. Swarm's own (`update_config: {failure_action:
rollback, monitor, max_failure_ratio: 0}`, required on every service by R266 and R294) acts within a service's monitor
window when a new task fails to start or its healthcheck fails ([deploy spec], [swarm services]); it restores only that
service's previous spec, one service at a time. The stack rollback restores consistency across services: it redeploys
the previous accepted release from its stored `stack.yaml` (with the secret and config versions it named), converges and
verifies it; a failure in functional verification, where every container is healthy but the journey is wrong, is caught
only here. The job ends red either way, and the record says `rolled-back` or `rollback-failed`.

**Rollback target.** The accepted release at the start of the deploy (the `current` pointer, never moved for a release
that did not verify). Preflight proves its images still pull, so a registry clean-up cannot strand a rollback. A manual
`rollback --release <id>` to an older one is refused when the database has applied a contract migration after that
release was accepted (the record knows both), unless the owner passes `--data-acknowledged`.

**Notification.** The deploy job writes the outcome to the run's summary (release id, digests, each phase with its
verdict and time, rollback) and uploads `release.json` as an artifact. GitHub's own notification of a failed run reaches
the pusher; an app that declares `services.notify` (a chat webhook as a CI secret) gets one message per deploy outcome.
A red run is a red CI for the harness, which opens the fix (authority/ci.md).

**Strategy.** Rolling, health-gated, `start-first` for stateless services and `stop-first` for a service that mounts a
single-host volume, exactly as the stacks declare today. Blue/green is not adopted: Swarm has no native traffic switch,
and on a single VPS it doubles memory for the whole stack; `start-first` already gives an overlap with no dropped
requests for stateless services, and the stack rollback is the fast way back.

## Database migrations

The migration moves into the deploy, before the services update, under three rules.

- **Expand before deploy, contract after accept.** A release's ordinary migrations only add (tables, nullable or
  defaulted columns, indexes built concurrently, new functions): the previous release keeps working on the expanded
  schema, so a stack rollback after a migration is safe. Destructive DDL already lives only in `*_contract_*`
  migrations after the code stops using the target (BE-PERSISTENCE-19); the deploy applies them in the `contract` phase,
  after accept, and only when the previous accepted release's code no longer uses the target, which `app check --db`
  proves by refusing a contract migration that lands in the same release as the code change it depends on (a new
  migration finding, so a hard blocker).
- **No down migration runs by default.** A rollback restores service specs, never data (PROJECT-STACKS-6). Lite has no
  down migrations; full's `down()` stays an owner-run step. The backup taken before the migration, with its receipt, is the
  way back for data, and restoring it is a separate owner decision with its loss window.
- **Backup only when something will change.** The preview runs first; with nothing pending there is no backup and the
  record says so. With something pending, the backup, its verified receipt and its test decrypt are the urgent floor's
  steps (`STACK_URGENT_BACKUP_*` codes become `STACK_DEPLOY_BACKUP_*` for both paths). The archive stays on the manager,
  encrypted to the `.sops.yaml` recipients; copying it off the host remains the owner's job.

The migration runs inside the database service's container through the Docker transport, the way the first start already
does (`inContainer`), so the database never listens beyond its stack network and CI never holds a `DATABASE_URL`. An app
whose database is outside the stack declares `database.target: external` and keeps `--db-url-env` with a sealed URL.

**First start.** When an environment has no accepted release, the deploy proves the database empty and runs the first
start (hold deploy with only the database running, bootstrap and migrate in its container, then the real deploy), today
reserved to `--urgent --first-start`. A database that is not empty with no accepted release is refused
(`STACK_FIRST_START_NOT_EMPTY`) and needs the owner.

## Secrets and access

- **Server key.** Each environment's server identity is the `SOPS_AGE_KEY` of its GitHub Environment (PROJECT-STACKS-5);
  only jobs bound to that environment read it. The images and check jobs read no secret beyond the Sonar token.
- **Transport.** The CI deploy key becomes a sealed member of the environment, `.starcistacks/<env>/secrets/vps-ci.enc.yaml`
  (`sshKey`, `knownHosts`, the account), opened with the server key the job already holds, so `VPS_SSH_KEY` and
  `VPS_KNOWN_HOSTS` leave GitHub and the pinned host keys are reviewed in git. It is a key of its own, never the owner's
  ops key, named by its comment so it can be revoked alone. `StrictHostKeyChecking yes` always; CI never accepts a new
  host key.
- **Least privilege, honestly.** Access to the Docker socket is root on that host, so the CI key's line in
  `authorized_keys` is `restrict` plus a forced command, the managed `starci-ssh-gate`, that admits only
  `docker system dial-stdio` and the release store's fixed scripts. That narrows what a stolen key can run without a
  shell; it does not make Docker access less than root, and the runbook says so. Key creation and rotation stay
  owner-run steps (`owner-run-steps`).
- **Registry.** Pushes use the job's `GITHUB_TOKEN` with `packages: write` on the images job only; the manager pulls
  with `--with-registry-auth`, which forwards the deploy job's short-lived login, so no registry credential lives on the
  server. A private registry other than GHCR is a declared service with its credential as a CI secret of the environment.
- **Nothing is printed.** Every value reaches a step through `env:`, members are materialized into a private temporary
  directory removed on exit, post-deploy and verify output carries names and counts only; the existing R251, R296 to
  R298 checks keep holding.
- **GitHub Environments.** Each deployed environment restricts its deployment refs to tags `v*`. Required reviewers are
  not part of the default: the owner asked for the deploy to follow the green pipeline, and on the Free, Pro and Team plans
  a private repository cannot have required reviewers or a wait timer at all ([environments]). An environment variable
  `STARCI_DEPLOY_PAUSED=true` stops automatic deploys of that environment without a code change, and the dispatch still
  works; an app that wants a human gate sets `deploy.approval: reviewers` and the environment's reviewers.

## Gates

- **Branch and tag rules.** `main`: no force push, no deletion, updates only by the owner and the release push; a pull
  request needs the `verdict` check. Tags `v*`: creation only by the same, never moved or deleted. The canon pre-push hook
  stays the local guard; the rules are the server's.
- **Required to deploy.** The `verdict` job: every required check job green for the sha (or the reused candidate run),
  the images pushed, and `--ci-run` evidence accepted by the CLI. A hard blocker (plaintext secret, boot proof, migration
  finding, a forged cache record) fails its job at any count.
- **The urgent path.** `starci app stack deploy --env <env> --urgent --reason "<text>" --execute` from the owner's machine
  stays as ruled (`urgent-release`): fast local checks, the safety floor, no CI. It becomes auditable on the server side
  too: the tag annotation carries `Starci-Urgent: <role>` and `Starci-Urgent-Reason: <text>` trailers (written by
  `release push --urgent`, never by hand), the manager's deploy record carries the same, and the tag's CI run is the
  back-fill: green leaves the release as it is, red is a red CI the harness fixes, and its deploy job finds the sha already
  current and does nothing. The manager lock serialises the urgent deploy with any CI deploy.
- **Owner approval.** Hard rule 5 (deploying waits for the owner's yes) is amended by the ruling: for an environment with
  `deploy.auto: true`, the owner's yes is given once, by that setting, and each release push that turns green deploys.

## Records

Today the manager holds `releases/<id>/{stack.yaml,release.json}` and the `current` and `previous` pointers, and nothing
else: a failed deploy leaves no trace there, a service that Swarm rolled back by itself still reads as the new release,
and a manual `docker service update` is invisible. The fix:

- **A deploy journal.** `/srv/<stack>/deploys/<attempt>.json`, one per attempt (time, trigger `ci|dispatch|urgent`,
  sha, tag, CI run URL or urgent role and reason, release id, previous, each phase with start, end and verdict, the
  backup receipt and migrations applied, outcome `accepted|rolled-back|rollback-failed|refused`), plus an append-only
  `deploys.jsonl` index. Written at every phase boundary, so a cancelled job still leaves its last phase.
- **What runs.** After converge, after a rollback and on accept, the verb snapshots `docker service inspect` of every
  service of the stack (spec image digest, update state, task template hash) into the attempt, and `release.json` gains
  `observed`. `starci app stack status --env <env>` (read-only) compares the live services with the accepted release and
  prints drift per service (`rolled back by swarm`, `updated outside a release`), which `stack verify` also fails on.
- **Pinned digests.** The release record and its stored `stack.yaml` name every image by digest, the third-party ones from
  the stack file and the built ones from the images job; the tracked `release/images.lock.yaml` keeps listing which are
  bound per release.
- **Retention.** The manager keeps the last 10 attempts' releases and every accepted one in the last 30 days; the registry
  keeps every digest a kept release names (a managed clean-up job deletes other `sha-*` versions older than 30 days).

## Compared with common practice

The widespread GitHub Actions pattern for a small Swarm (build with buildx, push to GHCR by sha, then
`docker stack deploy` over an SSH Docker context with `--with-registry-auth`) is what the harness already does, and it
is kept. What the common pattern usually lacks and this design adds: deploying by digest only, one build whose attested
digest is the deployed one, the in-run evidence gate instead of trusting the job graph, convergence judged on the new
task spec rather than on `docker stack deploy` returning, functional verification after health, a whole-stack rollback
from stored bytes in addition to Swarm's per-service rollback, migrations in the deploy under expand and contract, and a
manager-side journal. `docker service rollback` alone is not enough: it reverts one service to its previous spec only
([swarm services]).

## Work packages

Each package is independent until the integration order; every one ends with its own specs green and the dry runs of the
verbs it touches unchanged for an app that does not opt in.

**WP1. Deploy records, lock and status (`@starci/hfs` stack).** Files: `stack/deploy.mts`, `stack/release-store.mts`, a new
`stack/journal.mts` and `stack/status.mts`, `stack/cli.mts` (action `status`, flags `--ci-run` passed through), the urgent
floor. Interfaces: `ReleaseStore.journal(attempt)`, `lock()`/`unlock()` over the ssh runner with validated paths only;
`observedServices(ctx, config)`. Tests: stubbed runner specs for lock contention, journal at each phase including a thrown
step, drift detection after a simulated Swarm rollback, idempotence by `sourceSha`. Done: a deploy and an urgent deploy
both write a journal; `stack status` reports drift; rollback target images are pre-pulled in preflight.

**WP2. Migrations in the deploy (`@starci/hfs` stack and db).** Files: `stack/deploy.mts` phases backup, migrate and
contract, generalised from `stack/urgent-floor.mts` (shared steps, renamed codes), `db/postgres.mts` (`inContainer` for any
migrate), the contract-migration finding in the db rules (`app check --db`), `database.target` in the stacks schema.
Tests: no pending migration means no backup; a red preview refuses before the stack deploy; a contract migration runs only
after accept; first start chosen automatically with no accepted release and refused on a non-empty database. Done: the
nivo-lite stack deploys and migrates in a scratch swarm with the db service internal only.

**WP3. CI evidence and urgent trailers (`cli/`).** Files: `cli/src/core/check/ci.ts` (`requireCiGreen` accepts
`--ci-run <id>`: the run's required jobs for that sha, or the reused run), `cli/src/core/app/stack.ts`, `release push
--urgent` writing the tag trailers through `@starci/hfs` `release/urgent.mts`, `release/records.mts` reading them back,
`policy/quality.yaml` comment. Tests: a run with one required job skipped or failed is refused `CI_NOT_GREEN`; a
reused candidate run of another sha is refused; trailers round-trip. Done: `stack deploy --ci-run` works inside a run that
is still in progress.

**WP4. The managed workflows (`@starci/hfs` templates, sync and rules).** Files: `templates/app/ci-workflows{,-lite}/github/
workflows/ci.yml` (plan, images, verdict, deploy jobs; `pull_request`), `images.yml` and `stack-deploy.yml` as reusable
workflows (`workflow_call`, dispatch kept on `stack-deploy.yml` with `deploy|redeploy|rollback`), `db-deploy.yml` retired
(sync deletes it), `sync/ci-commands.mts`, `sync/stack-images.mts`, `runtime/knowledge/hfs/ci-standard.yaml` (jobs, the
`verdict` and `plan` items), rules R221, R251, R271 (`HFS_DB_DEPLOY_UNGUARDED` moves to the deploy's migrate phase) and the
supply-chain SBOM check (now on the pushed build), the stacks schema keys `deploy.auto`, `deploy.approval`,
`deploy.platforms`, `ci.imageCache`, `services.notify`, the `vps-ci` sealed member and `starci-ssh-gate`. Tests:
`hfs-deploy-workflow.spec`, `hfs-release-provenance.spec`, `hfs-supply-chain.spec`, the render specs for lite and full,
prettier stability. Done: `app sync` renders a pipeline that `actionlint` and the CI standard accept for both editions.
Needs WP1 to WP3 published (the workflows call their flags).

**WP5. Knowledge, rulings and the move of existing apps.** Files: this document made the rule (its sections become ids),
[stacks.md](stacks.md) PROJECT-STACKS-6 and PROJECT-STACKS-7, [authority/ci.md](../authority/ci.md),
[harness/rules.md](../harness/rules.md) rule 5, [harness/decisions.md](../harness/decisions.md), the ruling set live. The
migration path, nivo-lite first: bump hfs and the CLI, `app sync --execute` (the new workflows, `db-deploy.yml` and
`images.yml`'s old form removed); seal the CI deploy key as `vps-ci` and install its `authorized_keys` line with the gate
(owner-run); set the `production` environment's deployment refs to `v*`; release a no-op patch and watch the first
automatic deploy; once it is accepted, delete `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS` from the environment. The app-owned
`authorize-deploy-key.yml` and `cli-deploy.yml` stay. Then the other apps, one per release.

Integration order: WP1, WP2 and WP3 in parallel; WP4 after they are published; WP5 last, and its knowledge edits can
start with WP4.

## As built by the work packages (integration, 2026-10-31)

Where the packages differ from the design above, or add to it, the code and the rules are the authority:

- **The deploy is called, not owned.** A job that calls a reusable workflow cannot bind a GitHub Environment, so `ci.yml` has one `deploy-<env>` job per
  environment with `deploy.auto` that passes `with.environment`, and the called `stack-deploy.yml` job binds it (restricted to `v*` tags), reads that
  environment's `SOPS_AGE_KEY` and opens the transport. R251 judges both halves. The environment URL of a deployment record is not set.
- **The brake is a step, not a job condition.** An environment variable is not readable in a job's `if` before the job is bound to the environment, so
  `STARCI_DEPLOY_PAUSED` is read by the first step of the bound deploy job; the later steps wait for it and the job ends green with a notice in the run summary.
- **The transport is one sealed member.** `.starcistacks/<env>/secrets/vps-ci.enc.yaml` holds `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `VPS_HOST` and `VPS_USER`;
  `stack connect` prefers it over the job's `VPS_*` variables and masks the host, the account and the releases root in the log. `stack-key-restore.yml` keeps
  its own `VPS_*` environment secrets (it runs when the server identity that opens the member is missing), so deleting them removes the restore path.
- **Pull requests** run the checks and build the images without pushing (`push: false`); an image with sealed build values is built on release tag runs only.
- **Public repositories** (nivo-lite is public). GitHub-hosted runners only, never self-hosted. A sealed `.enc` is public ciphertext: the age keys and the CI
  private key never enter the repository. The CI key is a key of its own on the manager (`restrict`, a forced command, a rotation path owned by the owner, who
  also seals it), the log prints no host, address or server path, no secret is baked into an image (build arguments are public values), `main` is protected and
  the `v*` tags are protected and never moved or deleted, and `pull_request_target` never runs a pull request's code.
- **Not built yet:** the forced-command gate `starci-ssh-gate` (the release store's scripts are not yet named scripts it could admit), `services.notify`,
  the `--data-acknowledged` guard of a manual rollback to a release older than an applied contract migration, and the environment URL.

## Open decisions

| decision | options | recommended |
|---|---|---|
| Who approves a production deploy | every green release tag deploys (`deploy.auto: true`) / GitHub required reviewers / staging auto and production by dispatch | auto, as the owner asked, with the pause variable as the brake; reviewers need a public repository or Enterprise |
| Agents push main, so agents deploy | accept it (the green pipeline is the guard) / only the owner's pushes deploy (the `verdict` job checks the pusher) | accept it; the pause variable and the rollback cover the risk, and the urgent path already lets the owner ship alone |
| The CI SSH key | sealed member `vps-ci` opened with the server key / GitHub Environment secrets as today | sealed: one GitHub secret per environment and the pinned host keys reviewed in git |
| Pull request CI | add `pull_request` (checks only, no secrets) / keep apps without it | add it, so Dependabot's updates are judged |
| Contract migrations | after accept, in the same deploy / held for a dispatch by the owner | after accept, with the same-release finding as a hard blocker |
| Sonar on every release run | every full run / tags only as today | every full run, so the gate judges before the deploy |
| Image cache | GitHub Actions cache per image / registry cache | Actions cache by default, registry cache per app when the 10 GB limit evicts |
| Multi-architecture images | `linux/amd64` only unless declared / always amd64 and arm64 | amd64 unless an environment declares another node |

## Sources

- [deploy spec]: Compose deploy specification, `update_config` and `rollback_config`, https://docs.docker.com/reference/compose-file/deploy/
- [swarm services]: Deploy services to a swarm, rolling updates and rollback, https://docs.docker.com/engine/swarm/services/
- [buildx gha]: GitHub Actions cache backend, https://docs.docker.com/build/cache/backends/gha/
- [environments]: Deployments and environments, https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- [concurrency]: Control the concurrency of workflows and jobs, https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

## Read with

[check-cache.md](check-cache.md) (which run is diff-only and which full, and the trusted base), [stacks.md](stacks.md)
(environments, custody, the operations and their safety rules), [authority/ci.md](../authority/ci.md), the `app stack`
and `app release` usage of `@starci/hfs`, and [policy/quality.yaml](../../policy/quality.yaml) (`requireCi`, the gate
threshold).
