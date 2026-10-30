# Stacks: how an app runs

`.starcistacks/` at the app root is the one place an app says how it runs: which environments exist, what each one
starts, how traffic enters, where its secrets are sealed, what its CI and quality services read, and how an operator
brings it up and down. The harness owns the **shape** (what may exist, what every environment must declare, the
operations and their safety rules); the project owns the **values** (its components, images, ports, hosts, secret
names and runbook commands).

The exact tree (required, allowed and forbidden paths, per edition) is the slot `app.starcistacks` in
[hfs/slots.yaml](../hfs/slots.yaml); the laws are R10 `HFS_STACKS_SHAPE` and the `STACKS_*` rules in
[hfs/rules.yaml](../hfs/rules.yaml), which name their enforcers. This file gives the reasons and the operating
rules no slot can express, each under its id; every one without a named rule is held by review. What each edition
runs is in [lite.md](lite.md) and [full.md](full.md).

## PROJECT-STACKS-1 One root per app

`.starcistacks/` lives only at the app root, the repository that owns `.starciwork`, and covers every side the app
has (be and fe). A side repository or a side folder carries none (`HFS_STACKS_IN_SIDE`), so a front end that ships
from its own repository finds its stack, and its CI credentials, in the app root's custody.

Why: one root keeps one manifest, one custody and one runbook per environment; two roots drift, and nobody can say
which one deployed.

## PROJECT-STACKS-2 The manifest declares everything the app runs and reads

`application-stacks.yaml` (schema `starci/application-stacks@1`) is the declaration everything else is checked
against:

- `components`: every process and dependency the app needs, each with its role and purpose, so a reader can tell a
  durable store from a rebuildable cache without opening a compose file.
- `environments`: per environment, its runtime (`docker-compose` or `docker-swarm`), the infra files it reads, the
  components it runs, its runbook and its secrets. A component absent from an environment's map does not run there.
- `secrets`: per environment, each member's `name`, `where` (environment-relative), `recipientPolicy` and
  `keyCustody`; names only, never a value.
- `ci` and `services`: the names CI reads and the delivery services it calls (PROJECT-STACKS-7, PROJECT-STACKS-8).
- remote application APIs the app consumes, each with its owner (PROJECT-STACKS-9).

A directory under `.starcistacks/` that is not a declared environment is a defect, and so is a compose file no
environment reaches.

## PROJECT-STACKS-3 Two kinds of environment, each with its runbook

Two kinds, named by the project:

- **dev** (conventionally `dev`): every dependency runs in Docker Linux containers on the developer host, rendered
  from the environment's compose files; application processes may run natively against them. Non-secret
  configuration lives under `<env>/runtime/{config,env}/`, seed data under `<env>/seeds/`.
- **vps** (conventionally `vps`): the app and its dependencies run on a Docker Swarm stack rendered from
  `<env>/infra/swarm/`. Images are immutable and pinned (BE-SERVICES-2 in [code/be/services.md](../code/be/services.md);
  base images in [stack/pins.yaml](../stack/pins.yaml) `images`), secrets are versioned external Swarm secrets, and
  every service declares healthcheck, placement and rollout (R266, R267, R294).

Beside the environments, a lite app keeps the managed Dockerfile of its db image at `images/db/Dockerfile` (slot
`app.db.image`, ruling `lite-db-image-in-stacks`); `images/` is no environment and holds no custody.

Each environment has its own `README.md`, the runbook: the operations of PROJECT-STACKS-6 with the project's real
commands, the components it binds, its secret custody and its data custody (which volumes are authoritative, which are
rebuildable).

A single VPS is a one-manager swarm: it orchestrates but has no manager failover, so a lost manager means recovery or a
new cluster, and a replicated task never makes a single-host volume highly available. More nodes are a design of their
own (quorum, node roles, data placement), recorded in the runbook. Provisioning tools may create machines and DNS but
never own the runtime topology; creating or joining a swarm, DNS and key rotation are owner-run steps the runbook
names.

**Scheduled work.** Swarm has no native schedule, so recurring work stays inside the app: the back end's queue
scheduler (BE-QUEUES-3), a lite `platform/jobs` tick (BE-JOBS-6) that enqueues through the queue outbox, or a declared `replicated-job`
component that runs a named back-end CLI action on a cron `schedule`, started by a declared `role: scheduler`
component. Never a host crontab, systemd timer or deploy-script loop (R250, R268). The command owns its completion,
retry and overlap; a healthy scheduler container is no proof that the job finished.

## PROJECT-STACKS-4 One declared ingress publishes, and only in the open it must

One declared ingress component per environment is the only thing that publishes a port (R266, R275); every other
service sits on internal networks. The checker keys on the component's role and its published ports, never on the
image, so any digest-pinned supported reverse proxy serves.

- dev: the ingress publishes on loopback only, `127.0.0.1:<port>:<port>`, never `0.0.0.0` and never a bare port.
- vps: the ingress publishes 80 and 443 only. DNS is an owner-run prerequisite with its receipt; the ingress obtains
  and persists its certificate, and exposes a route only after the upstream is ready.
- An app routed by a shared ingress outside its own stack declares that ingress as external with its hosts; its own
  stack then renders no ingress and publishes no port, and its DNS and TLS stay declared (R275).
- The application origin the back end trusts (BE-AUTH-7 in [code/be/api-auth.md](../code/be/api-auth.md)) is the
  ingress origin of that environment; the app is opened there, never at a process port.

## PROJECT-STACKS-5 Secrets are sealed, granted least and never regenerated

- **Sealed only, one member per provider.** A secret exists in the tree only as a SOPS envelope; a member holds the keys
  of one provider or service (the owner's group: an app's own keys, the keys one service reads),
  `<env>/secrets/<provider>.enc.yaml`, sops YAML whose values come back byte for byte (a multi-line key, a trailing
  newline), committed (R06, R277; the names are `scripts/lib/sealed-member.mjs` of @starci/hfs).
  A legacy dotenv `<member>.enc` stays readable until `migrate` moves it. Nothing else under `.starcistacks/` is ciphertext.
- **Declared per key, read as `<KEY>_FILE`.** Each key is one entry of its environment's `secrets:` in
  `application-stacks.yaml` (`name: <kebab of the key>`, `member`, `key`, `where: secrets/<member>`); `materialize` writes
  each key to its own file in host-local custody and the back end reads it through `<KEY>_FILE` as BE-CONFIG-4 in
  [code/be/config.md](../code/be/config.md) says. `set` declares the keys of a compose environment itself; a swarm
  environment's secret is wired with its stack (runtimeName and the deploy grant) by hand.
- **One owner identity, found by itself; one rule per environment.** Every member is sealed to the public recipients of
  its environment's rule in the app's `.sops.yaml`, which `starci app secret init` and `recipients` manage: dev to the owner
  key, production to the production server key and the owner key both, so the owner sets and rotates production from his
  machine and the server opens it with its own key. A member is sealed to that whole set, and a rewrite (`set`, `migrate`,
  `split`, an edit) seals to the rule's set, or to the member's own set when no rule names it, so none drops the server key;
  a decrypt opens a member when its identity's recipient is one of the set. The owner's private identity is `SOPS_AGE_KEY` in
  the harness's secret.env, backed up by the owner (R253); every verb that opens a member (`starci app secret`, `stack`,
  `release`, `db`, the CLI's custody) finds it with nothing exported or pointed to through one lookup, taking the first of:
  SOPS_AGE_KEY or SOPS_AGE_KEY_FILE of the environment, the app's git-ignored `.claude/secret.env` (its main checkout's for a
  worktree), the harness secret.env, the sops `keys.txt` (`decryptionIdentity`, @starci/hfs `secret-init.mjs`), and with none
  refuses before asking for a value, naming each place. A member it cannot open is refused naming the member, the format it
  was read as, its recipients, the identity's source and recipient, and why. Whoever holds that identity can decrypt every member in the whole git history, so
  it never leaves the harness secret.env and the app repositories stay private.
- **The server's own identity, made on the server.** `starci app secret server-key <env>` (a dry run until `--execute`)
  reaches the environment's deploy server the way the deploy does (`deploy.remote`, the same host, user and key source;
  without one it refuses) and there keeps `/root/.config/sops/age/keys.txt`, sops' default key file of root that a decrypt on
  the server reads with nothing set (SOPS_AGE_KEY_FILE names it where one is set), or makes it with `age-keygen` (umask 077,
  mode 600, owner root), installing age through stack prepare's installer when it is missing. Every script runs as root and
  resolves age-keygen there (root's PATH, then `/usr/local/bin`, `/usr/bin`, `/bin`), the presence check the same way, since
  sudo's secure_path can leave `/usr/local/bin` out; the static installer puts age in `/usr/local/bin` and links it from
  `/usr/bin`. Only `age-keygen -y` comes
  back: the private key never leaves the server and the owner's key never makes it. Locally the recipient joins the
  environment's rule beside the owner key, is recorded as `deploy.remote.serverRecipient`, and every member is wrapped again
  with `sops updatekeys`, the owner identity opening only the data key. `--rotate --execute` stages a new identity, wraps the
  members to it, swaps it in keeping the old file on the server as `keys.txt.retired-<UTC stamp>` until the owner deletes it,
  then drops the old recipient. The owner key is the first way back when the server loses its identity: production is
  sealed to it, so the owner seals production again to a new server key. The server key is also the environment's CI key,
  which the owner accepts knowing that whoever can deploy to that GitHub Environment can read it: `--backup github --execute`
  streams the key file from the server's ssh stdout straight into `gh secret set SOPS_AGE_KEY --env <env>` of the app's
  origin repository, never printed, held or written locally, and refuses unless that Environment exists with required
  reviewers or deployment branches limited to main. That Environment secret is the SOPS_AGE_KEY every CI job bound to `<env>`
  reads, overriding a repository secret of the same name, so a deploy of `<env>` opens its members with that environment's
  server key. GitHub never gives a secret back, so `--restore github --execute` dispatches the managed
  `.github/workflows/stack-key-restore.yml` with the recorded `serverRecipient`, which writes that secret to the server over
  the deploy's CI ssh key only when its public key is that recipient (umask 077, mode 600, never echoed, never over an
  existing identity). Both warn while the repository holds a SOPS_AGE_KEY of its own (`gh api repos/<o>/<r>/actions/secrets`,
  names only): the owner deletes it once every environment holds its server key, since the owner key never belongs in
  GitHub. The deploy's owner-machine transport opens `deploy.remote.sealed`, one member
  (`sealed: vps`, `.starcistacks/<env>/secrets/vps.enc.yaml`) holding `VPS_HOST`, `VPS_USER`, the PEM private key under
  `privateKey` and the pinned known_hosts under `knownHosts` (`SEALED_SSH_KEYS`, @starci/hfs `stack/remote.mjs`). A member per
  role is refused; `starci app secret migrate <env> <member> --to vps --into-existing` folds each into `vps`. `stack deploy` opens the members where it runs (the owner machine with the owner key, or CI with the bound
  environment's server key) and hands each value to a Swarm secret over the deploy transport; a decrypt on the server reads
  this key file (@starci/hfs `stack/server-key.mjs`).
- **Set in one write.** `starci app secret set <env> <provider> <KEY>...` prompts for each key with masked input on a
  terminal (or reads redirected stdin, or `--from-file KEY=path` byte for byte) and seals them all in one write, so no member
  is left half filled. `starci app secret audit [<env>]` names every deviation (a legacy member, a member mixing providers by
  the first word of its keys unless the stack groups it on purpose, every key of it declared in `secrets:` with that
  `member`; one sealed to other recipients than its rule, a key not declared, a declared member not sealed, an untracked
  member, a rule that does not name the recorded `deploy.remote.serverRecipient` beside the owner key, a production swarm
  deploy that records none) and exits 1 while any stands; `migrate` and `split` repair them, dry runs until `--execute`, decrypting in
  memory only. Either merges into a member that already exists only with `--into-existing`: a key the target holds with
  another value refuses the whole move, naming the key, an identical one merges, each target is written once and the
  source goes only after every target is written. The audit is a verb, not a gate row, until every app has moved.
- **Moving an app to the standard.** In the app root, with the harness CLI:
  1. `starci app secret audit` lists what deviates; `starci app secret recipients <env>` shows each environment's
     recipients.
  2. `starci app sync --write` renders the `.gitignore` block that tracks `secrets/*.enc.yaml`.
  3. `starci app secret recipients <env> --add owner` puts the owner key on each environment; a recipient no one holds any
     more leaves with `--remove <age1...>`, `starci app secret server-key production --execute` makes the server key and
     seals production to it, and `server-key production --backup github --execute` makes it the key CI deploys production
     with; once every environment holds its key, the owner deletes the repository-level SOPS_AGE_KEY the backup warns about.
  4. `starci app secret migrate <env> <member> [--to <provider>] [--into-existing]`, then the same with `--execute`, moves
     each legacy member, or merges one into an existing member; `split <env> <member> [--group KEY=member ...]
     [--group-file <yaml>] [--into-existing]` (dry run, then `--execute`) divides one that mixes providers, each key to its
     first word's member unless `--group` (or the file's `KEY: member` map) names the owner's. A member no identity here
     opens is removed (`remove <env> <member> --force-nonempty --execute`) and its keys set again. A member the deploy names
     (`deploy.secrets.grants`, `deploy.secrets.settings`, one `{ member, keys }` or a list of them, `deploy.remote.sealed`)
     is renamed there in the same change, and each key's `secrets:` entry names its new member.
  5. `starci app secret set <env> <provider> <KEY>...` seals the provider's keys and declares them.
  6. `starci app secret verify <env>` opens every member and checks the shapes the app reads; `audit` is clean.
  7. Commit the members, `.sops.yaml`, `.gitignore` and `application-stacks.yaml` together.
- **Plaintext never enters the tree.** A decrypted member reaches a process through `*_FILE` from host-local custody
  (the `goesTo` of slot `app.plaintext-env`) or memory, never a file in the checkout, ignored or not. Each
  environment's `.gitignore` still ignores everything under `secrets/` except its sealed members, so a mistaken decrypt cannot be
  committed.
- **Never printed.** No agent opens, decrypts, echoes or logs a secret; a member is judged by its name
  ([contexts/harness/rules.md](../harness/rules.md) hard rule 1, `neverRead` in [policy/security.yaml](../../policy/security.yaml)).
  Logs keep tokens, prompts and decrypted values out.
- **Refuse, never regenerate.** Missing ciphertext or a missing or wrong identity refuses `prepare`; a failed decrypt
  is never answered by minting a replacement. Rotation mints a new value under a new versioned name, re-encrypts,
  updates the grant, waits for every consumer and only then retires the old version; a name is never reused. Key
  rotation is owner-run.
- **Least grant.** Each secret is granted only to the components that consume it; two consumers of different
  authority never share one member.

## PROJECT-STACKS-6 Every runbook declares the same operations

Every environment's runbook declares the same seven operations, one row each, with the project's command and its
acceptance gate. They are run by the owner or a `deliver` worker; deploying needs the owner's approval
([contexts/harness/rules.md](../harness/rules.md) hard rule 5) and `deploy.prod` waits for green CI (`requireCi` in
[policy/quality.yaml](../../policy/quality.yaml)). The harness verbs that will run them are listed in
[README.md](../../README.md) (verb groups; `starci explain` lists what is built) and are not built yet, so today the
runbook is the operation and these rules are held by review.

| operation | does | safety rule |
|---|---|---|
| `prepare` | checks tools, host capacity and the decryption identity, materializes secrets into host-local custody, builds or pulls the exact images, runs the project's setup commands | refuses on missing ciphertext, identity or image; never generates a replacement secret; creates or joins no swarm by itself |
| `doctor` | read-only inspection: render the compose or stack config, envelopes present, identity custody, image identities, free loopback ports, existing volumes, swarm state | changes nothing; never prints a value |
| `up` | starts the environment and waits for health | only after `prepare` passes; on vps, only for an approved immutable release, after a verified backup and a migration with a durable receipt |
| `status` | desired against running, migration receipt, dependency-backed readiness | container presence is not status; a returned deploy command is not success |
| `logs` | one named service, bounded in time and lines | redacted; never dumps environment or credentials |
| `down` | stops the environment | never `--volumes`; named volumes and ciphertext survive; on vps refused without a data-retention and drain decision, and never targets another stack |
| `verify` | after a real start: liveness, an authenticated journey through the ingress, private endpoints denied, restart, restore | a static render or a passing check is not verification |

**Start order.** A component starts in one observable sequence: materialize custody, parse and validate its
configuration (BE-CONFIG-1, BE-CONFIG-2), migrate under authority with a receipt (BE-PERSISTENCE-2), start listeners
and workers, open readiness (BE-AUTH-8), then verify a named journey. Readiness never stands in for the migration
receipt or the journey.

**Releases.** A vps release is immutable: the rendered stack, the source digest, the image digests per architecture,
the non-secret configuration digest, the versioned secret names, the migration and backup plans and the previous
accepted release, under a release tag equal to the package version (R267, R271). Images are built and proved before the
deploy step, which never builds. Convergence is observed (desired against running replicas, no failing or restarting
task, then the journey), and the release pointer moves only after it. Rollback restores a service specification, never
data: a schema change or a removed secret is not undone by it, and a data restore is a separate decision with its loss
window.

**Backup and reset.** Authoritative data (databases, identity, object stores) is backed up encrypted, hashed and
outside the host failure domain before `up` on vps; a named volume on the same host and a swarm-state archive are not
database backups, and a recovery claim needs an isolated restore. A backup writes its archive outside the app and every
worktree, encrypted to the root `.sops.yaml` recipients with no plaintext left behind, plus a receipt (target, time,
archive hash, byte count, row counts). A database reset refuses without a receipt of a full backup of the same target,
younger than the manifest's maximum age, and without an explicit keep-or-drop choice for identity and stored files; it
is a dry run until it is armed explicitly.

## PROJECT-STACKS-7 CI holds names; every value stays with its consumer

One key belongs to one class, and the manifest's `ci` block declares names and public values only:

| class | read by | lives in |
|---|---|---|
| app secret | the app's containers at runtime | a sealed member (PROJECT-STACKS-5) |
| app public config | the app's build and runtime | the manifest's build arguments and environment record |
| CI secret | the CI workflows | the CI provider's secret store, repository or environment scope |
| CI public config | the CI workflows | the CI provider's variables, repository or environment scope |
| dependency-bot secret | the dependency bot | its own secret store |

A name is upper snake case, never in the CI provider's reserved prefix, and declared once across the classes; an
environment-scoped name names its environment; a variable whose value only the owner may give is declared as such and
set from standard input, never argv. A sealed key is never a CI secret, an app's runtime secret never reaches CI, and
every workflow reference is declared and every required declaration read (R296, R297, R298). CI holds only each
environment's server key, as the SOPS_AGE_KEY of that GitHub Environment (PROJECT-STACKS-5), and the deploy transport
credentials, never the owner key and no repository-level SOPS_AGE_KEY. Every job that reads SOPS_AGE_KEY is bound to the
environment whose members it opens (`environment: <env>`), so it reads that environment's key, injected into that job
alone and gone when it ends; a job that only builds or checks needs no key (R251, R252).

## PROJECT-STACKS-8 Quality services are declared and required

The manifest's `services` block names the delivery, quality and platform services the code and CI use (a static
analysis server, coverage upload, the dependency bot, the dependency audit, a registry, error tracking, analytics),
each with its provider, its mode (`local`, `hosted` or `disabled` with a reason), its host, its auth and its
credentials as custody references, never values; a service the CI calls is declared, and a disabled one is never
called. Static analysis and coverage are required: a missing token, an unreachable host or a rejected upload is a red
job, never a skip, and the analysis row passes only on the server's quality gate for that analysis, never on the
scanner's exit code. A shared analysis server the host runs for every project is declared host-owned, and a project
never copies its Compose files. The app's CI follows the one CI standard, delivered only by the app sync (R299, R301);
its thresholds are `sonar-new-code` in [policy/quality.yaml](../../policy/quality.yaml).

**Status badges.** The app's README carries one managed badge block, rendered by the app sync from the manifest and
checked for drift by it: CI, coverage, analysis and dependency-bot badges, each linking a live public service only,
never a local, loopback or private host. A private repository's coverage and analysis badges need a read-only badge
token, which is public configuration in the manifest, never a CI secret; that a badge service is live is checked by
hand.

## PROJECT-STACKS-9 A remote application API is consumed, not administered

An application the app calls that runs elsewhere (on a cluster or another host) is an application API to its caller,
whatever runs it. Three contracts stay apart, each with its own adapter, permissions and proof:

- **consumption**: the caller's protocol, authentication, authorization, result mapping, deadline and recovery
  (BE-INFRA-3);
- **deployment**: its owner builds and rolls out the workload, its dependencies and migrations in its own target;
- **cluster administration**: its owner runs nodes, scheduling, network, storage and cluster access.

Calling the API grants neither of the other two. The caller's manifest names the API's owner, failure domain, its
separately kept deployment declaration, the accepted contract, an endpoint reachable from the caller's network (a
cluster-internal address is not), the credential's custody reference, the deadline and the readiness check. One
component has one placement: a local copy is never started to satisfy an inventory, and a local forward is a declared
development connection, not proof the API runs locally. Verification runs from the real caller against the intended
API version; an open port or a running pod proves nothing, and an unreachable target is reported, never replaced by a
mock and called verified.

## PROJECT-STACKS-10 Local runs

Rules learned from running apps on developer hosts; each holds in every app.

- **Through the ingress.** The person and the `uat` worker open the app at the dev ingress origin
  (PROJECT-STACKS-4).
- **Bind Next to `localhost`.** A Next dev server started with `-H 127.0.0.1` normalizes its own host to `localhost`
  and loops on locale redirects. The dev server binds `localhost` (its default); the 127.0.0.1 address belongs to
  the ingress in front of it.
- **Caches outside the tree, where the host allows.** Tool caches live outside the repository (slot `app.tool-cache`
  names the location). A Windows host may refuse the SWC cache under AppData; the dev runbook then names a writable
  cache directory outside the repository rather than letting the cache fall back into the checkout.
- **A clean checkout runs its setup.** Generated code is never committed (SHARED-SCRIPTS-2), so `prepare` runs the
  project's setup commands, the same ones a task contract carries in `context.setup` ([README.md](README.md) "Life
  cycle of a piece of work").

## Read with

[lite.md](lite.md), [full.md](full.md); slot `app.starcistacks` and `app.plaintext-env` in
[hfs/slots.yaml](../hfs/slots.yaml); R06, R10, R250 to R253, R266 to R268, R271, R275 to R277, R294, R296 to R299,
R301 in [hfs/rules.yaml](../hfs/rules.yaml); rulings `lite-production-swarm`, `sealed-secret-custody`,
`single-declared-ingress` and `owner-run-steps` in [decisions/rulings.yaml](../decisions/rulings.yaml).
