---
slots: [be.platform.event-bus, be.platform.queue, be.platform.jobs, be.platform, be.integrations]
---
# Infrastructure ownership

Which capability may touch a raw library: exactly one owner per library, reached by everyone else through its port.
The owner table is `ruleParams.be.infraOwners` (`ruleParams.be.lite.infraOwners` narrows it in lite); the clock is
temporal.md, retries resilience.md, logging logging.md.

## BE-INFRA-1 One owner per raw library

A raw library (the queue and Redis clients, the Postgres driver, socket and LISTEN engines, timers, loggers, date
libraries, `node:async_hooks`) is imported only by the platform capability the table names; any other package
dependency outside the framework and pure-library allowlists only by its one provider integration. `@nestjs/config`,
`dotenv`, `@nestjs/schedule` and `@nestjs/event-emitter` are imported nowhere. In lite a backing library is legal only
when `sides.be.backing` declares it (Redis for the queue and the realtime hub); vectors are pgvector.

Why: a library used in two places has two configurations, two failure behaviours and two upgrade paths.

- When code must run something later → a typed queue producer and a job (BE-QUEUES-1, BE-JOBS-4), never `setTimeout`
  or a cron decorator.

Enforced by: `infra-import-owner`, `third-party-import-owner` (R90, R279), `no-ambient-id` (R142).

## BE-INFRA-2 Outbound HTTP goes through the HttpClient port with a required timeout

`platform/http` owns the `HttpClient` port (`request({ method, url, headers?, body? | form? | bytes?, read?, pin?,
redirect?, timeoutMs, signal? })`, built on `fetch`), injected with `@InjectHttpClient()`. `timeoutMs` is required in
the type and comes from the integration's options. Only an integration (and `platform/http` itself) calls the port; a
network failure rejects with its `HttpError`.

Why: a required field makes "every outbound call has a deadline" a type error instead of a lint heuristic.

Enforced by: `http-needs-timeout`, `http-client-only-in-integrations` (R70, R90).

## BE-INFRA-3 An integration is one folder that only it may call

`modules/integrations/<provider>/` holds `index.ts`, `<provider>.config.ts` (`parse<Provider>Config`), `<provider>.options.ts`,
`<provider>.decorators.ts` (the client token, `Inject<Provider>` and `Inject<Provider>Options`), module files,
`<provider>.client.ts` (the only file that speaks the provider's protocol), its contracts, pure policies, `errors/` and
`messages/`. It imports platform only, never the domain. A client answers typed results and turns every failure into
its own error with the cause; it never logs a token.

The folder implements the provider's `integration` record, designed from the provider's current documentation
(PROJECT-WORK-4 in [project/work.md](../../project/work.md)).

Why: a provider is replaceable only when one folder speaks its protocol and nothing above it knows its wire shapes.

```ts
/** Calls one method with the bot token and returns its result; a refusal or a network failure is a TelegramError. */
async call(token: string, method: string, body: TelegramParams = {}): Promise<unknown> {
    const answer = await this.http
        .request({ method: "POST", url: `${this.options.apiBase}/bot${token}/${method}`, body, timeoutMs: this.options.timeoutMs })
        .catch((cause: unknown) => {
            throw new TelegramError({ code: TelegramErrorCode.Unavailable, cause })
        })
    if (!isRecord(answer.body) || answer.body.ok !== true) throw new TelegramError({ code: TelegramErrorCode.Rejected })
    return answer.body.result
}
```

Enforced by: `third-party-import-owner`, `tier-direction`, `http-client-only-in-integrations` (R279, R26, R90), R112.

## BE-INFRA-4 A cache key is declared by the owner that caches

When an app has a cache capability, it exports the `Cache` port (`get`, `set`, `del` over `{ key, args }`) through
`InjectCache()`, and each owner that caches declares its keys in `<owner>.cache-keys.ts` with
`defineCacheKey<TValue>({ name: "<owner>.<key>", ttl, store })`: no free-form string key and no TTL at a call site. Lite
declares no cache unless Redis is a declared backing; a short-lived value is a row with an expiry.

Why: a key declared with its value type and TTL by its owner cannot drift from its readers or collide with another
owner's key.

Enforced by: `infra-import-owner`, `injector-only` (R90, R85); the key form is review only.
