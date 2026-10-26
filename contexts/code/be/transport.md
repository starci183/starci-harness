---
slots: [be.transport, be.transport.message, be.contract]
---
# Transport

How a door into the application is written: GraphQL by default, REST only with evidence, a thin adapter that
dispatches one message, no envelope. Who may call a door is api-auth.md; a cli command is an action runner (cli.md).

## BE-TRANSPORT-1 GraphQL is the default door; a REST route carries its evidence

GraphQL is code-first and flat: `transport/graphql/<action>.resolver.ts` (one `@Resolver()` class per operation),
`dto/<name>.input.ts` (`<Name>Input`), `dto/<name>.type.ts` (`<Name>Type`) and `<action>.mapper.ts` (`to<Action>Request`,
`to<Name>Type`). A REST route lives in `transport/http/<action>.controller.ts` (DTOs `<Name>Request`, `<Name>Response`)
and shows on its own method why it is not GraphQL: a probe, an auth handshake or signed webhook
(`@Public({ reason })`), a credential-authenticated public API route (`@Credential({ kind })`), a byte transfer, a
redirect, an event stream (`@Sse` in a realtime channel) or a declared operation table. No buffered multipart upload:
a browser transfers bytes to storage through an address the domain signs (`signedUpload`) after authorizing the key.

Why: one flat shape makes an operation, its input, output and mapper findable from the name; a REST route without a
reason is a JSON read that belongs in the schema the client already uses.

Enforced by: `door-lives-in-features`, `rest-door-needs-a-reason`, `rest-route-declared`, `no-buffered-upload` (R88,
R278, R312).

## BE-TRANSPORT-2 A door maps, dispatches one message and maps back

A resolver or controller injects only `@InjectCommandBus()` / `@InjectQueryBus()` (plus `RequestLocale` in REST), takes
the principal from `@CurrentPrincipal()` and any tenant selector from its decorator (`@WorkspaceId()`), maps the input
with a pure mapper, dispatches exactly one message and maps the result. No manager, no domain service, no branch or
loop. A refusal returned as an `Outcome` becomes a throw here, with `unwrapOutcome(outcome, <C>Error)`.

Why: a door that reaches a service or the database bypasses the handler's failure log and the service's authorization.

```ts
/** Reads an order belonging to the selected workspace. */
@Query(() => OrderType, { name: "order", nullable: true })
async order(
    @CurrentPrincipal() principal: Principal,
    @WorkspaceId() workspaceId: string,
    @Args("input") input: OrderInput,
): Promise<OrderType | null> {
    const result = await this.queryBus.execute(
        new GetOrderQuery({ request: toGetOrderRequest(workspaceId, input), principal }),
    )
    return toOptionalOrderType(result)
}
```

Enforced by: `transport-is-thin`, `feature-thin`, `no-capability-imports-features`, `em-injection-slots` (R88, R203).

## BE-TRANSPORT-3 No response envelope, no JSON tunnel

A door returns the typed payload; a failure travels through the error filter or formatter (BE-ERROR-5). No transform
interceptor, success flag or message wrapper, and `GraphQLJSON` is never an input or output.

Why: an envelope duplicates GraphQL's error channel and puts user copy in the back end.

Enforced by: `no-response-envelope`, `no-graphql-json` (R88).
