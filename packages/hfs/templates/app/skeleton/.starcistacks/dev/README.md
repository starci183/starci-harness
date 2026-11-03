# Development stack

The dev environment is one command: `starci app stack up --env dev --execute`. It checks the machine, opens the dev custody, starts the
compose services of `infra/compose/stack.yaml` in Docker Linux containers (the pinned local PostgreSQL first, then the core API and the product
and landing front ends), waits for each healthcheck and for readiness, and prints the origins. What it runs is the `local` block of
`environments.dev` in `.starcistacks/application-stacks.yaml` (PROJECT-STACKS-6 in contexts/project/stacks.md); this runbook never carries a
docker command, an agent never runs docker by hand. Trust authentication is confined to this local, unpublished database.

**A new machine.** Install what `starci app stack doctor --env dev` reports missing (it prints the exact winget, brew or apt step per tool; Node
from `.nvmrc`, npm, git, Docker with Compose v2 running Linux containers, WSL2 on Windows, sops and age), then run `prepare` and `up`.

**Custody.** The API reads its database connection from the owner-controlled file `/run/starci-secrets/{{project}}/dev/primary-db-url`, which
the compose model mounts into the API; materialize its real sealed member there before `up`. The scaffold creates no fake secret or
successful proof.

| Command | Operation |
| --- | --- |
| prepare | `starci app stack prepare --env dev --execute`: checks the machine, opens the custody and builds the app images. |
| doctor | `starci app stack doctor --env dev`: read-only table of host prerequisites with the owner-run install step per OS, custody, compose render and ports. |
| up | `starci app stack up --env dev --execute`: prepare, then the services in order and readiness; prints the origins. |
| status | `starci app stack status --env dev`: desired against running and every readiness probe. |
| logs | `starci app stack logs --env dev --service core` (a compose service, bounded and redacted; never prints mounted credentials). |
| down | `starci app stack down --env dev --execute`: stops the compose project; volumes and sealed values stay. |
| verification | `starci app stack verify --env dev`: the declared liveness and readiness probes after a real start, then `npm run lint` from the app root. |

Keep real sealed members under `.starcistacks/dev/secrets/*.enc.yaml`, add them to the manifest after sealing and inventory their key names in
`.starcistacks/dev/runtime/env/KEYS.md`.
