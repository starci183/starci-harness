# @starci/ai-router design: many providers below, one virtual key above

This is the design of `@starci/ai-router` 0.5: how a pool of upstream providers, each with an array of keys, is
load-balanced behind one OpenAI-compatible gateway, how a key whose quota is spent or whose secret is refused is
blacklisted, and how an app declares all of it from env. The README is the reference of every option; this document
says why the pieces are shaped as they are, and what was read to shape them.

## The shape

```
 clients (above)                          gateway (in process)                            providers (below)
 ───────────────                          ────────────────────                            ─────────────────
 app LangChain client ─┐                                                     ┌── anthropic  [a-1, a-2]   Messages API
 agent runtime ────────┼─ OpenAI HTTP ─▶ virtual key ─▶ profile ─▶ router ──┼── openrouter [or-1..or-9] OpenAI
                       │  model: "work"   STARCI_AI_KEY   work      lanes     ├── qwen       [dashscope-1]  OpenAI
                       │  model: "embed"  quotas, usage   embed     blacklist ├── deepseek   [deepseek-1]   OpenAI
                       └─────────────────────────────────────────── breakers ├── openai     [openai-1..]   OpenAI
                                                                    budgets   ├── gemini     [gemini-1]     OpenAI compat
                                                                              └── groq, ollama, vllm, ...    OpenAI
```

- **Above:** every client of an app speaks OpenAI chat-completions and embeddings to the gateway with one virtual key
  per app and environment (`STARCI_AI_KEY`, `sk-starci-<label>-...`), mounted from a sealed secret
  (`virtualKeyFromEnv`). It names a profile as its `model`. No app uses the admin token or the admin API; both stay in
  the package for an operator who runs the standalone gateway.
- **Below:** each provider is declared with an array of keys (`<PREFIX>_API_KEY`, `_2`, ...). A lane is one
  (provider, key, model). The router picks a lane per attempt by health, weight and headroom, and translates the
  request into the provider's protocol.

## Provider matrix

Read from each provider's official documentation on 2026-10-31. Model ids move fast; they are an app's config, never the
package's. The table is what `PROVIDER_PRESETS` (`src/providers.ts`) encodes.

| kind | default base URL | protocol | auth header | embeddings | env prefix | docs read |
|---|---|---|---|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1` (`/messages`) | Anthropic Messages, through the adapter | `x-api-key`, `anthropic-version: 2023-06-01` | none | `ANTHROPIC` | platform.claude.com/docs/en/api/errors, /api/rate-limits, /api/messages, /build-with-claude/streaming, /build-with-claude/handling-stop-reasons, /build-with-claude/structured-outputs, /models/overview |
| `openrouter` | `https://openrouter.ai/api/v1` | OpenAI | `Authorization: Bearer` (optional `HTTP-Referer`, `X-OpenRouter-Title` as provider `headers`) | yes (`/embeddings`) | `OPENROUTER` | openrouter.ai/docs/api/reference/overview, /errors-and-debugging, /limits, /embeddings |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (Singapore; `DASHSCOPE_BASE_URL` for `dashscope.aliyuncs.com` or a workspace host `{WorkspaceId}.<region>.maas.aliyuncs.com`) | OpenAI (DashScope compatible mode) | `Authorization: Bearer` | yes (`text-embedding-v4`, default 1024 dims) | `DASHSCOPE` | alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope, /error-code, /embedding, /models |
| `deepseek` | `https://api.deepseek.com` | OpenAI | `Authorization: Bearer` | none | `DEEPSEEK` | api-docs.deepseek.com, /quick_start/error_codes, /quick_start/rate_limit |
| `openai` | `https://api.openai.com/v1` | OpenAI | `Authorization: Bearer` | yes (`text-embedding-3-small` 1536, `-large` 3072, `dimensions` accepted) | `OPENAI` | developers.openai.com/api/docs/guides/error-codes, /rate-limits, /embeddings |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI compatibility (beta) | `Authorization: Bearer` | yes (`gemini-embedding-001`, default 3072) | `GEMINI` | ai.google.dev/gemini-api/docs/openai, /api-errors, /rate-limits, /embeddings, /troubleshooting |
| `groq` | `https://api.groq.com/openai/v1` | OpenAI | `Authorization: Bearer` | not declared (unverified) | `GROQ` | console.groq.com/docs/openai, /errors, /rate-limits |
| `openai-compatible` | required | OpenAI | `Authorization: Bearer` | yes | the app names one | docs.ollama.com/api/openai-compatibility, docs.vllm.ai/en/latest/serving/online_serving/ |

Facts that shaped the code:

- A Qwen key works only in the region it was created in; a key sent to another region answers 401 `invalid_api_key`,
  which is a refused secret here. Give each region its own provider entry and base URL.
- Gemini's limits are per Google Cloud project, not per key, so several keys of one project share one bucket; spread
  keys over projects for real headroom.
- DeepSeek's concurrency is per account; two keys of one account do not double it.
- OpenRouter can answer an error inside a 200 body, and mid-stream as a chunk with `error` and `finish_reason: "error"`;
  both are classified like an error status.
- DeepSeek sends empty lines on a slow non-streaming answer and `: keep-alive` comments in a stream; JSON parsing and the
  SSE parser skip both.
- Anthropic's own OpenAI-compatible endpoint is documented for testing, not production (no prompt caching, `json_object`
  refused), so the package speaks the Messages API through its own adapter instead.

What the docs did not show and is marked unverified: the literal JSON error bodies of DashScope compatible mode and
DeepSeek (status codes are documented, bodies are assumed OpenAI-style; the classifier also reads their messages),
Gemini's list-wrapped error form (both forms are read), and Groq's embeddings.

## Error classification

`classifyFailure(kind, status, body)` (`src/classify.ts`) reads any of the shapes (OpenAI `{ error: { message, type,
code, param } }`, Anthropic `{ type: "error", error: { type, message, details } }`, OpenRouter `{ error: { code: <status>,
message, metadata } }`, Gemini object or `[{ error: { code, message, status } }]`, DashScope `{ code, message }`) and
decides in this order: a refused secret, a spent quota (some providers send it as 429 or 400), a rate limit, then the
status alone.

| class | effect on the key | retried |
|---|---|---|
| `rate_limit` | the lane cools down until `retry-after` (else `rateLimitCooldownMs`) | at once, another lane |
| `quota` | the key is blacklisted until its window ends or its secret changes | at once, another key |
| `auth` | the key is blacklisted until its secret changes (or `authDisableMs`) | at once, another key |
| `transient` | the key's and provider's breakers count it | after backoff, another lane |
| `invalid_request` | none | no: the caller's request is wrong |

| provider | rate_limit | quota (window) | auth | transient | invalid_request |
|---|---|---|---|---|---|
| Anthropic | 429 `rate_limit_error` | 402 `billing_error` (TTL); 429 with `details.error_code: enforced_spend_limit_reached` (next UTC month); 400 "You have reached your specified API usage limits" (TTL) | 401 `authentication_error`, 403 `permission_error` | 500 `api_error`, 504 `timeout_error`, 529 `overloaded_error`, SSE `event: error` | other 400, 404, 413 |
| OpenRouter | 429; 402 `metadata.limit_source: openrouter_in_flight_budget` | 402 `openrouter_credits`, `openrouter_key_limit` (TTL); 429 "free-models-per-day" (next 00:00 UTC) | 401 | 408, 502, 503, a 200 with `error` | 400, 403 (moderation) |
| Qwen (DashScope) | 429 `Throttling`, `Throttling.RateQuota`, `Throttling.AllocationQuota`, `Throttling.BurstRate` | 400 `Arrearage`, 403 `AllocationQuota.FreeTierOnly` (TTL) | 401 `InvalidApiKey` / `invalid_api_key`, 403 `AccessDenied`, `Model.AccessDenied` | 500 `InternalError` | 400 `InvalidParameter`, `DataInspectionFailed`, 404 `ModelNotFound` |
| DeepSeek | 429 | 402 "Insufficient Balance" (TTL) | 401 | 500, 503 | 400, 422 |
| OpenAI | 429 `rate_limit_exceeded`, `slow_down` | 429 `insufficient_quota`, `credit_balance_exhausted` (TTL); `organization_usage_limit_exceeded`, `*_spend_limit_exceeded` (next UTC month) | 401 `invalid_api_key`, 403 (region) | 500, 503 `server_is_overloaded` | 400, 404 |
| Gemini | 429 per-minute (`RESOURCE_EXHAUSTED`, `rate_limit_exceeded`, `too_many_requests`) | 429 `quota_exceeded` or a per-day limit (next midnight America/Los_Angeles); 402 `payment_required`; 400 `failed_precondition` naming billing | 401 `authentication`, "API key not valid", 403 `permission_denied`, "reported as leaked" | 500, 503, 504 | 400, 404 |
| Groq | 429 tokens per minute | 429 on requests per day (until `x-ratelimit-reset-requests`) | 401 | 498 (flex capacity), 500, 502, 503 | 400, 413, 422 |
| openai-compatible | 429 | 402 | 401, 403 | 5xx, connection refused | other 4xx |

Gemini words its per-minute 429 like a spent quota ("You exceeded your current quota"); only a per-day limit or the
`quota_exceeded` code is treated as one, else a short cooldown would become a day-long blacklist. The fake provider's
`PROVIDER_ERRORS` holds every row as the provider answers it, and `test/classify.test.ts` holds the table to it.

## Blacklist lifecycle

```
            401/403, invalid key ─────────────▶ blacklisted (auth)  ── until the secret changes, or authDisableMs
 healthy ── 402, quota/credit/billing codes ──▶ blacklisted (quota) ── until its window ends, or the secret changes
            no secret (unset env, resolver threw) ▶ blacklisted (missing) ── until a secret is set
            429 ──────────────────────────────▶ cooling down        ── until retry-after (short)
            5xx, timeout, network ────────────▶ breaker counts      ── closed / open / half-open probe
```

- **Where it lives.** The key's `HealthRecord` in the pool's `StateStore`: `disabledUntil`, `disabledReason`
  (`auth`, `missing`, `quota`), `disabledCode` (the provider's code) and `fingerprint`. With `openSqliteStateStore`
  (one host) or `redisStateStore` (several) a restart reads it back, so a dead key is not hammered again; the default
  memory store forgets it. A record written by 0.4 reads with the new fields empty.
- **Until when.** A quota uses, in order: the window the answer names (next UTC month for Anthropic's spend cap and
  OpenAI's monthly limits, next Pacific midnight for Gemini's daily quota, next UTC midnight for OpenRouter's free daily
  cap), Groq's `x-ratelimit-reset-requests` when the request limit is at 0, else `resilience.quotaBlacklistMs` (default 6
  hours); a later `retry-after` wins. A refused secret lasts until the secret changes (`authDisableMs: null`, the
  default). Expiry is lazy: a past `disabledUntil` is simply usable.
- **A new secret lifts it.** The record keeps a 64-bit fingerprint (namespaced SHA-256, truncated) of the secret it
  refused, never the secret. Each pick resolves the secret of a blacklisted key and compares: a rotated env variable,
  a re-sealed `_FILE` or a resolver's new value brings the key back at once, with a `key-restored` event.
- **Observable.** `key-disabled` carries the alias, the reason, the provider's code and `until`; `key-restored` the
  alias and what it was out for; `health()` shows `disabledReason` and `disabledUntil` per key. No surface carries a
  secret.
- **Everything blacklisted.** When every lane is out because its key is blacklisted (or its provider is past its
  budget) and none returns before the call's deadline, the call fails at once with class `quota` (any spent quota or
  budget) or `auth`, naming the keys and the earliest return as `retryAt`. The gateway answers 503
  `pool_quota_exhausted` or 503 `pool_auth_failed`, with `Retry-After` at that return, or 300 seconds when none is
  known. A blacklist shorter than the deadline is waited out, like a cooldown.

## Selection

Unchanged in spirit from 0.4: a lane is out while blacklisted, breaker-open, cooling down, out of headroom or at its
concurrency cap (`key.maxConcurrency`, `provider.maxConcurrency`, per process). Tiers: untried lane, candidate tier,
untried key, untried provider, headroom; then fewest in flight, latency EWMA within tolerance (after three samples),
smooth weighted round-robin by `provider.weight * key.weight * model.weight * candidate.weight`. New: a provider may
carry a `budget` (`costPerDay`, `costPerMonth`, in the models' cost unit), spent from usage and kept in the store; past
it the provider is out until the next UTC day or month. Budget writes are read-modify-write, so two processes may
overshoot by one call each.

## Profiles

A profile is a named policy. `work` takes ordered tiers of `(provider, model)` candidates; a tier that is a list shares
its load by weight, and the router falls to the next tier when the tier has no usable lane:

```ts
work: {
    candidates: [
        [{ provider: "anthropic", model: "claude-sonnet-5-5", weight: 3 }, { provider: "openrouter", model: "anthropic/claude-sonnet-5-5" }],
        { provider: "deepseek", model: "deepseek-v4-pro" },
        { provider: "qwen", model: "qwen3.8-max" },
    ],
},
embed: { pinned: true, candidates: [[{ provider: "openai", model: "text-embedding-3-small" }, { provider: "openrouter", model: "openai/text-embedding-3-small" }]] },
```

`embed` is pinned: every candidate must resolve to models of one `identity` (`openai/text-embedding-3-small` at
OpenRouter declares `identity: "text-embedding-3-small"`) and one `dimensions`, or the pool is refused at startup; a call
cannot name another model; a vector of another length fails its lane and is never returned. Beyond pinned profiles,
every embeddings call stays on the identity of its first lane, and the gateway gives a direct embeddings model no
fallback: another model is another vector space, and an index holds one.

`model` and `fallbacks` keep working as in 0.4; a policy gives `candidates` or them, not both.

## Key scopes

A virtual key carries the profiles it may call (`work`, `embed`; more named profiles such as `fast`, `reason` or
`vision` later) and, optionally, an allowlist of exact catalog model ids, empty by default. A client sends
`model: "<profile>"`; the profile's candidates live only in the router config.

- A request naming neither one of the key's profiles nor a model on its allowlist is refused 403 `model_not_allowed`.
  It is never remapped to a profile silently.
- An allowlisted model goes through the same pool, keys, blacklist and budgets as a profile, and the key's quotas and
  cost caps count it the same: they are per virtual key, whatever the model.
- An embeddings request is served by the pinned `embed` profile's model only. A key cannot allowlist another embedding
  model into `embed`; a second embeddings space is a separately named profile with its own index.
- `GET /v1/models` lists only what the calling key may use.

Why profiles and not a free model choice: a profile keeps cost, failover and model upgrades in one place. The model
behind `work` is swapped in the router config, without touching an app. A free model choice would bypass the budget
planning and the fallback chains, and pin apps to provider ids that change every few months. The allowlist covers the
rare caller that genuinely needs one specific model, by name and on purpose.

## The Anthropic adapter

`src/wire/anthropic.ts` translates OpenAI chat-completions to the Messages API and back. The router keeps every
other concern (lanes, retries, breakers, blacklist) protocol-free through the `Wire` interface (`src/wire/wire.ts`):
auth headers, request body, unary answer and stream events.

| OpenAI request | Anthropic request |
|---|---|
| `system` and `developer` messages | top-level `system`, joined by a blank line |
| `user` content string or parts; `image_url` (data URL or URL) | `text` blocks; `image` with a `base64` or `url` source; empty text left out |
| `assistant` content and `tool_calls` | `text` blocks then `tool_use` blocks (`arguments` parsed; not JSON is refused) |
| `tool` messages | `tool_result` blocks in a user turn; consecutive turns of one role merge |
| `max_completion_tokens` / `max_tokens` | `max_tokens` (required: else the provider's `defaultMaxTokens`, else 4096) |
| `stop` | `stop_sequences` |
| `tools` (`function`) | `{ name, description, input_schema, strict }`; other tool types pass as they are |
| `tool_choice` `auto` / `none` / `required` / `{ function }`, `parallel_tool_calls: false` | `auto` / `none` / `any` / `{ type: "tool", name }`, `disable_parallel_tool_use` |
| `response_format` `json_schema` | `output_config.format` `json_schema` (structured outputs) |
| `response_format` `json_object` | a system instruction (Anthropic has no JSON mode) |
| `user` | `metadata.user_id` |
| `temperature`, `top_p`, and `top_k`, `thinking`, `output_config`, `service_tier` | as they are |
| `n` above 1 | refused, `invalid_request` |
| `seed`, penalties, `logprobs`, `stream_options` | dropped |

Answers: text blocks join into `content`, `tool_use` blocks become `tool_calls`, thinking blocks are dropped;
`stop_reason` maps `end_turn`/`stop_sequence`/`pause_turn` to `stop`, `max_tokens`/`model_context_window_exceeded` to
`length`, `tool_use` to `tool_calls`, `refusal` to `content_filter`; usage counts cache reads and writes into
`prompt_tokens` and reports cache reads as `prompt_tokens_details.cached_tokens`.

Streams: `message_start` becomes the role chunk; `text_delta` content chunks; a `tool_use` block start a `tool_calls`
delta with id and name, and its `input_json_delta` pieces argument deltas at the tool call's own index; `message_delta`
the finish reason (its usage is cumulative); `message_stop` a final usage chunk. `ping`, `content_block_stop`, thinking
deltas and event types Anthropic adds later are skipped, as its docs ask. An `error` event is classified like an error
status; a stream that ends before `message_stop` is a failed attempt. Failover is before the first token only, as for
every provider.

Current models need care the adapter does not take for you: forced tool use (`tool_choice` `any`/`tool`) is refused on
Opus 5.5 and Sonnet 5.5, a `temperature` below 1 on 4.7 and later, and assistant prefill on 4.6 and later. These answer 400
and are not retried.

## Config from env

`poolFromEnv(spec, env)` (`src/env.ts`) is what an app calls instead of hand-rolling `<PROVIDER>_API_KEY_2...`:

| variable | meaning |
|---|---|
| `<PREFIX>_API_KEY`, `<PREFIX>_API_KEY_2`, ... `_<n>` | one key each, aliases `<id>-1`, `<id>-2`, ... (gaps allowed, no upper bound) |
| `<PREFIX>_API_KEY_FILE`, `<PREFIX>_API_KEY_<n>_FILE` | the same key as a mounted file (first line); both forms for one number is refused |
| `<PREFIX>_API_KEYS` | a list in one variable, split at commas and whitespace, aliases `<id>-list-<i>` |
| `<PREFIX>_BASE_URL` | moves the endpoint (a Qwen region or workspace host, an Ollama host) |
| `STARCI_AI_KEY`, `STARCI_AI_KEY_FILE` | the app's virtual key, `virtualKeyFromEnv` |

Prefixes: `ANTHROPIC`, `OPENROUTER`, `DASHSCOPE` (Qwen, the name Alibaba's own SDKs read), `DEEPSEEK`, `OPENAI`,
`GEMINI`, `GROQ`; an `openai-compatible` provider names its own (`OLLAMA`, `VLLM`, `TOGETHER`). Keys are references
read at each attempt; the helper never copies a value. A provider with no key in env is left out, and every profile is
cut down to the candidates the present providers serve, so one declaration deploys with whatever keys an environment
has; a profile left with nothing is refused at startup naming the variables that would serve it. The config file takes
`keysFromEnv: <PREFIX>` on a provider for the same discovery.

```ts
const pool = poolFromEnv({
    providers: [
        { kind: "anthropic", models: [{ id: "claude-sonnet-5-5", cost: { input: 3, output: 15 } }] },
        { kind: "openrouter", models: [{ id: "anthropic/claude-sonnet-5-5" }, { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", dimensions: 1536, capabilities: ["embeddings"] }] },
        { kind: "deepseek", models: [{ id: "deepseek-v4-pro" }] },
        { kind: "qwen", models: [{ id: "qwen3.8-max" }] },
        { kind: "openai", models: [{ id: "text-embedding-3-small", dimensions: 1536, capabilities: ["embeddings"] }] },
    ],
    profiles: { work: { candidates: [...] }, embed: { pinned: true, candidates: [...] } },
    store: await openSqliteStateStore("/data/ai-router-state.sqlite"),
})
```

## Constraints

- Breakers, blacklists, headroom and budgets are per process unless the `store` is shared; in-flight counts, latency
  EWMAs and round-robin positions are always per process.
- One gateway host per app unless the store is Redis: the SQLite store is shared only by processes on one host.
- A stream fails over only before its first token; after it, the error reaches the caller with `afterFirstToken`.
- Store updates are read-modify-write: two processes failing at once may count one failure, and a budget may be
  overshot by one call per process.
- A blacklisted key's secret is resolved at each pick to notice a new one: a resolver that is slow or rate-limited (a
  vault) is called that often.

## Migration from 0.4

- `ProviderConfig.baseUrl` is optional for a kind with a default; `kind` defaults to `openai-compatible`, so a 0.4 pool
  routes exactly as before.
- `ErrorClass` gains `quota`. A spent quota was a 429 `rate_limit` with a 10-second cooldown; it is now a blacklist.
  Code that switches over `errorClass` adds the case.
- `KeyDisabledEvent.reason` gains `quota` and the event may carry `code`; `KeyHealth` gains `disabledUntil`;
  `ProviderHealth` gains `kind` and `spend`; `CatalogProfile` gains `pinned` and `serves`; `RouterEvents` gains
  `key-restored`.
- A key refused for its secret comes back when the secret changes, without `reset()`; a missing secret comes back when
  it is set.
- When every key is blacklisted, the router fails with `quota` or `auth` rather than `no_candidate`, and the gateway
  answers 503 (`pool_auth_failed` was 502) with `Retry-After`.
- Embeddings never fall back to another model identity, and the gateway gives a direct embeddings model no fallback.
- `HealthRecord` gains fields; a custom `StateStore` adapter stores them as it stores the rest (records it wrote before
  read with the new fields empty).
- Apps replace hand-rolled key lists (`OPENROUTER_API_KEY` plus `_2..._9`) with `poolFromEnv`, keep `STARCI_AI_KEY` as
  their one virtual key (`virtualKeyFromEnv`), pass no admin token, and pass a durable `store`.
