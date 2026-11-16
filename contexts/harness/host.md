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
  ([embeddings-tunnel.yml](../../ops/host/stack/embeddings-tunnel.yml)) sends `embed.starci.org` to the gate on the stack's
  network. The DNS record is made once with `cloudflared --config ops/host/stack/embeddings-tunnel.yml tunnel route dns
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
