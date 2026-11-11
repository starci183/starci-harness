---
slots: [be.transport, be.transport.message, be.contract]
---
# Transport

How a door into the application is written: the door of the app's declared contract (GraphQL by default, REST when
the app declares `rest`), any other REST route only with evidence, a thin adapter that dispatches one message, no envelope. Who may call a door is api-auth.md; a cli command is an action runner (cli.md).

## BE-TRANSPORT-1 The app's declared contract is its default door; any other REST route carries its evidence

An api app declares its contract in hfs.json, `sides.be.apps[].contract`: `graphql` (the default, also when absent) or
`rest`. The api apps of one back end declare one kind, since their features are shared (`HFS_DECLARATION_INVALID`
otherwise). A `rest` back end serves controllers (`transport/http/<action>.controller.ts`, DTOs `<Name>Request`,
`<Name>Response`) with no door reason, holds no GraphQL door or GraphQL platform (`BE_REST_APP_GRAPHQL`) and commits its
contract as BE-TRANSPORT-4 says. The rest of this section is the `graphql` back end.

GraphQL is code-first and flat: `transport/graphql/<action>.resolver.ts` (one `@Resolver()` class per operation),
`dto/<name>.input.ts` (`<Name>Input`), `dto/<name>.type.ts` (`<Name>Type`) and `<action>.mapper.ts` (`to<Action>Request`,
`to<Name>Type`). A REST route lives in `transport/http/<action>.controller.ts` (DTOs `<Name>Request`, `<Name>Response`)
and shows on its own method why it is not GraphQL: a probe, an auth handshake or signed webhook
(`@Public({ reason })`), a credential-authenticated public API route (`@Credential({ kind })`), a byte transfer, a
redirect, an event stream (`@Sse` in a realtime channel) or a declared operation table. No buffered multipart upload:
a browser transfers bytes to storage through an address the domain signs (`signedUpload`) after authorizing the key.

Why: one flat shape makes an operation, its input, output and mapper findable from the name; a REST route without a
reason is a JSON read that belongs in the schema the client already uses.

Enforced by: `door-lives-in-features`, `rest-door-needs-a-reason` (switched off by a `rest` back end), `rest-route-declared`,
`rest-app-graphql`, `no-buffered-upload` (R88, R278, R312).

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

## BE-TRANSPORT-4 A rest contract is a committed OpenAPI 3 document with stable, typed, secured operations

A `rest` api app commits `contracts/<app>/openapi.json`, written by `npm run contract:emit` (`starci app emit`) and never by
hand: Nest's own `@nestjs/swagger` builds it over the controllers of the app's module graph, read from source without
booting the app, and the head `apps/<app>/src/openapi.ts`, which exports `OPENAPI` (`new DocumentBuilder().setTitle(..)
.setVersion(..).addBearerAuth().build()`). `main.ts` serves the same head with `SwaggerModule.setup`, so the published
Swagger equals the committed file. A literal `setGlobalPrefix("<prefix>")` in `main.ts` prefixes every path; a prefix that is
not one literal, and a graph importing `RouterModule`, are refused by the emit, never written as a document with the wrong
paths (a controller carries its full path in `@Controller`). In that document:

- every operation names an explicit, unique operationId `<area>.<action>` (`@ApiOperation({ operationId: "leads.list" })`);
- every JSON request body and 2xx answer is a named DTO schema (`@ApiProperty` fields, `@ApiOkResponse({ type })`);
- every operation answers `default` with one error schema that requires `code` and `message` (`@ApiDefaultResponse`);
- a list GET answers a page `{ items, nextCursor }` read with the query parameters `cursor` and `limit`, never a bare array;
- the head declares a security scheme and every operation states its security; a public one (`security: []`) carries
  `x-public-reason` (`@ApiExtension`);
- an operation and a field may carry their documentation (`summary`, `description` of `@ApiOperation`, `@ApiProperty`,
  `@ApiResponse`): it is contract text for the developers of the clients, judged with the document here and never as user copy
  (BE-MESSAGES-1, R78).

How a caller authenticates is stated by the scheme, and the starter's guards fix it: a signed-in user's door takes the bearer
access token, and a `@Credential({ kind })` door is authenticated by `CredentialGuard` from the `Authorization` header alone
(`credential.guard.ts`: no other header, query parameter or cookie is read), and the credential it accepts carries exactly one
workspace (`CredentialPrincipal.workspaceId`): a client acting for two workspaces holds two credentials. The head names the
scheme the doors declare (`addBearerAuth()` is `bearer`; a credential door names its own with `@ApiBearerAuth("<scheme>")`).

`starci app add api <feature>` in a `rest` app writes this door (`templates/be/patterns/api/http.*.tpl`, the `contract: rest`
entries of the api pattern): `transport/http/<action>.controller.ts` (`@ApiOperation({ operationId: "<feature>.<action>" })`,
`@ApiBearerAuth()`, `@ApiOkResponse`, `@ApiDefaultResponse({ type: ErrorResponse })`), `dto/<action>.request.ts` and
`dto/<action>.response.ts` (`@ApiProperty` fields with JSDoc), the mapper and the HTTP module, composed in the api group;
`npm run contract:emit` then adds the operation to the committed document.

A rest app with many operations splits them into features by the noun they act on and its domain into one module per bounded
context, so each owner's public surface stays within its index budget (BE-IMPORTS-1); the doors never import a wider owner.

The committed file equals the emit (R23). Once published, the contract is pinned as `contracts/<app>/openapi.pin.json` and
changes additively against it, or raises the major of `info.version` (R177). A front end reading a `rest` contract has no
generated client yet: until it does, a front end composes only with a `graphql` back end.

Why: the contract is the one interface other projects and clients read; a stable id, a named type, one error shape, one
page shape and a stated security are what make it consumable without reading the code.

Enforced by: `contract-snapshot-drift`, `rest-contract`, `rest-contract-breaking` (R23, R396, R177).
