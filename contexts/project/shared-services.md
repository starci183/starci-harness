# Shared services: one stack per server, an opt-in per environment

A managed VPS can run opt-in shared services beside the app stacks, the way it runs the monitoring stack
([monitoring.md](monitoring.md)): one harness-owned stack per service per server, deployed by the owner, never by an app's deploy user.
An app environment opts in with `environments.<env>.services` of its `.starcistacks/application-stacks.yaml`. Without the block, an app
renders and deploys exactly as it did before (PROJECT-STACKS-21 in [stacks.md](stacks.md)). The first service is the embeddings server.

## PROJECT-SHARED-SERVICES-1 A catalog entry per service, every component a toggle

`starci vps service up <id> --service <name>` deploys `ops/vps/services/<name>/components.yaml` (schema `starci/vps-service@1`, read by
`cli/src/harness/vps/services.ts`). The entry names:

- its stack and the external attachable overlay network apps join;
- what an opted-in app service gets (`app`: the gate's alias on the network, the URL, the URL variable, the key name and the default member);
- its key (`key`: the name sealed in the server's `<id>.enc.yaml` and the Swarm secret file);
- its model, when it serves one (`model`: the default variant and the pinned variants);
- its components, each as in the monitoring stack: `default` and `requires`, the image pinned in [stack/pins.yaml](../stack/pins.yaml)
  (digests only), limits and reservations, its own `update_config` (`failure_action: rollback`) and `rollback_config`, its restart policy,
  its retention, its volumes and configs, and `secret: true` when it reads the key.

A server's file (`ops/vps/servers/<id>.yaml`, gitignored) holds the choices for one server: `services: {embeddings: {components: {...},
model: <variant>}}`. `--with` and `--without` change one run. Configs and the key's secret are named by the hash of their content, so a
change is a new one and a rollback finds the old one; `docker stack deploy --prune` removes a component turned off. Every verb but `status`
is a dry run until `--execute`.

| verb | does |
|---|---|
| `vps service up <id> --service <name>` (or `--local`) | the network, the key as a Swarm secret, the files under `/opt/starci/services/<name>`, the stack; the budget and the capacity check first |
| `vps service status <id> --service <name>` | read only: the stack's services and tasks, the model's own start lines (`starci: serving <model> <digest>` or its refusal), the network |
| `vps service down <id> --service <name>` | removes the stack; the model volume, the network and the key's secrets stay, so `up` serves again at once |
| `vps service grant <id> --service <name> --app <path> --env <env> [--member ai] [--key EMBEDDINGS_API_KEY]` | seals the key into the app environment's member through `starci app secret set`; reaches no server |

Monitoring is not folded into the catalog. Its render assembles configs across components (each component's Prometheus jobs, alert
groups, Grafana datasources and dashboards, the Alloy pipeline, the Telegram receiver), which a catalog entry does not have; folding it would
put monitoring-only hooks into the generic renderer, or move `cli/src/harness/vps/monitor.ts` while other trains change it. The capacity
check counts the monitoring stack as one of the shared stacks that run instead.

## PROJECT-SHARED-SERVICES-2 The embeddings server

ONE per server, CPU only, shared by every opted-in environment:

- **model**: Ollama `ollama/ollama:0.30.11@sha256:c484b703...`, OLLAMA_NUM_PARALLEL 2, context 4096, keep-alive forever, 16 CPUs at most
  (4 reserved), memory limit 10G (4G reserved), stop-first rollout, restart on failure at most 5 times, the volume `starci-embeddings-models`.
- **gate**: Caddy `caddy:2.10.2@sha256:c3d7ee5d...`, the host gate's Caddyfile (ops/host/stack/embeddings.Caddyfile) with its upstream
  moved to `model:11434`: the bearer key, three routes (`POST /v1/embeddings`, `POST /api/embed`, `GET /v1/models`), 401 without the key,
  404 for everything else, a 1 MB body cap, at most 4 requests upstream. It is the only service on the network `starci-embeddings`, as
  `embeddings-gate`; the model is on the stack's own network only.

**The model is pinned**: `qwen3-embedding:4b`, quantization Q4_K_M, its native 2560 dimensions with no truncation, manifest sha256
`df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907`, the model `starci.embed` pins in the harness ops/host-roles.yaml for every
machine, the owner's PC included; `starci host doctor`
compares the vectors of every machine serving it (`HOST_EMBED_MISMATCH`). A different
quantization or size is a different vector space: dev and server vectors, and any index copied between them, would stop being comparable.
The model service pulls the model once into its volume and, at every start, compares the sha256 of its manifest with the pin and refuses to
serve on a mismatch (`starci: <model> is <digest>, not the pinned <digest>; refusing to serve`). Retention `otherModels: remove` deletes every
other model of the volume at start.

**Another model only by explicit choice.** The catalog also pins `qwen3-embedding-8b` (Q4_K_M, 4096 dimensions, manifest `64b93349...`,
the model the apps called before 4b) and `qwen3-embedding-0.6b` (Q8_0, 1024 dimensions, manifest `ac6da0df...`). Neither is the default (the loader refuses a default variant that forces a reindex). A server file that chooses it
(`services: {embeddings: {model: qwen3-embedding-0.6b}}`) is refused `VPS_SERVICE_REINDEX` unless the run passes `--acknowledge-reindex`, and
an acknowledged plan still prints `FINDING (reindex acknowledged)`: every app that calls the server re-embeds its whole index first.

### Capacity

`service up` measures the box before it changes anything, from the same sources `vps list` reads: `/proc/meminfo` (MemTotal, MemAvailable),
the CPUs Docker sees, and the free disk of Docker's root (on the local swarm, the Docker VM, read through a throwaway container of the
gate's image with no network). It adds the limits and CPU reservations of the other shared stacks that run (every other catalog service
whose stack exists, and the monitoring stack with its components), and refuses `VPS_SERVICE_CAPACITY`, naming every number, when:

- the memory limits of this service and the others exceed the box's memory less `services.capacity.keepMemory` of ops/vps.yaml (4G);
- the memory it holds once it serves exceeds the memory available now less the same room (skipped when it runs already);
- the CPU reservations exceed the CPUs less `keepCpus` (2);
- the disk its images and model take exceeds the free disk less `keepDisk` (20G) (skipped when its volume exists).

A dry run on `--local` measures and judges; a dry run on a server reaches nothing and the check runs before the first step of `--execute`.

What the model needs, measured on the local swarm (Docker Desktop, 28 CPUs, 32 GB) with the shipped stack:

| figure | value | how |
|---|---|---|
| resident, Ollama's own count | 6.6 GB | `ollama ps` in the model container (100% CPU, context 4096) |
| anonymous memory of the container | 5.4 GB | `memory.stat` `anon` of its cgroup |
| page cache of the GGUF | 4.7 GB, reclaimable | `memory.stat` `file`; it fills up to the 10G limit (`memory.peak`), no `oom` event |
| model on disk | 4.68 GB (one 4676804928-byte layer) | `docker system df -v`, the manifest's layer size |
| image | 8.0 GB unpacked | `docker image inspect` |
| first call after the start (cold load) | 15 s | gated request from a container on the network |
| warm call (one short passage) | under 1 s | the same request again |

The catalog declares `needs: {memory: 7G, disk: 13G}` for the 8b variant (Ollama's 6.6 GB rounded up; image plus model) and 2G / 9G for 0.6b.

## PROJECT-SHARED-SERVICES-3 The key

- **Made once, sealed.** The first `up --execute` generates 32 random bytes (or takes once a harness secret, `--key-from-host
  EMBEDDINGS_API_KEY`) and seals it to the owner key in the server's `<id>.enc.yaml` as `serviceEmbeddingsApiKey` (on the local swarm,
  `.runtime/services/local.enc.yaml` of the harness state). A sealed key is never replaced by a run (`VPS_SERVICE_KEY_SEALED`); rotation is
  the owner's: remove the key from the file, `up` again, grant every app again.
- **On the server** it travels on the step's stdin only and becomes the Swarm secret `starci_embeddings_key_<hash12>`, mounted in the gate
  alone at `/run/secrets/embeddings_api_key`; the gate's entrypoint reads it into Caddy's process environment and refuses an empty one.
- **To an app**, `vps service grant` opens it from the sealed file and runs `starci app secret set --env <env> ai EMBEDDINGS_API_KEY
  --from-file` (PROJECT-STACKS-5): the app's own sealed copy, which its deploy turns into the app's own versioned Swarm secret
  (`<stack>-embeddings-api-key-v<hash>`). Declare the key in the environment's `secrets:` as the grant prints.
- Never printed: no plan, output or argv holds the value.

## PROJECT-SHARED-SERVICES-4 An environment opts in

```yaml
environments:
  production:
    services:
      embeddings:
        member: ai                     # the sealed member that holds the key (vps service grant seals it)
        key: EMBEDDINGS_API_KEY        # default
        consumers: [api]               # default: the services of deploy.images
        # required: false              # default: render without the key until the member is sealed, reported
        # network: starci-embeddings   # default, the catalog's network
        # url: http://embeddings-gate:8080/v1
        # urlEnv: EMBEDDINGS_BASE_URL
```

`starci app stack render` (and so deploy) gives each consumer:

- the external network `starci-embeddings` (beside its own networks);
- `EMBEDDINGS_BASE_URL=http://embeddings-gate:8080/v1`; a consumer that also declares it in `deploy.environment` is refused, so one value
  has one source;
- a grant of `EMBEDDINGS_API_KEY` from the member, read through `EMBEDDINGS_API_KEY_FILE=/run/secrets/EMBEDDINGS_API_KEY` (BE-CONFIG-4).

The model is `qwen3-embedding:4b` at 2560 dimensions; an app keeps its own model and dimension settings (its vector columns
`halfvec(2560)`, since pgvector cannot HNSW-index a `vector` above 2000 dimensions). An environment that needs the embedding model on its
machines declares it in `hostServices` (contexts/harness/host.md "What an app needs"); `starci host up --host <name> --execute` deploys this
service on a machine whose roles turn `starci.embed` on. The defaults live in the catalog (`app`) and in
`packages/hfs/stack/shared-services.mts` `SHARED_SERVICES` (the hfs package cannot read `ops/`). The schema is
`$defs.environment.services` of `application-stacks.schema.yaml`; `HFS_STACKS_SHAPE` checks the consumers against the rendered model
(`rules/stacks-shared-services.mts`) and the render refuses the same problems with `STACKS_DEPLOY_CONFIG_INVALID`. A docker-compose
environment declares no services block.

**Landing before the key is sealed.** The opt-in, like any grant source declared `required: false`, renders without the key while its
member has no envelope: the render prints `pending (STACKS_SEALED_MEMBER_PENDING, report only)` and `app check` reports the warning
`STACKS_SEALED_MEMBER_PENDING`. A source that omits `required` and one marked `required: true` still refuse (`STACKS_DEPLOY_CONFIG_INVALID`;
an opt-in with `required: true` refuses the same way). An environment pending its cutover (PROJECT-STACKS-19) tolerates the missing member
of a required source as `STACKS_SEALED_MEMBER_MISSING`, report only and for that environment alone; the pending finding needs no cutover and
never blocks, so the two agree: an optional source waits anywhere, a required one waits only under a declared cutover.

## Refusals

| code | when |
|---|---|
| `VPS_SERVICE_UNKNOWN` | `--service` names no folder of ops/vps/services |
| `VPS_SERVICE_COMPONENT` / `VPS_SERVICE_REQUIRES` | a toggle names no component, every component is off, or a component on needs one that is off |
| `VPS_SERVICE_MODEL_UNKNOWN` | the server file names a variant the catalog lacks, or a model for a service that serves none |
| `VPS_SERVICE_REINDEX` | the server file chooses a variant that forces a reindex and the run did not pass `--acknowledge-reindex` |
| `VPS_SERVICE_CAPACITY` / `VPS_SERVICE_CAPACITY_UNREAD` | the service does not fit the measured box (every number named), or the probe printed no figure |
| `VPS_SERVICE_KEY_SEALED` / `VPS_SERVICE_KEY_MISSING` | `--key-from-host` differs from the sealed key; the host secret or the sealed file is missing |
| `VPS_SERVICE_GRANT_APP` / `VPS_SERVICE_GRANT_FAILED` | `--app` holds no `.starcistacks`; `app secret set` refused |
| `VPS_SERVICE_STATUS` | the status probe failed |
| `STACKS_SEALED_MEMBER_PENDING` (warning) | a `required: false` source or an opt-in waits for a member not sealed yet |

## Before the first `up` on a server

The server is bootstrapped and swarm-initialised; `SOPS_AGE_KEY` is on the machine that runs `--execute` (the key is sealed into
`<id>.enc.yaml`); `vps doctor` and a dry run show the room; the owner says yes. Then, per app environment: `vps service grant`, the opt-in
block and the `secrets:` entry, committed with the member.
