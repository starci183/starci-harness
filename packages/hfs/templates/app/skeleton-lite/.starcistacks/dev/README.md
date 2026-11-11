# Development stack

The dev environment is one command: `starci app stack up --env dev --execute`. It checks the machine, opens the dev custody, runs the setup
commands, starts the dependencies in Docker Linux containers (the `db` service: the official postgres image plus pgvector, built from
`.starcistacks/images/db/Dockerfile`; the `mail` service: Mailpit, the dev mail sink; the `storage` service: MinIO, the dev object store), gives the environment its own database role, migrates, applies the seed levels `.starcistacks/seeds/` then `.starcistacks/dev/seeds/`, starts the api and web
processes natively and waits for readiness. What it runs is the `local` block of `environments.dev` in `.starcistacks/application-stacks.yaml`
(PROJECT-STACKS-6 in contexts/project/stacks.md); this runbook never carries a docker command, an agent never runs docker by hand.

**A new machine.** Install what `starci app stack doctor --env dev` reports missing (it prints the exact winget, brew or apt step per tool; Node
from `.nvmrc`, npm, git, Docker with Compose v2 running Linux containers, WSL2 on Windows, sops and age), then run `up`. A fresh clone needs
nothing else: `up` runs `npm ci` and the codegen itself.

**Custody.** Dev values are sealed like any secret and generated once, dev-only: the owner arms `starci app secret init --env dev --execute`, which
creates every value `local.custody` declares, declares its key in the manifest and never replaces a value that is already sealed. A machine that
lacks the age identity of an existing dev member is refused with the owner step to obtain it. The `db` service takes `POSTGRES_PASSWORD`, the
migrations run as the environment's own owner role and the api connects as the `app_be` role with its own password, so no role is shared with
another environment. The `storage` service takes the `storage` member's `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` as its root
credentials, the keys the api signs with.

**Ports.** Every host port derives from `local.basePort` (R389, PROJECT-STACKS-10): web on the base, the api on base + 1, the compose services
from base + 80 (`db` base + 90, the `mail` SMTP and web UI base + 91 and base + 92, the `storage` S3 API and console base + 93 and base + 94), so
two apps run side by side on one machine.

| Command | Operation |
| --- | --- |
| prepare | `starci app stack prepare --env dev --execute`: checks the machine, opens the custody, runs the setup commands and builds the images. |
| doctor | `starci app stack doctor --env dev`: read-only table of host prerequisites with the owner-run install step per OS, custody, compose render and ports. |
| up | `starci app stack up --env dev --execute`: prepare, then the services, the database role, migrations with a receipt, the seed levels `.starcistacks/seeds/` then `.starcistacks/dev/seeds/`, each entry once per content hash, the processes and readiness; prints the origins. |
| status | `starci app stack status --env dev`: desired against running, the migration receipt and every readiness probe. |
| logs | `starci app stack logs --env dev --service api` (a process or a compose service, bounded and redacted). |
| down | `starci app stack down --env dev --execute`: ends the processes and stops the compose project; volumes and sealed values stay. |
| verification | `starci app stack verify --env dev`: the declared liveness and readiness probes after a real start, then `npm run lint` from the app root. |

**Mail.** The confirmation and reset mails of the sign-in go to the `mail` service on its SMTP port (`MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURITY: none`: a plain channel that only the loopback sink accepts) and nothing leaves the machine. Open the web UI at the `mail` origin `up` prints (base + 92), sign up in the web app and follow the link from the message there. A deployed environment names a real SMTP server and `MAIL_SECURITY: starttls` or `tls`.

**Storage.** The api reaches the `storage` service on its S3 port (`STORAGE_ENDPOINT`) and creates its bucket (`STORAGE_BUCKET`) on its first
readiness probe, so `/health/ready` answers only once the database and the bucket answer; the console is the `storage` origin `up` prints.
The volume `storage-data` is rebuildable development data.

The database volume `db-data` is rebuildable development data: `starci app db migrate` recreates its schema from `db/bootstrap.sql` and
`db/migrations`. Key names of the environment are in `.starcistacks/dev/runtime/env/KEYS.md`.
