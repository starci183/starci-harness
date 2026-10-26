---
slots: [fe.modules.api, fe.modules.auth, fe.transport, fe.transport.client, fe.transport.outcome, fe.package.api, fe.route.callback]
---
# Transport

Which code calls the back end, what it returns and where its types come from. The browser calls the back end
directly; the front end serves nothing ([architecture.md](architecture.md) FE-ROUTE). The same in both editions.

## FE-API-GRAPHQL One link chain, one file per operation

`modules/api/graphql/clients/` builds the auth and no-auth Apollo clients from one link chain in `links/` (retry,
error, timeout, refresh on unauthenticated, attach access token, attach the tenant header when the app has one,
attach locale, then the http link with the caller's signal), with `fetchPolicy: "no-cache"` so SWR is the only cache;
each operation is one file holding its typed document and one exported async function that runs it on a client.

Why: one chain makes timeout, retry, refresh and headers a single decision, the locale travels on every call as
`Accept-Language`, and one file per operation keeps every back-end call findable.

```ts
type MutateUpdateProfileRequest = WireInput<UpdateProfileMutationVariables["input"]>
type Document = TypedDocumentNode<UpdateProfileMutation, InputVariables<MutateUpdateProfileRequest>>

const mutation1: Document = gql`
    mutation UpdateProfile($input: UpdateProfileInput!) { updateProfile(input: $input) }
`

/** Saves the viewer's profile; the back end authorizes and validates the input. */
export const mutateUpdateProfile = async ({ request, signal }: MutateUpdateProfileParams) =>
    createAuthApolloClient({ signal }).mutate({ mutation: mutation1, variables: { input: request } })
```

Enforced by: R50 (`transport-owner`, `fetch-only-in-api-client`, `client-fetch-has-signal`, `no-shared-transport-state`,
`api-client-attaches-the-locale`, `locale-header-belongs-to-the-link`).

## FE-WIRE-GENERATED Wire types come from the back-end contract

The front end reads `be/contracts/<app>/schema.graphql` in place (`hfs.json` `sides.fe.reads`), keeps no copy, and
`npm run codegen` generates `modules/api/graphql/__generated__/` (ignored) before typecheck, lint and build; every
document is a `TypedDocumentNode` of the generated result and variables, and no response is typed by hand.

Why: a hand-written type drifts from the back end without a signal; the committed contract makes the interface a
reviewable artefact in the commit that moved it.

- When an operation is added → add the resolver, emit the contract, run codegen, then write the operation file.

Enforced by: R52 (`no-hand-typed-wire`; hfs `wire-generated`), R113 (hfs `fe-contract-documents`).

## FE-API-REST REST only for what GraphQL cannot carry

A binary upload, a presigned-URL request or an identity-provider endpoint is one file under
`modules/api/rest/<area>/` on the one axios instance, wrapped by a `hooks/swr/api/rest` hook and reported through the
toast owner.

Why: one HTTP client keeps headers, credentials and failure handling in one place.

Enforced by: R50 (`fetch-only-in-api-client`).

## FE-UPLOAD Files go straight to storage

A mutation returns an authorized presigned request; the client PUTs the bytes with the signed headers through
`modules/api/rest` (no bearer, cookie or credential on the storage request), then calls the completion mutation, and
the back end verifies what storage holds.

Why: media stays out of the front end and the API process, and the client's type and size checks are feedback only.

Enforced by: review only.

## FE-AUTH The auth client yields identity, never data

`modules/auth` is the only importer of the identity-provider SDK and uses only its auth API: the client entry exports
the sign-in, sign-up, sign-out and password actions (each returning `GraphQLResponse<T>`), the session, the
access-token getter the Apollo links and the event stream read, and an auth-change subscription; `modules/auth/server`
holds the code exchange and session refresh for the callback and the proxy.

Why: the back end authorizes every read and write; the front end only proves who the user is, and holds no service key.

Enforced by: R217 (machine `supabase-client-owner`, `supabase-service-role`), R244 (`fe-stack-import`), R287
(`callback-shape`).
