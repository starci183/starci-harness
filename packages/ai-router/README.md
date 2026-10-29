# @starci/ai-router

A router for OpenAI-compatible calls across a pool of keys, models and providers, usable three ways over one engine:

- **as a gateway service** (`run.js serve`): an OpenAI-compatible HTTP endpoint (`/v1/chat/completions`, streaming
  included, `/v1/embeddings`, `/v1/models`) with its own virtual API keys, per-key quotas and usage accounting, so any
  app (LangChain, an OpenAI SDK, curl, a non-Node service) uses the pool by pointing its base URL at it;
- **as a NestJS module**: register the pool once at the app root, inject `AiRouterService`, and call `chat`, `stream`
  and `embeddings`; `AiRouterGatewayModule` hosts the gateway in the same process;
- **as a plain Node library**: `createRouter(config)` from `@starci/ai-router/gateway`, with no Nest at all.

The router picks a healthy key for each attempt, backs off what is failing, honours rate limits, retries on a different
key or provider, falls back to another model when you allow it, and tells you what it did without ever exposing a key or
a prompt.

- ESM, typed, Node 20 or newer (the durable key store needs Node 22.13 or newer for `node:sqlite`). One runtime
  dependency, `yaml`, for the config file. `@nestjs/common`, `@nestjs/core` (11 or 12) and `reflect-metadata` are
  optional peer dependencies: the root entry needs them, `@starci/ai-router/gateway`, `@starci/ai-router/cli` and the `run.js` process entry do not.
- OpenAI chat-completions and embeddings shapes in and out, so any OpenAI-compatible endpoint (OpenAI, Azure OpenAI
  behind a compatible gateway, OpenRouter, Groq, Together, DeepSeek, vLLM, Ollama, LiteLLM...) is a provider.
- Keys are references (an environment variable name or a resolver function), read at each attempt and named by alias
  everywhere else.

## Why

One key hits its rate limit, another is revoked, a provider has a bad five minutes, and a model is briefly overloaded.
Hand-written retry loops get each of those slightly wrong: they retry a 400, hammer a key that answered 401, ignore
`retry-after`, or retry the same overloaded key. This package owns that loop once, behind one gateway every app can
call, or as a Nest capability with a testing module to prove your use of it.

## Install

```sh
npm install @starci/ai-router                                          # the gateway and plain Node
npm install @starci/ai-router @nestjs/common @nestjs/core reflect-metadata  # in a Nest app
```

## Run it as a gateway

One process (one container) holds the pool, the virtual keys and the admin API. The package declares no `bin` (the
harness has one CLI); the process entry is `dist/gateway/run.js`, and `main(argv, io)` from `@starci/ai-router/cli` runs
the same commands in process:

```sh
node node_modules/@starci/ai-router/dist/gateway/run.js serve --config pool.yaml
# {"listening":"http://0.0.0.0:8080"}
```

### The config file

YAML (or JSON, by the `.json` extension). It is the pool of the [Configuration reference](#configuration-reference) plus
a `gateway` section; every secret is a reference by name, `{ env: NAME }` or `{ file: path }` (a mounted Docker or
Kubernetes secret, re-read at each attempt so rotation needs no restart). A field that would hold a secret's value
(`apiKey`, `value`, `token`, ...) or a provider header that would carry one (`authorization`, `x-api-key`, ...) is
refused when the file loads, as is any unknown field.

```yaml
gateway:
  port: 8080                     # default 8080; or derive it from the app: appPort: 3001 (+ portOffset, default 1) serves on 3002
  host: 0.0.0.0                  # default 127.0.0.1; 0.0.0.0 in a container
  adminToken: { env: AI_ROUTER_ADMIN_TOKEN }   # absent: the admin API is off
  keyStore: { type: sqlite, path: /data/keys.sqlite }   # or { type: memory }; a relative path is from this file
  maxBodyBytes: 4194304          # default 4 MiB
providers:
  - id: openai
    baseUrl: https://api.openai.com/v1
    keys:
      - { alias: team-a, env: OPENAI_KEY_A }
      - { alias: team-b, file: /run/secrets/openai_key_b, maxConcurrency: 8 }
    models:
      - { id: gpt-4o-mini, aliases: [fast], cost: { input: 0.15, output: 0.6 } }
      - { id: gpt-4o, aliases: [smart], cost: { input: 2.5, output: 10 } }
      - { id: text-embedding-3-small, capabilities: [embeddings] }
  - id: openrouter
    baseUrl: https://openrouter.ai/api/v1
    keys: [{ alias: or-1, env: OPENROUTER_KEY }]
    models: [{ id: openai/gpt-4o-mini, aliases: [fast] }]
defaults: { fallbacks: [smart], deadlineMs: 60000 }
profiles:
  lesson: { model: fast, fallbacks: [smart] }
  grading: { model: smart, allowFallback: false, maxAttempts: 3 }
```

### Routes

| route | auth | does |
|---|---|---|
| `POST /v1/chat/completions` | virtual key | a chat completion; `stream: true` answers OpenAI `chat.completion.chunk` events over SSE ending with `data: [DONE]` |
| `POST /v1/embeddings` | virtual key | an embeddings response |
| `GET /v1/models`, `GET /v1/models/{id}` | virtual key | the profiles and pool models (ids and aliases) this key may call |
| `GET /health` | none; the admin token adds the pool's breakers and keys | `{ "status": "ok" }`, or `degraded` when no provider has a usable key |
| `/admin/keys...` | admin token | the [admin API](#admin-api) |

A request's `model` names a profile (`lesson`) or a pool model by id or alias (`gpt-4o-mini`, `fast`); a profile wins
when a name is both. A profile call routes by the profile's policy; a direct model call falls back only to the pool
defaults' fallbacks that the key may call itself. The answer is the provider's OpenAI body without the router's
`routing`; the response carries `x-request-id`, and a unary one `x-ai-router-model` (the model that answered) and
`x-ai-router-attempts`. For a stream the gateway always asks the provider for usage (for accounting) and forwards the
usage chunk only when the client set `stream_options.include_usage`. Nothing is sent before the first chunk, so a pool
failure before the first token is an ordinary error response; after it, the stream ends with an OpenAI error event.

Errors are OpenAI error objects, `{ "error": { "message", "type", "param", "code" } }`:

| status | code | when |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `missing_model`, `model_not_supported` | a body the gateway cannot route |
| 401 | `missing_api_key`, `invalid_api_key` | no key, an unknown, revoked or disabled key |
| 403 | `model_not_allowed` | a profile or model the key is not bound to |
| 404 | `model_not_found`, `not_found` | a name the pool does not serve, an unknown route |
| 413 | `request_too_large` | a body past `maxBodyBytes` |
| 429 | `requests_per_minute_exceeded`, `tokens_per_day_exceeded`, `cost_per_day_exceeded`, `cost_per_month_exceeded` | the key's quota, with `Retry-After` |
| 4xx | `upstream_invalid_request` | the provider refused the request (its status and message, e.g. a context-length error) |
| 502 | `upstream_error`, `pool_auth_failed` | every attempt failed upstream, or no upstream key was accepted |
| 503 | `pool_unavailable`, `pool_rate_limited` | no lane can serve it, or every key is rate limited (`Retry-After` when known) |
| 504 | `pool_timeout` | the policy's deadline passed |

### Virtual keys

The gateway issues its own keys, `sk-starci-<label>-<48 hex>`, and stores only their SHA-256: the secret is shown once,
when the key is created or rotated, and never again. Each key is bound to:

| field | meaning | default |
|---|---|---|
| `label` | lowercase letters, digits, `_`; part of the secret | required |
| `owner` | free text naming who holds it | none |
| `profiles` | profile names it may call, or `["*"]` | `[]` |
| `models` | pool model ids or aliases it may call directly, or `["*"]` | `[]` (at least one profile or model) |
| `allowFallback` | `false` pins every call to the profile's or named model | `true` |
| `quota.requestsPerMinute` | requests per UTC minute | none |
| `quota.tokensPerDay` | prompt plus completion tokens per UTC day | none |
| `quota.costPerDay`, `quota.costPerMonth` | estimated cost per UTC day or month, from usage and the model's `cost` (a model without one counts 0) | none |
| `enabled` | a disabled key answers 401 until enabled | `true` |

Tokens and cost are counted after a call, so a quota stops the request after the one that crossed it. Every request a
key makes is accounted per UTC day: requests, successes, failures, prompt and completion tokens, estimated cost, summed
latency and the outcomes (`success`, `error:<class>`, `rejected:<code>`). No prompt, response or end-user identifier is
stored.

Keys live in a key store. `{ type: memory }` loses them on restart; `{ type: sqlite, path }` is the durable store
(`node:sqlite`, WAL, several processes may share the file). Another database implements the exported `KeyStore`
interface; `KEY_STORE_SCHEMA` is the reference schema (it carries over to Postgres with `BIGINT` times,
`DOUBLE PRECISION` cost and `JSONB` lists).

### Mounted keys

An app that already holds a key's secret (an env variable, a mounted secret file) mounts it with `mountedKeys`, so a
deploy needs no `keys create`. A mounted key is never written to the store: the gateway reads each secret once at
startup, keeps only its SHA-256 and bindings in memory, and authenticates a bearer token against the mounted keys before
the store.

```ts
AiRouterGatewayModule.registerAsync({
    useFactory: async () => ({
        keys: await openSqliteKeyStore("/data/keys.sqlite"),
        mountedKeys: [
            // The secret is sk-starci-<label>- and at least 32 letters, digits, "_" or "-": openssl rand -hex 24
            { label: "nivo_lite", secret: () => readFileSync("/run/secrets/nivo_lite_ai_key", "utf8").trim(), profiles: ["lesson"], owner: "nivo-lite", quota: { costPerMonth: 20 } },
        ],
        listen: true,
    }),
})
```

| case | what happens |
|---|---|
| a request bears the secret | it authenticates as the mounted key, with its bindings and quota |
| the key's id | `key_` and 16 hex of `sha256("mounted:<label>")`: stable per label, so its quota counters and usage rows carry over a new secret and every deploy |
| a new secret for the label, or new bindings | change it and redeploy; the old secret answers 401 |
| `GET /admin/keys`, `GET /admin/keys/{id}`, usage | listed and read like a stored key, with `mounted: true` |
| revoke, rotate or update (`PATCH`) | refused, 409 `key_mounted` (`KeyAdminError` code `mounted`): it changes by changing the secret and redeploying |
| a secret not starting with `sk-starci-<label>-`, too short after it, or a function that throws | `createGateway` throws `MountedKeyError` (`invalid`); the Nest module fails at init |
| a label given twice | `MountedKeyError` (`duplicate_label`) |
| a stored key holds the same secret or the same id | `ready()` rejects with `MountedKeyError` (`collision`); `listen`, `handle` and the Nest module wait for `ready()`, so the app refuses to start |

A refusal names the label and key id, never the secret, and drops the cause of a secret function that threw (its
message may quote what it read). The key's `hint` shows the last four characters, as for every key.

### Admin API

Guarded by `Authorization: Bearer <admin token>` (403 `admin_disabled` when no token is configured).

| route | does |
|---|---|
| `POST /admin/keys` | create from a key spec; 201 `{ key, secret }` |
| `GET /admin/keys` | list (never a secret or hash), mounted keys with `mounted: true` |
| `GET /admin/keys/{id}`, `PATCH /admin/keys/{id}` | read, or change bindings (`owner`, `profiles`, `models`, `allowFallback`, `quota`, `enabled`) |
| `POST /admin/keys/{id}/revoke` | revoke for good |
| `POST /admin/keys/{id}/rotate` | new secret, same id, bindings and usage; 200 `{ key, secret }` |
| `GET /admin/keys/{id}/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` | day rows and totals (default: this month) |

### CLI

```sh
RUN="node node_modules/@starci/ai-router/dist/gateway/run.js"
$RUN keys create --label lesson_app --profiles lesson --rpm 60 --cost-per-month 20 --config pool.yaml
$RUN keys list   --config pool.yaml
$RUN keys usage  key_1a2b3c4d5e6f7a8b --from 2026-10-01 --config pool.yaml
$RUN keys rotate key_1a2b3c4d5e6f7a8b --url http://gateway:8080      # admin token from AI_ROUTER_ADMIN_TOKEN
$RUN keys revoke key_1a2b3c4d5e6f7a8b --url http://gateway:8080 --admin-token-env MY_ADMIN_TOKEN
```

`keys create|list|get|update|revoke|rotate|usage` run on the config's durable store directly (`--config`), or through a
running gateway's admin API (`--url`, required for a memory store). Every command prints JSON; `--help` lists
the flags.

### Call it from any OpenAI client

LangChain (JS):

```ts
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"

const llm = new ChatOpenAI({
    model: "lesson", // a profile, or a pool model such as "gpt-4o-mini"
    apiKey: process.env.STARCI_AI_KEY, // sk-starci-...
    configuration: { baseURL: "http://127.0.0.1:3002/v1" },
})
const reply = await llm.invoke("Explain closures in one paragraph.")
for await (const chunk of await llm.stream("Count to five.")) process.stdout.write(String(chunk.content))

const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small", apiKey: process.env.STARCI_AI_KEY, configuration: { baseURL: "http://127.0.0.1:3002/v1" } })
```

LangChain (Python): `ChatOpenAI(model="lesson", api_key=..., base_url="http://127.0.0.1:3002/v1")`.

The OpenAI SDK, or any compatible client:

```ts
import OpenAI from "openai"

const client = new OpenAI({ apiKey: process.env.STARCI_AI_KEY, baseURL: "http://127.0.0.1:3002/v1" })
const completion = await client.chat.completions.create({ model: "lesson", messages: [{ role: "user", content: "hi" }] })
```

```sh
curl http://127.0.0.1:3002/v1/chat/completions -H "Authorization: Bearer $STARCI_AI_KEY" \
  -H "content-type: application/json" -d '{"model":"lesson","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

### Deploy

One container or process: `node node_modules/@starci/ai-router/dist/gateway/run.js serve --config
/etc/ai-router/pool.yaml` as its command, `host: 0.0.0.0` in the config, the port published,
a volume for the SQLite file, and SIGTERM for a graceful stop. The environment holds only what the config names: the
upstream key variables (`OPENAI_KEY_A`, `OPENROUTER_KEY`, ... or mounted files), and the admin token variable
(`AI_ROUTER_ADMIN_TOKEN` by convention). The CLI's `--url` mode reads the admin token from `AI_ROUTER_ADMIN_TOKEN`
unless `--admin-token-env` names another variable. Breakers and headroom are per process unless the pool's `store` is
shared; run one gateway per pool, or several behind a load balancer sharing the SQLite file on one host.

### Plain Node and in-process hosting

```ts
import { createGateway, createRouter, openSqliteKeyStore } from "@starci/ai-router/gateway"

const router = createRouter(pool) // the same engine AiRouterService wraps: chat, stream, embeddings, health, stats, on, reset, catalog
const gateway = createGateway(router, { keys: await openSqliteKeyStore("keys.sqlite"), adminToken: () => process.env.AI_ROUTER_ADMIN_TOKEN })
await gateway.listen(8080, "0.0.0.0") // or mount gateway.handle on an existing node:http, Express or Nest adapter
```

In a Nest app, `AiRouterGatewayModule` fronts a registered router (the default one, or `name` for a named one) and
listens on its own port when `listen` is given, closing at shutdown; the gateway is injected with
`@InjectAiRouterGateway(name?)` (token `AI_ROUTER_GATEWAY`):

```ts
@Module({
    imports: [
        AiRouterModule.register({ isGlobal: true, ...pool }),
        AiRouterGatewayModule.registerAsync({
            useFactory: async () => ({ keys: await openSqliteKeyStore("/data/keys.sqlite"), adminToken: () => process.env.AI_ROUTER_ADMIN_TOKEN, listen: true }),
        }),
    ],
})
export class AppModule {}
```

#### The port convention

The gateway's port is derived from the app's, so nobody configures it by hand. The StarCi port convention is
`basePort + portOffset`: the front end is base+0 (3000), the API is base+1 (3001), and the gateway is the API's port
plus an offset, 1 by default (3002).

| `listen` | gateway listens on |
|---|---|
| `true` | the app's port + 1, on `127.0.0.1` |
| `{ offset?: n, host?: h }` | the app's port + `n` (default 1, at least 1), on `h` (default `127.0.0.1`) |
| `{ port: p, host?: h }` | `p`, explicitly; the app's port is not read |
| absent | nothing; mount `gateway.handle` yourself |

The app's port is the port its HTTP server is actually bound to. Nest bootstraps before `app.listen` binds, so the
module waits for the server's `listening` event (or reads the address at once when it is already bound) and then
starts the gateway; a failure to bind the gateway's port (`EADDRINUSE`) goes to the `onError` option, not out of
`app.listen`. An application with no HTTP server (a standalone context) reads `PORT` instead; with neither, bootstrap
fails with an `AiRouterError` saying the port is unknown and `listen.port` is the way out. The host is local to the app
(`127.0.0.1`) and is `0.0.0.0` only when you set it. With `serve`, `gateway.appPort` plus `gateway.portOffset`
(default 1) does the same; it cannot be combined with `gateway.port`.

A client of an API on 3001 uses `http://127.0.0.1:3002/v1` as its OpenAI base URL: LangChain (below), OpenClaw, or any
OpenAI-compatible agent, with a virtual `sk-starci-...` key as its API key.

## Use it in a Nest app

The module follows the Nest configurable-module shape: `AiRouterModule.register(options)` or
`AiRouterModule.registerAsync(...)`, registered once at the app root. The options are the pool
([Configuration reference](#configuration-reference)) plus `on` (one handler per [event](#observability)), and the
extras `isGlobal` (default `false`) and `name` (for [several pools](#named-pools)).

```ts
import { Module } from "@nestjs/common"
import { AiRouterModule } from "@starci/ai-router"

@Module({
    imports: [
        AiRouterModule.register({
            isGlobal: true,
            providers: [
                {
                    id: "openai",
                    baseUrl: "https://api.openai.com/v1",
                    keys: [
                        { alias: "team-a", env: "OPENAI_KEY_A" },
                        { alias: "team-b", env: "OPENAI_KEY_B", maxConcurrency: 8 },
                    ],
                    models: [
                        { id: "gpt-4o-mini", aliases: ["fast"], contextWindow: 128_000, cost: { input: 0.15, output: 0.6 } },
                        { id: "gpt-4o", aliases: ["smart"], cost: { input: 2.5, output: 10 } },
                        { id: "text-embedding-3-small", capabilities: ["embeddings"] },
                    ],
                },
                {
                    id: "openrouter",
                    baseUrl: "https://openrouter.ai/api/v1",
                    keys: [{ alias: "or-1", env: "OPENROUTER_KEY" }],
                    models: [{ id: "openai/gpt-4o-mini", aliases: ["fast"] }],
                },
            ],
            defaults: { model: "fast", fallbacks: ["smart"], deadlineMs: 60_000 },
            profiles: { strict: { model: "smart", allowFallback: false, maxAttempts: 3 } },
        }),
    ],
})
export class AppModule {}
```

When the options come from another provider, use `registerAsync` with `imports`, `inject` and `useFactory`, or
`useClass` / `useExisting` with a class whose `createAiRouterOptions()` returns them. With `@nestjs/config`:

```ts
import { ConfigModule, ConfigService } from "@nestjs/config"
import { AiRouterModule } from "@starci/ai-router"

AiRouterModule.registerAsync({
    isGlobal: true,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
        providers: [
            {
                id: "openai",
                baseUrl: config.getOrThrow<string>("OPENAI_BASE_URL"),
                keys: [{ alias: "main", resolve: () => config.get<string>("OPENAI_API_KEY") }],
                models: [{ id: "gpt-4o-mini", aliases: ["fast"] }],
            },
        ],
        defaults: { model: "fast" },
    }),
})
```

The router is created, and its pool validated, when Nest instantiates the module, so a bad pool fails the bootstrap
with an `AiRouterError` of class `config` naming the problem.

## Inject and call

Each registration provides:

| Token | Value | Inject with |
| --- | --- | --- |
| `AiRouterService` | the service: `chat`, `stream`, `embeddings`, `health`, `stats`, `on`, `reset`, and `router` | the constructor type, or `@InjectAiRouterService()` |
| `AI_ROUTER` | the raw `AiRouter` the service delegates to | `@InjectAiRouter()` |

```ts
import { Injectable } from "@nestjs/common"
import { AiRouterService } from "@starci/ai-router"

@Injectable()
export class SummaryService {
    constructor(private readonly ai: AiRouterService<"strict">) {}

    async summarise(text: string): Promise<string> {
        const reply = await this.ai.chat({ messages: [{ role: "user", content: `Summarise: ${text}` }] }, { profile: "strict" })
        return reply.choices[0]?.message.content ?? "" // reply.routing: provider, key alias, model, attempts, cost
    }

    embed(input: string[]) {
        return this.ai.embeddings({ model: "text-embedding-3-small", input })
    }
}
```

The service's type parameter names the profiles a call may select, so `{ profile: "strcit" }` does not compile; type
the options the same way (`AiRouterModuleOptions<"strict">`) to keep the two in step.

| member | does |
|---|---|
| `chat(request, options?)` | sends a chat-completions request; resolves to the OpenAI completion plus `routing` |
| `stream(request, options?)` | returns an async iterable of OpenAI chunks, with `requestId`; see [Streaming](#streaming) |
| `embeddings(request, options?)` | sends an embeddings request; resolves to the OpenAI response plus `routing` |
| `health()` | reads every breaker, disabled key, headroom and latency EWMA |
| `stats()` | this process's counters: requests, attempts, failures by class, tokens and cost per lane |
| `on(event, handler)` | subscribes to `attempt`, `request`, `breaker` or `key-disabled` until shutdown; returns the unsubscribe function |
| `reset(target?)` | closes breakers, re-enables keys and clears headroom for everything, one provider or one key |
| `catalog()` | the pool's profiles (resolved model and fallbacks) and models (ids, aliases, providers), with no key |

`options` is `{ profile?, policy?, signal?, requestId?, headers? }`. `requestId` (generated when absent) is sent as
`x-request-id` and `idempotency-key` on every attempt of the call, so a provider that deduplicates sees one request.
`headers` adds headers to this call; it can never replace `authorization`.

Every failure is an `AiRouterError` with `errorClass`, `retryable`, `status`, `provider`, `key` (alias), `model`,
`requestId`, `attempts` (every failed attempt: where and why), `afterFirstToken` and `retryAt` (when a 429 said to
come back).

On application shutdown (`app.close()`, or a signal after `enableShutdownHooks()`), the service aborts every call still
in flight through it (a stream ends with `cancelled`), rejects later calls as `cancelled`, and releases the `on`
handlers and every handler it subscribed. Calls made on the raw `AI_ROUTER` are the caller's to cancel.

## Named pools

Give each registration a `name` to hold several pools in one app; its tokens become `AI_ROUTER:<name>` and
`AiRouterService:<name>` (`getAiRouterToken(name)`, `getAiRouterServiceToken(name)`), injected by name:

```ts
imports: [
    AiRouterModule.register({ name: "chat", isGlobal: true, ...chatPool }),
    AiRouterModule.registerAsync({ name: "embed", isGlobal: true, imports: [ConfigModule], inject: [ConfigService], useFactory: embedPool }),
]

constructor(
    @InjectAiRouterService("chat") private readonly chat: AiRouterService,
    @InjectAiRouterService("embed") private readonly embed: AiRouterService,
) {}
```

A named registration provides no default instance; `@InjectAiRouterService()` without a name needs an unnamed one.

## Configuration reference

| field | meaning | default |
|---|---|---|
| `providers[].id` | a name, unique, without `/` | required |
| `providers[].baseUrl` | the URL the OpenAI paths hang from (`.../v1`) | required |
| `providers[].headers` | extra headers for every request (an `authorization` here is ignored) | none |
| `providers[].weight` | multiplies the round-robin share of every lane of the provider | 1 |
| `providers[].maxConcurrency` | in-flight requests across the provider's keys, in this process | unbounded |
| `providers[].keys[]` | `{ alias, env }` or `{ alias, resolve }`, plus `weight`, `maxConcurrency` | at least one |
| `providers[].models[]` | `{ id, aliases?, contextWindow?, cost?, capabilities?, weight? }` | at least one |
| `defaults` | the policy every call starts from | none |
| `profiles` | named policies a call selects with `{ profile }` | none |
| `resilience.keyBreaker` | `{ failureThreshold, cooldownMs, maxCooldownMs }` per key | 3, 15000, 300000 |
| `resilience.providerBreaker` | the same per provider, fed by all its keys | 8, 30000, 300000 |
| `resilience.backoff` | `{ baseMs, factor, maxMs }` between attempts after a transient failure | 100, 2, 5000 |
| `resilience.authDisableMs` | how long a 401/403 key stays out; `null` until `reset()` | `null` |
| `resilience.rateLimitCooldownMs` | a 429's cooldown when it has no `retry-after` | 10000 |
| `selection.latencyTolerance`, `latencySlackMs` | how far above the best latency EWMA a lane still ties | 1.5, 50 |
| `selection.ewmaAlpha` | the weight of the newest latency sample | 0.3 |
| `selection.lowHeadroom` | remaining requests at or below which a lane is used only when nothing else is | 1 |
| `telemetry.includeContent` | adds request and response bodies to `attempt` events | `false` |
| `store`, `storeNamespace` | where shared state lives, and its key prefix | in memory, `ai-router` |
| `fetch` | the `fetch` to use (a proxy agent, a test double) | global `fetch` |
| `random` | the jitter source | `Math.random` |

A model's `id` is the name sent to the provider; a caller may name it by `id` or any alias, and an alias shared by
several providers makes them interchangeable for that call. `cost` is per one million tokens, `input` and `output`, in
whatever unit you budget in. `capabilities` defaults to `chat`, `streaming`, `tools` and `json`; an embeddings model
declares `["embeddings"]`.

## Policies

A call's policy is `defaults`, then the selected profile, then `options.policy`, merged field by field (later wins).
The preferred model is the call policy's `model`, else the profile's, else the request's own `model`, else the
defaults'.

| field | meaning | default |
|---|---|---|
| `model` | the preferred model | the request's |
| `fallbacks` | models tried in order once the preferred one has no usable lane | none |
| `allowFallback` | `false` pins the call to the preferred model | `true` |
| `maxAttempts` | attempts across keys, providers and models | 4 |
| `timeoutMs` | one attempt (a stream: until the first token, then between chunks) | 60000 |
| `deadlineMs` | the whole call, waits and backoff included | 120000 |
| `budget.maxCost` | a model whose worst-case cost for this request is higher is no candidate | none |
| `providers` | restrict the call to these provider ids | all |
| `require` | capabilities needed beyond those the request implies | none |

The request implies its own needs: `tools` needs `tools`, a non-text `response_format` needs `json`, `stream()` needs
`streaming`, `embeddings()` needs `embeddings`. A model is also no candidate when its `contextWindow` is smaller than
the estimated prompt (four characters a token) plus `max_tokens`. When nothing is left, the call fails at once with
class `no_candidate`.

## Selection

A candidate ("lane") is one provider, key and model. A lane is out while its key is disabled, its key's or provider's
breaker is open, a 429 cooldown holds it, its last reported remaining requests are 0 (or remaining tokens are below
the estimate) until the reported reset, or its key or provider is at its concurrency cap. Among the lanes left, tiers
decide, in order:

1. a lane this call has not tried yet;
2. the policy's model order (preferred, then each fallback);
3. a key this call has not tried yet, then a provider it has not tried yet;
4. enough headroom (lanes at `lowHeadroom` or below come last).

Within the first non-empty tier: the fewest in-flight requests on the key, then latency (lanes whose EWMA is within
`best * latencyTolerance + latencySlackMs`; a lane never measured stays in), then smooth weighted round-robin by
`provider.weight * key.weight * model.weight`. Equal keys therefore alternate deterministically rather than randomly.

When no lane is usable now but one will be before the deadline (a cooldown, a breaker, a concurrency slot), the call
waits for it rather than failing. When none will be, it fails at once with the class of the last failure (or
`no_candidate`) and `retryAt`.

## Resilience

| what happened | class | effect | retried |
|---|---|---|---|
| 429, or a rate/quota error object | `rate_limit` | the lane (key and model) cools down until `retry-after` / `retry-after-ms`, else `rateLimitCooldownMs` | yes, at once, on another lane |
| 401, 403, an auth error object | `auth` | the key is disabled (`authDisableMs`, default until `reset()`); `key-disabled` event | yes, at once, on another key |
| a resolver that returns nothing or throws, an unset env var | `auth` | the key is disabled with reason `missing`; nothing is sent | yes |
| 408, 409, 425, 5xx | `transient` | counts toward the key's and the provider's breakers; a `retry-after` also cools the lane | yes, after backoff |
| connection failure | `network` | as transient | yes, after backoff |
| attempt timeout | `timeout` | as transient | yes, after backoff |
| broken or malformed stream before the first token | `stream` (or the streamed error's class) | as transient | yes, after backoff |
| 400, 404, 422, other 4xx, an invalid-request error object | `invalid_request` | none | no |
| the caller's signal aborted | `cancelled` | the attempt in flight is aborted | no |
| the call's deadline passed | `deadline` | the attempt in flight is aborted | no |

Breakers are closed, open or half-open. A closed breaker opens after `failureThreshold` consecutive transient
failures (a success resets the count), for `cooldownMs` or until a `retry-after`, whichever is later. Past its
cooldown it is half-open: exactly one attempt, the probe, holds a lease and goes through while every other call waits.
A successful probe closes it; a failed one reopens it with the cooldown doubled, up to `maxCooldownMs`. Rate limits,
invalid requests and cancellations never count against a breaker.

Backoff after a transient failure is `min(maxMs, baseMs * factor^(n-1))` scaled by a random factor in `[0.5, 1)`, and
the next attempt goes to a different lane by the tiers above. Rate and auth failures belong to one key, so the next key
is tried without waiting.

## Streaming

`stream()` sends `stream: true` with `accept: text/event-stream` and parses the server-sent events itself. The body is
read only when you ask for the next chunk, so a slow consumer holds the connection back instead of buffering the whole
reply; breaking out of the loop cancels the body and frees the key's slot.

- **Before the first token** (the first chunk whose delta carries anything besides `role`), chunks are held back.
  If the stream fails then, by HTTP status, a broken connection, malformed data or a streamed `error` object, the
  attempt fails over like any other and the held chunks are dropped: you never see two role chunks or half an answer.
- **After the first token**, chunks are yielded as they arrive and a failure is thrown as an `AiRouterError` with
  `afterFirstToken: true`. The router does not retry it, since a second answer cannot be spliced onto the first; retry
  the whole call if your use allows it.
- `timeoutMs` bounds the wait for the first token and then each gap between chunks; `deadlineMs` bounds the whole
  stream.
- Stopping early counts as a success of the lane. Usage is read from a final usage chunk when the provider sends one
  (OpenAI does when you pass `stream_options: { include_usage: true }`).
- Policy errors (an unknown model or profile) throw from `stream()` itself; everything else is thrown from iteration.

## Observability

Handlers given in the options as `on` are subscribed when the module is instantiated; `service.on(event, handler)`
subscribes later. Both are released at application shutdown.

```ts
AiRouterModule.register({
    ...pool,
    on: {
        attempt: (event) => metrics.histogram("llm.attempt", event.latencyMs, { provider: event.provider, key: event.key, model: event.model, outcome: event.outcome, class: event.errorClass }),
        breaker: (event) => log.warn("breaker", event),
        "key-disabled": (event) => alert(`key ${event.provider}/${event.key} disabled: ${event.reason}`),
        request: (event) => log.info("llm call", event),
    },
})
```

| event | when | carries |
|---|---|---|
| `attempt` | every attempt | `requestId`, `operation`, `attempt`, `provider`, `key` alias, `model`, `latencyMs`, `outcome`, `errorClass`, `status`, `usage`, `cost` |
| `request` | every call, once | `requestId`, `operation`, `outcome`, `attempts`, `latencyMs`, the answering lane or the `errorClass` |
| `breaker` | a breaker changes state | `scope` (`key` or `provider`), `provider`, `key`, `from`, `to` |
| `key-disabled` | a key is disabled | `provider`, `key`, `reason` (`auth` or `missing`), `until` (null: until `reset()`) |

Events never carry message content unless `telemetry.includeContent` is `true`; then `attempt` events add `content`
with the request body and, for `chat` and `embeddings`, the response. A handler that throws is isolated from the call.
The module itself logs nothing.

## Sharing state between processes

Breakers, disabled keys and headroom live in the `store` option; the default keeps them in memory. Several processes
(or several registrations) share them through one store: an adapter implements the exported `StateStore` type (`get`,
`set`, `delete`, `keys(prefix)`, and an atomic `lease(key, ttlMs)` / `release(key)` pair for the half-open probe).
Methods may return values or promises. Records are plain JSON (`HealthRecord`); a Redis adapter is a `GET`/`SET`, a
`SCAN` and a `SET NX PX` lease. In-flight counts, latency EWMAs and round-robin positions stay per process. Updates
are read-modify-write, so two processes failing at the same instant may count one failure between them: breakers are a
health signal, not a ledger.

## Testing

`@starci/ai-router/testing` holds an in-process OpenAI-compatible fake provider and `AiRouterTestingModule`, which
registers the real module (the same options, `isGlobal` and `name`) with every request sent to the fake and a fixed
jitter. Script replies per base URL, key, model or path; replies are used in order and the last one repeats.

```ts
import { Test } from "@nestjs/testing"
import { AiRouterService } from "@starci/ai-router"
import { AiRouterTestingModule, createFakeProvider } from "@starci/ai-router/testing"

const fake = createFakeProvider()
fake.on({ key: "sk-test-1" }, { status: 429, headers: { "retry-after": "30" } })
fake.on({ key: "sk-test-2" }, { latencyMs: 20, text: "hello" })
fake.on({ model: "m-stream" }, { stream: { chunks: ["a", "b"], failAfter: 1 } })

const app = await Test.createTestingModule({
    imports: [
        AiRouterTestingModule.register({
            fake,
            isGlobal: true,
            providers: [{ id: "p", baseUrl: "https://p.test/v1", keys: [{ alias: "one", resolve: () => "sk-test-1" }, { alias: "two", resolve: () => "sk-test-2" }], models: [{ id: "m" }, { id: "m-stream" }] }],
        }),
    ],
    providers: [SummaryService],
}).compile()

const reply = await app.get(AiRouterService).chat({ model: "m", messages: [{ role: "user", content: "hi" }] })
// reply.routing.key === "two"; fake.calls lists both requests with their key, model, headers and body
await app.close()
```

A reply may set `status`, `headers`, `latencyMs`, `error: "network"`, `text`, `usage`, `embedding`, a raw `body`, and
`stream: { chunks, delayMs, failAfter, failWith: "network" | "error-event", stallAfter, stallMs, includeUsage }`.
Everything is deterministic except the latencies you script.

## Security notes

- A key is given as an environment variable name or a resolver; the package never needs a literal in configuration.
  It is read at each attempt (so rotation needs no restart) and is sent only in the `authorization` header to its own
  provider's `baseUrl`.
- Keys are never logged, never put in events, errors, `health()` or `stats()`; every surface names them by alias. An
  error body that echoes the key has it replaced by `[redacted]`.
- Prompts and responses are not in events unless you set `telemetry.includeContent`.
- `headers` in a provider or a call cannot override `authorization`.
- The fake provider records the key values your tests send in `fake.calls`; it is a test double, use test values.
- The gateway never forwards a client's `Authorization` upstream, never answers with `routing` (the key alias), and keeps
  virtual keys as SHA-256 hashes; the admin token is compared in constant time.

## FAQ

**Is this a proxy server?** It can be: `run.js serve` is an OpenAI-compatible gateway with virtual keys. Inside a Nest
app it is also a module you call directly, and `AiRouterGatewayModule` serves the gateway from that process.

**Can I use it outside Nest?** Yes: through the gateway over HTTP from any language, or in Node with `createRouter` and
`createGateway` from `@starci/ai-router/gateway`, which loads no Nest code.

**Does it work with providers that are not OpenAI-compatible?** Only through a compatible gateway; the wire format is
the OpenAI chat-completions and embeddings API.

**Why did my call wait instead of failing?** A lane was going to be usable before the deadline (a `retry-after`, a
breaker cooldown, a concurrency slot). Lower `deadlineMs` to fail sooner.

**Why is a key never used again?** It answered 401/403, or its resolver returned nothing, and `authDisableMs` is `null`
by default. Fix the key and call `service.reset({ provider, key })`, or set `authDisableMs`.

**How do I keep calls on one model?** `allowFallback: false` in the policy or a profile. `providers: [...]` keeps them
on chosen providers.

**Why does a stream throw instead of failing over?** It had already yielded tokens; see [Streaming](#streaming).

**Are costs exact?** They are usage times your configured price; the budget check before a call uses an estimate (four
characters a token, plus `max_tokens`).

## License

MIT
