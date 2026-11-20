# The host environment

What a shell on the harness host does differently from the textbook, and the one way to work with it. Every role and host
(Claude Code, Codex, Devin) reads it before spawning a tool on Windows or from a Devin Desktop shell.

## Spawning a process

- **Devin's backend variable.** `ACP_BACKEND=windsurf` leaks into shells spawned from Devin Desktop and makes the `devin`
  CLI take the Windsurf auth branch, which rejects valid Devin credentials. Before spawning `devin`, drop it:
  `Remove-Item Env:ACP_BACKEND` (PowerShell) or `env -u ACP_BACKEND` (POSIX).
- **No `.cmd` shim without a shell.** On Windows a `.cmd` or `.bat` shim (`npm.cmd`, `npx.cmd`) cannot run without a
  shell. Run `node.exe` with the tool's script instead; the CLI does this for npm and refuses a `.cmd` with that hint
  (`cli/src/shared/exec.ts`).

- **A long-lived dev process is started outside the desktop app.** A process started from an agent's shell inside a
  desktop agent app (a dev stack, a dev server, a watcher, a tunnel) is a child of that app and dies when the app
  updates or restarts, mid-session and without a message. Start anything that must outlive the session through a launcher
  of the operating system, such as a scheduled task that runs once and at once (`schtasks /Create /SC ONCE ... /F`, then
  `schtasks /Run /TN <name>`, on Windows; `systemd-run --user` or `nohup setsid` elsewhere), with its output sent to a
  log file, and read its state from the stack's own status verb and that log, never from the shell that started it.
  A short command, a check or a build stays in the agent's shell. Why: a stack that vanishes with the app looks like a
  crash of the stack, and the session that follows debugs a failure that never happened. Held by review.

## The host stack

- **One compose stack, defined in the harness.** The containers the harness itself needs on a host (the shared SonarQube, its
  database, its admin bootstrap, its public tunnel, and the local npm registry on 127.0.0.1:4873) are one Compose project,
  `starci`, whose files are [ops/host/stack/](../../ops/host/stack/) and nowhere else; [ops/host.yaml](../../ops/host.yaml)
  declares each as a service with `stack: starci`. Bring it up with `starci host up --stack starci`, read it with
  `starci host status --stack starci`: both are idempotent and neither recreates a running container. Never start one of these
  containers by hand with `docker run` or from a compose file of another folder: a container compose did not create blocks the
  stack's own, and one loaded from another path keeps running a definition nobody maintains.
- **Data lives in named volumes.** The stack's volumes (`starci-sonarqube-*`, `starci-local-registry-storage`) outlive their
  containers. `host down` stops containers and removes nothing; never run `docker compose down -v` or `docker volume rm` on them
  without the owner's yes ([rules.md](rules.md) rule 2).
- **A full disk makes Docker read-only.** When the drive that holds Docker Desktop's data is full, every write to the Docker
  store fails with `read-only file system` (a build, a container removal) and stays so after space is freed, until Docker
  Desktop restarts. Free space first, then ask the owner to restart it: a restart stops every stack on the host.

### Self-healing

Docker's embedded DNS can stop answering a name on a network whose containers all run and are healthy. On 2026-11-21 it stopped
resolving `embeddings-gate` on `starci_default` twice in one night: the tunnel answered 502 on `embed.starci.org`, 113 NIVO
`vector.upsert` jobs waited, and only a manual restart cleared it. A healthcheck inside the gate cannot see that (it answers on its own
loopback), and Compose never restarts a container that is merely unhealthy. The stack therefore carries five things, each a file
of the harness:

- **A dedicated network with fixed addressing.** The gate and the tunnel share the named network `<project>-edge`
  ([embeddings.yaml](../../ops/host/stack/embeddings.yaml): subnet `10.77.84.0/29`, the gate at `10.77.84.2` with the alias
  `embeddings-gate`, the tunnel at `10.77.84.3`). The tunnel's ingress calls the gate **by address**
  ([embeddings-tunnel.yml](../../ops/host/stack/embeddings-tunnel.yml)), so no lookup stands on the path that failed; the alias stays
  for every other caller and for the doctor. An address is chosen over the alias for the ingress because the alias is the thing that
  failed, an ingress takes one target (no fallback), and the cost of an address is bounded: a subnet clash is refused when the
  network is created, and the doctor calls the exact ingress URL, so a drift between the two files reads down at once.
- **Healthchecks.** The gate probes Caddy's health port; the tunnel image is distroless (no shell, wget or curl; `docker run
  --entrypoint sh` fails), so its check is its own binary, `cloudflared tunnel ready`, which is true only while the connector holds
  a connection to Cloudflare. Both have `restart: unless-stopped`. That the gate answers behind the tunnel is judged by the doctor.
- **`starci host doctor [--stack starci] [--fix] [--execute]`.** For each network a stack service declares (`network` in
  [ops/host.yaml](../../ops/host.yaml)) it reads Docker, the network, each member container (exists, runs, healthy, attached) and,
  from a throwaway container on the network (the image of `doctor.probeImage`, pinned by digest, removed afterwards), whether every
  name resolves and every declared probe is answered. A plain run changes nothing and exits 1 on a finding. `--fix` plans the
  repair, `--fix --execute` performs it, least disruptive first, each rung followed by a fresh read and tried only while something
  is still wrong: **start** what is absent or stopped (`compose up --no-recreate`); **reconnect** the implicated containers to
  the network with their aliases and address (this registers them with the network's DNS again); **restart** them and the rest of
  the network's members; and, last, **recreate the network** (members stopped and disconnected, the network removed, the members
  recreated from their compose file, no volume touched). Docker itself down starts Docker Desktop first (`host up docker`).
- **Scheduling.** The service `host-doctor` of ops/host.yaml is a schedule, `StarCi Host Doctor`, every two minutes running
  `host doctor --stack starci --fix --execute`; `starci host install host-doctor --execute` registers it. One run of a stack at a time
  (a lock under the shared state base, a dead holder's is taken over).
- **The alert.** A run that finds something sends one Telegram message to the owner channel of
  [ops/telegram.yaml](../../ops/telegram.yaml) (the bot token and chat of `connect telegram`; it does not depend on `notices`):
  one when an incident opens, repaired or not, none while it stays open, and one more when an incident reported as not repaired
  closes. A message that cannot be sent stays pending in `<shared state>/host-doctor/<stack>.json` and goes with the next run. A
  dry run prints the text and sends nothing.

Why a scheduled doctor and not an autoheal sidecar: the sidecar sees only a container's own healthcheck, which is blind to the DNS
failure, restarts but cannot reconnect or recreate a network, and needs write access to the Docker socket; the doctor reads the
failure itself, repairs in order, alerts, and runs outside Docker, so it still runs while Docker Desktop is down. Applying a change
of this stack to the live host recreates its containers (they join the new network), which takes the public origin down for about
half a minute: `docker compose --project-directory ops/host/stack -f ops/host/stack/embeddings.yaml up -d --force-recreate
embeddings-gate cloudflared-embeddings` from the one process `host up` uses (the secrets in its environment), then
`starci host install host-doctor --execute`. A throwaway project for a proof sets `STARCI_HOST_PROJECT` **and** a free
`STARCI_PORT_EMBEDDINGS` in the service's `start.env` of the ops folder it runs with (a repair that recreates would otherwise ask for the live port), and never runs a tunnel connector with the live tunnel's token.

## Host services

A host service is a model or server the host runs once for every app of every environment, published through the host stack
the way the SonarQube is, so an app on a workstation, in CI or in production reaches it by one public URL. Each is a service
of [ops/host.yaml](../../ops/host.yaml) whose check is its doctor and verify row: `starci host status <id>` reads it,
`starci host up <id>` starts what is down.

### embeddings

The host's GPU embedding model, `qwen3-embedding:8b`, served at `https://embed.starci.org`.

- **Where it runs.** The model runs in the host's native Ollama on `127.0.0.1:11434` (service `embeddings`, up when
  `/api/tags` names the model), never in a container: the native install reaches the GPU today, Docker Desktop's GPU
  passthrough on Windows and WSL is fragile, and the model is already pulled there. The harness never changes that install or
  its models. In front of it the stack runs two containers from [embeddings.yaml](../../ops/host/stack/embeddings.yaml):
  the gate `embeddings-gate` (Caddy, [embeddings.Caddyfile](../../ops/host/stack/embeddings.Caddyfile)), which reaches Ollama at
  `host.docker.internal:11434` (Docker Desktop forwards it to the host's loopback) and is also served on `127.0.0.1:11435` for a
  process of the host; and `embeddings-tunnel`, the connector of the locally managed tunnel `starci-host-services`, whose ingress
  ([embeddings-tunnel.yml](../../ops/host/stack/embeddings-tunnel.yml)) sends `embed.starci.org` to the gate's fixed address on the stack's
  `edge` network ("Self-healing" above). The DNS record is made once with `cloudflared --config ops/host/stack/embeddings-tunnel.yml tunnel route dns
  --overwrite-dns starci-host-services embed.starci.org` (the `--config` keeps the record off the tunnel of the home's default
  config.yml, as [project/stacks.md](../project/stacks.md) says for an app's tunnel); no dashboard step.
- **Auth.** Every call carries `Authorization: Bearer <EMBEDDINGS_API_KEY>`. The token is a host secret: a random value
  appended to the harness `secret.env` once, never printed, read by the secret loader ([rules.md](rules.md) rule 1,
  policy/security.yaml `secretKeys`) into the one compose process `host up` starts, and by Caddy from its environment when it
  loads the Caddyfile; the tunnel's run token, `HOST_SERVICES_TUNNEL_TOKEN`, is kept the same way. The gate strips the token
  before Ollama. `embeddings-gate` and `embeddings-tunnel` read up only while `GET /v1/models` without the token answers 401,
  so a gate that answered openly reads down.
- **Routes and limits.** Served: `POST /v1/embeddings`, `POST /api/embed`, `GET /v1/models`. Every other method or path is
  404, with or without the token; a served route without the token is 401. A body over 1 MB is 413. At most 4 requests reach
  Ollama at once and the rest wait in Caddy, which with Ollama's own queue bounds the GPU's load. Known gap: there is no per-key
  requests-per-minute limit, since stock Caddy has no rate limiter (it needs the `caddy-ratelimit` plugin and a custom build); a
  leaked token is bounded only by the concurrency cap until it is rotated, and a Cloudflare rate-limiting rule on the host is the
  limit to add when one is needed.
- **The GPU is shared.** The host's GPU has 8 GB and desktop apps hold about 3.6 GB of it, so Ollama keeps about 89% of the
  loaded model on the GPU and the rest on the CPU; the first call after the model unloads waits tens of seconds while it loads.
- **How an app consumes it.** The owner copies the token into the app's own custody, never into a file of the app's tree:
  `starci app secret set --env <env> <member> LOCAL_AI_API_KEY --from-host EMBEDDINGS_API_KEY` seals it without printing it
  ([cli/README.md](../../cli/README.md) "Host secrets"), and a process that needs the value outside the app's runtime reads it
  with `starci app secret get --env <env> <member> LOCAL_AI_API_KEY --to-file` only. The app declares a `@starci/ai-router`
  provider of `kind: "local"` with `baseUrl: "https://embed.starci.org/v1"`, its key `{ ref: "LOCAL_AI_API_KEY" }`, and the
  model `localModel("qwen3-embedding:8b", { dimensions: 1024 })`: the model's 4096 numbers are cut to 1024 by Matryoshka
  truncation and L2-normalized (`truncate: "mrl"`, the ai-router README "Embedding dimensions"), the size a pgvector index
  takes. Through `poolFromEnv` the same comes from `LOCAL_AI_BASE_URL=https://embed.starci.org/v1` and `LOCAL_AI_API_KEY`.

## Dependencies through a link

A package manager command that writes `node_modules` never runs through a link. npm, pnpm and yarn rewrite the folder they install into:
through a junction or a symlink that folder is another checkout's install or the harness install cache, and an `npm ci` there empties the
install every checkout linked to it uses. The writing commands are `ci`, `install` (`i`, `add`), `uninstall` (`remove`, `rm`), `update`,
`prune`, `dedupe`, `rebuild`, `link`, `unlink` and their aliases, of npm, pnpm and yarn (a bare `yarn` installs). A command is refused when
its target's `node_modules` is a junction or symlink, or is a real folder another worktree of the same repository links its own
`node_modules` to. It is judged wherever it hides: chained (`&&`, `||`, `;`, `|`), sent to the background (`&`, `start /b`, a host's
background run), wrapped (`cmd /c`, `sh -c`, `powershell -Command`), after a `cd`, or aimed with `--prefix`, `-C`, `--dir` or `--cwd`. To
install a linked checkout, remove only the link (a plain unlink, never a recursive delete through it) and install its own lockfile.

The judge is one: `installRefusals` of `cli/src/harness/install-guard.ts`. The CLI's own installs ask it before npm runs
(`DEPS_INSTALL_LINKED`, `DEPS_INSTALL_SHARED`, `cli/src/core/deps/packages.ts`), and every agent host asks it before a shell command
through `starci host guard --hook`, its pre-tool hook (Claude Code: a `PreToolUse` hook on the shell tool running
`node <runtime root>/cli/dist/main.js host guard --hook`; the verb answers the deny decision on stdout). `starci host guard <line>` judges a
line by hand. Why: one `npm ci` in a lane whose `node_modules` was a junction emptied the install every other lane ran on.

## Files and folders

- **`robocopy /MIR` follows junctions.** It can delete through a directory junction (a worktree's `node_modules`). Always
  add `/XJ`.
- **PowerShell writes the ANSI code page.** `Set-Content` and `Add-Content` default to it and corrupt UTF-8 text. Edit
  files with the editor tools, or pass `-Encoding utf8`.
