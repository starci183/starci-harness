---
slots: [be.app, be.app.api, be.app.worker, be.transport.message, be.feature.saga, be.contract]
---
# Services of one product

Decides where a back-end service lives when a product runs more than one, how images are pinned, how the contract between services
is vendored and evolves, and how an asynchronous consumer is proven. Saga compensation specs are BE-SAGA-4.

Edition: written from the full edition; the lite reference app declares none of these patterns, and whether lite
admits them is open ([project/lite.md](../../project/lite.md) "Patterns").

## BE-SERVICES-1 A service lives only at be/apps/<service>, and no service imports its sibling
A service is a Nest app at `be/apps/<service>/` (its `be.app.*` files and its own Dockerfile and image) sharing the `be/src`
libraries and the repository's one `package.json`; a Dockerfile or `package.json` anywhere else makes a second service root. In a
multi-service product each api or worker app is a `role: service` component of the application stacks. No service app imports a
file of another: shared code lives in `be/src`, and services meet through the wire.

Why: one repository, one install and one image per service keep each deployable on its own while every rule still sees all the
code; an import between apps welds two deployables back into one.

Enforced by: R163 HFS_SERVICE_PLACEMENT, R168 BE_SERVICE_ISOLATION, R165 HFS_SERVICE_STACK_DECLARATION, R188 HFS_DOCKER_STAGES.

## BE-SERVICES-2 Every image of a multi-service stack is pinned
Every component image of a multi-service stack is a digest or an exact version; an own image is `<repo>/<service>:<x.y.z>` built from
its app's Dockerfile, a third-party one stays pinned. No missing tag, `latest`, branch word or major/minor-only tag. A version bump is
one deliberate change that also rebuilds and republishes the own images.

Why: a moving tag makes two runs of the same commit different; the world and the deployment read the image from the stack, so the
version is decided once there.

Enforced by: R164 HFS_IMAGE_UNPINNED.

## BE-SERVICES-3 The contract between services is vendored and checked against the provider
A synchronous API keeps its committed snapshot (`be/contracts/<service>/schema.graphql`, `openapi.json`). The async contract is
`be/contracts/<service>/events.json` (event name, version, payload fields, and `compensates` for a failure event), emitted by
`starci app emit` and equal to the event classes (BE-EVENT-BUS-2). A consumer states what it reads in the literal `CONSUMES` table of
its app's `consumes.ts` (service, event, version); each entry must exist in the provider's snapshot at that version.

Why: the consumer is judged against the provider's committed contract, not its source, so a change on either side is a reviewed
diff of one file and a failing check on the other.

Enforced by: R166 HFS_EVENT_CONTRACT, R23 HFS_CONTRACT_SNAPSHOT_DRIFT, R113 FE_GRAPHQL_CONTRACT, R302 HFS_MCP_TOOLS_SNAPSHOT.

## BE-PERSISTENCE-15 Event contracts evolve only additively
`events.json` is compared with its pinned previous copy `events.pin.json`, refreshed only when the contract is published. Every pinned
event keeps its stream, version, payload fields, types and optionality; a new field is optional; a new event is free. A breaking
change is a new event key (`<event>.v2`) published beside the old one, which stays until its consumers have moved.

Why: events already on the wire and consumers deployed at another time cannot change in one commit; only additive change is safe for
both.

Enforced by: R177 BE_CONTRACT_BREAKING.

## BE-SERVICES-4 Every consumed event has an e2e spec through the world
Every event an app consumes (an entry of its `consumes.ts`) is named by an e2e spec that boots the apps with `useTestWorld`, publishes
the event, reads the persisted effect back and redelivers it, the receiver keeping the effect single; a delivery that exhausts its
retries is covered too. A saga step's spec also drives the compensation flow (BE-SAGA-4).

Why: an asynchronous flow fails between processes; a unit spec of one side proves nothing about delivery or redelivery.

Enforced by: R167 BE_ASYNC_SPEC_MISSING, R80 BE_INBOX_DEDUPE_MISSING.
