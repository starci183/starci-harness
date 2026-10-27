# Changelog

## 0.2.0 - 2026-10-27

- Breaking: the package is a NestJS module. The root entry is the Nest API (`AiRouterModule`, `AiRouterService`, the tokens and decorators, the options, config, policy and event types, `AiRouterError`, the `StateStore` type); `createRouter`, `definePool`, `validateConfig`, `MemoryStateStore`, `parseSse`, `parseDuration`, `readRateLimit` and `classifyStatus` are no longer exported, and the router engine is reached only through the service.
- Breaking: `@nestjs/common` and `@nestjs/core` (11 or 12) and `reflect-metadata` are required peer dependencies.
- Changed: `createFakeProvider` moved to `@starci/ai-router/testing`, beside `AiRouterTestingModule.register({ fake, ...options })`, which registers the real module with every request sent to the fake and a fixed jitter.
- Added: `AiRouterModule.register(options)` and `AiRouterModule.registerAsync({ imports, inject, useFactory | useClass | useExisting })`, built with `ConfigurableModuleBuilder`, taking the pool config plus `on` handlers and the `isGlobal` and `name` extras.
- Added: the `AiRouterService` (`chat`, `stream`, `embeddings`, `health`, `stats`, `on`, `reset`, typed profiles), the `AI_ROUTER` raw-router token, `@InjectAiRouter(name?)`, `@InjectAiRouterService(name?)`, `getAiRouterToken(name?)` and `getAiRouterServiceToken(name?)`; named registrations hold separate pools in one app.
- Added: on application shutdown the service aborts its calls in flight and releases its handlers.

## 0.1.0 - 2026-10-27

- Added: `createRouter(config)` over a pool of OpenAI-compatible providers, keys (by env var name or resolver, named by alias) and models (aliases, context window, cost, capabilities), with `chat`, `stream`, `embeddings`, `health`, `stats`, `on` and `reset`.
- Added: model policies per call or per named profile (preferred model, ordered fallbacks, `allowFallback`, `maxAttempts`, attempt timeout, total deadline, budget, provider restriction, required capabilities), and the typed builder `definePool()`.
- Added: selection by health and headroom (untried lane, model order, untried key and provider, headroom tier), then least in-flight, latency EWMA within a tolerance, and smooth weighted round-robin; per-key and per-provider concurrency caps that queue instead of failing.
- Added: circuit breakers per key and per provider (closed, open, half-open with one leased probe, doubling cooldown, `retry-after` honoured), error classification, jittered exponential backoff onto a different lane, auth-disabled keys, rate-limit cooldowns from `retry-after` and `x-ratelimit-*` headers, idempotent request ids, cancellation and deadlines.
- Added: SSE streaming with backpressure; fail-over before the first token, an `afterFirstToken` error after it, an idle timeout between chunks.
- Added: `attempt`, `request`, `breaker` and `key-disabled` events with no key values and no content unless `telemetry.includeContent`; key values scrubbed from error messages.
- Added: the pluggable `StateStore` (in-memory `MemoryStateStore` by default) and the deterministic test double `createFakeProvider()`.
