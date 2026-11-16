# @starci/ai-router design: many providers below, one virtual key above

This is the design of `@starci/ai-router`: how a pool of upstream providers, each with an array of keys, is
load-balanced behind one gateway that speaks the OpenAI and the Anthropic protocols, how a key whose quota is spent or
whose secret is refused is blacklisted, how prompt caching and thinking cross the protocols, and how an app declares
all of it from env. The README is the reference of every option; this document
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

- **Above:** every client of an app speaks OpenAI chat-completions and embeddings, or Anthropic Messages
  (`/v1/messages`), to the gateway with one virtual key per app and environment (`STARCI_AI_KEY`,
  `sk-starci-<label>-...`), mounted from a sealed secret (`virtualKeyFromEnv`). It names a profile as its `model`; a
  LangChain app asks `@starci/ai-router/langchain` for the client of that name. No app uses the admin token or the admin API; both stay in
  the package for an operator who runs the standalone gateway.
- **Below:** each provider is declared with an array of keys (`<PREFIX>_API_KEY`, `_2`, ...). A lane is one
  (provider, key, model). The router picks a lane per attempt by health, weight and headroom, and translates the
  request into the provider's protocol.

## Provider matrix

Read from each provider's official documentation on 2026-10-31. Model ids move fast; they are an app's config, never the
package's. The table is what `PROVIDER_PRESETS` (`src/providers.ts`) encodes.

| kind | default base URL | protocol | auth header | embeddings | env prefix | docs read |
|---|---|---|---|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1` (`/messages`) | Anthropic Messages, through the adapter | `x-api-key`, `anthropic-version: 2023-06-01` | none | `ANTHROPIC` | platform.claude.com/docs/en/api/errors, /api/rate-limits, /api/messages, /build-with-claude/streaming, /build-with-claude/handling-stop-reasons, /build-with-claude/structured-outputs, /models/overview; on 2026-11-10 /build-with-claude/prompt-caching, /thinking, /thinking-tool-workflows, /preserved-thinking |
| `openrouter` | `https://openrouter.ai/api/v1` | OpenAI | `Authorization: Bearer` (optional `HTTP-Referer`, `X-OpenRouter-Title` as provider `headers`) | yes (`/embeddings`) | `OPENROUTER` | openrouter.ai/docs/api/reference/overview, /errors-and-debugging, /limits, /embeddings |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (Singapore; `DASHSCOPE_BASE_URL` for `dashscope.aliyuncs.com` or a workspace host `{WorkspaceId}.<region>.maas.aliyuncs.com`) | OpenAI (DashScope compatible mode) | `Authorization: Bearer` | yes (`text-embedding-v4`, default 1024 dims) | `DASHSCOPE` | alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope, /error-code, /embedding, /models |
| `deepseek` | `https://api.deepseek.com` | OpenAI | `Authorization: Bearer` | none | `DEEPSEEK` | api-docs.deepseek.com, /quick_start/error_codes, /quick_start/rate_limit |
| `openai` | `https://api.openai.com/v1` | OpenAI | `Authorization: Bearer` | yes (`text-embedding-3-small` 1536, `-large` 3072, `dimensions` accepted) | `OPENAI` | developers.openai.com/api/docs/guides/error-codes, /rate-limits, /embeddings |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI compatibility (beta) | `Authorization: Bearer` | yes (`gemini-embedding-001`, default 3072) | `GEMINI` | ai.google.dev/gemini-api/docs/openai, /api-errors, /rate-limits, /embeddings, /troubleshooting |
| `groq` | `https://api.groq.com/openai/v1` | OpenAI | `Authorization: Bearer` | not declared (unverified) | `GROQ` | console.groq.com/docs/openai, /errors, /rate-limits |
| `local` | `http://localhost:11434/v1` (Ollama) | OpenAI | `Authorization: Bearer`, only when a key is set | yes (`/v1/embeddings`, else Ollama's `/api/embed`) | `LOCAL_AI` | docs.ollama.com/api/openai-compatibility, docs.ollama.com/gpu (read 2026-11-17) |
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
| `model_not_found` | none | no: a `local` server does not hold the model (404 with a JSON error); the caller pulls it |

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
| local | 429 | 402 | 401, 403 | 5xx, connection refused (`network`) | other 4xx; `model_not_found` for a 404 with a JSON error |

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
| `system` and `developer` messages | top-level `system`: one string joined by a blank line, or blocks when a part marks a cache breakpoint |
| `cache_control` on a part, a message, a tool or the top level | the same breakpoint on the block, the tool or the request ("Prompt caching") |
| `user` content string or parts; `image_url` (data URL or URL) | `text` blocks; `image` with a `base64` or `url` source; empty text left out |
| `assistant` content and `tool_calls` | `text` blocks then `tool_use` blocks (`arguments` parsed; not JSON is refused) |
| `tool` messages | `tool_result` blocks in a user turn; consecutive turns of one role merge |
| `max_completion_tokens` / `max_tokens` | `max_tokens` (required: else the model's `params`, else the provider's `defaultMaxTokens`, else 16000) |
| `stop` | `stop_sequences` |
| `tools` (`function`) | `{ name, description, input_schema, strict }`; other tool types pass as they are |
| `tool_choice` `auto` / `none` / `required` / `{ function }`, `parallel_tool_calls: false` | `auto` / `none` / `any` / `{ type: "tool", name }`, `disable_parallel_tool_use` |
| `response_format` `json_schema` | `output_config.format` `json_schema` (structured outputs) |
| `response_format` `json_object` | a system instruction (Anthropic has no JSON mode) |
| `user` | `metadata.user_id` |
| `temperature`, `top_p`, and `top_k`, `thinking`, `output_config`, `service_tier` | as they are |
| `n` above 1 | refused, `invalid_request` |
| `seed`, penalties, `logprobs`, `stream_options` | dropped |

Answers: text blocks join into `content`, `tool_use` blocks become `tool_calls`, the text of thinking blocks (empty
unless the request asked to see it) becomes `reasoning_content`, and the blocks themselves follow "Thinking with
tools"; `stop_reason` maps `end_turn`/`stop_sequence`/`pause_turn` to `stop`, `max_tokens`/
`model_context_window_exceeded` to `length`, `tool_use` to `tool_calls`, `refusal` to `content_filter` with the reason
as `message.refusal`; usage is the shape of "Prompt caching".

Streams: `message_start` becomes the role chunk; `text_delta` content chunks; a `tool_use` block start a `tool_calls`
delta with id and name, and its `input_json_delta` pieces argument deltas at the tool call's own index; `message_delta`
the finish reason (its usage is cumulative, and the last one holds the thinking tokens); `message_stop` a final usage
chunk. `ping`, `content_block_stop`, hidden thinking deltas and event types Anthropic adds later carry nothing for the
caller, as its docs ask, but each restarts the attempt's idle timeout: a model that thinks for a minute before its
first visible token is at work, not stalled (the call's `deadlineMs` still bounds it). An `error` event is classified like an error
status; a stream that ends before `message_stop` is a failed attempt. Failover is before the first token only, as for
every provider.

Current models refuse requests older ones took: a forced tool choice (`tool_choice` `any`/`tool`) on Opus 5.5 and
Sonnet 5.5, non-default sampling parameters on 4.7 and later, `thinking: { type: "disabled" }` on Opus 5.5 and
Sonnet 5.5, assistant prefill on 4.6 and later. They answer 400 and are not retried. The first three are a model's
config ("A model's own request shape"), never the app's; prefill has no replacement but structured output.

The adapter sends `anthropic-version: 2023-06-01`, the version it is written against; a provider header overrides it.
`2026-10-21` refuses `temperature`, `top_p` and `top_k` at any value.

## Prompt caching

A provider caches a prompt prefix either on its own (DeepSeek, OpenAI, Gemini, Groq, most OpenAI-compatible endpoints)
or at breakpoints the request marks (Anthropic, and `anthropic/*` through OpenRouter). An app marks breakpoints once, in
the OpenAI shape, and each lane receives them in the form its provider takes, or not at all:

```ts
await router.chat({
    model: "auto-heavy",
    messages: [
        { role: "system", content: [
            { type: "text", text: craft, cache_control: { type: "ephemeral", ttl: "1h" } },  // L1; the tools render before it
            { type: "text", text: shopRules, cache_control: { type: "ephemeral" } },          // L2
            { type: "text", text: stepGoal, cache_control: { type: "ephemeral" } },           // L3
        ] },
        ...conversation,                                                                       // L4, append-only
    ],
    tools,
    cache_control: { type: "ephemeral" },  // automatic: one more breakpoint on the last cacheable block
})
```

| where the request marks it | Anthropic provider | `anthropic/*` on OpenRouter | every other lane |
|---|---|---|---|
| a content part (`text`, `image_url`) of a system, user or assistant message | `cache_control` on that block; a marked system prompt is sent as blocks, one per part | kept on the part | removed |
| a message (`cache_control` beside `content`) | on the message's last block; on the `tool_result` for a tool message | moved to the last part (a string content becomes one text part) | removed |
| a tool (`cache_control` beside `function`) | on the tool definition | removed: tools render before the system prompt, whose breakpoint covers them | removed |
| the top level | top-level `cache_control` (automatic caching) | kept | removed |

- **Limit.** Anthropic takes at most four breakpoints, the top-level one included; a request that marks more is refused
  by the adapter as `invalid_request`, before it is sent. The TTL (`"5m"`, the default, or `"1h"`) passes as written; a
  one-hour entry must sit before any five-minute one, which the API enforces.
- **Who takes markers.** `ModelConfig.cacheControl` decides for a model; without it, an `anthropic` provider and
  `anthropic/*` models on `openrouter` take them and nothing else does. A direct Qwen model or a Gemini model on
  OpenRouter, which take explicit breakpoints too, set `cacheControl: true`.
- **What is cached.** The render order is tools, system, messages, and a breakpoint caches everything before it. A
  system prompt with no breakpoint is one string; a marked one becomes blocks, so adding the first
  breakpoint changes the prefix once. A prompt below the model's minimum (512 tokens on Sonnet 5.5) is not cached and
  no error says so: read the usage.

Usage is one shape for every lane. `prompt_tokens` is the whole prompt; its cache parts are in
`prompt_tokens_details`: `cached_tokens` (read), `cache_write_tokens` (written, every lifetime together) and
`cache_write_1h_tokens` (the one-hour part, when the provider splits it); thinking is
`completion_tokens_details.reasoning_tokens`, a part of `completion_tokens`. Anthropic lists the uncached input apart
from the cache reads and writes; the adapter adds them up. A model's `cost` prices each part: `cacheRead`, `cacheWrite`
and `cacheWrite1h` per million tokens, each defaulting to `input` (`cacheWrite1h` to `cacheWrite`), so a model that
declares only `input` and `output` is priced at those two alone.

## Thinking with tools

Current Claude models think by default, and on Sonnet 5.5 and Opus 5.5 thinking cannot be turned off (`thinking:
{ type: "disabled" }` is a 400; Sonnet 5.5's lowest setting is `{ type: "between_tools" }`, which no other model
accepts). An answer that calls a tool carries `thinking` blocks with a signature, and the API binds each block to the
model, the account and the conversation before it (system, tools and earlier messages).

The OpenAI shape has no field for those blocks, so the adapter chooses per provider, `ProviderConfig.thinking`:

- **`drop`, the default.** The blocks are never sent back: the next request of the tool loop carries the assistant turn
  as text and `tool_use` only. Anthropic's preserved-thinking page lists removing every thinking block as valid ("the
  model loses that reasoning"), nothing fails, and the prompt cache still matches, since the cached prefix is the
  request and not the answer. It is the default because it can never be refused: nothing replayed, nothing to bind.
- **`replay`, the opt-in.** The adapter keeps each answer that thought and then called tools (its content blocks as
  received, up to 2000 turns per provider in this process, least recently used first) under the ids of its tool calls.
  When a later request carries an assistant message with exactly those tool calls, the turn goes back as it was
  received, thinking and signatures included, whatever the client above forwarded. It is replayed only while the
  request up to that turn (system, tools, earlier turns; key order and breakpoints aside) has the digest it had when the
  turn was produced; after an edit the turn goes back rebuilt, without thinking, and so does every later one, which is
  the documented way to continue. A turn the memory forgot, or a second process, degrades to `drop`.

Thinking text reaches the caller as `reasoning_content` (the message, or stream deltas) when the request asks to see it
(`thinking: { type: "adaptive", display: "summarized" }`); by default Claude returns it empty. Thinking tokens are
billed as output and count toward `max_tokens`, which is why the adapter's default is 16000.

An app that speaks the Anthropic protocol to the gateway (below) needs neither: its client carries the blocks itself.

## A model's own request shape

What one model needs and another refuses is the model's config, applied to each attempt just before the request is
translated for that lane, so a request that fails over reaches the next model in that model's shape:

| `ModelConfig` | effect |
|---|---|
| `params` | request fields sent when the request does not set them (`{ max_tokens: 32000, output_config: { effort: "medium" } }`); shallow |
| `omit` | request fields never sent (`["temperature", "top_p", "top_k"]` for Sonnet 5.5, which refuses non-default sampling) |
| `forcedToolUse: false` | `tool_choice` `required` or a named function becomes `auto` plus a system instruction to make the call, for models that refuse a forced choice (Opus 5.5, Sonnet 5.5, Fable 5.1 and later); `auto` guarantees no call, so the caller checks one was made |
| `cacheControl` | whether its provider takes cache breakpoints (above) |

## The native Anthropic route

`POST /v1/messages` on the gateway speaks the Anthropic Messages protocol, under the same virtual key (read from
`x-api-key`, or a bearer token). The request goes to an Anthropic provider untranslated: only `model` becomes the
lane's model id, and the model's own shape applies (`params`, `omit`, and `forcedToolUse: false`, which turns
`tool_choice` `any` or `tool` into `auto` with the instruction at the end of `system`). Cache breakpoints, thinking blocks, tool results and
whatever the API adds later pass through, and so does the client's `anthropic-beta` header. The answer and the stream
events come back as the provider sent them. The router reads only what it accounts for: usage, the first content
(failover is over once a `content_block_delta` arrived), an `error` event, a stream cut before `message_stop`.

- **Routing.** The call is narrowed to the providers of the Anthropic protocol; keys rotate and fail over among them as
  for any call. `router.messages()` and `router.messagesStream()` are the same calls in process.
- **A name no Anthropic provider serves** is refused 400 `model_not_supported`, naming the route that serves it.
  Nothing translates a Messages request for an OpenAI-protocol provider: that adapter would be a second protocol
  surface to keep correct for a path with no caller, since an app asks for the client of the name's own protocol.
- **Errors** on this route are in Anthropic's shape (`{ type: "error", error: { type, message, code } }`), and a failure
  after the first event is an `error` event.

A profile whose candidates span two protocols is served on each route by its own protocol's candidates. On
`/v1/chat/completions` such a profile is served by every candidate, Anthropic ones through the adapter, unless the
request carries `x-ai-router-kind: openai` (or `anthropic`), which narrows the call to that protocol's providers.

`GET /v1/models` says how each name is served: `kind` (the protocol of its first candidate), `kinds` (every protocol,
in the order the pool tries them), `serves` (`chat`, `embeddings`) and, for an embeddings name, `dimensions`.

## Who served, and what it cost

Every answer names its lane where each client library hands it on untouched: inside the provider's `usage`, as
`usage.served = { provider, model, attempts, cost? }` (the pool's provider id and model id, never a key). It is there
on both routes, unary and streamed: in a chat completion's `usage` and its final usage chunk, in an Anthropic message's
`usage` and in the `usage` of its `message_start` event. The response headers say the same (`x-ai-router-provider`,
`x-ai-router-model`, `x-ai-router-attempts`, `x-ai-router-cost`). In process, `ChatCompletion.routing` and the `attempt`
event carry it with the key's alias; a client may name its call with an `x-request-id` header (letters, digits and
`._:-`, up to 128, unique per call since providers see it as the idempotency key) to match the gateway's call to
those events.

## The LangChain entry

`@starci/ai-router/langchain` gives an app LangChain clients over the gateway, by name:

```ts
const ai = createRoutedModels({ gatewayUrl, virtualKey })
const picked = await ai.chat(node.model)          // a pool model id or a profile
const agent = createAgent({ model: picked.model, tools })
const usage = usageOf(reply)                      // tokens by part, model, provider: the same for every kind
```

- **`kind` is the protocol**, never the model family: `{ kind: "openai", model: ChatOpenAI }` for every OpenAI-compatible
  provider, `{ kind: "anthropic", model: ChatAnthropic }` for an Anthropic one. It comes from the gateway's catalog
  (`GET /v1/models`, read once and again when a name is unknown). The common path uses `picked.model` and never reads
  `kind`; a provider's own feature does.
- **A profile of two protocols** is the client of its first candidate's protocol, with the other protocols' clients in
  `picked.fallbacks`, in the order the pool tries them. Each client sends `x-ai-router-kind`, so it stays on its own
  protocol's providers: the router fails over between keys and providers inside a protocol, and moving to the next
  protocol is the app's retry. The fallbacks are not wrapped into one runnable because LangChain's
  `RunnableWithFallbacks` is no chat model (it has no `bindTools`), so an agent could not take it, and because the
  clients never retry (`maxRetries: 0`): the app owns its tries and decides which one moves on.
- **New kinds** extend one interface, `RoutedChatKinds` (module augmentation), and register a factory with
  `registerChatKind`; the core and the built-in kinds are untouched.
- **Optional peers.** `@langchain/openai`, `@langchain/anthropic` and `@langchain/core` are optional peer dependencies,
  imported the first time a kind is built; the router's core imports none of them.
- **Usage.** `usageOf(reply)` reads LangChain's `usage_metadata` (which both clients fill the same way: the whole
  input, with `cache_read` and `cache_creation` as parts) and the `usage.served` the gateway wrote, which both keep in
  `response_metadata.usage`: `inputTokens` (full price), `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`,
  `reasoningTokens`, `model`, `provider`, `cost`.
- **Embeddings.** `ai.embeddings(name)` is `{ kind: "openai", embeddings: OpenAIEmbeddings, dimensions }` for a pinned
  profile or an embeddings model; it never changes model identity, and Anthropic has no embeddings API.

Verified against `@langchain/openai` 1.8.2, `@langchain/anthropic` 1.6.2 and `@langchain/core` 1.3.6: the constructor
fields the entry sets (`configuration.baseURL`, `anthropicApiUrl`, `clientOptions`, `maxRetries`, `streamUsage`), and
where each puts usage. `ChatAnthropic` sends `thinking` only when the app sets it, and its own `max_tokens` default for
a name it does not know is 4096, so the entry sends 16000 unless told otherwise.

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
        { kind: "anthropic", models: [{ id: "claude-sonnet-5-5", cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } }] },
        { kind: "openrouter", models: [{ id: "anthropic/claude-sonnet-5-5" }, { id: "openai/text-embedding-3-small", identity: "text-embedding-3-small", dimensions: 1536, capabilities: ["embeddings"] }] },
        { kind: "deepseek", models: [{ id: "deepseek-v4-pro" }] },
        { kind: "qwen", models: [{ id: "qwen3.8-max" }] },
        { kind: "openai", models: [{ id: "text-embedding-3-small", dimensions: 1536, capabilities: ["embeddings"] }] },
    ],
    profiles: { work: { candidates: [...] }, embed: { pinned: true, candidates: [...] } },
    store: await openSqliteStateStore("/data/ai-router-state.sqlite"),
})
```

## The local provider

`kind: "local"` is an endpoint on the owner's own hardware (Ollama, vLLM, the llama.cpp server). It reuses the `openai`
protocol, `openAiWire` and the classifier of `openai-compatible`; a mechanism was added only where the 0.9.0 code, read
at the lines below, cannot express the behaviour with an existing kind. Line numbers are 0.9.0's.

| behaviour | why `openai-compatible` cannot | what 0.10.0 adds |
|---|---|---|
| a key that may be absent | `open` turns an unset key into an `auth` failure with `missingKey` (`router.ts:356-357`), which blacklists the key until a secret appears (`pool.ts:577`); `validateConfig` refuses a provider with no keys (`config.ts:173`); `poolFromEnv` drops a provider with no key in env (`env.ts:107`) | `keysOf` (`config.ts`): a `ref` key becomes an env key, and a `local` provider with no key gets one that resolves to nothing; `open` skips the check for `local`, sends no `Authorization`; `providersFromEnv` keeps a `local` provider whose base URL is set |
| the first-token wait | one number, `policy.timeoutMs`, starts every attempt and restarts at every chunk (`router.ts:470`, `526`, `541`, `547`); a model loading into VRAM exceeds 60 s while the silence between chunks should stay short | `firstTokenTimeoutMs` (provider, preset default 120000): the first arm of an attempt and the arms before the first token use `max(timeoutMs, firstTokenTimeoutMs)`; later arms use `timeoutMs` |
| the call deadline | `deadlineMs` defaults to 120000 for every call (`config.ts:299`), shorter than a cold load plus a long answer | 300000 when every provider the call can reach is local (`LOCAL_DEADLINE_MS`) |
| cost 0 | `costOf` is `undefined` for a model without a price (`pool.ts:125`), so a local call reports no cost | `local` usage counts at 0 (`pool.ts`, in `succeeded`), a declared price still wins |
| a missing model | a missing model is a 404, which every kind classifies `invalid_request` with a bad request (`classify.ts:134`) | class `model_not_found`: a `local` 404 with a JSON error body, not retryable (`errors.ts:30`'s set does not list it) |
| the embeddings path | `openAiWire.embeddings` has one path and `open` one `fetch` (`wire/wire.ts:54`, `router.ts:370`) | `localWire.embeddingsFallback`: on a 404 from `/v1/embeddings`, `POST /api/embed` at the server root, its answer adapted by `embeddingsResponse` |
| a vector cut to a size | the dimension filter keeps only models declared at the asked length (`pool.ts:217`) and the answer is checked against the declaration (`router.ts:654`) | `truncate: "mrl"`: the lane is kept for any asked size, the vector is cut and renormalized (`src/vectors.ts`) |
| isolation | `validatePolicy` knows names, not kinds (`config.ts:100`) | `isolationProblem` at load (defaults and profiles) and at each call (`resolvePolicy`) |

What an existing mechanism already does, so nothing was added: an unreachable endpoint is a `fetch` rejection that
`AttemptScope.classify` turns into a `network` failure (`router.ts:148`), which is retryable (`errors.ts:30`), feeds the key's and
the provider's breaker (`pool.ts:580`) and backs off like a `transient` one. That is the class a caller falls back on; a new
`unavailable` class would repeat it. Health and model discovery are not an attempt, so `probeLocal` (`src/local.ts`) is a
function beside `fetchOpenRouterModels` (`known-models.ts:99`), not a method of `AiRouter`: a method would break every
implementer of the interface.

### Local isolation

A local provider and a hosted one never share a chain by accident. The chain of a call is its candidates: the model and fallbacks
(or candidates) of the call, its profile and the defaults, resolved to providers (narrowed by `providers`). `isolationProblem` refuses it
when one name is served by both kinds (a swap nobody asked for), or when both kinds appear and any candidate does not name its
`provider`. A profile whose candidates all name their provider may list both; that listing is the explicit statement. It runs in
`validateConfig` for the defaults and every profile, so a bad pool does not start, and in `resolvePolicy` for the merge of the
call, so a call cannot build the bridge a profile avoided. A pool with no `local` provider skips the check and routes as before.
`withAutoProfiles` draws only from `KNOWN_MODELS`, which names no local model, so `auto` never reaches the GPU.

### Truncating an embedding

An MRL model packs its meaning into the leading numbers, so `v[0:N] / ||v[0:N]||` is a valid N-dimensional vector and the vector
of a smaller size is the prefix of a larger one up to scale. `truncate: "mrl"` makes the router the only party that cuts:
it removes `dimensions` from the request (Ollama documents `dimensions` on `/api/embed` and `/v1/embeddings`, but a server, a model or a
version may ignore it, and a vector the endpoint cut and one the router cut would differ), takes the native vector, cuts it to
`request.dimensions ?? model.dimensions` and normalizes. A vector shorter than the cut, a non-integer size and base64 are the caller's
mistakes (`invalid_request`). A model without `truncate` is unchanged: `dimensions` goes to the endpoint and the answer must
match the declaration. The reason the app cuts at all: pgvector indexes `vector` to 2000 dimensions and `halfvec` to 4000, and the
native vector of Qwen3 Embedding 8B has 4096.

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
