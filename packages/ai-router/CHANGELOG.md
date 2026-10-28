# Changelog

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
