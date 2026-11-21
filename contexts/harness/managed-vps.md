# Managed VPS

The harness manages the owner's fleet of VPS servers from the harness host: it brings each server to one policy, watches its
health, opens its doors under the owner's domain and hands each project the narrow deploy access it needs. The policy is
[ops/vps.yaml](../../ops/vps.yaml); the verbs are `starci vps` (`cli/src/harness/vps/`, `cli/src/core/vps/`); the harness app's
"Máy chủ VPS" page (`#/vps`) reads the same rows as `starci vps list --json`.

## Machines and roles

The owner's words (2026-11-21): "phải lưu máy lại ở config.yaml kiểu starci vps add -- vì cái này là push xài chung" and "gõ cli starci cái
là dựng lun chứ k phải hỏi lại". A machine is registered once in this host's config.yaml (never pushed) with its roles, and one command
brings it up:

```
starci vps add sv-hk-1 --roles app-host,starci,monitor,edge          # imports ops/vps/servers/sv-hk-1.yaml when it is on this host
starci vps add box-2 --host <addr> --user <user> --ssh-key <path> --roles app-host,starci   # a new machine, no question asked
starci vps set sv-hk-1 --roles +starci.buildkit,-starci.sonar
starci host status --host sv-hk-1        # what runs, what is adopted, the gaps, the drift
starci host up --host sv-hk-1 --execute  # deploys only what is missing, each with its rollback; adopts traefik and portainer
starci host doctor --host sv-hk-1        # one real call per service, the embed parity across machines
```

The roles, the services and their deployers are [ops/host-roles.yaml](../../ops/host-roles.yaml) and [host.md](host.md) "Roles and
machines". The verbs below stay the deployers `host up` hands each missing service to; a config.yaml machine is a managed server for every
one of them (its login the key file config.yaml names, its generated keys sealed in `<shared state>/machines/<name>.enc.yaml`).

## Clean boxes only

`starci vps` is made for a clean, empty VPS, and bootstrap owns the whole box: the ops user and key, root by key only and password
login off for everyone, a firewall that opens only ssh, 80 and 443, fail2ban, Docker at its pin, a swarm, Traefik on 80/443 and the
Portainer UI behind the Cloudflare tunnel. A box that already runs a hosting control panel (DirectAdmin, cPanel, Plesk) or serves
80/443 with anything but Docker is not clean: `vps doctor` reports it and `vps bootstrap` refuses it in its preflight
(ops/vps.yaml `bootstrap.notClean`). Such a box, a shared-hosting server whose customers log in to SFTP with passwords among them,
is handled by hand; the harness automates nothing around a panel.

## Two layers

| layer | lives in | holds | who uses it |
|---|---|---|---|
| the managed fleet | the harness: `ops/vps.yaml` (tracked policy) and `ops/vps/servers/` (gitignored inventory) | each server's host, port, OS, provider, panel, swarm role, allowed projects; its root or ops key and pinned host keys, sealed | the owner, through `starci vps` |
| a project's deploy access | the app: `.starcistacks/<env>/secrets/vps.enc.yaml` ([PROJECT-STACKS-5](../project/stacks.md#project-stacks-5-secrets-are-sealed-granted-least-and-never-regenerated)) | `VPS_HOST`, `VPS_USER`, `privateKey`, `knownHosts` of one deploy user | the app's `stack deploy`, from the owner machine or CI |

The two never mix. Root (and the ops user, who has passwordless sudo) belongs to the fleet layer only and never leaves the
owner's sealed inventory. A project gets a deploy user of its own per environment (`deploy-<project>-<env>`, the docker group, no
sudo, no password), made by `starci vps grant`, and loses it by `starci vps revoke`. A project can deploy; it cannot administer
the server, and one project's key never opens another's user.

## Why the inventory is gitignored

The harness repository is public. A server's address, port and login are a map for an attacker even without a key, and a sealed
file in a public repository can be decrypted by whoever ever holds the owner key, for all of its history. So nothing of a real
server is tracked, sealed or not: `.gitignore` keeps `ops/vps/servers/*.yaml` (but the placeholder `example.yaml`) and
`ops/vps/cloudflare.enc.yaml` out, the npm package leaves them out (`cli/package.json` `files`), and the secret scan refuses them
if one is added by force (policy/security.yaml `refusedPaths`, `vps-inventory`). The owner backs the inventory up himself, as he
backs up SOPS_AGE_KEY.

## The server and backup recipients are public and tracked

Each managed server's age recipients, its own (made on the server by `starci app secret server-key`, private half only in
`/root/.config/sops/age/keys.txt` there) and its one backup (a dedicated key whose private half exists only in a GitHub Environment
secret of the harness repository, the break-glass copy), are tracked in `ops/vps/recipients.yaml` with the harness recipient, public
halves only. It is the recipient policy of every app's sealed members (contexts/project/stacks.md PROJECT-STACKS-5, R451): dev to the
harness key alone, staging and production to the server key plus that server's backup and never the harness key. The dev machine
holds the public halves only. Minting the backup key, setting or rotating a deployed value on the server, and the break-glass
workflow belong to the follow-up `vps` lane; until a server's `backup` is filled in, R451 reports every deployed environment on it. R451 warns
while `enforce` is false (globally and per server); the owner sets a server's `enforce: true` once its environments are resealed.

## Keys, never passwords

A server is reached by key only. `vps add` takes the login's private key at a masked prompt (or redirected stdin), or with
`--generate-key` makes one on the owner machine and prints only its public half; it never asks for, stores or sends a password.
The secret scan refuses any key named like VPS_PASSWORD, ROOT_PASSWORD or SSH_PASSWORD anywhere, a sealed envelope included
(policy/security.yaml `refusedKeys`).

**A server that allows password login only** gets a key before the harness can touch it: run `starci vps add <id> --host <ip>
--os <os> --provider <name> --generate-key --execute`, then paste the printed public key into root's `~/.ssh/authorized_keys` through the
provider's web console or the panel's SSH-keys page. That is the provider's side, which no verb can reach; everything after it (the box's
policy, its swarm, its role services) is a verb: `vps bootstrap`, `vps swarm init`, `host up --host <id> --execute`.

The host keys are pinned at `vps add` by ssh-keyscan, after the owner confirms one SHA256 fingerprint against the provider's
console (on the terminal, or `--fingerprint SHA256:...`). Every later session runs with `StrictHostKeyChecking=yes`.

## The verbs

Every acting verb prints its plan and changes nothing until `--execute`; every step is idempotent and prints `changed` or
`unchanged`. No verb prints a secret: a step names the secrets it reads, and their values reach the server only on the script's
stdin (`cli/src/harness/vps/ssh.ts`, the pattern of @starci/hfs `stack/remote.mts`).

| verb | does |
|---|---|
| `vps add <name> --host --user [--port] [--ssh-key] --roles <r1,r2>` | registers a machine in this host's config.yaml (never pushed), no question asked; `--import <file>` (or the inventory file of the same name) takes its address and keeps its sealed login |
| `vps set <name> --roles ...` · `vps show <name>` · `vps remove <name>` | changes a machine's roles (`+starci.sonar,-starci.embed`) or login, shows it with the services its roles turn on, forgets it (the server untouched) |
| `vps list [--offline]` | this host's machines with their roles, then the fleet with health: reachable, uptime, CPU, load, memory, disk, failed SSH logins in the window, swarm nodes and services, the UI and panel links; alerts by `health` of ops/vps.yaml |
| `vps add <id> --host --os --provider [--port] [--user] [--panel-kind] [--panel-url] [--project ...] [--ingress] [--firewall] [--role] [--generate-key] [--fingerprint]` | writes `<id>.yaml`, seals `VPS_USER`, `privateKey`, `knownHosts` in `<id>.enc.yaml` to the owner key |
| `vps doctor <id>` | read-only: whether the box is clean, sshd's effective settings, public listening ports, firewall, fail2ban or lfd, Docker against its pin, swarm, pending security updates and reboot |
| `vps bootstrap <id>` | refuses a box that is not clean; then ops user, sshd drop-in (`sshd -t` before reload), firewall (ufw, firewalld or a CSF the owner installed: 80, 443 and ssh only; CSF with DOCKER="0" and a csfpost.sh that restarts Docker), fail2ban or CSF lfd, automatic security updates, Docker at `contexts/stack/pins.yaml` `hosts.docker-ce`; the login moves to the ops user only after it is proven |
| `vps swarm init <id>` | a one-manager swarm and the attachable overlay network `edge` |
| `vps ui up <id>` | Portainer CE and its agent (digests pinned) as the `starci-ui` stack, published on no port |
| `vps edge up <id>` | Traefik (digest pinned) as the `starci-edge` swarm stack on 80/443 in host mode, routing to labelled services of the `edge` network, certificates by ACME DNS-01 through Cloudflare; the token is a swarm secret named by its hash |
| `vps monitor up <id> [--with <c>] [--without <c>]`, `monitor up --local` | the shared monitoring stack `starci-monitor` of the components ops/vps/monitor/components.yaml and the server file turn on (Prometheus, Alertmanager to the owner's Telegram, Grafana, Loki, Alloy, node-exporter, cAdvisor, a read-only socket proxy by default; blackbox, Tempo, Pyroscope, Consul, Uptime Kuma, GlitchTip optional), digests pinned, its memory budget printed; app environments opt in ([project/monitoring.md](../project/monitoring.md)) |
| `vps service up\|status\|down\|grant <id> --service <name>`, `service ... --local` | an opt-in shared service of ops/vps/services/<name>/components.yaml, one stack per server (the embeddings server: qwen3-embedding:4b, 2560 dimensions, pinned by digest on CPU behind a bearer-key gate), its components toggled, digests pinned, refused when it does not fit the measured memory, CPUs and disk beside the other shared stacks; `grant` seals its key into an app environment's member; app environments opt in ([project/shared-services.md](../project/shared-services.md)) |
| `vps domain add <id> <sub> --to <service:port\|port\|ui\|ssh>`, `domain list <id>`, `domain remove <id> <sub>` | a name `<sub>.starci.org` for the server (below) |
| `vps cloudflare set-token --account <id>`, `cloudflare status` | the owner's Cloudflare API token, masked, verified, sealed |
| `vps grant <id> --app <path> --env <env>` | a deploy user with a key made here, sealed into the app through `starci app secret set` |
| `vps revoke <id> --app <path> --env <env>` | removes that deploy user; the app's sealed key stops working |
| `vps build-key add\|list\|remove <id> --repo <owner>/<name>` | the keys of the remote BuildKit's ssh user `starci-build` (below): `add` mints an ed25519 key here, installs its public half as one gated line, and sets the private half as the repository's Actions secret `STARCI_BUILDER_SSH_KEY` (with `STARCI_BUILDER_HOST` and `STARCI_BUILDER_KNOWN_HOSTS`) through `gh secret set` on stdin, never printed; `remove` takes the line and the secrets away |

## Remote BuildKit

The owner's decision "A" (2026-11-21): a remote BuildKit on sv-hk-1 that CI and dev build through. **Rootless only** (the
coordinator's hard line, 2026-11-21): `moby/buildkit:<pin>-rootless` as uid 1000, never `privileged: true` (a privileged container is
root on the prod host), never the Docker socket, never host PID, IPC or network. If the kernel cannot run it rootless, the step stops with
the exact reason; there is no privileged fallback, that would be an owner decision.

- **The service** is the self-contained folder [ops/vps/services/buildkit](../../ops/vps/services/buildkit/): `service.yaml` (the
  catalog entry: role `starci`, service `buildkit`, kind `host-compose`), `compose.yaml` and `buildkitd.toml`. The image is pinned by
  digest in `contexts/stack/pins.yaml` `images.buildkit`; `buildctl` of the same release is pinned by its tarball's sha256 in
  `service.yaml`. `cli/src/harness/vps/buildkit.ts` renders and plans it; the host roles deploy it with `buildkitUpPlan`, roll it back
  with `buildkitDownPlan` and check it with `buildkitDoctorScript` + `readBuildkitDoctor`.
- **Host compose, not a Swarm stack**: rootless buildkitd needs `seccomp=unconfined` and `apparmor=unconfined` (BuildKit's
  docs/rootless.md), which a Swarm service cannot take. It runs `--oci-worker-no-process-sandbox`, so `/proc` stays masked
  (`systempaths=unconfined` is refused). `cpus` 6, `mem_limit` 8G and `pids_limit` sit under the box's app reserve (ops/vps.yaml
  `services.capacity`, `judgeBuildkitCapacity`); the cache lives on its own volume with `maxUsedSpace` 100GB (the successor of
  keepStorage). The render refuses privileged, an engine socket, host namespaces, added capabilities or devices, published ports, a
  root user and missing limits (BUILDKIT_RENDER_UNSAFE). Rollback is `docker compose -p buildkit down`: no app stack is touched
  and the cache volume stays.
- **The preflight** reads the kernel first: `user.max_user_namespaces`, `kernel.unprivileged_userns_clone` and, on Ubuntu 24.04 and
  later, `kernel.apparmor_restrict_unprivileged_userns` (it must be 0 for rootlesskit; changing it is a host security setting, so the
  step stops and names it).
- **Transport: ssh, no open port.** buildkitd listens only on `/run/starci-buildkit/buildkitd.sock` (the folder made at every boot by
  systemd-tmpfiles, a default ACL giving the group `starci-build` the socket). Clients use BuildKit's ssh helper, which runs
  `buildctl dial-stdio` on the server as the user `starci-build`: not in the docker group (it can never reach the Docker socket or a
  prod container), password locked, its `authorized_keys` owned by root. Every line there is
  `restrict,command="/usr/local/bin/starci-build-gate",no-pty,no-port-forwarding,...` and the gate admits exactly `buildctl dial-stdio`
  to that socket, nothing else. `starci vps build-key` alone manages the lines, one per repository; `vps grant` never touches them.
- **CI**: an app opts in with `ci.imageBuilder: remote` in `.starcistacks/application-stacks.yaml` (default `runner`, so every other app
  renders unchanged). Each image job then writes the repository's key and pinned known_hosts, runs `docker buildx create --name
  starci-remote --driver remote ssh://starci-build@<host>` and bootstraps it within 60 s; on any failure it prints
  `remote builder unreachable, building on the runner` and the hosted runner's builder builds. The cache stays as declared. A
  build for another architecture than linux/amd64 stays on the runner.
- **Dev**: `starci app stack build --env <env> --builder-host <ssh destination> [--push] --execute` (or `STARCI_BUILDER_HOST`) creates
  or reuses the same `starci-remote` builder from this machine and builds there; `--load` brings the images back over the connection,
  `--push` goes from the builder to ghcr with the operator's docker credentials forwarded per build, so nothing is stored on the
  server. The destination is an ssh alias or host this machine reaches with its own key; resolving a machine name of config.yaml to it
  belongs to the host roles.

## Doors under the owner's domain

The UI (`--to ui`) and SSH (`--to ssh`) always go through the server's Cloudflare tunnel, so no admin port is public; put a
Cloudflare Access application (Zero Trust > Access > Applications, self-hosted, the UI's name, the owner's identity) in front of
the UI once its name answers. An app service (`--to <service>:<port>`) goes the way the server's file picks (`ingress.mode`):

- **tunnel** (default): one remotely managed Cloudflare tunnel per server (`starci-vps-<id>`), made on the first `domain add`, its
  run token sealed in the server's `<id>.enc.yaml` and handed to a `starci-tunnel` cloudflared swarm service as a swarm secret
  (`--token-file`), never an environment value. `domain add` adds the ingress rule and a proxied CNAME to
  `<tunnel id>.cfargotunnel.com`. The same pattern as the host stack's tunnels ([host.md](host.md), `ops/host/stack/tunnel.yaml`),
  but remotely managed so the CLI writes the rules through the API.
- **edge**: `vps edge up` runs Traefik as a swarm stack on 80/443 of the box; `domain add` makes a DNS-only A record to the server
  and puts the Traefik labels (router rule, websecure entrypoint, resolver, port) on the service, joining it to the `edge` network.
  Traefik gets and renews the certificate itself by ACME DNS-01 through Cloudflare.

**The Cloudflare token.** In the dashboard, My Profile > API Tokens > Create Custom Token, with exactly the scopes of
ops/vps.yaml `ingress.tokenScopes`: Zone / DNS / Edit and Zone / Zone / Read on the zone starci.org (Traefik's DNS-01 reads the zone), and
Account / Cloudflare Tunnel / Edit on the owner's account (the tunnel). Zone Resources: Include, Specific zone, starci.org. Then
`starci vps cloudflare set-token --account <account id> --execute` reads it masked, verifies it and seals it to the owner key in
`ops/vps/cloudflare.enc.yaml` (gitignored); it is never written to secret.env and never printed. On an edge server the token also
lives as a swarm secret the Traefik container reads as CF_DNS_API_TOKEN_FILE.

## Who may run what

The acting verbs are the owner's (`roles: owner`). `vps list` and `vps doctor` change nothing and the Supervisor may run them too;
both open the sealed logins with the owner key, so they work only where SOPS_AGE_KEY is.
