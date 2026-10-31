# Changelog

## 0.5.0 - 2026-10-31

Many providers below, each with an array of keys, behind one virtual key per app above; a key whose quota is spent or
whose secret is refused is blacklisted. [docs/design.md](docs/design.md) holds the provider matrix (read from each
provider's docs on 2026-10-31), the classification table, the blacklist lifecycle, profiles and key scopes, the
Anthropic adapter and the env naming.

- Added: provider kinds, `ProviderConfig.kind` (`anthropic`, `openrouter`, `qwen`, `deepseek`, `openai`, `gemini`, `groq`, `openai-compatible`), each with its default base URL, auth header, embeddings support and error classification (`PROVIDER_PRESETS`); `baseUrl` is optional for a kind that has one.
- Added: the Anthropic Messages adapter: OpenAI chat-completions in, `/v1/messages` with `x-api-key` and `anthropic-version` out, and back, for chat, SSE streaming (text and `tool_use` deltas, finish reason, usage, error events, a stream cut before `message_stop`), tools and `tool_choice`, tool results, images, `json_schema` as structured output, cache tokens in usage; `defaultMaxTokens` for the `max_tokens` Anthropic requires. Anthropic `anthropic-ratelimit-*` headers (RFC 3339 resets) and OpenRouter's epoch-millisecond `X-RateLimit-Reset` feed headroom.
- Added: the error class `quota` and per-provider classification (`classifyFailure`, `readProviderError`) of every error shape the providers document: OpenAI, Anthropic, OpenRouter (402 by `limit_source`, errors in a 200 body and mid-stream), DashScope codes, DeepSeek, Gemini (object or list, per-minute vs per-day), Groq (498, daily requests).
- Added: the key blacklist. A spent quota blacklists the key until the provider's window ends (next UTC month for Anthropic's spend cap and OpenAI's monthly limits, next Pacific midnight for Gemini's daily quota, next UTC midnight for OpenRouter's free daily cap, Groq's request reset), else `resilience.quotaBlacklistMs` (default 6 hours); a refused or missing secret until the secret changes. A 64-bit fingerprint of the refused secret is kept (never the secret), and a new secret lifts the blacklist at the next pick with the new `key-restored` event. `key-disabled` carries the provider's `code`; `KeyHealth.disabledUntil`.
- Added: when every key that could serve is blacklisted (or its provider past its budget), the call fails at once with class `quota` or `auth`, naming the keys, with `retryAt` at the earliest return; the gateway answers 503 `pool_quota_exhausted` or 503 `pool_auth_failed` with `Retry-After` (300 seconds when no return is known).
- Added: durable state stores, so a restart does not hammer dead keys: `openSqliteStateStore(path)` and `redisStateStore(client)` over a five-command `RedisLike`; `stateStore: { type: sqlite, path }` in the config file; `toHealthRecord` and `parseHealthRecord` for an adapter; `MemoryStateStore` and `EMPTY_RECORD` are exported again.
- Added: profile candidates, `ModelPolicy.candidates`: ordered tiers of `{ model, provider?, weight? }`, a tier that is a list sharing its load by weight; `pinned` profiles whose candidates must be one model `identity` and `dimensions` (`ModelConfig.identity`, `ModelConfig.dimensions`), which a call cannot override; an embeddings vector of another length fails its lane; every embeddings call stays on one model identity, and the gateway gives a direct embeddings model no fallback. `CatalogProfile.pinned` and `serves`; a profile on the wrong route is 400 `model_not_supported`.
- Added: provider budgets, `ProviderConfig.budget` (`costPerDay`, `costPerMonth`), kept in the store; `ProviderHealth.spend` and `kind`.
- Added: config from env: `poolFromEnv`, `providersFromEnv` and `keysFromEnv` read `<PREFIX>_API_KEY`, `_2` ... `_<n>`, their `_FILE` twins, a `<PREFIX>_API_KEYS` list and `<PREFIX>_BASE_URL` (prefixes ANTHROPIC, OPENROUTER, DASHSCOPE, DEEPSEEK, OPENAI, GEMINI, GROQ) as references read at each attempt, keep the providers that have keys and cut every profile to what they serve; `virtualKeyFromEnv` mounts the app's `STARCI_AI_KEY` (or `STARCI_AI_KEY_FILE`); `keysFromEnv: <PREFIX>` on a config-file provider.
- Added: the fake provider answers `/messages` in the Anthropic shape (unary and SSE), reads `x-api-key`, scripts `toolCalls`, and `PROVIDER_ERRORS` (from `@starci/ai-router/testing`) holds each provider's real error answers.
- Fixed: a provider or call header differing from the router's own only in case (`Anthropic-Version`) is one header, not two.

### Migration from 0.4

- A 0.4 pool routes as before: `kind` defaults to `openai-compatible`, whose classification is 0.4's plus `quota` for 402 and the quota codes.
- `ErrorClass` has `quota`: a spent quota was a `rate_limit` with a 10-second cooldown and is now a blacklist; a `switch` over `errorClass` adds the case.
- When every key is blacklisted the router fails with `quota` or `auth`, no longer `no_candidate`, and the gateway answers 503 where `pool_auth_failed` was 502.
- A key refused for its secret comes back when the secret changes, without `reset()`; a missing secret when it is set.
- `KeyDisabledEvent.reason` adds `quota`, the event may carry `code`; `KeyHealth` adds `disabledUntil`, `ProviderHealth` `kind` (and `spend`), `CatalogProfile` `pinned` and `serves`, `RouterEvents` `key-restored`, `HealthRecord` its blacklist and budget fields (records 0.4 stored read with them empty).
- Embeddings never fall back to another model identity.
- Apps replace a hand-rolled `<PROVIDER>_API_KEY` plus `_2` ... `_9` list with `poolFromEnv`, keep `STARCI_AI_KEY` as their one virtual key (`virtualKeyFromEnv`), pass no admin token, and pass a durable `store`.

## 0.4.1 - 2026-10-30

- Changed: the lint configuration is TypeScript (eslint.config.ts, loaded through jiti 2.7.0, an exact devDependency) and typechecked with the package; no runtime change.

## 0.4.0 - 2026-10-30

- Added: mounted keys, `GatewayOptions.mountedKeys` (and so `AiRouterGatewayModule`'s options): virtual keys from secrets the app already holds (`{ label, secret: string | (() => string), owner?, profiles?, models?, allowFallback?, quota?, enabled? }`, the `MountedKeySpec` type), so a deploy needs no `keys create`. Each secret is read once at startup, must start with `sk-starci-<label>-` followed by at least 32 letters, digits, `_` or `-`, and is kept only as its SHA-256 with its bindings in memory; a mounted key is never written to the key store. A bearer token is matched against the mounted keys before the store. Each mounted key has the stable id `key_` + 16 hex of `sha256("mounted:<label>")`, so its quota counters and usage rows survive a new secret and every deploy.
- Added: `MountedKeyError` (`code` `invalid`, `duplicate_label` or `collision`, and the `label`), naming the label and key id, never the secret. An invalid mounted key or a label given twice throws from `createGateway`; a secret or id a stored key already holds rejects the new `gateway.ready()`, which `listen`, `handle` and `AiRouterGatewayModule` (whose gateway provider is now async) await, so the app refuses to start.
- Added: `VirtualKey.mounted` (`true` on a mounted key, absent otherwise); `KeyAdmin.list` and `get` show mounted keys, and `revoke`, `rotate` and `update` refuse one with the new `KeyAdminError` code `mounted`, which the admin API answers 409 `key_mounted`. `KeyAdmin`'s options are the exported `KeyAdminOptions` (`catalog`, `clock`, `mounted`).

## 0.3.0 - 2026-10-28

- Added: an OpenAI-compatible HTTP gateway over the same router (`createGateway(router, options)`): `POST /v1/chat/completions` (SSE streaming in OpenAI's chunk format, ending with `[DONE]`), `POST /v1/embeddings`, `GET /v1/models` (the profiles and pool models the calling key may use), `GET /health`, and OpenAI error objects with 400, 401, 403, 404, 413, 429 (with `Retry-After`), 502, 503 and 504. A request's `model` names a profile or a pool model id or alias.
- Added: virtual API keys (`sk-starci-<label>-<random>`), stored as SHA-256 only and shown once at create and rotate, each bound to profiles, models, fallback, quotas (requests per minute, tokens per day, cost per day and month), enabled and revoked state, label and owner; usage per key and UTC day (requests, outcomes, tokens, estimated cost, latency), with no prompt or end-user identifier. `KeyAdmin` (create, list, get, update, revoke, rotate, usage), the `KeyStore` interface, `MemoryKeyStore`, and the durable `openSqliteKeyStore(path)` over `node:sqlite` with its `KEY_STORE_SCHEMA`.
- Added: the admin API under `/admin/keys`, guarded by an admin token, and the commands `serve --config <pool.yaml|json>` and `keys create|list|get|update|revoke|rotate|usage`, on the durable store (`--config`) or through a running gateway (`--url`), run by the process entry `dist/gateway/run.js` or in process with `main` from `@starci/ai-router/cli`; the package declares no `bin`, since the harness has one CLI. The config file names every secret by reference (`{ env }` or `{ file }`) and refuses one written inline. `loadGatewayConfig`, `parseGatewayConfig`, `serveGateway`, `openKeyStore`.
- Added: `AiRouterGatewayModule.register` / `registerAsync` hosting the gateway in a Nest app over a registered router, `AI_ROUTER_GATEWAY`, `getAiRouterGatewayToken` and `@InjectAiRouterGateway()`.
- Added: the gateway's port follows the StarCi port convention (`basePort + portOffset`: FE base+0, API base+1): `AiRouterGatewayModule`'s `listen` takes `{ port }` (explicit), or `true` / `{ offset?, host? }` for the app's own bound port plus `offset` (default 1, so an API on 3001 serves its gateway on 3002), on `127.0.0.1` unless `host` is set. The app's port is read from its HTTP server once it listens (the module waits for `listening`, since Nest bootstraps before `app.listen`), from `PORT` when the app has no HTTP server, and bootstrap refuses with an `AiRouterError` when neither is known; a bind failure goes to `onError`. `serve` takes `gateway.appPort` + `gateway.portOffset` in place of `gateway.port`.
- Added: `catalog()` on the router and `AiRouterService`: the pool's profiles and models by name.
- Changed: `createRouter(config)` is exported again, from the root and from the new Nest-free entry `@starci/ai-router/gateway`. 0.2.0 removed it to make the Nest module the one entry, not because the engine changed; with the gateway it is again the one engine behind the service, the gateway and plain Node apps.
- Changed: the Nest peer dependencies are optional, since the gateway and cli entries load no Nest code; `yaml` is a dependency for the config file.

## 0.2.1 - 2026-10-28

- Fixed: 0.2.0 shipped corrupt declarations: the build rewrote `.ts` specifiers with a `$1` that sh expanded to nothing, so every `dist/*.d.ts` read `export { X } .js";` and a consumer tsc failed. The declaration step now names `.js` with a replacer function and `"`, and reads alike under sh and cmd.

## 0.2.0 - 2026-10-27

- Breaking: the package is a NestJS module. The root entry is the Nest API (`AiRouterModule`, `AiRouterService`, the tokens and decorators, the options, config, policy and event types, `AiRouterError`, the `StateStore` type); `createRouter`, `definePool`, `validateConfig`, `MemoryStateStore`, `parseSse`, `parseDuration`, `readRateLimit` and `classifyStatus` are no longer exported, and the router engine is reached only through the service.
- Breaking: `@nestjs/common` and `@nestjs/core` (11 or 12) and `reflect-metadata` are required peer dependencies.
- Changed: `createFakeProvider` moved to `@starci/ai-router/testing`, beside `AiRouterTestingModule.register({ fake, ...options })`, which registers the real module with every request sent to the fake and a fixed jitter.
- Added: `AiRouterModule.register(options)` and `AiRouterModule.registerAsync({ imports, inject, useFactory | useClass | useExisting })`, built with `ConfigurableModuleBuilder`, taking the pool config plus `on` handlers and the `isGlobal` and `name` extras.
- Added: the `AiRouterService` (`chat`, `stream`, `embeddings`, `health`, `stats`, `on`, `reset`, typed profiles), the `AI_ROUTER` raw-router token, `@InjectAiRouter(name?)`, `@InjectAiRouterService(name?)`, `getAiRouterToken(name?)` and `getAiRouterServiceToken(name?)`; named registrations hold separate pools in one app.
- Added: on application shutdown the service aborts its calls in flight and releases its handlers.
- Fixed: latency ranks a lane only after three samples, so one cold call no longer takes a key out of rotation, and a lane latency leaves out drifts back toward the best EWMA and is retried instead of being starved.

## 0.1.0 - 2026-10-27

- Added: `createRouter(config)` over a pool of OpenAI-compatible providers, keys (by env var name or resolver, named by alias) and models (aliases, context window, cost, capabilities), with `chat`, `stream`, `embeddings`, `health`, `stats`, `on` and `reset`.
- Added: model policies per call or per named profile (preferred model, ordered fallbacks, `allowFallback`, `maxAttempts`, attempt timeout, total deadline, budget, provider restriction, required capabilities), and the typed builder `definePool()`.
- Added: selection by health and headroom (untried lane, model order, untried key and provider, headroom tier), then least in-flight, latency EWMA within a tolerance, and smooth weighted round-robin; per-key and per-provider concurrency caps that queue instead of failing.
- Added: circuit breakers per key and per provider (closed, open, half-open with one leased probe, doubling cooldown, `retry-after` honoured), error classification, jittered exponential backoff onto a different lane, auth-disabled keys, rate-limit cooldowns from `retry-after` and `x-ratelimit-*` headers, idempotent request ids, cancellation and deadlines.
- Added: SSE streaming with backpressure; fail-over before the first token, an `afterFirstToken` error after it, an idle timeout between chunks.
- Added: `attempt`, `request`, `breaker` and `key-disabled` events with no key values and no content unless `telemetry.includeContent`; key values scrubbed from error messages.
- Added: the pluggable `StateStore` (in-memory `MemoryStateStore` by default) and the deterministic test double `createFakeProvider()`.
