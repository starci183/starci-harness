# Monitoring: one shared stack per server, an opt-in per environment

A managed VPS runs one harness-owned monitoring stack, `starci-monitor`, beside the app stacks, the way it runs the Swarm UI and the edge
proxy ([harness/managed-vps.md](../harness/managed-vps.md)). An app environment opts in to it with `environments.<env>.monitoring` of its
`.starcistacks/application-stacks.yaml`. Without the block, an app renders and deploys exactly as it did before (PROJECT-STACKS-17 in
[stacks.md](stacks.md)). The harness owns the components and their shape. An app owns only which of its services expose what.

## PROJECT-MONITORING-1 One stack per server, every component a toggle

`starci vps monitor up <id>` deploys the stack from `ops/vps/monitor/components.yaml`. Each component has its own entry:

- its `default` (whether it runs when nothing else is said);
- its image, pinned by `repo:tag@sha256` in [stack/pins.yaml](../stack/pins.yaml);
- its limits and reservations, so monitoring cannot starve the apps;
- its own `update_config` (`failure_action: rollback`) and `rollback_config` (`failure_action: pause`, the only other value Docker takes there);
- its retention.

A server's file (`ops/vps/servers/<id>.yaml`, gitignored) turns components on or off with `monitor: {components: {tempo: true, cadvisor: false}}`. `--with <component>` and
`--without <component>` change one run. The plan refuses a component whose `requires` are off (`VPS_MONITOR_REQUIRES`).

The stack file and the config files are built from the components that run. Each component adds its own pieces:

- `scrape`: its Prometheus jobs;
- `alerts`: its alert groups;
- `datasources`: its Grafana datasources;
- `dashboards`: the dashboards it feeds;
- `alloy`: its Alloy pipeline.

So a component that is off leaves nothing behind. Every config and secret is named by the hash of its content, so a change makes a new one
and a rollback still finds the old one. `docker stack deploy --prune` removes a component that was turned off. The plan prints the memory
budget of exactly what runs.

| component | default | purpose | memory limit | why on or off by default |
|---|---|---|---|---|
| socket-proxy | on | the read-only Docker API (GET only) that Prometheus, Alloy and cAdvisor use to discover containers | 32M | every discovery reads it, and only it holds the socket |
| prometheus | on | the metrics store and the alert rules; Swarm discovery of the opted-in services, of every task Swarm wants running, and of the edge Traefik | 512M | the core; retention 15d or 4GB |
| alertmanager | on | sends each app's alerts to that app's own Telegram bot (PROJECT-MONITORING-5) | 96M | an alert nobody receives is no alert |
| grafana | on | dashboards (host, stacks and services, logs) and datasources as code, behind the server's door with its own login | 256M | the one place the owner reads the server |
| node-exporter | on, global | host metrics | 64M | the host dashboard and host alerts read it |
| cadvisor | on, global | container metrics by stack and service | 192M | the services dashboard and service alerts read it |
| loki | on | the log store, filesystem, the compactor deleting what is older than the retention | 512M | the logs view; retention 168h (7 days) |
| alloy | on | collects logs by stack and service; is also the OTLP receiver once Tempo is on | 256M | without it no log reaches Loki |
| blackbox | off | HTTP, TLS and uptime probes of `monitoring.probes`, with ProbeFailed (2 minutes) and CertificateExpiresSoon (under 14 days) alerts | 48M | it probes the public names from inside the server, so it only proves the name answers; turn it on for uptime and certificate alerts |
| tempo | off | the trace store; Alloy forwards OTLP to it | 384M | no app emits traces until it adds an OpenTelemetry SDK; retention 72h |
| pyroscope | off | continuous profiling | 384M | needs an SDK in the app and costs memory; retention 168h |
| consul | off | one Consul server and its UI behind the door | 128M | see "Consul" below |
| uptime-kuma | off | a status page | 192M | blackbox and Grafana already cover the same monitoring |
| glitchtip, glitchtip-worker, glitchtip-postgres, glitchtip-redis | off | Sentry-compatible error tracking, with its own Postgres and Redis (never an app's) | 512M + 384M + 256M + 64M = 1216M | the heaviest add-on; run it only on a server with room |

**Memory budget of the defaults:** about 1.9 GB of limits (1920 MB) and 808 MB of reservations; CPU limits add up to 2.4. The limits are the
most the stack can take, and it usually uses far less. With every optional component on, the limits add up to about 4.2 GB (4272 MB), reservations 1624 MB, CPU limits 4.7.

## PROJECT-MONITORING-2 An environment opts in

```yaml
environments:
  production:
    monitoring:
      metrics:                       # services that serve Prometheus metrics (path defaults to /metrics)
        - {service: api, port: 3001, path: /metrics}
      logs: true                     # default true: the logs of every service of this stack are kept
      probes: [https://example.org/health]   # blackbox targets; absent: https://<host>/ of every ingress host; false: none
      exporters:                     # one per backing service
        - {kind: postgres, user: monitor, password: {member: db, key: DB_MONITOR_PASSWORD}}   # service defaults to the backing postgres
        - {kind: redis, service: redis}
        - {kind: minio, service: storage}
        - {kind: qdrant, service: qdrant}
        - {kind: kafka-connect, service: connect}   # the JMX exporter agent built into its image, :9404
        - {kind: ingress, service: ingress, port: 2019}   # Caddy's admin metrics or Traefik's metrics entrypoint
      traces: true                   # true: every metrics service; or a list of services
      profiles: [api]
      alerts: {telegram: {member: alerts}}   # this environment's own alert bot (PROJECT-MONITORING-5); absent: its alerts are held
      # network: starci-monitor      # default; the server's `monitor.network`
```

`starci app stack render` (and so deploy) turns the block into the following:

- every scraped service gets `starci.monitor.scrape|port|path|stack` deploy labels and joins the external `network`. This applies to `metrics`
  and to the native exporters (minio, qdrant, kafka-connect, ingress). A minio service also gets `MINIO_PROMETHEUS_AUTH_TYPE=public`, so its
  metrics are open on the private network only;
- a `postgres` or `redis` exporter becomes a sidecar service named `<service>-<kind>-exporter`. It uses a pinned image, the target's networks
  and placement plus the monitoring network, scrape labels, limits and a rollback rollout. The postgres password is the sealed key, mounted
  as a Swarm secret (`DATA_SOURCE_PASS_FILE`). A redis password is not supported yet;
- the probe URLs become `starci.monitor.probe.<n>` labels on one carrier: the own ingress component, else the first shared-edge route's
  service, else the first metrics service. At most 10 URLs;
- the traced and profiled services get `OTEL_EXPORTER_OTLP_ENDPOINT=http://starci-monitor_alloy:4318`, `OTEL_SERVICE_NAME`,
  `PYROSCOPE_SERVER_ADDRESS` and `PYROSCOPE_APPLICATION_NAME`, and join the network;
- with `logs`, every service of the stack gets the container label `starci.monitor.logs=true`, which Alloy keeps containers by.

The labels are generic and name no app's business. The schema is `$defs.environment.monitoring` of
`packages/hfs/runtime/modules/schemas/application-stacks.schema.yaml`. `HFS_STACKS_SHAPE` checks it against the rendered model
(`runtime/scripts/hfs/rules/stacks-monitoring.mts`), and the render refuses the same problems with `STACKS_DEPLOY_CONFIG_INVALID`.
A docker-compose environment declares no monitoring block.

## PROJECT-MONITORING-3 Doors, credentials and alerts

- **Grafana's URL** is `https://grafana-<id>.starci.org`: `components.yaml` `grafana.door.subdomain` under ops/vps.yaml `ingress.domain`.
  The owner opens it once with `starci vps domain add <id> grafana-<id> --to starci-monitor_grafana:3000 --execute`, through the server's
  tunnel or its Traefik. On an edge server, the stack file already carries the same Traefik labels, so a redeploy keeps the route. Grafana
  keeps its own login: anonymous access, sign-up and basic auth are off. Put a Cloudflare Access application in front of it, as for the UI.
  Consul (`consul-<id>`), Uptime Kuma (`status-<id>`) and GlitchTip (`errors-<id>`) answer the same way when they are on.
- **Secrets are sealed only.** The Grafana admin password and GlitchTip's database password and secret key are generated on the first
  `monitor up --execute` and sealed to the owner key in the server's `<id>.enc.yaml` (`monitorGrafanaAdminPassword`,
  `monitorGlitchtipDbPassword`, `monitorGlitchtipSecretKey`). `sops -d` shows them to the owner. Each reaches the server only on the step's
  stdin and becomes a Swarm secret named by its hash. The containers read them by file (`GF_SECURITY_ADMIN_PASSWORD__FILE`,
  `bot_token_file`, `POSTGRES_PASSWORD_FILE`). Grafana reads its admin password only when its database is first made; to rotate it later,
  use `grafana cli admin reset-admin-password` in the container.
- **Alerts go to each app's own bot**, never the harness bot of ops/telegram.yaml (PROJECT-MONITORING-5).
- **The rules are generic** (`ops/vps/monitor/alerts.yml` and each component's `alerts`); a rule whose metric no target serves stays silent:
  - TargetDown; ServiceReplicasBelowDesired (a task Swarm wants running that does not run, 5 minutes; the `swarm-tasks` job keeps one series
    per such task by scraping only Prometheus's own one-series federate answer and dropping every sample); ServiceRestarting (more than 3 new
    containers in 15 minutes); ServiceMemoryNearLimit;
  - HostDiskFull and HostMemoryLow at ops/vps.yaml `health.diskAlertPercent` and `memoryAlertPercent`; HostCpuBusy;
  - PostgresDown, PostgresConnectionsNearMax (80% of max_connections) and PostgresSlowQueries (mean over 1s; only where the exporter collects
    pg_stat_statements, which the sidecar does not turn on yet), RedisDown and RedisMemoryNearMax (90% of maxmemory), from the exporter sidecars;
  - EdgeErrorRate: over 2% 5xx for one edge service for 5 minutes, once it serves more than 3 requests a minute. The edge Traefik serves its
    metrics on an entrypoint `:8082` published on no port; Prometheus joins the edge network and scrapes `tasks.<edge stack>_proxy:8082`. A
    running edge picks the entrypoint up on its next `starci vps edge up`;
  - with blackbox: ProbeFailed (2 minutes) and CertificateExpiresSoon (under 14 days).

## PROJECT-MONITORING-4 Dev parity

`starci vps monitor up --local --execute` runs the same components on this machine's swarm: `docker swarm init` first, and the scripts
run in Git for Windows' bash. Differences from a server:

- the doors are published on `localPort` (Grafana on `http://localhost:3300`), and the `edge` network is left out;
- no alert is sent: Alertmanager routes everything to `held`;
- the generated secrets are sealed in `.runtime/monitor/local.enc.yaml` of the harness state.

## PROJECT-MONITORING-5 Each app's own alert bot

The owner's words (2026-11-21): "bot giám sát server là bot khác nhé, setup trong từng dự án ở starcistacks". The harness bot
(ops/telegram.yaml) carries the owner's questions; it never carries a server's alerts.

```yaml
environments:
  production:
    monitoring:
      alerts:
        telegram: {member: alerts}   # .starcistacks/production/secrets/alerts.enc.yaml
```

- **The member** holds `ALERTS_TELEGRAM_BOT_TOKEN` and `ALERTS_TELEGRAM_CHAT_ID`, sealed like every member of the environment (its server,
  backup and CI recipients). The owner makes the bot with BotFather and seals its token with `starci app secret set --env <env> alerts
  ALERTS_TELEGRAM_BOT_TOKEN`; after he sends /start to the bot, `starci app alerts discover-chat --env <env>` reads the bot's updates, finds
  the one private chat (or `--chat` among several) and seals its id into the member, to the member's own recipients. It refuses when no chat
  wrote yet, or when no identity on this machine opens the member.
- **The routes.** `vps monitor up <id>` reads the apps of the server's `projects`: their checkouts registered with this harness, or
  `--app <dir>`. An environment whose `deploy.remote.serverRecipient` is this server's key (ops/vps/recipients.yaml) and whose member holds
  both keys (read from the sops envelope's plain key names) has a bot ready. Alertmanager sends an alert carrying an app's `stack` label to
  that environment's bot; a host alert (no stack label: disk, memory, CPU, the edge) to one bot of every app, each once (`continue`);
  everything else to the null receiver `held`.
- **No value leaves the sealed files on this machine.** The plan ships each member's ciphertext to the server, whose own key
  (`/root/.config/sops/age/keys.txt`, `starci app secret server-key`) opens it there with `sops`: the token becomes a swarm secret named by its
  hash and read by file (`bot_token_file`), and the chat id fills `alertmanager.yml` from its template, whose config is named by the filled
  file's hash. A server without sops or its key stops the step, naming which.
- **Held, never refused.** With no bot ready, the stack still comes up with every alert behind `held`, and the run prints one line naming
  each app (or environment) that lacks a bot and why. `starci host doctor --host <name>` reports the same as `monitor.alert-bots`, a warning.
  A later `monitor up` with a bot rewires the receiver.
- **Owed in the apps.** Neither nivoos-lite nor starci-next declares `monitoring.alerts` or has a bot yet: the owner's BotFather step, then
  the member, the declaration and the discovery above, per environment.

## Consul

Consul is off by default. It is offered only for a workload outside Swarm or for use across several hosts. Swarm already does what Consul
would do on a single VPS:

- **Discovery**: its embedded DNS answers `<service>` (the VIP) and `tasks.<service>` (every task). The stack always uses the full swarm
  name (`<stack>_<component>`, `tasks.<stack>_<component>`) and every service sets `dns_search: ["."]`: a container inherits the host's
  resolv.conf, and a short name the embedded DNS does not answer is completed by the host's search domain, whose provider wildcard answers
  with the server's public IP.
- **Health**: it replaces a failing task by its healthcheck and rolls an update back by `update_config`.
- **Scraping**: Prometheus discovers Swarm natively (`dockerswarm_sd_configs`, the roles tasks, services and nodes), and so does Alloy
  (`discovery.docker` over the same socket proxy).

On one VPS, a Consul server would be a single-node raft with no HA, plus registration code that no part of the stack reads. The local
smoke test showed the opted-in services found, scraped and their logs kept without Consul (see the lane report of train 182).

When Consul is turned on, it is one server (`-bootstrap-expect=1`) with its UI behind the server's door with auth, and Prometheus scrapes
its own metrics. The app block has no Consul field.
