---
slots: [be.feature.webhooks, be.feature.webhooks.http, be.feature.webhooks.dto]
files:
  - path: src/features/webhooks/<provider>/index.ts
    slot: be.feature.webhooks
    template: webhooks/webhook.index.ts.tpl
    role: The public surface of the kind folder, the module class an api-kind app composes.
  - path: src/features/webhooks/<provider>/transport/http/<provider>-http.options.ts
    slot: be.feature.webhooks.http
    template: webhooks/webhook.http.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/webhooks/<provider>/transport/http/<provider>-http.module-definition.ts
    slot: be.feature.webhooks.http
    template: webhooks/webhook.http.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/webhooks/<provider>/transport/http/<provider>-http.module.ts
    slot: be.feature.webhooks.http
    template: webhooks/webhook.http.module.ts.tpl
    role: Nest module of the door, composed only by an api-kind app.
  - path: src/features/webhooks/<provider>/transport/http/<provider>.webhook.ts
    slot: be.feature.webhooks.http
    template: webhooks/webhook.door.ts.tpl
    role: The signed door, one controller with one POST handler and optionally one GET challenge verifier; an own-feature PROVIDER_ACK is a fixed literal.
    rules: [BE_WEBHOOK_SHAPE, BE_WEBHOOK_UNVERIFIED, BE_DEFAULT_DENY, BE_INPUT_BOUNDED]
    spec: src/features/webhooks/<provider>/transport/http/<provider>.webhook.spec.ts
  - path: src/features/webhooks/<provider>/transport/http/<provider>.webhook.spec.ts
    slot: be.feature.webhooks.http
    template: webhooks/webhook.door.spec.ts.tpl
    role: Unit spec of the door beside it.
  - path: src/features/webhooks/<provider>/transport/http/dto/<event>.request.ts
    slot: be.feature.webhooks.dto
    role: The typed, bounded provider payload.
    rules: [BE_INPUT_BOUNDED]
    template: webhooks/webhook.request.ts.tpl
  - path: src/modules/platform/http-security/webhook-signature.service.ts
    slot: be.platform
    role: WebhookSignatureService, the shared signature and replay proof when provider secrets are platform options.
    spec: src/modules/platform/http-security/webhook-signature.service.spec.ts
    optional: true
  - path: src/modules/domain/<capability>/<capability>.service.ts
    slot: be.domain
    role: The domain verifier or intake method, which may combine per-connection proof with inbox claim, durable receipt recording and outbox publishing in its transaction; no command/query-bus or feature-handler dispatch.
    rules: [BE_INBOX_DEDUPE_MISSING, BE_OUTBOX_WRITE_TX]
    optional: true
  - path: src/modules/events/<service>/<event>.event.ts
    slot: be.events
    role: The typed event the intake publishes.
    rules: [BE_EVENT_CLASS_CONTRACT]
    optional: true
  - path: src/features/reactors/<reactor>/transport/message/<event>.consumer.ts
    slot: be.transport.message
    role: Optional reactor consumer of the durable receipt event; forwards its eventId and receipt reference in one command after commit.
    rules: [BE_EVENT_CONSUMER_SHAPE, BE_FEATURE_THIN]
    optional: true
  - path: src/tests/e2e/<area>/<provider>-webhook.e2e-spec.ts
    slot: be.tests.e2e
    role: "Titles webhooks/<scenario>: ... prove the pattern against the provider fake."
    spec: webhooks/bad-signature-is-refused, webhooks/replay-is-refused, webhooks/accepted-delivery-publishes-once
    rules: [BE_PATTERN_SPEC_MISSING]
    optional: true
---
# Provider webhooks

Decides how a delivery a provider POSTs is received: one signed door that proves the delivery first and hands it to one domain
intake, which records it durably; a reactor or job processes it after commit (`verify -> record -> reactor or job dispatches`). The
inbox claim is BE-IDEMPOTENCY-1; the event class is BE-EVENT-BUS-2.

## BE-WEBHOOK-1 A webhook is a kind folder with one door, its module and its spec
`features/webhooks/<provider>/` (enabled by declaring `webhooks`) holds `index.ts`, `transport/http/<provider>-http.module.ts` with its
module definition and options, the door `transport/http/<provider>.webhook.ts`, its spec `<provider>.webhook.spec.ts` (the door has no
service of its own) and an optional `transport/http/dto/` of typed, bounded payload classes. Nothing else: no application layer,
handler or consumer. Only an api app composes the module. A second endpoint of the same provider is a second door only when its
proof differs.

Why: a webhook is an external caller we do not control; one place and one shape make every public signed door and its proof
findable in one folder.

Enforced by: R01 HFS_SLOT_UNDECLARED, R02 HFS_SLOT_REQUIRED_MISSING, R47 BE_TEST_TOPOLOGY.

## BE-WEBHOOK-2 The door verifies first and hands the delivery to one domain intake
The door is one `@Controller` with exactly one `@Post` and optionally one `@Get` challenge handler, each
`@Public({ reason: PublicReason.SignedWebhook })` with the strict rate tier, thin. A handler's first statement is an unconditional,
awaited verification call, before any data access or other work: either `WebhookSignatureService.verify({ provider, rawBody,
signature, timestamp })` of `platform/http-security` (HMAC over `<timestamp>.<raw body>`, constant-time comparison, a replay window
on the signed timestamp, per-provider key, secret and tolerance in its options), or a domain verifier when secrets belong to
individual connections. A domain verifier is a method of a domain service whose class name ends in `Verifier`, or a domain method the
adjacent HTTP module names as a symbol in `export const webhookVerifiers = [<Service>.prototype.<method>] as const`; a string, alias
or non-domain class grants no proof. A separate verification is followed by exactly one domain intake call; a domain method that
verifies then records may be the only call. The door injects only domain services and the signature service
(`@InjectWebhookSignature()`), has no branch, loop or `try`, parses, maps and publishes nothing, and neither it, its module nor the
intake reaches a command or query bus or feature handler. The POST returns nothing or exactly `PROVIDER_ACK`, an exported literal of
the same feature declared `as const` (no call, template, spread, input-derived value or other feature's constant). The GET returns
exactly the result of its verifier's challenge call and makes no intake. `SignedWebhook` metadata belongs only to webhook doors and
their declared verifiers, and a public route whose path says webhook, callback or events belongs in a webhook door. The raw body is
verified, never a re-serialized one (the api app enables `rawBody`).

Why: the signature is the authentication of a public door; making it the first statement removes every path that skips it, and one
intake with no decision leaves only the proof and the hand-over to test.

- When a provider requires a fixed body (`{"success": true}`) → `export const PROVIDER_ACK = { success: true } as const` in the
  door's file, returned after verify and intake; an inline object or computed ack is a finding.
- Shape:
  ```ts
  @Post()
  @Public({ reason: PublicReason.SignedWebhook })
  @RateLimit(RateTier.Strict)
  async receive(@Req() request: RawBodyRequest<Request>, @Headers("x-signature") signature: string | undefined, @Body() delivery: ProviderEventRequest): Promise<typeof PROVIDER_ACK> {
      await this.verifier.verify({ rawBody: request.rawBody, signature })
      await this.deliveries.recordProviderDelivery(delivery)
      return PROVIDER_ACK
  }
  ```

Enforced by: R182 BE_WEBHOOK_SHAPE, R183 BE_WEBHOOK_UNVERIFIED, R263 BE_WEBHOOK_SCOPE, R42 BE_INPUT_BOUNDED, R203 BE_FEATURE_THIN.

## BE-WEBHOOK-3 The intake records the receipt; a reactor or job dispatches after commit
The domain intake (`<Provider>Service.record<Provider>Delivery`) is a delivery method: in its transaction it claims
`(source, deliveryId)` first with the callback's manager and returns on a duplicate (BE-IDEMPOTENCY-1), keyed by the stable provider
delivery id; then, with the same manager, it saves the payload or a durable receipt reference and publishes a typed receipt event.
No processing callback, domain processing or command dispatch runs inside the receipt transaction. A reactor consumes the receipt
event and dispatches its own command with the delivered `eventId` and receipt reference, its service claiming that consumer delivery
before processing; or a job takes a receipt reference enqueued in the recording transaction. The webhook door never imports the
event bus or event classes.

Why: recording and the outbox row in one transaction mean a crash can neither lose nor duplicate the delivery, and processing after
commit keeps a slow or failing effect out of the provider's request.

Enforced by: R80 BE_INBOX_DEDUPE_MISSING, R152 BE_OUTBOX_WRITE_TX, R263 BE_WEBHOOK_SCOPE.

## BE-WEBHOOK-4 Three behaviours are proven against the provider fake
Declaring `webhooks` requires tests titled `webhooks/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios` (e2e or
integration in full, integration in lite): a tampered body is refused and nothing is published, a stale timestamp is refused and
nothing is published, and a valid delivery publishes once while a redelivery publishes nothing more. The provider is the test world's
network-edge fake, signing as the provider documents with the test secret; a real provider is never called. The door's unit spec
uses the real verifier with a test secret and a double of a separate intake; a combined verify-and-record method has its domain
service spec prove refusal before intake.

Why: the door has no logic, so the risk is the wiring: the raw body, the headers, the real signature scheme and the transaction
behind the intake.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
