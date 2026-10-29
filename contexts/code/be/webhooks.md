---
slots: [be.feature.webhooks, be.feature.webhooks.http, be.feature.webhooks.dto]
---
# Provider webhooks

How a delivery a provider POSTs is received: one public door that proves the delivery first and hands it to one domain
intake, which records it durably; a job processes it after commit (verify, record, job). The inbox claim is
BE-IDEMPOTENCY-1; the provider's signing scheme, callback setup and live proof come from its `integration` record's
research (PROJECT-WORK-4 in [project/work.md](../../project/work.md)).

## BE-WEBHOOK-1 A webhook is a kind folder with one door, its module and its spec

`features/webhooks/<provider>/` holds `index.ts` (exporting the HTTP module) and `transport/http/` with
`<provider>-http.module.ts` and its definition and options, the door `<provider>.webhook.ts`, its spec
`<provider>.webhook.spec.ts` and an optional `dto/`. No application layer, handler or bus. Only an api app composes
it, and the app boots with `rawBody: true`.

Why: a webhook is a caller we do not control; one shape makes every signed public door and its proof findable.

Enforced by: `webhook-shape` (R182), `slot-undeclared` (R01), `unit-test-colocated` (R47).

## BE-WEBHOOK-2 The door verifies first, then makes one intake call

The door is one `@Controller` with one `@Post` (and at most one `@Get` challenge), each
`@Public({ reason: PublicReason.SignedWebhook })` and `@RateLimit(RateTier.Strict)`. Its first statement is the
verification: `WebhookSignatureService.verify(...)` of `platform/http-security`, or a domain verifier (a service whose
class ends in `Verifier`, or a method the HTTP module names in `export const webhookVerifiers =
[Service.prototype.method] as const`), awaited when async. Then exactly one domain intake call with the raw body and the
proof headers. No branch, loop, `try`, parse or bus; the POST returns nothing or the file's
`export const PROVIDER_ACK = { ... } as const`; the GET returns only its verifier's challenge result.

Why: the signature is the authentication of a public door; making it the first statement removes every path that
skips it.

```ts
/** Answers 200 with the provider's acknowledgement; a repeated delivery gets the same answer without being applied. */
@Post()
@HttpCode(HttpStatus.OK)
@Public({ reason: PublicReason.SignedWebhook })
@RateLimit(RateTier.Strict)
async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("authorization") authorization: string | undefined,
): Promise<typeof PROVIDER_ACK> {
    this.settlement.verifyDelivery(authorization)
    await this.settlement.acceptDelivery({ authorization, rawBody: request.rawBody })
    return PROVIDER_ACK
}
```

Enforced by: `webhook-shape`, `webhook-verify-first`, `webhook-scope` (R182, R183, R263), `feature-thin` (R203),
`auth-door-strict-rate-tier` (R42).

## BE-WEBHOOK-3 The intake records the receipt; a job processes it after commit

The domain intake parses the raw body through its owner's guard, then in one transaction claims `(source, deliveryId)`
with the provider's stable delivery id and the receipt insert (`inbox.claim(source, id, manager, { insert, payload })`; in
lite `inbox.claimRow(source, id, manager, { entity, row })` of the `EntityInbox`, which answers the receipt id),
returns on a duplicate, and enqueues the processing job with the same manager (`outbox.write(manager, QUEUE, { deliveryId },
{ dedupeKey })`). No processing, provider call or bus dispatch runs in the receipt transaction; the job's service reads
the committed receipt and does the work.

Why: the receipt and the job commit together, so a crash neither loses nor doubles a delivery, and a slow effect stays
out of the provider's request.

Enforced by: `inbox-dedupe-required`, `webhook-inbox-key` (R80, R263), `outbox-write-tx` (R152).

## BE-WEBHOOK-4 Three behaviours are proven against a signing fake

An app declaring `webhooks` proves `bad-signature-is-refused`, `replay-is-refused` and
`accepted-delivery-publishes-once` in specs titled `webhooks/<scenario>: ...` (integration in lite), the fake signing
as the provider documents with a test secret. The door's spec covers the verify-then-intake order with a double of the
intake; a combined verify-and-record method proves the refusal in its service spec.

Why: the door has no logic; the risk is the wiring: raw body, headers, the real scheme and the transaction behind the
intake.

Enforced by: R155, R284.
