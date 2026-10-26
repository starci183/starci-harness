# Stacks: how an app runs

`.starcistacks/` at the app root is the one place an app says how it runs: which environments exist, what each one
starts, how traffic enters, where its secrets are sealed and how an operator brings it up and down. The harness owns
the **shape** (what may exist, what every environment must declare, the operations and their safety rules); the
project owns the **values** (its components, images, ports, hosts, secret names and runbook commands).

The exact tree (required, allowed and forbidden paths, per edition) is the slot `app.starcistacks` in
[hfs/slots.yaml](../hfs/slots.yaml); the laws are R10 `HFS_STACKS_SHAPE` and the `STACKS_*` rules in
[hfs/rules.yaml](../hfs/rules.yaml), which name their enforcers. This file gives the reasons and the operating
rules no slot can express. What each edition runs is in [lite.md](lite.md) and [full.md](full.md).

## One root per app

`.starcistacks/` lives only at the app root, the repository that owns `.starciwork`, and covers every side the app
has (be and fe). A side repository or a side folder carries none (`HFS_STACKS_IN_SIDE`), so a front end that ships
from its own repository finds its stack, and its CI credentials, in the app root's custody.

Why: one root keeps one manifest, one custody and one runbook per environment; two roots drift, and nobody can say
which one deployed.

## The manifest

`application-stacks.yaml` (schema `starci/application-stacks@1`) is the declaration everything else is checked
against:

- `components`: every process and dependency the app needs, each with its role and purpose, so a reader can tell a
  durable store from a rebuildable cache without opening a compose file.
- `environments`: per environment, its runtime (`docker-compose` or `docker-swarm`), the infra files it reads, the
  components it runs, its runbook and its secrets. A component absent from an environment's map does not run there.
- `secrets`: per environment, each member's `name`, `where` (environment-relative), `recipientPolicy` and
  `keyCustody`; names only, never a value.

A directory under `.starcistacks/` that is not a declared environment is a defect, and so is a compose file no
environment reaches.

## Environments

Two kinds, named by the project:

- **dev** (conventionally `dev`): every dependency runs in Docker Linux containers on the developer host, rendered
  from the environment's compose files; application processes may run natively against them. Non-secret
  configuration lives under `<env>/runtime/{config,env}/`, seed data under `<env>/seeds/`.
- **vps** (conventionally `vps`): the app and its dependencies run on a Docker Swarm stack rendered from
  `<env>/infra/swarm/`. Images are immutable and pinned (BE-SERVICES-2 in [patterns/be/services.md](../patterns/be/services.md);
  base images in [stack/pins.yaml](../stack/pins.yaml) `images`), secrets are versioned external Swarm secrets, and
  every service declares healthcheck, placement and rollout (R266, R267, R294). Recurring work is app-owned, never a
  host crontab (R268, [patterns/be/background.md](../patterns/be/background.md)).

Each environment has its own `README.md`, the runbook: the operations table below with the project's real commands,
the components it binds, its secret custody and its data custody (which volumes are authoritative, which are
rebuildable).

## Ingress

One declared ingress component per environment is the only thing that publishes a port (R266, R275); every other
service sits on internal networks.

- dev: the ingress publishes on loopback only, `127.0.0.1:<port>:<port>`, never `0.0.0.0` and never a bare port.
- vps: the ingress publishes 80 and 443 only; DNS and certificates are owner-run prerequisites with their evidence.
- The application origin the back end trusts (BE-AUTH-3 in [patterns/be/api-auth.md](../patterns/be/api-auth.md))
  is the ingress origin of that environment; open the app there, not at a process port.

## Secret custody

- **Sealed only.** A secret exists in the tree only as a SOPS envelope `<env>/secrets/<slug>.enc` (R06, R277,
  BE-CONFIG-4 in [patterns/be/config.md](../patterns/be/config.md)). Nothing else under `.starcistacks/` is
  ciphertext.
- **One recipient.** Every envelope is encrypted with age to the one shared master recipient; the root `.sops.yaml`
  names only that public recipient. The matching private identity is the shared master identity, kept by the owner at
  `~/.starci/master.identity` (`%USERPROFILE%\.starci\master.identity` on Windows), outside every repository and
  backed up by the owner (R253).
- **Plaintext never enters the tree.** A decrypted member reaches a process through `*_FILE` from host-local custody
  (the `goesTo` of slot `app.plaintext-env`) or memory, never a file in the checkout, ignored or not. Each
  environment's `.gitignore` still ignores everything under `secrets/` except `*.enc`, so a mistaken decrypt cannot be
  committed.
- **Never printed.** No agent opens, decrypts, echoes or logs a secret; a member is judged by its name
  ([CONTEXT.md](../../CONTEXT.md) hard rule 1, `neverRead` in [policy/security.yaml](../../policy/security.yaml)).
  Logs keep tokens, prompts and decrypted values out.
- **Refuse, never regenerate.** Missing ciphertext or a missing or wrong identity refuses `prepare`; a failed decrypt
  is never answered by minting a replacement. Rotation mints a new value, re-encrypts, updates the grant, waits for
  every consumer and only then retires the old version. Key rotation is owner-run.
- **Least grant.** Each secret is granted only to the components that consume it; two consumers of different
  authority never share one member.

## Operations

Every environment's runbook declares the same seven operations, one row each, with the project's command and its
acceptance gate. They are run by the owner or a `deliver` worker; deploying needs the owner's approval
([CONTEXT.md](../../CONTEXT.md) hard rule 5) and `deploy.prod` waits for green CI (`requireCi` in
[policy/quality.yaml](../../policy/quality.yaml)). The harness verbs that will run them are listed in
[README.md](../../README.md) (verb groups; `starci explain` lists what is built) and are not built yet, so today the runbook is the operation and these
rules are held by review.

| operation | does | safety rule |
|---|---|---|
| `prepare` | checks tools and the decryption identity, materializes secrets into host-local custody, builds or pulls the exact images, runs the project's setup commands | refuses on missing ciphertext, identity or image; never generates a replacement secret |
| `doctor` | read-only inspection: render the compose or stack config, envelopes present, identity custody, image identities, free loopback ports, existing volumes | changes nothing; never prints a value |
| `up` | starts the environment and waits for health | only after `prepare` passes; on vps, only for an approved release, after a verified backup and a migration with a durable receipt |
| `status` | desired against running, migration receipt, dependency-backed readiness | container presence is not status; a returned deploy command is not success |
| `logs` | one named service, bounded in time and lines | redacted; never dumps environment or credentials |
| `down` | stops the environment | never `--volumes`; named volumes and ciphertext survive; on vps refused without a data-retention and drain decision, and never targets another stack |
| `verify` | after a real start: liveness, an authenticated journey through the ingress, private endpoints denied, restart, restore | a static render or a passing check is not verification |

Backup before a production deploy: authoritative data (databases, identity, object stores) is backed up encrypted
outside the host failure domain before `up` on vps, and a recovery claim needs an isolated restore. A named volume on
the same host is not a backup. Rollback restores a service specification, never data.

## Local runs

Rules learned from running apps on developer hosts; each holds in every app.

- **Loopback, through the ingress.** Dependencies and the ingress publish on `127.0.0.1` only. The person and the
  `uat` worker open the app at the ingress origin.
- **Bind Next to `localhost`.** A Next dev server started with `-H 127.0.0.1` normalizes its own host to `localhost`
  and loops on locale redirects. The dev server binds `localhost` (its default); the 127.0.0.1 address belongs to
  the ingress in front of it.
- **Caches outside the tree, where the host allows.** Tool caches live outside the repository (slot `app.tool-cache`
  names the location). A Windows host may refuse the SWC cache under AppData; the dev runbook then names a writable
  cache directory outside the repository rather than letting the cache fall back into the checkout.
- **A clean checkout runs its setup.** Generated code (GraphQL types, database row types) is never committed, so a
  clean checkout cannot typecheck until it is generated. The project declares its setup commands; `prepare` runs them
  and every task contract carries them in `context.setup`, which the clean verify runs after install and before the
  checks (`cli/src/harness/contract.ts`, `cli/src/harness/clean-verify.ts`).

## Read with

[lite.md](lite.md), [full.md](full.md); slot `app.starcistacks` and `app.plaintext-env` in
[hfs/slots.yaml](../hfs/slots.yaml); R06, R10, R253, R266 to R268, R275 to R277, R294 in
[hfs/rules.yaml](../hfs/rules.yaml); rulings `lite-production-swarm`, `sealed-secret-custody`,
`single-declared-ingress` and `owner-run-steps` in [decisions/rulings.yaml](../decisions/rulings.yaml).
