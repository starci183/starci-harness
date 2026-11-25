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

Docker's embedded DNS can stop answering a name on a network whose containers all run and are healthy. It has stopped
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

## Roles and machines

One command brings a host up, with no question asked; the machines live in a local config.yaml, because the repository is pushed and
shared; a machine hosts one or more roles, at least one.

### Roles

[ops/host-roles.yaml](../../ops/host-roles.yaml) is the generic catalog, pushed, with no address, user, port or account id:

| Role | Services (`<role>.<service>`, on by default unless marked off) |
| --- | --- |
| `app-host` | runs the app stacks; `engine: swarm` (built), `k3s` declared for a later train |
| `starci` | `embed` (the embedding model behind its gate), `buildkit` (off; rootless, lane t190-buildkit), `sonar` (off), `registry` (off) |
| `monitor` | `prometheus`, `grafana`, `loki`, `alertmanager`, `exporters`, `portainer` |
| `edge` | `traefik` |
| `dev` | `orca`, `docker` (the machine `local` only) |

Each service says, per placement (`on.local` for this harness host, `on.remote` for a managed server), its `kind` (`swarm-stack` or
`host-compose`), the deployer it already had (`via`: the ops/host.yaml services of this machine, `vps service|monitor|ui|edge up` of a
server, or a host-compose adapter), its images pinned by digest (pins of contexts/stack/pins.yaml where they exist; specs hold them equal
to the deployers' own files), its limits, its health probe, the secret names it needs (the values stay in the sealed stores) and its network
and endpoint. Nothing runs differently because of the catalog: the host stack still runs from ops/host/stack/, the VPS embeddings from
ops/vps/services/embeddings/. BuildKit's entry (`starci.buildkit`, `host-compose`, project `buildkit`) is reserved: lane t190-buildkit
builds its definition (ops/vps/services/buildkit/) and registers its adapter (render, up, down, ping) in `cli/src/harness/host-compose.ts`;
until then it reads `unbuilt` (`HOST_SERVICE_UNBUILT`) and nothing is deployed for it.

### Host settings

The settings of this host as a machine live in the `host` block of the same config.yaml, never in the repository, and every CLI copy of the
machine (the harness checkout, a lane worktree, a CLI installed in an app's `node_modules`, which finds config.yaml through the harness home above
its working folder) reads them fresh at each use (`harness/host-settings.ts`):

```yaml
host:
  diskFloorMb: 15360   # the free space a heavy command's drive keeps; over heavy.diskFloorMb of ops/liveness.yaml, the default
  diskWarnMb: 51200    # under this much free, lane gate warns early and lists the landed worktrees that can be removed; over heavy.diskWarnMb of ops/liveness.yaml
```

A host with no config.yaml (a CI runner) reads every default.

### Machines

A machine is an entry of **config.yaml** in the harness home's state (`<main checkout>/.runtime/config.yaml`, or `STARCI_LOCAL_ROOT`),
written only by the CLI and never pushed. The home is found as the fleet's ops/ is: `STARCI_OPS_DIR`'s checkout, else the harness home of
the working folder, else the checkout the CLI is built in; a published CLI's own package is never it, and with none found `vps add` refuses.
A remote machine always has a login user: `--user`, or the `user:` of the inventory file it imports (with its `sshPort`). `local` (this host) is always present, with roles `starci` (sonar, registry, embed with its
tunnel) and `dev`, until the owner changes it.

| Verb | Does |
| --- | --- |
| `starci vps add <name> --host <addr> --user <u> [--port <p>] [--ssh-key <path>] --roles <r1,r2,...>` | registers a machine, no question asked; `--import <ops/vps/servers/<id>.yaml>` (or the inventory file of the same name, when it exists and no `--host` is given) takes its address and keeps its sealed login |
| `starci vps set <name> --roles +starci.sonar,-starci.embed` | `app-host,starci` replaces the roles, `+monitor`/`-edge` adds or removes one, `+role.service`/`-role.service` turns one service on or off against its role's default; `--host`, `--user`, `--port`, `--ssh-key` change the login |
| `starci vps list` · `vps show <name>` · `vps remove <name>` | list the machines (and the fleet's health), show one with the services its roles turn on, forget one (the server is untouched; `local` stays) |

config.yaml keeps the key's path, never the key. A machine that is no inventory file logs in with that key as its user, its host key pinned
by the user's own `~/.ssh/known_hosts` (StrictHostKeyChecking stays on). The keys a deploy generates (an embeddings gate key, Grafana's admin
password) are sealed to the owner key in `<shared state>/machines/<name>.enc.yaml`, or in the managed server's `<id>.enc.yaml`. Every vps verb
takes a config.yaml machine as a managed server.

### `host up|status|doctor --host <name>`

- **`host status --host <name>`** reads every service the machine's roles turn on: `running` (its stack or compose project runs), `adopted`
  (it runs under another name, found by its image), `partial` (a monitoring stack that runs without a component), `missing`, `unsupported`
  (no placement for this kind of machine), `unbuilt` (a host-compose service whose definition is not built yet), each with its drift (a
  running image that is not the pin) and, for an owned running service, its config drift: each file its deployer would write now (the same
  render `vps monitor|service|ui|edge up` or the host-compose adapter compares with `cmp -s` before it redeploys) that differs from the one on
  the server or is not there, read with one sha256 per file and nothing written. Both are listed as findings; neither is a gap. A server is
  read with one read-only probe over its login. `--json` `data.endpoints` lists, per served model, every machine's endpoint in the order a
  router tries them (`starci.embed`: `local` at https://embed.starci.org/v1 first, then each server's `http://embeddings-gate:8080/v1`): the
  list the apps' ai-router profile is made from.
- **`host up --host <name>`** plans the union; **`--execute`** brings it up. Each service gets one state: `keep` (it runs as its deployer
  renders it), `update` (an owned running service with config drift or image drift, e.g. `update (config drift: monitor/stack.yml differs:
  ...)`), `adopt`, `deploy` or `skip`. An `update` runs the deployer's normal up for that service (the monitor services are one stack: one
  `vps monitor up` with the machine's monitor components), then the same health wait; an update that never turns healthy is rolled back with
  `docker service rollback` of each of its Swarm services (never `docker stack rm`; a host-compose project keeps no previous version and stays
  for inspection). A secret rotated in a sealed file is not seen by the comparison (its value is never opened for a read); a host-stack
  service of `local` has no config drift (compose up --no-recreate). The owner's rule for an ADOPTED service holds: one running under
  another name (traefik and portainer on sv-hk-1) is recorded in config.yaml (`adopted`) and checked, never redeployed or restarted, its
  config never compared and its image drift reported only. A missing one goes to its deployer (the generated keys sealed from the key
  model), then `host up` waits for its health and, when it never turns healthy, rolls it back (`docker stack rm`, `compose down`, or a stop
  of the ops/host.yaml services; volumes stay; `--no-rollback` keeps it for inspection). A monitoring stack that runs without a component is
  kept as it is (adding one is the owner's `vps monitor up --with`). App stacks are never touched. One writer per host: a local lock and a
  lock on the server itself (`/run/starci-host-up.lock`), `HOST_BUSY` naming the holder. An unreachable server is never deployed blind
  (`HOST_UNREACHABLE`).
- **`host doctor --host <name>`** makes one real call per running service: an embed vector of the pinned dimensions, the Grafana login
  page, the SonarQube status API, the registry ping, the BuildKit ping hook, each Swarm service at its replicas. Then, for every served model,
  the same fixed text is embedded on every machine serving it: equal dimensions and a cosine of at least the catalog's `minCosine` (0.999),
  else `HOST_EMBED_MISMATCH` (mixed vectors would corrupt every app's search). The config and image drift of each service are printed as
  findings, read-only and never red.
- `starci host up --stack starci` (and `host status`, `host doctor --stack starci --fix --execute`, the scheduled self-heal) work as they
  did: `--host local` is the role-driven view of the same ops/host.yaml services.

### What an app needs

An app environment declares the host services it needs in its `.starcistacks/application-stacks.yaml`, beside its shared-service opt-in:

```yaml
environments:
  production:
    hostServices:
      # machine: sv-hk-1          # default: the server its deploy.remote.serverRecipient belongs to (ops/vps/recipients.yaml), else local
      needs:
        starci.embed: [local, sv-hk-1]   # the owner's PC first, the VPS as fallback; [] is the landing machine alone
```

`starci app check --env prod` (every environment that declares it) and `starci app stack deploy` (its environment) judge it against this
host's config.yaml: `HOST_SERVICE_MISSING` when no machine of a need's list hosts the service (an approved deploy refusal), `HOST_ROLE_MISSING`
when the server it lands on lacks `app-host`, `HOST_MACHINE_UNKNOWN` when config.yaml does not know it. A host with no config.yaml (a CI
runner) says the judgement was skipped: the machines are the owner host's, never the repository's. The schema is
`$defs.environment.hostServices` of @starci/hfs `application-stacks.schema.yaml`; the render ignores the block.

## Host services

A host service is a model or server the host runs once for every app of every environment, published through the host stack
the way the SonarQube is, so an app on a workstation, in CI or in production reaches it by one public URL. Each is a service
of [ops/host.yaml](../../ops/host.yaml) whose check is its doctor and verify row: `starci host status <id>` reads it,
`starci host up <id>` starts what is down.

### embeddings

The host's GPU embedding model, served at `https://embed.starci.org`: `starci.embed` of the machine `local`. The pinned model is
`qwen3-embedding:4b` at its native 2560 dimensions, with no truncation, manifest `df5bd2e3c74c…` (ops/host-roles.yaml), the same on every
machine.

- **Where it runs.** The model runs in the host's native Ollama on `127.0.0.1:11434` (service `embeddings`, up when
  `/api/tags` lists the pinned model, at any position), never in a container: the native install reaches the GPU today, Docker Desktop's GPU
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
  with `starci app secret get --env <env> <member> LOCAL_AI_API_KEY --to-file` only. The app declares one `@starci/ai-router` embeddings
  profile with the providers `host status --host local --json` lists in `data.endpoints["starci.embed"]`, in that order: the PC
  (`https://embed.starci.org/v1`, a short timeout of about 1.5 s for a query, longer for batch indexing) and the VPS gate
  (`http://embeddings-gate:8080/v1` on the network `starci-embeddings`) as the fallback ("fallback lẫn vps lẫn máy thầy nếu máy thầy k mở thì
  về vps!"), both serving `qwen3-embedding:4b` at 2560 dimensions, no `truncate`. pgvector cannot HNSW-index a `vector` above 2000
  dimensions, so the app's columns become `halfvec(2560)` (the app's own work). The environment declares
  `hostServices.needs: {starci.embed: [local, sv-hk-1]}` ("What an app needs" above).
- **Data note.** A staging or production text sent to the PC travels over the Cloudflare tunnel with the gate key; the owner accepts this
  because the PC is his own machine.

## WSL memory

On a Windows host the WSL VM (vmmem, which Docker Desktop runs in) keeps the Linux page cache as committed memory and gives it back only when
told: it held 32 GB of commit while its distro used 2 GB, and the host ran out of commit ("paging file is too small") with RAM still free.
`starci host up --host local` merges `[experimental] autoMemoryReclaim=dropcache` into `%UserProfile%/.wslconfig`, keeping every other key and
section (`cli/src/harness/wsl-config.ts`), and says so; WSL reads it at its next start, so it takes effect after the owner's next
`wsl --shutdown` (or reboot), which the harness never runs.

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
