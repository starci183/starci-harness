# Stacks: how an app runs

`.starcistacks/` at the app root is the one place an app says how it runs: which environments exist, what each one
starts, how traffic enters, where its secrets are sealed, what its CI and quality services read, and how an operator
brings it up and down. The harness owns the **shape** (what may exist, what every environment must declare, the
operations and their safety rules); the project owns the **values** (its components, images, ports, hosts, secret
names and runbook commands).

The exact tree (required, allowed and forbidden paths) is the slot `app.starcistacks` in
[hfs/slots.yaml](../hfs/slots.yaml); the laws are R10 `HFS_STACKS_SHAPE` and the `STACKS_*` rules in
[hfs/rules.yaml](../hfs/rules.yaml), which name their enforcers. This file gives the reasons and the operating
rules no slot can express, each under its id; every one without a named rule is held by review. What the app
runs is in [edition.md](edition.md).

## PROJECT-STACKS-1 One root per app

`.starcistacks/` lives only at the app root, the repository that owns `.starciwork`, and covers every side the app
declares ([README.md](README.md) PROJECT-1). A side repository or a side folder carries none (`HFS_STACKS_IN_SIDE`), so a front end that ships
from its own repository finds its stack, and its CI credentials, in the app root's custody.

Why: one root keeps one manifest, one custody and one runbook per environment; two roots drift, and nobody can say
which one deployed.

## PROJECT-STACKS-2 The manifest declares everything the app runs and reads

`application-stacks.yaml` (schema `starci/application-stacks@1`) is the declaration everything else is checked
against:

- `sides`: the project's sides as booleans, `{be, fe, packages}`, equal to the sides `hfs.json` declares, with a
  plain-words comment line above it that the scaffold writes (a project without a front end says so). No component,
  deploy image or local process runs an app of a side the project lacks: no web component without fe, no api
  component without be (R399: `STACKS_SIDES_DRIFT`, `STACKS_COMPONENT_SIDE`; a manifest without the field is warned
  `STACKS_SIDES_UNDECLARED`; owner: `@starci/hfs` `runtime/scripts/hfs/rules/project-sides.mts`).
- `components`: every process and dependency the app needs, each with its role and purpose, so a reader can tell a
  durable store from a rebuildable cache without opening a compose file.
- `environments`: per environment, its runtime (`docker-compose` or `docker-swarm`), the infra files it reads, the
  components it runs, its runbook and its secrets. A component absent from an environment's map does not run there.
- `secrets`: per environment, each member's `name`, `where` (environment-relative), `recipientPolicy` and
  `keyCustody`; names only, never a value.
- `data`: the stores that must be kept, the stateful components that are rebuilt instead, and the data sets copied from them,
  each a `seed-standard` or a `seed-backup` with its destinations (PROJECT-STACKS-13, PROJECT-STACKS-14; R426, R427).
- `tests`: the world slots of the integration and e2e runs, `{ integration: { workers: n }, e2e: { workers: n } }`, each `workers` an integer from 1 to 8 (absent is 1: one
  spec file at a time): how many spec files of the kind run at once, each on a data slot of its own, with the exclusive
  specs alone afterwards ([code/be/test.md](../code/be/test.md) BE-TEST-17; `HFS_STACKS_SHAPE`).
- `ci` and `services`: the names CI reads and the delivery services it calls (PROJECT-STACKS-7, PROJECT-STACKS-8).
- `branches`: the branch profile of each branch that lowers a polish gate, `dev` only ([lint.md](lint.md) PROJECT-LINT-2).
- remote application APIs the app consumes, each with its owner (PROJECT-STACKS-9).

A directory under `.starcistacks/` that is not a declared environment is a defect, and so is a compose file no
environment reaches.

## PROJECT-STACKS-3 Two kinds of environment, each with its runbook

Two kinds, named by the project:

- **dev** (conventionally `dev`): every dependency runs in Docker Linux containers on the developer host, rendered
  from the environment's compose files; application processes may run natively against them. Non-secret
  configuration lives under `<env>/runtime/{config,env}/`, its seed data in its seed level `<env>/seeds/` (PROJECT-STACKS-12).
- **vps** (conventionally `vps`): the app and its dependencies run on a Docker Swarm stack rendered from
  `<env>/infra/swarm/`. Images are immutable and pinned (BE-SERVICES-2 in [code/be/services.md](../code/be/services.md);
  base images in [stack/pins.yaml](../stack/pins.yaml) `images`), secrets are versioned external Swarm secrets, and
  every service declares healthcheck, placement and rollout (R266, R267, R294).

Beside the environments, `images/<name>/` holds the image folder of each service the app customises (PROJECT-STACKS-11),
a db image is the managed `images/db/Dockerfile` among them (slot `app.db.image`). `images/` is no environment and holds no custody.

Each environment has its own `README.md`, the runbook: the operations of PROJECT-STACKS-6 with the project's real
commands, the components it binds, its secret custody and its data custody (which volumes are authoritative, which are
rebuildable).

A single VPS is a one-manager swarm: it orchestrates but has no manager failover, so a lost manager means recovery or a
new cluster, and a replicated task never makes a single-host volume highly available. More nodes are a design of their
own (quorum, node roles, data placement), recorded in the runbook. Provisioning tools may create machines and DNS but
never own the runtime topology; creating or joining a swarm, DNS and key rotation are owner-run steps the runbook
names. A server of the owner's own fleet is managed by the harness, not by the app: `starci vps` bootstraps it, inits its swarm and
opens its doors, and `starci vps grant` hands the app a deploy user of its own, sealed into the `vps` member of PROJECT-STACKS-5
([harness/managed-vps.md](../harness/managed-vps.md)); the app never holds that server's root.

**Scheduled work.** Swarm has no native schedule, so recurring work stays inside the app: the back end's queue
scheduler (BE-QUEUES-3), a `platform/jobs` tick (BE-JOBS-6) that enqueues through the queue outbox, or a declared `replicated-job`
component that runs a named back-end CLI action on a cron `schedule`, started by a declared `role: scheduler`
component. Never a host crontab, systemd timer or deploy-script loop (R250, R268). The command owns its completion,
retry and overlap; a healthy scheduler container is no proof that the job finished.

## PROJECT-STACKS-4 One declared ingress publishes, and only in the open it must

One declared ingress component per environment is the only thing that publishes a port (R266, R275); every other
service sits on internal networks. The checker keys on the component's role and its published ports, never on the
image, so any digest-pinned supported reverse proxy serves.

- dev: the ingress publishes on loopback only, `127.0.0.1:<port>:<port>`, never `0.0.0.0` and never a bare port.
- vps: the ingress publishes 80 and 443 only, in ingress mode or in host mode. Ingress mode goes through the Swarm routing mesh,
  which rewrites the client source IP, so every client reaches the app as one address and a per-IP rate limit becomes one site-wide
  bucket; host mode keeps the real client IP for per-IP limits behind the single proxy hop. Host mode publishes on every node the
  ingress runs on, so a host-mode ingress is global mode or pinned by a placement constraint (`STACKS_PORT_PUBLISHED`); no other
  service publishes in host mode. DNS is an owner-run prerequisite with its receipt; the ingress obtains
  and persists its certificate, and exposes a route only after the upstream is ready.
- Web and api on different hosts (R337): the web server forwards the browser's Cookie header to the api, and the
  skeleton's passport sets its refresh cookie host-only unless `AUTH_COOKIE_DOMAIN` is set. An environment whose
  web and api hosts differ gives the api `AUTH_COOKIE_DOMAIN` (the bare common parent domain, such as `example.com`) in
  its stack environment, its KEYS.md or a sealed key; `starci app check` reports `HFS_AUTH_COOKIE_DOMAIN_MISSING` otherwise.
  The refresh cookie is named `refresh_token` unless the api sets the optional `AUTH_COOKIE_NAME` (an RFC 6265 token, at most 64
  characters; any other value stops the boot). Apps that share a parent cookie domain (two dev hosts under one domain) must each set a
  distinct `AUTH_COOKIE_NAME`: with one name, one app's sign-in overwrites the other's and its refresh cookie reaches the other api.
- An app routed by a shared ingress outside its own stack declares that ingress as external with its hosts; its own
  stack then renders no ingress and publishes no port, and its DNS and TLS stay declared (R275).
- **Hosts are declared once.** An environment's public hosts live in `.starcistacks/application-stacks.yaml`, never in the stack file.
  `ingress.kind` is `own` (the default: the stack's own Caddy or Traefik component, `ingress.component` and `ingress.hosts`) or
  `shared-edge`, a shared edge-traefik outside the stack: `ingress: { kind: shared-edge, network, certResolver, entrypoint?, routes: [{ host, service, port, paths?, pathPrefixes?, priority? }] }`.
  `starci app stack render` (and so deploy) renders each routed service's Traefik labels from `routes` (a router named `<stack>-<service>`, never a bare service name, since the edge is shared with other stacks; router rule `Host(...)`, the entrypoint
  (default `websecure`), `tls.certresolver`, the service port, `traefik.swarm.network` and `traefik.docker.network`) and attaches the service to the external edge `network`;
  a route with `paths` or `pathPrefixes` serves only those paths of its host (one host can split between a front end and an api; give the path route an explicit `priority`), and routes that share a port and a constraint form one router; a service that names no network of its own keeps the stack's default one. A shared-edge environment renders no ingress and publishes no port, and its
  DNS and TLS stay declared per host. A hostname written in the stack file's labels, or a rendered host that `routes` does not hold, is
  `STACKS_HOST_UNROUTED`; a malformed shared-edge block is `STACKS_INGRESS_UNDECLARED`.
- The application origin the back end trusts (BE-AUTH-7 in [code/be/api-auth.md](../code/be/api-auth.md)) is the
  ingress origin of that environment; the app is opened there, never at a process port.

## PROJECT-STACKS-5 Secrets are sealed, granted least and never regenerated

- **Sealed only, one member per provider.** A secret exists in the tree only as a SOPS envelope; a member holds the keys
  of one provider or service (the owner's group: an app's own keys, the keys one service reads),
  `<env>/secrets/<provider>.enc.yaml`, sops YAML whose values come back byte for byte (a multi-line key, a trailing
  newline), committed (R06, R277; the names are `scripts/lib/sealed-member.mjs` of @starci/hfs).
  A legacy dotenv `<member>.enc` stays readable until `migrate` moves it. Nothing else under `.starcistacks/` is ciphertext.
  A business package keeps its provider keys the same way: `packages/<pkg>/secrets/<name>.sops.yaml`, committed only as a valid sops
  document (every leaf `ENC[...]`, a `sops` block with age recipients) sealed to the recipients of the package's own `.sops.yaml`
  (R277: `HFS_PACKAGE_SECRET_NOT_SEALED` for plaintext, `HFS_PACKAGE_SECRET_RECIPIENT` for a missing or different recipient set);
  `.env` and `*.secrets.env` stay refused.
- **Declared per consumer.** An app runtime key is one entry of its environment's `secrets:` in
  `application-stacks.yaml` (`name: <kebab of the key>`, `member`, `key`, `where: secrets/<member>`); `materialize` writes
  each key to its own file in host-local custody and the back end reads it through `<KEY>_FILE` as BE-CONFIG-4 in
  [code/be/config.md](../code/be/config.md) says. `set` declares the keys of a compose environment itself; a swarm
  environment's secret is wired with its stack (runtimeName and the deploy grant) by hand.
  A delivery or quality-service key is declared by its exact `services.<id>.credentials[]` member path and `key`
  instead (PROJECT-STACKS-8); `set` keeps it out of runtime secret declarations and binds a quality-service member (`sonar.enc.yaml`) to its service, the
  `credentials` entry and the `ci.secrets` entry the template shows, or prints the exact binding when the file's shape is not the template's
  (`starci app codemod quality-binding` binds an app scaffolded before). The audit recognizes both consumers.
- **One shared dev key, one key per server; one rule per environment** (owner, 2026-11-21, model B; R451). Every member is sealed
  to exactly the public recipients of its environment's rule in the app's `.sops.yaml`, one rule per environment and no catch-all
  (`HFS_SOPS_CATCH_ALL`). The recipients are data: `ops/vps/recipients.yaml` of the harness repository (public halves only, shipped to
  @starci/hfs as `knowledge/hfs/sops-recipients.yaml`) names the harness recipient, each managed VPS's server and backup recipient, and
  each environment's set.
  - **dev** holds the harness recipient alone, the public half of `SOPS_AGE_KEY` in the harness secret.env (`age173qf…`). Every app
    made from the harness shares it; there is no app-only identity, and `starci app secret init` and the scaffold mint none and write
    nothing into the app's `.claude/secret.env`. A freshly scaffolded app gets the dev rule only: its production has no server yet, so it
    gets no rule and no sealed placeholders, R451 reports `HFS_SOPS_RECIPIENT_UNDECLARED` for it as a warning (it never fails `--env prod`
    before the app has a server while `enforce` is false), and its absent production members are not each `STACKS_SEALED_MEMBER_MISSING`.
  - **staging and production** hold the key of the VPS the environment deploys to (`deploy.remote.serverRecipient`) plus that server's
    ONE backup recipient, and never the harness key. The backup is a dedicated age key per VPS whose private half exists only in a GitHub
    Environment secret of the harness repository (break-glass), not a copy of the server key: rotating the server key leaves the backup as
    it is, and losing the server does not lose the backup. The dev machine holds the public halves only: it seals a deployed member to
    them (`set`, `init`) and never needs, or looks for, a private server or backup key; a deployed member is opened on its server, in CI
    bound to its GitHub Environment, or by the break-glass workflow. Owed to a follow-up lane: the `vps` verbs that mint the backup key
    and set or rotate a deployed value on the server, and the break-glass workflow.
  - **The accepted cost.** Whoever holds the harness key opens every app's dev members in the whole git history, so it never leaves the
    harness secret.env. A value that was ever sealed to a dev-side key (the harness key or an app-only key) is rotated, not only resealed,
    when its environment moves to the server-only set, since git keeps the old envelope.

  `starci app check` holds this (R451). Its severity is data: while `enforce` of `ops/vps/recipients.yaml` is false (and a server's own
  `enforce` for the environments that deploy to it), every R451 finding is a warning in every env, so nothing blocks a push before the
  owner-approved migration; the owner flips a server to `true` when its environments are resealed, and the global value when every app
  is on the policy, and from then on a finding is an error, report-only in `--env local` and blocking in `--env prod`. It reports a rule that does not name exactly its
  environment's set, naming each stranger as the harness key, another server's key or an app-only identity (`HFS_SOPS_RECIPIENTS`); an
  environment whose set cannot be resolved yet (`HFS_SOPS_RECIPIENT_UNDECLARED`: no recorded server, an undeclared server, a backup not
  minted); and a member whose cleartext `sops.age` recipients differ from the set (`HFS_SOPS_MEMBER_RECIPIENTS`). A rewrite (`set`,
  `migrate`, `split`, an edit) seals to the rule's set, or to the member's own set when no rule reaches an existing member; a new member
  no rule reaches is refused `SECRET_SOPS_RULE_MISSING` before sops runs (a rule written for the legacy `.enc` spelling does not reach a
  `.enc.yaml` member; `starci app secret init` writes the per-environment rules and `starci app codemod sops-rules` migrates a legacy file).
- **The dev identity, found by itself and guarded.** Every verb that opens a dev member (`starci app secret`, `stack`, `release`, `db`,
  the CLI's custody) finds the identity with nothing exported or pointed to through one lookup, taking the first of: SOPS_AGE_KEY or
  SOPS_AGE_KEY_FILE of the environment, the app's git-ignored `.claude/secret.env` (its main checkout's for a worktree), the harness
  secret.env (the running CLI's own, then the harness home's: the nearest ancestor of the app that is a harness checkout or holds one as
  `.claude`, `cli/src/harness/secret-env.ts`), the sops `keys.txt` (`decryptionIdentity`, @starci/hfs `secret-init.mjs`), and with none
  refuses before asking for a value, naming each place. Before sops runs, the SOPS_AGE_KEY guard (`secret-identity-guard.mjs`) compares
  the public recipient of each SOPS_AGE_KEY that lookup could take with the dev member's recipients. When the one it takes opens nothing,
  `stack up` (and every verb that opens a dev member) refuses `SECRET_IDENTITY_MISMATCH`, naming the file the key was read from, its
  recipient prefix, the prefix expected and any later place that would have matched, and `starci app check --env local` warns
  `HFS_SOPS_IDENTITY_MISMATCH`. It guards dev members only: a dev machine holding no identity for a deployed environment is expected, and
  `stack down` opens no member. **A package key lives under its own variable name** (e.g. `NIVO_PACKAGE_AGE_KEY`), never
  `SOPS_AGE_KEY`: on 2026-11-21 a package key pasted over `SOPS_AGE_KEY` in an app's `.claude/secret.env` shadowed the identity its dev
  members were sealed to. A member it cannot open is refused naming the member, the format it was read as, its recipients, the
  identity's source and recipient, and why.
- **The server's own identity, made on the server.** `starci app secret server-key --env <env>` (a dry run until `--execute`)
  reaches the environment's deploy server the way the deploy does (`deploy.remote`, the same host, user and key source;
  without one it refuses) and there keeps `/root/.config/sops/age/keys.txt`, sops' default key file of root that a decrypt on
  the server reads with nothing set (SOPS_AGE_KEY_FILE names it where one is set), or makes it with `age-keygen` (umask 077,
  mode 600, owner root), installing age through stack prepare's installer when it is missing. Every script runs as root and
  resolves age-keygen there (root's PATH, then `/usr/local/bin`, `/usr/bin`, `/bin`), the presence check the same way, since
  sudo's secure_path can leave `/usr/local/bin` out; the static installer puts age in `/usr/local/bin` and links it from
  `/usr/bin`. Only `age-keygen -y` comes
  back: the private key never leaves the server and the owner's key never makes it. Locally the recipient is recorded as
  `deploy.remote.serverRecipient` and joins the environment's rule. Under the recipient policy that rule is the server key plus the
  server's backup and nothing else (R451), so the members are wrapped again ON the server with its key (sops updatekeys, no plaintext
  on disk), never with a dev-side identity. `--rotate --execute` stages a new identity, wraps the
  members to it, swaps it in keeping the old file on the server as `keys.txt.retired-<UTC stamp>` until the owner deletes it,
  then drops the old recipient. The server's backup key is the way back when the server loses its identity: the
  break-glass workflow opens the members with it and seals them again to the new server key and the backup. The server key is also the environment's CI key,
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
  (`sealed: vps`, `.starcistacks/<env>/secrets/vps.enc.yaml`) holding `VPS_HOST`, `VPS_USER`, an optional `VPS_PORT` (the SSH port, default 22; the transport passes `-p`, `-i` and `UserKnownHostsFile` explicitly, so a non-default port and the pinned key work on Windows, Git Bash and Linux CI alike), the PEM private key under
  `privateKey` and the pinned known_hosts under `knownHosts` (`SEALED_SSH_KEYS`, @starci/hfs `stack/remote.mjs`). A member per
  role is refused; `starci app secret migrate --env <env> <member> --to vps --into-existing` folds each into `vps`. `stack deploy` opens the members where it runs (the owner machine with the owner key, or CI with the bound
  environment's server key) and hands each value to a Swarm secret over the deploy transport; a decrypt on the server reads
  this key file (@starci/hfs `stack/server-key.mjs`).
- **Set in one write.** `starci app secret set --env <env> <provider> <KEY>...` prompts for each key with masked input on a
  terminal (or reads redirected stdin, or `--from-file KEY=path` byte for byte) and seals them all in one write, so no member
  is left half filled. `starci app secret audit [--env <env>]` names every deviation (a legacy member, a member mixing providers by
  the first word of its keys unless the stack groups it on purpose, each key declared by its runtime consumer or exact
  service credential reference; one sealed to other recipients than its rule, a key not declared, a declared member not sealed, an untracked
  member, a rule that does not name the recorded `deploy.remote.serverRecipient` beside the owner key, a production swarm
  deploy that records none) and exits 1 while any stands; `migrate` and `split` repair them, dry runs until `--execute`, decrypting in
  memory only. Either merges into a member that already exists only with `--into-existing`: a key the target holds with
  another value refuses the whole move, naming the key, an identical one merges, each target is written once and the
  source goes only after every target is written. The audit is a verb, not a gate row, until every app has moved.
- **A sealed file outside the stack: `--ext <target>`.** A project may keep credentials in a sealed file that is no member of its `.starcistacks`:
  a package's seed standard holds them in `secrets.<env>.enc.yaml` of its own checkout, the data around it plain. The project's extension declares
  each such file once, in `secretTargets` of `ext/manifest.json` ([lint.md](lint.md) PROJECT-LINT-3): `{id, why, root, environments: {<env>: <file>},
  recipients, under?, depth?}`, `root` the checkout folder (relative to the app root, `../` allowed), `environments` the sealed file of each stack
  environment it serves, `recipients` the `.sops.yaml` below `root` whose creation rule names who the file is sealed to, `under` the mapping path the
  keys live below and `depth` how many `/`-joined segments a key has (1: a flat `KEY`; 2 below `under: [accounts]`: `<account>/<member>`).
  `starci app secret set --env <env> --ext <target> <KEY>...` (and `unset`, `list`) is the same command as for a member, with the same masked prompt,
  redirected stdin, `--from-file` and `--generate`, the same writer claim and the same sops seam, rooted at the target's checkout so its own `.sops.yaml`
  decides the recipients; the harness reads nothing of what the file means. It refuses an unknown target (naming the declared ones), an environment the
  target does not seal, a checkout that is not on the machine, a missing `.sops.yaml`, and a key of another depth or one that carries an
  environment (a leading DEV, PROD, PRODUCTION, STAGING, LOCAL or TEST: the environment is the file). A value never reaches the stack, the
  manifest, an argument or the output, and `get` is refused for a target (the project's own door opens the file in memory). `--from-host` still
  works for one key. Enforced by R429 (`secret-targets`: `HFS_SECRET_TARGET_MISSING`, `HFS_SECRET_TARGET_UNSEALED`, `HFS_SECRET_TARGET_PLAIN`: a declared
  file that is absent, not a sops envelope, or carrying a plain value, judged when the checkout is on the machine) and, for the declaration, R381.

  ```json
  "secretTargets": [{
    "id": "blocks-core", "why": "Credentials of the blocks-core seed standard, sealed per environment.",
    "root": "../../Repositories/blocks-core-seed-standard",
    "environments": {"dev": "secrets.dev.enc.yaml", "production": "secrets.prod.enc.yaml"},
    "recipients": ".sops.yaml", "under": ["accounts"], "depth": 2
  }]
  ```

  `starci app secret set --env dev --ext blocks-core crm-main/credential` prompts for the value masked and seals it as `accounts.crm-main.credential`.
- **Moving an app to the standard.** In the app root, with the harness CLI:
  1. `starci app secret audit` lists what deviates; `starci app secret recipients --env <env>` shows each environment's
     recipients.
  2. `starci app sync --execute` renders the `.gitignore` block that tracks `secrets/*.enc.yaml`.
  3. `starci app secret recipients --env dev --add <the harness recipient> --execute` puts the harness key on dev, and an app-only
     recipient leaves with `--remove <age1...> --execute` (R451 names both); `starci app secret server-key --env production --execute`
     makes the server key, and each deployed environment moves to its server key plus the server's backup as the next bullet says, and `server-key --env production --backup github --execute` makes it the key CI deploys production
     with; once every environment holds its key, the owner deletes the repository-level SOPS_AGE_KEY the backup warns about.
  4. `starci app secret migrate --env <env> <member> [--to <provider>] [--into-existing]`, then the same with `--execute`, moves
     each legacy member, or merges one into an existing member; `split --env <env> <member> [--group KEY=member ...]
     [--group-file <yaml>] [--into-existing]` (dry run, then `--execute`) divides one that mixes providers, each key to its
     first word's member unless `--group` (or the file's `KEY: member` map) names the owner's. A member no identity here
     opens is removed (`remove --env <env> <member> --force-nonempty --execute`) and its keys set again. A member the deploy names
     (`deploy.secrets.grants`, `deploy.secrets.settings`, one `{ member, keys }` or a list of them, `deploy.remote.sealed`)
     is renamed there in the same change, and each key's `secrets:` entry names its new member.
  5. `starci app secret set --env <env> <provider> <KEY>...` seals the provider's keys and declares them.
  6. `starci app secret verify --env <env>` opens every member and checks the shapes the app reads; `audit` is clean.
  7. Commit the members, `.sops.yaml`, `.gitignore` and `application-stacks.yaml` together.
- **Moving an environment to the recipient policy.** A deployed environment's members are resealed where its key lives, never on a dev
  machine: on the server with the server key (`sops rotate --in-place --rm-age <old> --add-age <backup>`, which also makes a new data key, so
  an old envelope in git and a removed key open nothing new; no plaintext on disk, as root or through the harness's server verbs), or in the break-glass workflow with the backup key. The
  resealed files come back into the repository, tracked, through a PR, and a dev machine verifies them by their recipient list alone
  (R451 `HFS_SOPS_MEMBER_RECIPIENTS`). Every value that was ever sealed to a dev-side key is rotated on the server first (new value,
  applied to the running service, sealed to the server key and the backup), each rotation armed by the owner's yes.
- **Plaintext never enters the tree.** A decrypted member reaches a process through `*_FILE` from host-local custody
  (the `goesTo` of slot `app.plaintext-env`) or memory, never a file in the checkout, ignored or not. Each
  environment's `.gitignore` still ignores everything under `secrets/` except its sealed members, so a mistaken decrypt cannot be
  committed.
- **Never printed.** No agent opens, decrypts, echoes or logs a secret; a member is judged by its name
  ([contexts/harness/rules.md](../harness/rules.md) hard rule 1, `neverRead` in [policy/security.yaml](../../policy/security.yaml)).
  Logs keep tokens, prompts and decrypted values out.
- **Dev values are created once, by the owner's yes.** `starci app secret init --env <dev env> [--execute]` creates the dev-only values the
  environment's `local.custody` declares (hex, base64, password, uuid, RSA or EC key pairs), seals them like any member, declares their keys and
  keeps every value that is already sealed; it refuses a vps or production environment and a half-present pair. `up` and `prepare` open the
  members into private files outside the checkout; a machine that holds no identity the members are sealed to is refused with the owner step to
  obtain it.
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
[policy/quality.yaml](../../policy/quality.yaml)).

**The dev kind is a verb set.** For a docker-compose environment the seven operations are `starci app stack prepare|doctor|up|status|logs|down|verify
--env <env>`, driven by the environment's `local` block of `application-stacks.yaml` (R372: ports, compose services, the environment's own database
role, dev-only custody to generate, setup and seed commands, native processes, readiness and verification probes). `prepare`, `up` and `down` are dry
runs until `--execute`; `doctor`, `status`, `logs` and `verify` are read-only. **`up` is the one command**: it checks the host table, opens the dev
custody, runs the setup (install, codegen), starts the compose services under the heavy-command governor (the app's dev compose runs its database, Mailpit, the `mail` sink the sign-in mails reach on loopback, its web UI an origin, and
MinIO, the `storage` object store whose root credentials are the dev `storage` member's keys and whose console is an origin; the store is built from the managed `.starcistacks/images/storage/Dockerfile` and loads the repo-owned `statics/` into its bucket, [statics.md](statics.md) PROJECT-STATICS-2) with `docker compose up --build` (a changed build input rebuilds, cached otherwise) and waits for their health, gives the
environment its own database role and the app role its own password, migrates with a receipt, applies the seed levels with their receipts (PROJECT-STACKS-12), runs the declared seed commands once per set of volumes (a receipt holds the volumes' names and creation times, so a wiped stack seeds again; a command declared `mode: always`, a migration runner idempotent by its own ledger such as TypeORM's, runs on every up, so a new migration reaches an existing stack, and runs right after `db migrate`, before the seed levels and the loader of the pinned seed-standards, whose doors write into the tables it creates), starts the native
processes, waits for readiness and prints the origins. An agent never runs Docker by hand ([harness/rules.md](../harness/rules.md) hard rule 8);
**A native process runs built, not watched.** A process may declare `serve: {build: {argv, cwd?}, argv, cwd?}`: `up` and `restart`
run its `build` (the governor's build class, with the process's non-secret env and no custody file) and then its `serve.argv`, the built
artifact (`next start`, `node dist/...`), so code merged on dev is never hot-reloaded half written. The process's own `argv` (`next dev`,
`ts-node-dev`) runs only with `--watch`, the explicit opt-in for live coding; a process without `serve` runs its `argv` either way. `starci app
stack restart --env <env> --process <name>[,<name>] [--watch] --execute` ends only those processes (only the ones this environment started),
builds and starts them, and waits for their health probe on the loopback and, when the dev tunnel routes their port, over the tunnel
hostname; the compose services, volumes, custody files and tunnel stay up. `STACK_LOCAL_NOT_UP` refuses an environment with no running
process. `starci dev sync` runs it ([cicd.md](cicd.md) "Dev and prod").
the runbook of a docker-compose environment names `starci app stack up --env <env>` and carries no docker command (R373). `down` ends the processes
and stops the compose project, never a volume, image or another project. A vps environment keeps the Swarm verbs below; `up`, `down`, `doctor` and
`logs` refuse it.

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
| CI execution credential | the CI workflows | the CI provider's secret store, repository or environment scope; a project service copy explicitly links its sealed source |
| CI public config | the CI workflows | the CI provider's variables, repository or environment scope |
| dependency-bot secret | the dependency bot | its own secret store |

A name is upper snake case, never in the CI provider's reserved prefix, and declared once across the classes; an
environment-scoped name names its environment; a variable whose value only the owner may give is declared as such and
set from standard input, never argv. A project service credential has one retrievable source in its product's sealed
custody and one explicitly linked execution copy in the CI provider: `services.<id>.ci.secrets[]` names the CI secret and
its `credential` id, while `ci.token` selects that same analysis copy. `starci app ci secret set <NAME> --from-custody`
judges the binding without decrypting or contacting the provider; `--execute` opens the selected key in memory and sends
it on the provider tool's stdin. Custody input requires terminal or closed/null stdin: a pipe or file is refused as a
competing input channel without reading it, even when empty. A same-named key in another project is
unrelated; a missing, ambiguous or unopenable member is a failure, with no global token fallback. An app runtime key
never reaches CI; sealed tooling classification requires the exact service, project, environment, member and key
binding (R296, R297). Every workflow reference is declared and every required declaration read (R298).
The decryption identity CI holds is each environment's server key, as SOPS_AGE_KEY of that GitHub Environment
(PROJECT-STACKS-5), never the owner key and no repository-level SOPS_AGE_KEY. Every job that reads SOPS_AGE_KEY is bound to the
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

The connection profile lives in this product's manifest: provider, mode, project keys and public local/hosted URLs.
A private URL is `host.fromCredential`, referencing a sealed URL key; username and password each have a credential
reference with their actual `key` and `custody: { repository, path }`. The path names the actual
`.starcistacks/<declared-env>/secrets/<provider>.enc.yaml` member, sealed to that environment's recipients; no plaintext
twin is declared. Required product Sonar analysis uses exactly `sonar.enc.yaml` in that environment's secrets folder;
an absent member or a reference to another basename fails. Local and cloud connections use the same profile shape. Operator/admin login credentials occupy a
separate authority member from the project's analysis token. A scanner and its CI copy select the analysis credential
only; stored username/password metadata grants no scanner, CI or provisioning authority. A private endpoint's CI copy
has its own `ci.secrets` credential link selected by `ci.hostVar`; the managed workflow reads that selector from secrets,
while a public endpoint selector reads variables. A missing endpoint fails before the scanner starts.

A project credential's `project` references its `projects[].key`; the credential `id` is just its reference name, with
no relationship to provider project-key syntax. Execution selects the project entry by the actual consumer repository,
then follows the explicit credential and exact member/key. A host-owned server supplies public endpoint settings,
never a fallback analysis or administrator identity. The native local release opens the selected product token in
memory and gives it to its scanner child alone; an explicit CI job token remains its execution copy. Quality jobs need
no age identity. Missing custody fails without creating a project, replacing history or rotating a credential.

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

- **Through the ingress.** The person and the `audit` worker open the app at the dev ingress origin
  (PROJECT-STACKS-4); a dev environment whose app processes run natively declares no compose ingress, and the origin `up` prints (the web
  process on its loopback port) is that origin.
- **Bind Next to `localhost`.** A Next dev server started with `-H 127.0.0.1` normalizes its own host to `localhost`
  and loops on locale redirects. The dev server binds `localhost` (its default); the 127.0.0.1 address belongs to
  the ingress in front of it.
- **Caches outside the tree, where the host allows.** Tool caches live outside the repository (slot `app.tool-cache`
  names the location). A Windows host may refuse the SWC cache under AppData; the dev runbook then names a writable
  cache directory outside the repository rather than letting the cache fall back into the checkout.
- **A clean checkout runs its setup.** Generated code is never committed (SHARED-SCRIPTS-2), so `prepare` and `up` run the
  project's setup commands (`local.setup`: the install, then codegen), the same ones a task contract carries in `context.setup`
  ([README.md](README.md) "Life cycle of a piece of work").
- **A new machine.** `starci app stack doctor --env dev` prints one row per prerequisite, read-only: Node at the version of `.nvmrc` or
  `engines.node`, npm, git, Docker running Linux containers with Compose v2, WSL2 on Windows, sops and age when sealed dev members exist, free
  disk and memory against `local.resources`, and every declared port free (a holder is named). Each missing row carries the exact owner-run step
  for the OS (winget, brew or apt). The harness installs no host tool: installing software and Docker Desktop is the owner's action (hard rule 5),
  and an agent runs no Docker or package manager by hand (hard rule 8), so the doctor prints the commands and `up` refuses a machine that fails
  the table before any effect. On a fresh clone `up --execute` then needs nothing but the identity: the owner obtains the age identity of the
  environment into the harness secret.env, or, when the app has no dev values yet, arms `secret init --env dev --execute` once.
- **One base port per app: every dev host port, native or compose, derives from it.** The host ports of every app's dev environment derive
  from one project base port, `environments.<env>.local.basePort`, so two apps run side by side on one machine (R389). The app owns `basePort`
  to `basePort + 99`: the native processes (a process with a `port`; its role is its name) below base + 80, the compose services (a port of
  `local.ports` no native process holds; its role is the port's name) from base + 80, by the role table:

  | role | process or port names | port |
  |---|---|---|
  | primary front end (the first process of the role) | `web`, `app`, `console`, `fe`, `frontend` | base |
  | api (the first) | `api`, `core`, `be`, `backend` | base + 1 |
  | AI gateway (the first; the api port + 1 of the ai-router convention) | `gateway`, `ai-gateway`, `ai-router` | base + 2 |
  | every other native process (mcp, landing, a further next app, a worker with a port) | any other name, and a second process of a role above | base + 3 to base + 79; base + 2 to base + 79 when no gateway runs |
  | database (compose) | the port `local.database` names | base + 90 |
  | mail sink SMTP, mail sink web UI (compose) | `mail`, `mailui` | base + 91, base + 92 |
  | object store S3 API, object store console (compose) | `storage`, `storage-console` | base + 93, base + 94 |
  | every other compose service (a cache, a vector store, an identity server, an ingress) | any other port name | a free port of base + 80 to base + 99 |

  A role no process or service plays leaves its slot empty, and base and base + 1 stay reserved for the front end and the api either way; base + 2
  is reserved for the gateway only while a gateway runs, so an app without one (front end, api, landing) puts its landing at base + 2.
  The range 3900 to 3999 is reserved for the shared UI-lane `next dev` preview, which runs outside any app's stack: no app's `basePort` range may overlap it,
  and port 9000 belongs to the host's shared analysis server, which no app's dev environment takes.
  The screenshot gallery ([gallery.md](gallery.md) PROJECT-GALLERY-1) is a native process on base + 50, started by `stack up` next to the others.
  A compose file of an environment with a base publishes every host port from `local.ports`, `127.0.0.1:${STACK_PORT_<NAME>}:<container port>`,
  never a literal port, which the base cannot move. A native process off the table is `STACKS_BASE_PORT_ROLE`, a compose port of a role off
  its slot `STACKS_COMPOSE_PORT_ROLE`, a literal host port in a compose file `STACKS_COMPOSE_PORT_LITERAL` (errors); the slot of another compose
  service is not judged yet. An app with native processes on ports and no `basePort` gets `STACKS_BASE_PORT_UNDECLARED`, a warning
  that asks it to declare one. `starci app sync --execute` brings an existing app to the table: it moves the database, `mail` and `mailui` ports
  of each environment with a base to their slots (a slot another port holds stays, named) and gives an environment that runs no object store
  the `storage` service with its ports, its grant of the `storage` member's keys, its readiness probe and its console origin, pointing the api's
  `STORAGE_ENDPOINT` at it (`sync/dev-services.mts` of `@starci/hfs`). 
  **Each project owns its own hundred.** No two projects of one machine share a port of `base` to `base + 99`: one project takes 3000,
  the next 3100, a third 3200, and so on (the numbers are examples; the hundred is the project's, whatever it is). The projects of the
  machine are the registered ones: the `ledgers` of every machine registry the CLI sees (its state base's `machine.sqlite` and, unless
  `STARCI_LOCAL_ROOT` pins one store, the harness home's `.runtime/machine.sqlite`, since an app's installed CLI keeps a state base of its
  own), each read from its registered checkout and every worktree of it (lanes included) for the environment of the same name; a project
  that declares no `basePort` holds the ports its `local.ports` declares. `starci app stack doctor --env <env>` prints the `base port` row
  (the role table) and a `port range` row that names every project it compared with its base (or its ports), the registries it read and
  every checkout it could not read, and fails, with the next free base, when this app's hundred overlaps another project's, or the reserved
  range (a `port range reserved` row). `starci app scaffold` checks the same projects: without `--base-port` it takes the name's base, or the
  next free hundred of 3000 to 4900 when another project holds it, and says which; `--base-port <n>` that overlaps another project is
  refused `HFS_SCAFFOLD_BASE_PORT_TAKEN` with the next free base. `starci app stack up --env <env>` (dry run and `--execute`) refuses an
  overlap before it starts anything, `STACK_LOCAL_BASE_PORT_TAKEN`, naming the other project and the next free base. `starci app check
  --env local` reports it as `STACK_BASE_PORT_OVERLAP`, a warning, report-only: the overlap is a relation of two checkouts of one machine
  that either may resolve, CI has no machine registry to compare (`--env prod` never asks), and `stack up`, the command that would collide,
  is where it blocks. The authority is `scripts/hfs/stack-base-port.mjs` (the table) and
  `stack/local-peers.mjs` (the projects) of `@starci/hfs`.
- **A green check judges the running stack too.** `starci app check --env local` (the default, the fix-loop run; `--env prod` never asks, since CI has no dev stack) reads
  the live dev environment after the tree checks, for each docker-compose environment that declares a `local.database`, with two read-only checks that are never cached
  and say nothing when the stack is not up (one line says why):
  - `pending-migrations` (`STACK_PENDING_MIGRATIONS`, error, R393) compares the migration files of the repository (`db/migrations`, or the `database.migrationsDir` of
    `.starcistacks/application-stacks.yaml`) with the history the database recorded (`supabase_migrations.schema_migrations`), through the plan `starci app db migrate` would run, reaching
    the database by `docker exec` in its container with the credentials it holds (no custody is opened). Every unapplied file is named, with the command that applies them,
    `starci app stack up --env <env> --execute`. A file that exists in the repository but not in the database passes every static check and fails at run time.
  - `dead-letter-repeat` (`STACK_DEAD_LETTER_REPEAT`, error, R394) reads the last 24 hours of the environment's API log (`state/stack/<project>/<env>/logs/api.log` under the state base;
    the last 64 MB of it) and fails on every queue or job that has more than one `queue.delivery.dead-lettered` or `event-bus.delivery.dead` line, naming the queue, the job and the last
    error message. A job that dead-letters again and again is a defect no retry fixes (BE-RESILIENCE-2).
  A database that cannot be read is a warning of the same code, never silence. The authority is `stack/local-live-checks.mjs` of `@starci/hfs`.
- **One database per environment.** A dev database is a container of its own compose project, so its roles are this environment's alone: the
  migrations run as the environment's own owner role, the app role the migrations create gets a password of this environment, and neither is a
  role of another environment or server. The client tools of `db migrate` run inside that container (`STARCI_DB_CONTAINER`), so the host needs no
  PostgreSQL client.

## PROJECT-STACKS-11 A customised service is an image the app builds, the same in every environment

A service the app customises (wrapper scripts, plugins, configuration code) is built from the app's own image folder
`.starcistacks/images/<name>/` whose Dockerfile starts every `FROM` at a digest-pinned base; when the harness owns a StarCi
fork image for that service ([images/README.md](../../images/README.md), `images/sources.json`) the final stage is `FROM` that
fork image and the app only adds its own files. No stack or compose file bind-mounts code, plugins or scripts into a service container. The line: allowed are a named
volume, a secret or config grant, a bind under the data root (`${data}` or `STACK_DATA_DIR`), the Docker socket read-only and a
read-only plain data file (json, yaml, toml, conf, ini, properties, txt, pem, crt, csv); every other bind is refused. Dev and
production run the same image of the service: a compose service builds from `images/<name>` and a stack service names the
project's own or a variable image reference, never a literal upstream image beside the folder.

Why: code mounted at run time is a second, unreviewed build whose bytes the image digest does not name, and a service that
differs between dev and production proves nothing about production.

Enforced by: R374 (`stacks-service-images`: `STACKS_CODE_BIND_MOUNT`, `STACKS_IMAGE_BASE_UNPINNED`, `STACKS_IMAGE_BASE_NOT_FORK`,
`STACKS_IMAGE_ENV_DIVERGES`); the fork list is `runtime/knowledge/hfs/fork-images.yaml`, held equal to `images/sources.json` by
`stacks-service-images.spec.mts`.

## PROJECT-STACKS-12 Seed data lives in the seed levels of the stack

The data an app seeds lives in two levels of `.starcistacks/`, tracked, one structure at each level:

- `.starcistacks/seeds/`, the shared level, applied in every environment and first: plans, the first-party catalogue, module definitions.
- `.starcistacks/<env>/seeds/`, applied in that environment only, after the shared level: synthetic accounts, sample workspaces and demo
  data in the dev environment, a production's initial configuration in its own; the business's own records never, they live in the data
  copies (PROJECT-STACKS-13). `<env>` is an environment name `application-stacks.yaml` declares,
  exactly as declared; `seeds` and `cache` are no environment names.

Each level is a manifest, `seeds.yaml` (schema `starci/seeds@1`), and the folders `sql/`, `data/` and `files/`. The manifest lists every file
of those folders, one entry each `{ id, kind, path, target, mode, after?, schema?, reason?, probe? }` (`packages/hfs/runtime/scripts/hfs/stack-seeds-config.mts`):

- `kind: sql`: idempotent DML (`insert ... on conflict`, an upsert) on the database `target` names; never a statement that changes the schema
  or its grants, which is a migration's (BE-PERSISTENCE-1).
- `kind: data`: a JSON or YAML document, or a folder of them, that the app command `target` (an argv list) loads; it validates against the
  JSON schema the app declares at `schema` (app-root relative). The app owns the meaning, the harness the order, the receipt and the validation.
- `kind: test-account`: the one data entry of an environment's level that declares a test account (its owner login, a test workspace and
  the product's own connector test credentials, never a customer's), with the `reason` it exists; the shared level declares none.
- `kind: files`: assets for the bucket `target` names, each keyed by its path.
- `mode` says how an entry learns that its target drifted: `once` applies it a single time; `upsert` (the default for an expensive seed)
  again whenever its content hash changes, or, when it declares a `probe` (the argv of an app command that exits non-zero on drift, given
  the input the entry's command gets), whenever the probe finds drift the hash cannot see; `always` on every run, for an idempotent, cheap
  command that answers `unchanged` or `restored` on its last output line. A files entry takes neither `always` nor a probe, and a probe
  belongs to an upsert entry only. `after` names the entries of the level, or of the shared level, it follows. The apply order is the migrations, then the shared level, then the environment's, each in manifest order
  with `after` respected.

A seed never holds a secret. A document names one as a reference, `{ "secret": "seeds-<name>" }`, to a member sealed for that environment
at `.starcistacks/<env>/secrets/seeds-<name>.enc.yaml` with the environment's own recipients (PROJECT-STACKS-5); the shared level's
references need the member in every environment. The test account's login password is such a member too: the seed sets it, nobody types
it. Identities are synthetic (`HFS_SEED_PII`), and a level a production environment applies (the shared level, and the level of every
environment that is not docker-compose) holds no test data (no example.test identity, no uat- or test- prefix) but in its one
test-account entry.

A new app is scaffolded with the three levels, each an empty manifest and a `.gitkeep` in each kind folder. `starci app codemod
seeds-layout` moves an older app's `db/seed.sql` to the shared level's `sql/reference.sql` and each loose SQL file of `<env>/seeds/` into
that level's `sql/`, declares them, completes every level and leaves a conflict, a loose seed that is no SQL and a source that names an
old seed home for a person. `starci app db baseline --squash --seed-tables` writes its reference rows as the shared entry `reference`.

Why: one structure per level puts seed data beside the environment that applies it, keeps it apart from schema and custody, and lets the
harness order, validate and judge every seed while the app keeps what the data means.

**The seed step** (`packages/hfs/stack/seeds.mts`) applies both levels on the database the migrations ran on, under their role. It keeps
its receipts in that database, `public.starci_seed_receipts` (scope, id, content hash, the referenced members with a digest of their
values, environment, the outcome of the last run, time), a table the step creates and no app migration owns: a `once` entry with a receipt
never runs again, an `upsert` entry runs again when its content or a referenced secret changed or its probe exits non-zero (the probe
alone never touches the receipt), an `always` entry runs every time, and a rerun with nothing changed and no drift applies nothing. The
outcome is what the command answered on its last output line, `unchanged` or `restored`, else `applied`; the rest of its output is
withheld, never printed or stored. A `sql`
entry runs in one transaction with its receipt. A `data` or `test-account` entry validates its documents, opens each secret reference in
memory with the environment's age identity and hands the resolved documents to its app command on stdin; no opened value reaches a file,
argv, a log or a receipt, and a failing command's or probe's output is withheld except its error lines, redacted (`STACK_SEED_COMMAND`, `STACK_SEED_PROBE` for a probe that cannot run; PROJECT-STACKS-16). A `files` entry is validated only: the harness has no
object-storage client, so the upload stays the app's. `starci app stack up` runs the step after the migrations; a deploy, urgent or not, runs it after
convergence (so a data command is the new release's), its app commands and probes in a task of the jobs service, and its dry run
names every entry, each applied unless its receipt holds; a dry run runs no probe. The scaffold's `cli seed run` still applies the `sql/` folders of the shared level and then
the environment's for a manual run.

Enforced by: R375 (`seeds-shape`: `HFS_SEEDS_SHAPE`), R06
(a plaintext secret on any tracked line), R259 (`HFS_SEED_PII` over the SQL and the JSON and YAML data), R332 (no SQL under `db/` but
migrations, the archive and the bootstrap); the scaffold and the codemod by `hfs-seeds-shape.spec.mts` and `seeds-layout-codemod.spec.mts`,
the seed step by `stack-seeds.spec.mts` and `stack-local.spec.mts`.

## PROJECT-STACKS-13 Data lives in seed copies: a standard is how a thing is born, a backup is what it became

A project keeps data outside its code in **seed copies**, of exactly two kinds, which share one model (PROJECT-STACKS-14), one layout
and one driver and differ only in who writes them, when they are read and their name:

| kind | what it is | written by | read by | sealed | repository |
|---|---|---|---|---|---|
| `seed-standard` | how an environment is born: curated reference and foundation data | a person (reviewed, committed, pinned by commit) | the bring-up's seed step, ONCE (PROJECT-STACKS-12 receipts) | never: plain, readable, diffable | `<name>-seed-standard` |
| `seed-backup` | the snapshot of what one environment has become | only that environment's scheduled backup job | only an explicit `starci app data sync` into the SAME environment; never a bring-up | always, to that environment's recipients | `<name>-seed-backup-<env>` (`<env>` = the environment's short name, else its name) |

**The naming law.** A copy repository is `<name>-seed-standard` or `<name>-seed-backup-<env>`, private, where `<name>` is the
project `hfs.json` names or a name the project's own extension defines, and `<env>` the label of an environment `application-stacks.yaml` declares:
the `short` the environment declares (lowercase kebab, at most 12 characters, unique across the environments), else its name; `{env}` in a repository
template becomes that label (an environment `production` with `short: prod` keeps `<name>-seed-backup-prod`). The names stay literal: the harness
never shortens or renames one. The suffix states the kind and the manifest's `purpose` agrees with it. One environment's backup is one repository: its readers are the
holders of that environment's identity, a host of another environment never clones it, and the cap is per environment.

**A standard is loaded once and keeps relations.** The seed step applies a `seed-standard` the first time an environment is brought up
and records a receipt (data set, pinned commit, manifest digest, time) in `public.starci_seed_receipts`; every later bring-up skips the
set whole. A changed pin is reported (`DATA_STANDARD_CHANGED`) and never applied by itself. Only `force: true`, declared on that data set
in `application-stacks.yaml` and nowhere else (no CLI flag, no variable), re-seeds, once per pinned commit (the receipt records the
forced commit, so the same stack text never re-seeds twice). A re-seed is an upsert by natural key: a row keeps its identity and is
updated in place, never deleted and re-created; a thing the standard no longer names is reported and left; data the standard does
not carry is never overwritten. A project-level standard holds no secret at all: its layout has no sealed file and no place for a
credential; the project's secrets stay in its stack custody (PROJECT-STACKS-5).

**A backup is per environment, sealed, and comes back only by a sync.** Each environment that declares a `seed-backup` has its own
scheduled job on the outbox + job frame of the back end (a tick enqueues one job per due set and slot, BE-JOBS-6, BE-JOBS-9) that
exports the stores once, skips when the manifest digest equals the newest copy's (no change, no commit), and writes the one export to
every destination; a configuration refusal (a copy past its cap) dead-letters with one item for a person, and a failed destination
leaves the others written and raises one item (BE-JOBS-7). A verify job restores the newest copy into an isolated scratch store and
compares digests. The whole relational database is copied by the per-table store of `@starci/seed/postgres` (data only, rows in byte order of their primary key, one consistent snapshot; the schema comes from the migrations), which connects as the environment's OWNER role, never by widening the app role: in a dev environment a process lists `DATABASE_OWNER_URL` in its `files` and `stack up` writes the owner connection to `DATABASE_OWNER_URL_FILE` from custody; in a swarm environment it is a sealed member granted to that one consumer. A sync is the only act that seeds from a backup: it names the snapshot, runs dry first, refuses a snapshot of another
environment (`DATA_SYNC_OTHER_ENVIRONMENT`), and refuses a non-empty target without a verified backup of that target younger than the
declared age (the reset rule of PROJECT-STACKS-6). Turning a backup into a standard is a person's review in a standard's checkout,
never a command. A secret a store keeps sealed by the app's own key travels still sealed, so a backup restores only where that key is
held; a sync that finds another key refuses with a typed reason instead of re-sealing by guess.

**What a copy repository holds** (the `git` driver, `@starci/seed/git`): `manifest.json` (schema `starci/data-manifest@1`:
the sets with counts and digests, the file index, the shard widths, the sealing and its public recipients; no value), record shards
`data/<store>/<set>/<shard>.json`, object chunks `blobs/<store>/<set>/<aa>/<id>[.<n>].bin` and `index/<store>/<set>.json`. In a
backup every one of them is a sops envelope (`*.sops.json`, binary mode, age) to the environment's recipients; in a standard none is.
Binaries are allowed only as these chunk entries, never as a loose file. No file exceeds 4 MiB (GitHub warns over 50 MiB and blocks
over 100 MiB); the whole snapshot (the data files of the working tree, history not counted) is at most 500 MiB, warned past 400 MiB;
past the cap the driver refuses (`DATA_GIT_CAP_EXCEEDED`): the data set has outgrown git and needs the `s3` driver. Git keeps each
changed sealed file whole in its history (sealed bytes do not delta); when a backup repository's pack passes 2 GiB its owner re-roots the
branch. No application code, no plaintext export, no private key.

**A standard may carry raw/ and an adapter.** There is one standard layout for every project. A project whose content is awkward to author
as JSON records (lessons, articles, prompts written as Markdown, a catalogue kept as YAML, images) keeps that material inside its standard
repository and converts it there; the committed layout above stays exactly as it is, and the bring-up never sees the difference:

| path | holds | written by | rules |
|---|---|---|---|
| `manifest.json`, `data/<store>/<set>/*.json`, `blobs/`, `index/` | the standard, as every standard holds it | the adapter, through the git driver; never by hand | R400; R434 |
| `raw/` | what people author: Markdown, YAML, code, images, any layout the adapter reads | people, reviewed and committed | plain, never sealed, 4 MiB a file, counted in the 500 MiB (R400) |
| `adapter/` | `main.ts`, `convert.ts`, `package.json` (pins `@starci/seed`, lockfile committed), `tsconfig.json` | people | R434 |
| `.githooks/pre-commit`, `.github/workflows/seed-standard.yml`, `.gitattributes` | the guard: `starci app check --staged` on every commit and in CI | `starci data standard init` | R434 |

`data/` stays the record shards only; that is why the authored folder is `raw/`.

The adapter contract (`@starci/seed/git`): `adapter/convert.ts` exports `convert(rawDir: string): StandardContent | Promise<StandardContent>`,
`{format, project, entries}`, where `format` is `<repository name>@<major>` and each entry is `{store, entry}` built with `recordEntry` or
`blobEntry` of `@starci/seed`, its store a store id of the app's `data.stores`. `adapter/main.ts` is one line,
`process.exitCode = await runStandardAdapter(convert, process.argv.slice(2))`; `node adapter/main.ts` from the repository root (or
`--raw <dir> --out <dir>`) renders the entries through `renderStandard`, the one git driver writing into a scratch working copy, and
replaces `manifest.json`, `data/`, `blobs/` and `index/` with what it wrote. An adapter reads `raw/` and writes nothing itself: no copy
file, no `raw/` file, nothing outside the four outputs. Its output is deterministic: the driver orders sets and keys and writes canonical
JSON, `renderStandard` fixes `takenAt` (`1970-01-01T00:00:00.000Z`: a standard is identified by its commit, never by a time) and
`source.environment` (`standard`), and the adapter brings no clock, random id or file-system order into an entry (sort what `readdirSync`
answers). A repeated key or a set mixing records and blobs is refused by the manifest builder.

The guard. The commit hook and CI run the adapter twice over `raw/` as the index holds it and compare what it writes, by git blob id, with
the committed `manifest.json`, `data/`, `blobs/` and `index/`; a run that fails, two runs that differ (a non-deterministic adapter), a
hand edit of `data/`, `raw/` committed without its output and an `adapter/` change left unstaged are HFS_DATA_ADAPTER_DRIFT. The adapter, and the git and npm
the bring-up gate runs in its scratch checkout, run without the caller's `GIT_*` variables: under a hook they would point the scratch git
of `renderStandard` at the user's repository. An adapter
repository without its entry, its package, the hook or the workflow is HFS_DATA_ADAPTER_DRIFT. `starci data standard init [--adapter]
[--dir <folder>] [--name <name>-seed-standard] [--force]` writes the guard, `.gitattributes`, an empty plain manifest (byte for byte what the driver renders for no entry)
and, with `--adapter`, `raw/README.md` and a compiling `adapter/` stub, and sets `core.hooksPath` to `.githooks`; a file a person changed is
kept unless `--force`. The folder is named `<name>-seed-standard`; a repository converted in place during its rename passes `--name`, which is
validated instead of the folder. Then `npm install --prefix adapter` and commit `adapter/package-lock.json` (CI installs with `npm ci`).

A worked example: lessons written as Markdown, with their images.

```
shop-seed-standard/
  raw/lessons/01-welcome.md          # "# Welcome" then the body; ![cover](images/welcome.png)
  raw/lessons/images/welcome.png
  adapter/convert.ts
```

```ts
export function convert(rawDir: string): StandardContent {
    const dir = join(rawDir, "lessons")
    const entries: StoredEntry[] = []
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".md")).sort()) {
        const text = readFileSync(join(dir, file), "utf8")
        const images = [...text.matchAll(/!\[[^\]]*\]\(images\/([^)]+)\)/gu)].map((match) => `lessons/${match[1]}`)
        entries.push({ store: "database", entry: recordEntry("lessons", file.slice(0, -3), { title: /^# (.+)$/mu.exec(text)?.[1] ?? file, body: text, images }) })
    }
    for (const image of readdirSync(join(dir, "images")).sort())
        entries.push({ store: "storage", entry: blobEntry("lesson-images", `lessons/${image}`, readFileSync(join(dir, "images", image)), "image/png") })
    return { format: "shop-seed-standard@1", project: "shop", entries }
}
```

`node adapter/main.ts` writes `data/database/lessons/all.json` (one record per lesson, keyed `01-welcome`, its images named by their bucket
key), `blobs/storage/lesson-images/<aa>/<id>.bin` and `index/storage/lesson-images.json`, and the manifest that lists them; the bring-up
upserts the lessons into the `database` store and the images into the `storage` store by those keys.

**One path in.** A standard reaches an app only through the bring-up's seed step at the commit `data.sets` pins, an upsert by natural key with
`force` once per pin. Before any entry of the seed levels applies, the seed step reads each pinned seed-standard of the environment (a git
destination, no project `completeness`) through `pinRepository` into the harness's cache and, when the pinned commit carries `adapter/`,
installs it from its lockfile in a scratch checkout and runs the same drift check; a pin whose output drifts, or that cannot be read, is
refused STACK_SEED_ADAPTER_DRIFT and nothing is seeded (an `npm ci` of its adapter that fails is STACK_SEED_ADAPTER_INSTALL, a checkout that fails STACK_SEED_STANDARD_UNREADABLE). A verified pin is recorded in the seed receipts (scope `standard`, the set's id, the
commit), so each pin is verified once. Then the loader below applies it. No app reads a standard any other way: no git clone, pull or fetch of a
`-seed-standard` repository, no content-sync command, no environment variable naming one. The one path is the loader of the seed step (R435); review holds the convention, no check guesses at the ways around it.

**The loader** (`packages/hfs/stack/standard-load.mts`, called by `seedStep` of `stack/seeds.mts` after the gate and before the levels: a
standard is how the environment is born). Per pin of the environment, in declaration order:

1. **Receipt.** One receipt per (standard, commit) in `public.starci_seed_receipts`: scope `standard`, id `<set>@<commit>`, hash the manifest's
   export digest, the outcome (`applied` or `unchanged`, `forced` before it on a forced pin), the environment and the time. A receipt for the
   pinned commit skips the pin (`kept`) and no door runs. No receipt for the set at all is the first bring-up: the pin applies. A receipt for
   another commit is a changed pin: it is reported `DATA_STANDARD_CHANGED` and left, unless the set declares `force: true`; then it applies
   once and its own receipt holds it, so the same stack text never re-seeds twice.
2. **Read.** `pinRepository` fetches the pin into the same bare mirror the gate filled, and the git driver of `@starci/seed` over that mirror
   verifies the commit (manifest `starci/data-manifest@1`, plain sealing, the file index, the cap and every set's digest) and reads its
   `data/<store>/<set>/*.json` records and `blobs/` chunks into entries. A pin that cannot be fetched is STACK_SEED_STANDARD_UNREADABLE; a copy that
   does not verify, is no `seed-standard` or fills a store the set's `stores` do not list is STACK_SEED_STANDARD_SCHEMA.
3. **Doors.** Each store the copy fills is reached through its seed door: the store's `adapter.command` (PROJECT-STACKS-14), served with
   `serveStore` over `starci/data-entries@1` and run by the seed step's own runner (from the app root in the api's environment on a dev stack, in a
   task of the jobs service on a deploy). A store with no command, or none in `data.stores`, is STACK_SEED_STORE_COMMAND.
4. **Dry run, then apply.** `restoreFrom` first imports every store with `{dryRun: true, mode: mirror}`: nothing is written, a refused key
   refuses the pin before any record applies, and the mirror's `removed` count is what the standard no longer names. Then `{dryRun: false,
   mode: merge}`: an upsert by natural key that keeps each row's identity and removes nothing; what the standard no longer names is reported
   and left. A door that exits non-zero (its output withheld), answers no ImportReport or refuses a key is STACK_SEED_DOOR_REFUSED.
5. **Receipt last.** The receipt is written only after every store of the pin applied. A refusal at any step writes none, so the next
   bring-up applies the pin again, which an upsert by natural key makes safe. Pins before a refused one keep their receipts.

A set with `completeness: ext:<check>` is the project's: the loader names it (`left to the project`) and reads nothing. A dry run plans each pin
from the receipts and opens no door.

A worked example: the set `lessons` of an app `shop` fills `database` and `storage`, each store declaring its door.

```yaml
data:
  stores:
    - {id: database, kind: database, level: logical, component: db, adapter: {module: be/src/modules/integrations/seed/database.adapter.ts, command: [npx, shop, data, database]}}
    - {id: storage, kind: storage, level: logical, component: minio, adapter: {module: be/src/modules/integrations/seed/storage.adapter.ts, command: [npx, shop, data, storage]}}
  sets:
    - {id: lessons, purpose: seed-standard, stores: [database, storage], environments: [dev, production], to: [{driver: git, repository: https://github.com/example/shop-seed-standard}], commit: <A>}
```

```
first bring-up at A    seed standard/lessons: no adapter, the committed standard stands (shop-seed-standard@<A>)
                       seed standard/lessons: applied shop-seed-standard@<A> (lessons: 2 created, 0 updated, 0 unchanged; lesson-images: 1 created, ...)
                       receipt (standard, lessons@<A>, <export digest>, applied)
second bring-up at A   seed standard/lessons: kept (shop-seed-standard@<A> applied before, once per pin)
pin moved to B         seed standard/lessons: DATA_STANDARD_CHANGED: pinned shop-seed-standard@<B>, applied <A>; not re-seeded: ...
B with force: true     seed standard/lessons: applied shop-seed-standard@<B>, forced (DATA_STANDARD_CHANGED from <A>) (lessons: 0 created,
                       1 updated, 0 unchanged; ...; 1 key(s) the standard no longer names left in place)
                       receipt (standard, lessons@<B>, <export digest>, forced applied)
next bring-up at B     seed standard/lessons: kept (shop-seed-standard@<B> applied before, once per pin)
```

Leaving `force: true` on the set is harmless: it re-seeds once per pinned commit, never on every bring-up.

**Code and copies stay apart.** A code project tracks no copy document (a data manifest or a shard) and never depends on a copy
repository (no package dependency, workspace, submodule or path into one).

**A project may define a stricter kind on top.** A data set may declare `completeness: ext:<check id>`, naming a check of the project's
`ext/manifest.json` (PROJECT-LINT-3): the project's own document and layout then live in that repository (for instance plain data plus
one sealed credential file per environment), the harness judges the declaration (name, pin, purpose, the once-and-force rule) and the
project reads the repository through `pinRepository` of `@starci/seed/git`, while the project's check judges what makes the
copy complete.

A repository written in the earlier `<project>-data@<major>` format (an entity file per record type, sealed value by value) is a
`seed-backup` in that format: its owner re-exports it through the driver into `<project>-seed-backup-<env>` and retires it; it is not
renamed in place.

Why: one model for every copy lets the harness prove sealing, size, pins and receipts the same way for every project, while a standard
stays readable for review and a backup stays unreadable to every environment but its own.

**The verbs.** `starci app data <action> --env <env>` (the `starci/app-data@1` verb of `@starci/hfs`; `--json` prints the result; roles owner, release, supervisor)
reads a backup, always through the git driver of `@starci/seed` over a checkout kept under the harness state base, never inside a repository, and always with the
one age identity lookup of the harness (never printed):

| action | does | refuses |
|---|---|---|
| `status [--set <id>]` | read-only: per `seed-backup` set of the environment, its repository and its newest copies with takenAt, export digest, the items per store and the copy's sealed bytes against the 500 MiB cap; a set whose declaration is refused is that set's own line | `DATA_SYNC_PURPOSE`, `DATA_SYNC_OTHER_ENVIRONMENT` for a named set |
| `verify --set <id> [--from <commit>]` | read-only: the driver's full verify of one copy (the newest, or the commit) with the identity: structure, sealing, file index, cap and every digest | `DATA_SYNC_SNAPSHOT_MISSING`, `DATA_SYNC_OTHER_ENVIRONMENT`, `DATA_IDENTITY_MISSING` |
| `sync --set <id> --from <commit> [--execute]` | dry by default: reads the snapshot into the environment's stores, mode `merge` (a key the snapshot lacks is left; no mirror sync is built), and prints per store and set what an import `created`, `updated`, left `unchanged` and `removed`; `--execute` applies it and prints the same counts and a receipt line | below |

A sync refuses, each as a typed refusal (exit 2) and in a dry run too: `DATA_SYNC_PURPOSE` (the set is no `seed-backup`: a standard is never synced), `DATA_SYNC_OTHER_ENVIRONMENT`
(the set does not list this environment, or its repository resolves to another environment's name, or the snapshot's `manifest.source.environment` is another environment's),
`DATA_SYNC_SNAPSHOT_MISSING` (no such commit, or none holding a manifest), `DATA_SYNC_COPY_UNHEALTHY` (the verify fails: nothing is read), `DATA_SYNC_TARGET_UNPROTECTED`
(the target stores hold data and no healthy copy taken in THIS environment, other than the snapshot being synced, is younger than the set's `maxAgeMinutes`, default 1440: the reset
rule of PROJECT-STACKS-6, take a backup first) and `DATA_SYNC_UNREACHABLE` (the stores of a deployed environment are reached from its own host; from a developer machine only a dev
docker-compose environment is synced). The harness reaches a store through its declared `adapter.command` (PROJECT-STACKS-14), run from the app root in the environment's custody;
no value, store error text or identity reaches an output.

Enforced by: R400 (`data-copies`: in a code project `HFS_DATA_IN_CODE`; in a copy repository's commit hook
`HFS_DATA_COPY_INVALID`, raw/ included); R427 (the data sets);
R434 (`data-adapter`, `standard-gate`: `HFS_DATA_ADAPTER_DRIFT`, `STACK_SEED_ADAPTER_DRIFT`, `STACK_SEED_ADAPTER_INSTALL`); R435 (`standard-load`: `STACK_SEED_STANDARD_UNREADABLE`, `STACK_SEED_STANDARD_SCHEMA`, `STACK_SEED_STORE_COMMAND`,
`STACK_SEED_DOOR_REFUSED`); the adapter's render by the specs of `@starci/seed` (`git/standard.spec.ts`), the guard by
`packages/hfs/src/data-adapter.spec.mts`, the loader by `standard-load.spec.mts`, the scaffold by `cli/src/core/data/standard.test.ts`.

## PROJECT-STACKS-14 Every store that must be kept has an adapter; every copy is written through a driver

The model is two closed lists of adapters behind one interface each, owned by `@starci/seed` (every project pins
`@starci/seed`):

- a **store adapter** (`StoreAdapter`) for each thing that must be seeded or backed up, of kind `database` (the relational database)
  or `storage` (the object store, binaries included): it describes its sets and what it cannot do, EXPORTS a deterministic stream of
  entries (set, natural key, body, sha256) in key order, IMPORTS entries as an upsert by natural key that keeps each row's identity
  (`identityOf`), and passes `storeContract` of `@starci/seed/testing` on its fakes;
- a **driver adapter** (`DriverAdapter`) for each place a copy is kept, of kind `git` (now) or `s3` (when a set outgrows git): it
  plans what it holds of an export (a subset names each omitted set), writes, lists, reads and verifies, and passes `driverContract`.

One export goes to every destination of its data set (`writeEverywhere`: each destination an isolated leg, outcome complete, partial
or failed); copies are compared by their manifests (`compareCopies`) and a restore takes the newest healthy one (`chooseCopy`). A new
store kind or driver is a harness change (the type, this rule and R426/R427 together).

A stateful component that is rebuilt from a store (a queue or cache store rebuilt from the database's outbox, a vector index rebuilt by
its reconcile) is declared **derived** with its source and how it is rebuilt, never copied: a copied queue restored beside a restored
database redelivers work that already happened. A derived entry's `from` is optional: a component rebuilt from a source outside the
project (an ingress re-issues its certificates from ACME) declares `rebuild` alone, and a `from` that is present names a declared store.

The declaration, in `application-stacks.yaml` (the smallest example: a project with a database and an object store, no extension):

```yaml
data:
  stores:
    - {id: database, kind: database, level: logical, component: db, adapter: {module: be/src/modules/integrations/seed/database.adapter.ts, command: [npx, shop, data, database]}}
    - {id: storage, kind: storage, level: logical, component: minio, adapter: {module: be/src/modules/integrations/seed/storage.adapter.ts, command: [npx, shop, data, storage]}}
  derived:
    - {component: redis, from: database, rebuild: the relay republishes the outbox}
  sets:
    - id: shop-standard
      purpose: seed-standard
      stores: [database]
      environments: [dev, production]
      to: [{driver: git, repository: https://github.com/example/shop-seed-standard}]
      commit: 0123456789abcdef0123456789abcdef01234567
    - id: shop-backup
      purpose: seed-backup
      stores: [database, storage]
      environments: [dev, production]
      everyMinutes: 1440
      maxAgeMinutes: 1440
      to: [{driver: git, repository: https://github.com/example/shop-seed-backup-{env}}]
```

`commit` and `force` belong to a `seed-standard` only, `everyMinutes` and `maxAgeMinutes` to a `seed-backup` only; `{env}` in a backup's repository is
replaced by each environment's label (its declared `environments.<env>.short`, else its name), and the result ends `-seed-backup-<env>`. A store's adapter `module` is the source file of the class that
implements `StoreAdapter`, or of the factory whose declared return type is `StoreAdapter` (a package store such as `postgresStore`). In a back end
`@starci/seed` is imported only by its one integration, `be/src/modules/integrations/seed/` (slot `be.integrations.seed`,
[code/be/infra.md](../code/be/infra.md) BE-INFRA-1), and every store adapter is registered by a module composed into an app, so it is
reached from the app's root, never named by the declaration alone. An adapter that reads only through platform (the starter's
`DatabaseStore`, a package store) is `integrations/seed/<store>.adapter.ts`, registered by its `DataSeedModule`; one that reads a domain's own
data lives in a domain capability, registered by that capability's module, and takes the port from `@modules/integrations/seed` (an
integration never imports the domain, BE-INFRA-3); its `command` is the argv, from the app root, of the app's own command that serves the store with `serveStore` of `@starci/seed` over the line
protocol `starci/data-entries@1` (`describe`, `export <selection>`, `import <options>` with entry lines on stdin, `identity <set> <key>`), which `starci app data` runs. Every protocol line `serveStore` writes starts with `starci/data-entries@1 ` (@starci/seed 0.3.0), so whatever else the app writes to stdout before or after it (a framework logging at shutdown) is left out; a door that marks no line is read by its JSON object lines. A store
of a `seed-backup` set declares one, and so does a store a `seed-standard` fills (no project `completeness`): that command is the app's **seed door**,
the one way the bring-up's loader writes a standard into the store (PROJECT-STACKS-13, "The loader").

Enforced by: R426 (`data-stores`: `DATA_STORE_INVALID`, including the `command` of a backed-up store and of a store a standard fills) and R427
(`data-sets`: `DATA_SET_INVALID`, `DATA_COPY_NAME`); the ports and the git driver by the specs of `@starci/seed`; the verbs by `packages/hfs/src/data-verb.spec.mts`.

## PROJECT-STACKS-15 An object store a dev environment runs has a public route; links are built on it, never on the loopback

A dev environment runs an S3 object store (MinIO) so an app can keep files and images. A link to one of its objects is followed by a browser, by a
provider that fetches an image (a channel that downloads the picture it is sent) and by a person on another machine, so it must not name the machine
it was written on. Like every public host (PROJECT-STACKS-4 "Hosts are declared once"), its host is declared once, here under `local.tunnel` for dev and under `ingress.routes` for a shared edge, and no stack or config file repeats it. The rule has four parts; each project that runs an object store in a dev environment that publishes anything follows all four.

- **One route, the S3 port only.** The store is declared in `environments.<env>.local.services[]` with `kind: object-store` (its `port` is its S3
  API port; an optional `console` names its admin console port) or is the `component` of a `data.stores[]` of kind `storage`. The dev tunnel that
  already publishes the app (the locally managed named tunnel of the machine, PROJECT-STACKS-10 "Through the ingress") gets one more public host,
  declared once under `local.tunnel`: `{name: <tunnel>, routes: [{name, host, port}]}` where `port` names a declared port. The route to the store
  names its S3 port; no route reaches the admin console, and the console stays on the loopback.
  One more route role: a route named `gallery` with `port: gallery` publishes the screenshot gallery (PROJECT-GALLERY-1 item 4); its port is the derived
  base + 50, never a `local.ports` entry, and it needs `local.basePort`. `starci app sync` renders its host into `server.allowedHosts` of the managed
  `gallery/vite.config.js`, which binds `127.0.0.1`, the address every route's ingress rule reaches; the other routes name declared ports.
- **Two values, never one.** The app receives the internal endpoint for its own writes (`STORAGE_ENDPOINT`, the loopback address, reached from the
  process) and the public base its links are built on (`STORAGE_PUBLIC_URL`, `https://` plus the host of the store's route). The base is the
  `publicEndpoint` option of `@starci/object-storage`: presigned requests are signed for it and `publicUrl` is read from it. Every process that
  sets `STORAGE_ENDPOINT` sets `STORAGE_PUBLIC_URL`.
- **Stored data holds no host.** A file or image reference in a table, a seed, a catalogue or an event is a bucket and a key. The link is built at
  read time from the public base: presigned and expiring for a private bucket, `publicUrl(bucket, key)` only for a bucket the app declares public
  (the picture bucket of its bootstrap). A link that contains `127.0.0.1`, `localhost`, a container name or the S3 port of the machine is a defect
  wherever it is found: in a response, a stored value, a log line meant for a person or a message sent to a provider.
- **The route is made from the declaration.** `starci app stack up --env <env> --execute` adds the declared hosts to the ingress file of the tunnel
  (`~/.cloudflared/<tunnel>.yml`, edited as text: a missing host is inserted before the catch-all rule, nothing else changes, a host already routed
  elsewhere is `STACK_LOCAL_TUNNEL_CONFLICT`) and makes each DNS record with `cloudflared --config <ingress file> tunnel route dns --overwrite-dns <tunnel id> <host>`
  over the machine's `cert.pem`, naming the tunnel's own ingress file and the id its `tunnel:` holds: without `--config` cloudflared reads the
  home's default `config.yml`, whose tunnel wins, and the record lands on another tunnel of the machine. An ingress file with no `tunnel:` is
  `STACK_LOCAL_TUNNEL_CONFIG`, and a record cloudflared reports routed to another tunnel id is `STACK_LOCAL_TUNNEL_DNS` (`STACK_LOCAL_TUNNEL_CERT`
  when the certificate is absent); no dashboard step. The connector of the tunnel
  reads its ingress file when it starts, so `up` says when it must be restarted. `stack up` prints each public origin and reads
  `https://<host>/minio/health/live` once (a wait, never a failure: DNS may need a moment); `stack verify` fails when that read is not 200;
  `stack doctor` has a row for `cloudflared`, the certificate and the ingress file. A dry run prints the plan lines.

```yaml
environments:
  dev:
    runtime: docker-compose
    local:
      ports: {api: 4301, storage: 4393, storage-console: 4394}
      services:
        - {name: storage, wait: tcp, port: storage, kind: object-store, console: storage-console}
      tunnel:
        name: shop-dev
        routes:
          - {name: storage, host: shop-local-files.example.org, port: storage}
      processes:
        - name: api
          argv: [node, dist/main.js]
          port: api
          env:
            STORAGE_ENDPOINT: "http://127.0.0.1:${port.storage}"
            STORAGE_PUBLIC_URL: "https://shop-local-files.example.org"
```

An environment that publishes nothing (no `tunnel`, no process holding a public `https` origin) keeps its loopback links: the rule starts with the first
public origin, because until then nothing outside the machine follows a link. Production is not judged here: its `STORAGE_ENDPOINT` is already a public
host (PROJECT-STACKS-4). The repo-owned statics (`statics/`, [statics.md](statics.md)) are the other public thing in the store: the storage image makes the `statics` prefix of the bucket, and nothing else of it, publicly readable (`mc anonymous set download <bucket>/<prefix>`), so a published object needs no presigned link and the rest of the bucket stays private. The front end reads their base from `NEXT_PUBLIC_STATICS_URL` (the gallery `VITE_STATICS_URL`), `<public storage origin>/<bucket>/<prefix>`; with `local.tunnel` declared a process that sets it names an `https://` route host of the store (`STORAGE_PUBLIC_LINK_INTERNAL`, R428). The sandbox sample images a provider catalogue ships (a placeholder host in a seed) are stored as bucket and key like any
file and served through the same public base; a project that wants a provider to fetch them seeds the files into the bucket.

Enforced by: R428 (`stacks-storage-public`: `STORAGE_PUBLIC_ROUTE_MISSING`, `STORAGE_PUBLIC_ROUTE_CONSOLE`, `STORAGE_PUBLIC_LINK_INTERNAL`, also for the statics base), R440 for the store itself ([statics.md](statics.md)), the shape of
`local.tunnel` and the service fields by R372 (`STACKS_LOCAL_CONFIG_INVALID`), the verbs by `packages/hfs/src/stacks-storage-public.spec.mts`; the stored value and the
read-time link are held by review and by the app's own specs (no rule reads code for a host).

## Read with

[edition.md](edition.md), [statics.md](statics.md); slots `app.starcistacks` and `app.plaintext-env` in
[hfs/slots.yaml](../hfs/slots.yaml); R06, R10, R250 to R253, R266 to R268, R271, R275 to R277, R294, R296 to R299,
R301, R372 to R375, R400, R426 to R428, R438 to R440, R450 in [hfs/rules.yaml](../hfs/rules.yaml).

## PROJECT-STACKS-16 A stack command whose output is withheld still names why it failed

A command the harness runs holds secrets (the seed step opens sealed members for it, a post-deploy task runs where the decrypted
environment is), so its output is never relayed whole. A failure that printed only "its output is withheld" costs the cause: a dev
stack that refused to boot for forty minutes while the one line that said why (a Nest wiring error) sat in the withheld output.

A failed seed command, seed door or post-deploy task prints an **error-only, redacted tail** under its failure line, built by
`runtime/scripts/lib/error-tail.mts`:

- only lines that read as an error survive: an `Error` or `...Exception` line, a stack frame, Nest's "can't resolve dependencies"
  message and its potential solutions, `ERR_*` and `ECONN*` codes; at most 14, from the first;
- every value of the opened secret set is masked first, raw, percent-encoded and JSON-escaped (a seed command: every value of every
  member it opened), then the shared redaction blanks credential URLs, tokens and secret-named pairs;
- an environment dump (`NAME=value`) and every line that is not an error are never printed; a command whose output has no error line prints nothing more.

Known gap: a post-deploy task runs in a container whose secret values the harness never opened, so its tail is filtered by the shared redaction
alone, not by a value list.

Why: the harness holds the secret set at the point of failure, so it can say why a command failed without ever printing a value; the
alternative, relaying the whole output, leaks, and relaying none sends every operator to the container.

Enforced by: `STACK_SEED_COMMAND` and `STACK_SEED_DOOR_REFUSED` carry the tail; held by `packages/hfs/src/stack-seeds.spec.mts` and `hfs-boot-entry.spec.mts`.

## PROJECT-STACKS-17 Monitoring is the server's, opted into per environment

A Swarm environment that wants metrics, logs, probes, traces or profiles declares `environments.<env>.monitoring`. It never runs its own
Prometheus or Grafana: the server's one shared monitoring stack (`starci vps monitor up`, its components toggled in
`ops/vps/monitor/components.yaml`) scrapes and keeps what the block names. An environment without the block renders byte for byte as before.
The block's fields, the labels and sidecars the render adds, the doors and secrets, and why Consul is not part of it are in
[monitoring.md](monitoring.md) (held by `HFS_STACKS_SHAPE` and the render's `STACKS_DEPLOY_CONFIG_INVALID`).

## PROJECT-STACKS-21 Shared services are the server's, opted into per environment

A Swarm environment that calls a service the server shares (the embeddings server first) declares `environments.<env>.services`. It never
runs its own copy: the server's one stack of that service (`starci vps service up <id> --service <name>`, ops/vps/services/<name>/) serves
every opted-in environment, and the render joins each consumer to the service's network, sets its URL and grants the sealed key the service's
gate checks. An environment without the block renders byte for byte as before. A grant source declared `required: false`, and an opt-in not
marked required, renders without its key while the member is not sealed yet (`STACKS_SEALED_MEMBER_PENDING`, report only), so the declaration
can land before the owner seals the key. The block, the catalog, the key's custody and the capacity check are in
[shared-services.md](shared-services.md) (held by `HFS_STACKS_SHAPE` and the render's `STACKS_DEPLOY_CONFIG_INVALID`).

## PROJECT-STACKS-22 One web image per sha; its public config is read at runtime

The owner, 2026-11-21: "1 ảnh chỉnh theo môi trường chứ?" (one image, configured per environment). A front end is built once per commit,
and the same digest goes from staging to production; only its environment differs. Next.js inlines every `process.env.NEXT_PUBLIC_*` read at
build time, so a public URL passed as a build argument ties the image to the environment it was built for. An image entry opts out of that
with `runtimePublicEnv: true`:

```yaml
environments:
  production:
    deploy:
      images:
        web:
          app: web
          runtimePublicEnv: true          # NEXT_PUBLIC_* below reach the service at runtime, not the build
          buildArgs:
            values: {NEXT_PUBLIC_API_URL: "https://api.example.com"}
            sealed: {member: web, keys: [NEXT_PUBLIC_MAPS_KEY]}
```

- **Build.** The NEXT_PUBLIC_* keys of `buildArgs` (literal and sealed) are left out of the build: `starci app stack build-args` prints the
  other keys only, `stack build` passes the same, and images.yml (rendered by sync) builds the image in the public `image` job with no build
  values, no GitHub Environment and no secret when nothing else is left. The image is pushed under `sha-<sha>` on every pushed run, not only
  on a release.
- **Deploy.** The render (`stack render` / `stack deploy`) sets those keys as the service's environment, the sealed ones opened from their
  member like any setting; `deploy.environment.<service>` wins over them for a key both name, and a changed value changes the release's
  `configDigest`. The keys stay declared under `buildArgs`, so R300 (`FE_PUBLIC_BUILD_ARG_MISSING`) still reads them.
- **App.** The server renders an allowlist of `NEXT_PUBLIC_*` keys into `window.__ENV` and the client reads them through one module,
  `createPublicEnv` of `@starci/next-data` ([its README](../../packages/next-data/README.md)); the root layout renders per request, so the
  script carries the runtime environment, not the build's. Only public keys: the allowlist refuses any name that is not `NEXT_PUBLIC_*`, and
  a secret stays a grant (PROJECT-STACKS-5).
- Without the declaration nothing changes: the values are build arguments of the release environment, as before. Apps adopt it in their own
  lanes, each moving its `process.env.NEXT_PUBLIC_*` reads to `publicEnv(key)` first.

## PROJECT-STACKS-18 Moving a stack to new runtime names: standby, copy, adopt

A Swarm stack whose runtime names change (the stack, its volumes, its releases base and so its secrets, overlay and router names) moves in one
maintenance window, and no empty instance answers on the public hosts at any point. The environment declares where it came from, once, in its
`deploy` block:

```yaml
deploy:
  stack: shop-production
  volumes: [shop-production-db-data, shop-production-storage-data, shop-production-redis-data]
  renamedFrom:
    stack: shop-old-production
    releasesBase: /srv/shop-old-production    # default /srv/<stack>
    volumes:                                   # new volume: the old volume its data is copied from
      shop-production-db-data: shop-old-production-db-data
      shop-production-storage-data: shop-old-production-storage-data
```

`renamedFrom.stack` is never the environment's own stack; every new volume is one of `deploy.volumes` and every old one is named once
(`STACKS_DEPLOY_CONFIG_INVALID`; the schema is `HFS_STACKS_SHAPE`). A rebuildable store (a cache) is left out of the map and starts empty. An environment
without `renamedFrom` renders, deploys and journals byte for byte as before. `stack prepare` (and its dry run, the doctor of a Swarm environment) checks both
sides: each old volume exists, each new one exists or is created, the old stack's services and how many still run, and the old releases base names its
last accepted release.

Three verbs carry the move, each a dry run until `--execute` and each executed run one recorded attempt under the deploy lock of the stack it acts on:

- `stack standby --env <env> [--renamed-from] [--timeout <s>] [--execute]` stops the writers (services without a named volume) and waits until none
  runs, then the stores (services that mount one), then sets `traefik.enable=false` on every service that carries the label (the shared edge renders it,
  an external ingress writes it by hand; an own ingress stops with its stack). It records every service's mode, replicas, role and router label in the
  attempt document first. A global service is held by a placement constraint no node carries. `--renamed-from` acts on `renamedFrom.stack`, its
  releases base, lock and journal. Refused when nothing runs (`STACK_STANDBY_ALREADY`). `stack resume` reads the newest standby record back and starts
  the stores, waits until every task runs (a task with a healthcheck is running only once healthy), then the writers, then restores the routes
  (`STACK_RESUME_NO_STANDBY` without a record).
- `stack volume copy --env <env> [--from <v> --to <v>] [--verify] [--execute]` copies each old volume (mounted read-only) into its empty new one with
  `cp -a`, in a throwaway container of the environment's pinned backup image (`deploy.backup.image`, no network), and measures both sides: files, bytes,
  a content digest and a metadata digest (path, type, owner, mode, size, link target). Any difference is `STACK_VOLUME_MISMATCH`; `--verify` also
  measures the source before the copy (`STACK_VOLUME_SOURCE_CHANGED`). Without `--from`/`--to` the pairs are `renamedFrom.volumes`. It is refused
  while a running container or a service with tasks to run mounts either volume (`STACK_VOLUME_IN_USE`; a service in standby does not count), into a
  volume the environment does not declare (`STACK_VOLUME_UNDECLARED`) and into one that is not empty (`STACK_VOLUME_TARGET_NOT_EMPTY`).
  `stack volume verify` measures and compares alone and changes nothing.
- `stack deploy --adopt` (the image form, never `--urgent`) is the first release of the new stack. Before anything changes it proves that the new stack
  has no accepted release, every new volume exists and is filled, the old stack runs nothing and its journal holds that standby, and the old releases
  base names a last accepted release (`STACK_ADOPT_*`). It writes `adoptedFrom` (old stack, its last release, its standby attempt, the volume map) into
  the release record and the attempt journal, deploys the database alone on the copied volume (the hold deploy of a first start), proves it carries a
  migration history (`STACK_ADOPT_NO_HISTORY`), runs the plain database path there (migrate preview, a verified backup when something is pending, the
  expand migrations), then the real deploy, converge, seed, verify, accept and the contract migrations of any deploy.

The rollback target of the adopted release is the old stack's last release, never its stored bytes under the new name: a failed adopted deploy puts the
new stack in standby and resumes the old one from its standby record, and `stack rollback --env <env> --data-acknowledged --execute` does the same later
(`STACK_ROLLBACK_ADOPTED_DATA` without the acknowledgement, since writes made on the new stack stay on its volumes).

The order of one window: `stack prepare --env <env> --execute` beforehand (new volumes and releases base), then `stack backup` of the old declaration,
`stack standby --env <env> --renamed-from --execute`, `stack volume copy --env <env> --verify --execute`, `stack deploy --env <env> --adopt --image ...
--sha ... --execute`, `stack verify --env <env>`. The old stack, its volumes, secrets and release store stay untouched through the hold period;
`renamedFrom` is removed from the declaration when they are retired.

Why: a new stack name has no accepted release, so a plain deploy takes the first start, which refuses a populated database, and the only way around it
exposed a freshly seeded empty instance on the public hosts until the data was swapped in. Standby, copy and adopt keep the old stack the one
rollback target and never let two stacks route the same hosts.

Enforced by: the refusals above (stack/standby.mts, stack/volume.mts, stack/adopt.mts), `STACKS_DEPLOY_CONFIG_INVALID` and `HFS_STACKS_SHAPE` for the
declaration; the rest is held by review.

## PROJECT-STACKS-19 A Postgres major upgrade is a dump and restore into a declared new volume

An app never declares its own Postgres major: the one db image (the managed `.starcistacks/images/db/Dockerfile`, `contexts/stack/pins.yaml`
`postgres`) moves every app to the next major together, and `stack db-upgrade` carries each environment's data across. A server of a new major does not
start on an old data directory, so the data is dumped by the old major and restored by the new one; the old volume is never written and stays the
rollback.

Both volumes come from the declaration, never from a guess. In a Swarm environment the new volume is the one the stack source mounts as the database's
data directory (one of `deploy.volumes`), and the old one is what it maps from:

```yaml
deploy:
  volumes: [shop-production-db-data, ...]
  dbUpgrade:
    volumes:
      shop-production-db-data: shop-production-postgres-data   # new: old (exactly one pair)
```

A stack renamed in the same window maps the database volume in `deploy.renamedFrom.volumes` instead (PROJECT-STACKS-18), and `db-upgrade` fills it in
place of `volume copy`. A dev (docker-compose) environment names exactly one of `local.dbUpgrade.from`, the old volume restored into the one its compose file
mounts, and `local.dbUpgrade.hold`, the volume that keeps the old data directory when the compose file mounts the old volume itself. Without a mapping the verb refuses and prints the YAML to add (`STACK_DB_UPGRADE_UNDECLARED`).

`stack db-upgrade --env <env> --image <db image@sha256> [--old-image <ref@sha256>] [--execute]` (a dev environment takes no `--image`: it builds the
compose db image) is a dry run until `--execute`. Everything runs in throwaway containers with no network; no host psql is needed:

- **Preflight.** The old volume's `PG_VERSION` (read-only mount) against the target image's major (`STACK_DB_UPGRADE_ALREADY`, `_DOWNGRADE`); nothing that
  runs mounts either volume (`STACK_DB_UPGRADE_IN_USE`: `stack standby`, or `stack down` in dev); the new volume absent or empty. The old-major image is
  `--old-image`, else the image the old service ran when it is of that major, else the pinned official image of that major (`postgres-16`, or
  `postgres-16-alpine` for a data directory owned by uid 70). The superuser password is the sealed value the deploy grants the database service under the
  file its `POSTGRES_PASSWORD_FILE` names; a running secret of another version is `STACK_DB_UPGRADE_PASSWORD_DRIFT`.
- **Dump.** The old volume is copied into a work volume and the old major starts there (no TCP, a trust-only local hba), so the old bytes cannot change.
  Its own `pg_dumpall --roles-only` keeps every stored SCRAM or md5 hash, so no password rotates, and `pg_dump -Fc --create` dumps each database. A
  managed image may add extensions the official one lacks: a dump that needs a missing library names `--old-image`.
- **Restore.** The target image initialises the new volume with its own entrypoint, the environment's superuser and database and the sealed password
  (handed in on stdin, never in an argument, a file on disk or a log line), with no init script. The roles go first, then each database with
  `pg_restore --create --exit-on-error`; an extension the target image does not ship is `STACK_DB_UPGRADE_EXTENSION_MISSING`.
- **Proof.** Both clusters are inventoried alike: databases, extensions, the exact row count of every table, every sequence's position, the count of each
  kind of relation and of functions, the roles with their attributes and password hashes, the memberships. Any difference is `STACK_DB_UPGRADE_MISMATCH`
  and the new volume is emptied again; only an extension's version may change. The sealed superuser and app passwords then log in over TCP
  (`STACK_DB_UPGRADE_PASSWORD_DRIFT` otherwise). A declared role the source cluster does not hold yet is reported, not proven, and recorded in
  `absentLogins`: an equal restore cannot hold it either, and the migration that creates it is followed by the step that gives it its sealed password
  (dev: the migrate step of `stack up`; Swarm: the adopt step). Then the old volume's files, bytes, content and metadata digests must equal those taken before (`STACK_DB_UPGRADE_SOURCE_CHANGED`).
- **Record.** A Swarm run is one recorded attempt (kind `db-upgrade`) under the deploy lock, every step a journal phase and its `upgrade` record (volumes,
  majors, images, inventory, measures; names and digests only). A dev run writes the same document to its state directory under a lock file.

The switch:

- **Swarm, same stack.** `stack deploy --env <env> --adopt --image db=<the same image> ... --sha <sha> --execute`. It proves the stack has an accepted
  release, its database runs nothing, and the newest `db-upgrade` of its journal restored into the declared volume with this deploy's db image
  (`STACK_ADOPT_UPGRADE_*`). It then starts the database alone on the new volume, proves its migration history, runs the plain database path, gives the declared app role its sealed password (a migration of the
  release may have just created it) and deploys.
  A failure redeploys the previous release, which runs the old image on the old volume. `stack rollback --env <env> --data-acknowledged --execute`
  does the same later (`STACK_ROLLBACK_UPGRADED_DATA` without the acknowledgement: writes made on the new volume stay there). While `dbUpgrade` is
  declared and the database service still mounts the old volume, a plain deploy is refused (`STACK_DEPLOY_DB_UPGRADE_PENDING`): it would start an empty
  database on the new volume and serve it.
- **Swarm, renamed stack.** The adopted first release of PROJECT-STACKS-18.
- **Dev.** With `from` the restore lands in the declared volume and nothing more is switched. With `hold` the verb swaps: the old data directory is
  copied into the hold volume and proven equal, then the database volume is emptied and the proven restore copied in (`STACK_DB_UPGRADE_SWAP_FAILED`
  copies the hold back). Then `stack up --env <env> --execute`.

The old volume (dev with `hold`: the hold volume) stays until the owner retires it after the hold period; `dbUpgrade` leaves the declaration with it. ALTER SYSTEM
settings (`postgresql.auto.conf`) are not carried; the dry run names them. Known gap: the volumes must live on the node that runs the verb's containers,
as with `volume copy`, so a multi-node swarm whose database runs on another node is not covered; the counts compare rows, not their contents.

Why: an in-place `pg_upgrade` needs both majors' binaries in one image and rewrites the only copy, while a dump and restore into a new volume needs only
the two official images, rebuilds every index for the new libc and keeps the old volume as an exact rollback; the proof is what makes a switch safe.

Enforced by: the refusals above (stack/db-upgrade.mts, stack/db-upgrade-core.mts, stack/local-db-upgrade.mts, stack/adopt.mts), `STACKS_DEPLOY_CONFIG_INVALID`
and `HFS_STACKS_SHAPE` for `deploy.dbUpgrade`, `STACKS_LOCAL_CONFIG` for `local.dbUpgrade`; the pair and the comparison are held by
`packages/hfs/src/stack-db-upgrade.spec.mts`; the rest by review.

## PROJECT-STACKS-20 An environment pending its cutover: reported, never deployed

An app that moves to its next shape lands the new code on its branch before each environment is cut over: dev runs the new shape, while staging
and production still run the previous release and wait for the owner. Those environments lack the sealed members of the new shape (the owner
creates them in the cutover) and keep the old ones for rollback, so a check of the new code against them is red for a reason no code change can
fix. The environment declares that state, once, under its own entry:

```yaml
environments:
  production:
    status: supported
    runtime: docker-swarm
    cutover:
      state: pending                    # the only state; a cut-over environment carries no cutover block
      reason: Waits for the owner to seal the members of the new shape and move the data.
      until: 2026-12-15                 # YYYY-MM-DD (UTC), required; the declaration holds through that day
      keep: [identity-provider, db/IDENTITY_DB_PASSWORD]   # old sealed members kept for rollback: <member> or <member>/<KEY>
```

`reason` and `until` are required, `keep` is optional; anything else is `HFS_CUTOVER_DECLARATION_INVALID` (the schema is `HFS_STACKS_SHAPE`), and an
unsound declaration tolerates nothing.

- **The check reports, for that environment alone.** `starci app check` (in `--env local` and `--env prod` alike) reports, instead of blocking, the
  findings of the codes `modules/kernel/failure-codes.yaml` marks `cutoverTolerant` whose environment is the pending one: a finding's environment is
  its `.starcistacks/<env>/` folder, or the one `environments.<env>.` its message names on the declaration file. `cutoverTolerant: true` codes are
  the not-yet-cut-over shape: a declared sealed member or key not sealed yet (`STACKS_SEALED_MEMBER_MISSING`) and the rendered stack of the old shape
  (`STACKS_LITE_SELFHOSTED_DB`, `STACKS_LITE_REDIS_PERSISTENCE`, `STACK_STORAGE_MISSING`, `STACKS_IMAGE_ENV_DIVERGES`). A `cutoverTolerant: kept` code
  (`ENV_SEALED_UNREAD`) is reported only for a member, or one key of a member, that `keep` names. Every other finding, of every environment, still
  blocks. The tolerated findings are listed `CUTOVER PENDING (<env>), REPORT ONLY`, and a section beside the gates off by declaration names each
  pending environment with its reason, its until, what it keeps and the codes it tolerated, so the state is never silent.
- **It expires.** A past `until` is the blocking `HFS_CUTOVER_EXPIRED`, and an expired declaration tolerates nothing. The declaration is judged on
  every run that selects hfs, outside the cache, since it reads the clock.
- **Nothing deploys to it.** While the block is present (sound, expired or not), `stack deploy` in every form (the image form, `--ci-run` from the
  managed `stack-deploy.yml`, the one-command `--urgent`, `--adopt`) and `stack prepare --execute` refuse the environment with `STACK_CUTOVER_PENDING`
  before any action reads the server, so nothing half-migrated reaches it. `stack rollback`, which redeploys a release the environment already
  accepted, and the read-only verbs stay open.
- **The cutover runbook removes it last.** The runbook seals the new members, moves the data (PROJECT-STACKS-18 when the runtime names change),
  retires the kept members, and as its last step deletes the `cutover` block and commits; only that commit deploys.

Why: the alternative is a branch that stays red until the owner cuts every environment over, or a gate switched off for the whole app, and both
hide the findings that are real. Naming the environment, the reason and the date keeps the tolerance to the findings the waiting causes, and the
deploy refusal keeps the new code from reaching an environment whose custody is the old one.

Enforced by: R450 (`cutover`: `HFS_CUTOVER_DECLARATION_INVALID`, `HFS_CUTOVER_EXPIRED`, the tolerance in `scripts/hfs/check-cutover.mjs`), the deploy
guard `STACK_CUTOVER_PENDING` (stack/cutover.mts), `HFS_STACKS_SHAPE` for the schema; proved by `packages/hfs/src/stack-cutover.spec.mts`.
