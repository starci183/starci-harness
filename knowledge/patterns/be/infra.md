---
slots: [be.platform.event-bus, be.platform.queue, be.platform.jobs, be.platform, be.integrations]
---
# Infrastructure ownership

Decides which capability may touch a raw library: exactly one platform or integration owner per library, reached by everyone else
through its port. The owner table is `ruleParams.be.infraOwners` (`ruleParams.be.lite.infraOwners` in lite); the clock is
temporal.md, retries resilience.md, logging logging.md.

## BE-INFRA-1 One owner per raw infrastructure library
An import or global reference of a raw library (HTTP clients, cache and Redis clients, queue and broker clients, timers, loggers,
date libraries) is allowed only in its owner named by `ruleParams.be.infraOwners`. Framework scheduling, framework config, dotenv
and in-process event emitters are owned by nobody. Everything else asks the owner's port through its injector. In lite a backing
library (queue, Redis) is legal only when `sides.be.backing` declares it; without a declared Redis the cache is an unlogged
Postgres table of the cache capability, a lock is a Postgres advisory lock or a row claim, and vector search is pgvector.

Why: a library used in two places has two configurations, two failure behaviours and two upgrade paths; one owner keeps timeouts,
retries, logging and clocks in one place.

- When code must run something later → a typed queue producer and a job processor (BE-QUEUES-1, BE-JOBS-4), never `setTimeout`
  or `@Cron`.

Enforced by: R90 BE_INFRA_OWNER, R142 BE_AMBIENT_ID.

## BE-INFRA-2 Outbound HTTP states its timeout in the type
`platform/http` owns the `HttpClient` port, `request({ method, url, headers, body, timeoutMs, correlationId, signal? })`, built on
`fetch` and injected with `InjectHttpClient()`. `timeoutMs` and `correlationId` are required fields; the adapter sends the
correlation id as the outbound `x-request-id` (BE-LOGGING-4). No other HTTP API is reachable outside `platform/http`, and only
integrations call the port. Each timeout matches its provider's contract.

Why: a required field turns "every outbound call has a timeout" from a lint heuristic into a type error.

Enforced by: R70 BE_HTTP_TIMEOUT, R90 BE_INFRA_OWNER.

## BE-INFRA-3 An integration is one folder that only it may call
`modules/integrations/<provider>/` holds `index.ts`, `<provider>.config.ts`, `<provider>.decorators.ts` (the SDK client token and
`Inject<Provider>`), `<provider>.client.ts` (the only file that calls the SDK or the `HttpClient` for that provider), `errors/` and
optional `messages/`. It imports platform only, never the domain; the domain calls its public API. Results are typed, and a
failure is the integration's error or an `Outcome`. Any dependency of the app's `package.json` outside the pure-library and
framework allowlists is imported only by its one provider integration.

Why: a provider is replaceable only when one file speaks its protocol and nothing above it knows the SDK's types.

Enforced by: R279 BE_THIRD_PARTY_OWNER, R90 BE_INFRA_OWNER, R26 BE_TIER_DIRECTION, R112 BE_INTEGRATION_SPEC_MISSING.

## BE-INFRA-4 Cache keys are declared by the owner that caches
`integrations/cache` owns the stores and exports the `Cache` port (`get`, `set`, `del` taking `{ key, args }`) through
`InjectCache()`. The owner that caches declares each key in `<owner>.cache-keys.ts` with
`defineCacheKey<TValue>({ name: "<owner>.<key>", ttl, store })`. No free-form string key, no TTL at a call site, no central key enum.

Why: a key declared with its value type and TTL by its owner cannot drift from its readers or collide with another owner's key.

Enforced by: R90 BE_INFRA_OWNER, R85 BE_RAW_INJECT.
