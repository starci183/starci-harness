---
slots: [fe.modules.api, fe.modules.auth, fe.transport, fe.transport.client, fe.transport.outcome, fe.package.api, fe.route.callback]
---
# Transport

Which code calls the back end, what it returns and where its types come from. The browser calls the back end
directly; the front end itself serves nothing ([architecture.md](architecture.md) FE-ROUTE). The same in both editions.

## FE-API-GRAPHQL One link chain, one file per operation

`modules/api/graphql/clients/` holds the auth and no-auth Apollo clients built from one link chain (`links/`): retry,
error, timeout, token refresh, attach access token, attach device id when the app uses one, then the http link. Each
operation is one file, `queries/query-<x>.ts` exporting `query<X>` or `mutations/mutation-<x>.ts` exporting
`mutate<X>`, with its document and typed request and response, returning `GraphQLResponse<T>`
([error.md](error.md) FE-ERROR-2). Nothing else in the app calls `fetch`, another HTTP or GraphQL client, a Server
Action or a front-end route handler. The locale travels as `Accept-Language`.

Why: one chain makes timeout, retry, refresh and headers a single decision, and one file per operation keeps every
back-end call discoverable.

Enforced by: R50 FE_TRANSPORT_OWNER, R51.

## FE-WIRE-GENERATED Wire types come from the back-end contract

The back end commits `be/contracts/<app>/schema.graphql` (written by the app emit). The front end reads it in place
(`hfs.json` `sides.fe.reads`), keeps no copy, and generates `modules/api/graphql/__generated__/` with graphql-codegen
before lint, typecheck and build. Request and response types re-export or narrow generated types; every document,
including an embedded `gql` template, validates against the contract.

- When an operation is added → add the resolver, emit the contract, run codegen, then write the operation file.

Why: a hand-written type drifts from the back end without a signal; the committed snapshot makes the interface a
reviewable artefact in the commit that moved it.

Enforced by: R52 FE_WIRE_GENERATED, R113 FE_GRAPHQL_CONTRACT.

## FE-API-REST REST only for what GraphQL cannot carry

A binary upload, a presigned-URL request or an identity-provider endpoint is one file under
`modules/api/rest/<area>/` using the one axios instance (base URL from `modules/config`, credentials only when the
auth flow needs the HttpOnly cookie), wrapped by a `hooks/swr/api/rest` hook and reported through the toast.

Why: one HTTP client keeps headers, credentials and failure handling in one place, and one contract carries the rest.

Enforced by: R50.

## FE-UPLOAD Files go straight to storage

A mutation returns an authorized presigned storage request; the client PUTs the file with the signed headers through
`modules/api/rest` (no application bearer, cookie or credential on the storage request), then calls the completion
mutation, and the API verifies what storage holds. The client checks type and size only for feedback; the back end
and storage enforce them. Downloads use a short-lived authorized link. File bytes never pass through a front-end
server or the API.

Why: media stays out of the front end and the API process.

## FE-AUTH The auth client yields identity, never data

`modules/auth` is the identity-provider client: sign-in, sign-out, the session, the signed-in state and an
access-token getter that the Apollo link and the realtime clients read. It is the only importer of the provider SDK,
uses only its auth API, and holds no service key. Data always goes through `modules/api` to the back end, which
verifies the token. An auth bootstrap effect (`hooks/effects`) puts the signed-in user in the store.

Why: the back end authorizes every read and write; the front end only proves who the user is.

Enforced by: R217 FE_SUPABASE_CLIENT_OWNER, R287 FE_CALLBACK_SHAPE.
