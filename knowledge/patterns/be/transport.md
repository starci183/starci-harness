---
slots: [be.transport, be.transport.message, be.contract]
---
# Transport

Decides how any door into the application is written: GraphQL by default, REST only with evidence, a thin adapter that dispatches
one message, and no envelope. Each trigger kind's door has its own topic; a cli command is an action runner, not a transport
(cli.md). Who may call a door is api-auth.md.

## BE-TRANSPORT-1 GraphQL is the default door; REST carries evidence per route
GraphQL (code-first) is the default. Files are flat: `transport/graphql/<action>.resolver.ts`, `dto/<action>.input.ts`
(`<Action>Input`), `dto/<action>.type.ts` (`<Action>Type`), `dto/<action>.args.ts` when needed and `<action>.mapper.ts`
(`to<Action>Type`, `to<Action>Request`). One module per transport (`<feature>-graphql.module.ts`), never one per operation. A REST
route, in either edition, carries its own evidence on its decorator: a probe, an auth handshake, a signed webhook, a real byte
stream, an event stream (an `@Sse` method of the realtime sse slot only) or a public versioned operation of the app's non-empty
operation table (BE-OPERATIONS-1). A class-level reason or an unused `StreamableFile` import proves no route.

Browser uploads and downloads never pass through the back end: the `ObjectStorage` port of `integrations/object-storage`
(`presignUpload`, `presignDownload`, `head`, `put`, `delete`; one S3 adapter for every S3-compatible store) serves both editions.
An authenticated operation authorizes the principal, derives the exact object key itself (the caller never names a principal,
bucket or key), validates the content type and a positive bounded size, and returns a short-lived presigned PUT whose signature
covers the exact Content-Type and Content-Length. After the transfer a second operation has the domain service `head` the object
and compare it with the declaration; a mismatch deletes it and refuses. Downloads authorize against the same scope, re-check the
object and sign a short-lived GET per request. Signed URLs and headers are bearer credentials and are never logged. Stray uploads
that are never completed are expired by a bucket lifecycle rule; bucket limits are defense in depth. No presigned POST policy, no
buffering upload decorator or middleware, and presigning is not byte-stream evidence for a REST route.

Why: one flat shape makes the operation, its input, output and mapper findable from the name; a direct presigned transfer keeps
bytes out of the process while the domain still decides who may store what.

Enforced by: R88 BE_TRANSPORT_SHAPE, R278 BE_REST_DOOR_EVIDENCE, R312 BE_UPLOAD_BUFFERED.

## BE-TRANSPORT-2 A transport adapts protocol and dispatches one message
A resolver, controller, gateway, consumer, processor or step validates protocol input, obtains the verified principal
(`@CurrentPrincipal()`), maps to a plain request, dispatches exactly one command or query and projects the result. It may import
its feature's application messages and contracts, `platform/*`, the public decorators of `domain/identity` and its own `dto/`;
never another feature. It injects only `InjectCommandBus` / `InjectQueryBus` (and `InjectRequestLocale` for REST content
negotiation): no EntityManager, no domain service, no branch or loop. A refusal becomes a throw only here, with
`unwrapOutcome(outcome, <C>Error)`. Resource authorization stays in the domain service so no other entry point bypasses it. A
scenario needing a read and a write is one command, not two dispatches.

Why: a transport that reaches the database or a service bypasses the handler's authorization and transaction, and a second
dispatch is a scenario that belongs in one command.

- `return toPlaceOrderType(unwrapOutcome(await this.commandBus.execute(new PlaceOrderCommand({ request: toPlaceOrderRequest(input), principal })), PurchaseError))`

Enforced by: R88 BE_TRANSPORT_SHAPE, R203 BE_FEATURE_THIN.

## BE-TRANSPORT-3 No response envelope
No transform interceptor, success-message decorator or response-wrapper class exists. A resolver returns the typed payload; a
failure travels as `errors[].extensions.{code,kind}` (BE-ERROR-5); success copy is front-end i18n. `GraphQLJSON` is never an
input or output type.

Why: an envelope duplicates GraphQL's own error channel, turns failures into HTTP 200 `success: false` and puts user copy in the
back end.

Enforced by: R88 BE_TRANSPORT_SHAPE, R78 BE_USER_COPY_LITERAL.
