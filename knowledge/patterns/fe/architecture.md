---
slots: [fe.app, fe.route, fe.route.callback, fe.source-root-pinned]
---
# Front-end architecture

The responsibility graph of a Next.js app: who adapts the framework, who owns product scenarios, who owns
reusable capabilities, and which way imports point. The tiers and the direction matrix are data in
[hfs/slots.yaml](../../hfs/slots.yaml) (`tiers.fe`); the architecture machine judges them.

## FE-ARCHITECTURE-1 A route adapts framework inputs to one visual owner

A visual route resolves framework-owned inputs (params, searchParams, headers, cookies, a session read) and mounts
one page-level owner from `features/{pages,layouts,overlays}`; a route whose whole job is a redirect or `notFound`
mounts none. Shell composition lives in a layout or the page owner, never beside the page in the route. Every owner
is mounted by some route, no owner renders `null` as its whole body, and every href comes from `modules/routes`
and resolves to a real route.

Why: one visual responsibility per route; an unmounted owner is dead code and an href with no route is a broken link.

Enforced by: R54 FE_ROUTE_FILES_THIN, R57 FE_OWNER_REACHABLE.

## FE-ARCHITECTURE-2 Responsibilities point inward and downward, without cycles

Route → features, modules, packages. Features → components, hooks, modules, packages; the only feature-to-feature
edge is a page or layout owner importing an overlay entry (a layout never imports a page, an overlay never another
overlay). Components descend blocks → composites → branches → leaves, never block to block, and may import hooks
and packages, never app or features. Hooks import modules and packages; modules import modules and packages,
acyclic. A framework-pinned root file is a thin adapter into modules or a feature entry. Type-only edges, aliases,
barrels and dynamic literals obey the same direction; every cross-owner import enters the owner's `index.ts(x)`.

Why: a one-way graph lets each unit be reasoned about alone, and holds for one app or several.

- When a reusable unit needs product state → pass it a resolved contract, or move the orchestration to the feature.
- When a client list renders connected blocks → the overlay passes identities and a `renderItem` prop down; the
  branch maps identities with stable keys and never imports a block.

Enforced by: R26 (FE_TIER_DIRECTION), R27 ARCH_OWNER_CYCLE, R30.

## FE-ARCHITECTURE-3 Split world ownership only where there is a world to own

A block that reads product data, session, locale, router or transport state owns that in its `index.tsx` and renders
its exact sibling `XBase` from `component.tsx` on every non-empty path. Pure blocks, composites, branches and leaves
need no twin and may keep intrinsic browser interaction (refs, focus, disclosure, measurement, drag, reduced motion).
Pages and layouts stay server components and read no data; a client overlay may read list identities for
composition, and each connected block owns its own reads. A connected unit stays within the hook and state budgets
of its slot ([hfs/slots.yaml](../../hfs/slots.yaml)).

Why: the split isolates real world dependencies without forwarding components around ordinary interaction.

Enforced by: R55 FE_CLIENT_BOUNDARY, R56 FE_HOOKS_ARE_HOOKS, R65 FE_SIZE_AND_STATE_BUDGET, R92 FE_COMPONENT_API.

## FE-ARCHITECTURE-4 Apps stay independent; packages expose owned APIs

Each app is independent ([folder.md](folder.md) FE-APPS-1). An app never imports another app; code two apps need is
a package under `fe/packages/<pkg>` consumed through its declared exports, and a package never imports app
internals. A second consumer or a `packages/` path does not by itself make code shared.

Why: apps that import each other cannot build or deploy separately, and a package boundary is a distribution contract.

Enforced by: R63 FE_PACKAGE_SHAPE, R64 FE_APP_ISOLATION.

## FE-ARCHITECTURE-5 Features own scenarios; modules own capabilities

`features/{pages,layouts,overlays}` own product composition; `hooks/<domain>` own React lifecycle and map module
results to the product contract; a module owns one cohesive technical or domain capability behind a public entry.
Wire types generated from `be/contracts/` stay inside `modules/api` and are mapped before presentation; the grammar
receives only product-agnostic visual contracts.

Why: a transport revision then changes its mapper, not every render contract.

Enforced by: R50 FE_TRANSPORT_OWNER, R52 FE_WIRE_GENERATED.

## FE-ROUTE The front end serves no API

The front end is a Next App Router app with thin routes. No file carries `"use server"`, and the only route handlers
are `app/health/live/route.ts` and, when the auth flow truly needs a server code exchange, the auth callback slot
(prefer the client-side PKCE exchange in `modules/auth`). The callback only exchanges the code (or verifies an email
link token), validates the next path with pure helpers of `modules/routes`/`modules/auth`, and redirects. A webhook,
cron, public API or third-party callback is a back-end feature. The pages router is not used.

Why: a Server Action or route handler is a second back end hidden in the front end; it bypasses the API contract,
back-end authorization and the job pipeline.

Enforced by: R243 FE_SERVER_ACTION_FORBIDDEN, R287 FE_CALLBACK_SHAPE.
