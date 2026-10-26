---
slots: [fe.app, fe.route, fe.route.callback, fe.source-root-pinned]
---
# Front-end architecture

The responsibility graph of a Next.js app: who adapts the framework, who owns a scenario, who owns a world, and which
way imports point. The tiers and the direction matrix are data in [hfs/slots.yaml](../../hfs/slots.yaml) (`tiers.fe`);
the architecture machine judges them.

## FE-ARCHITECTURE-1 A route adapts the framework to one feature owner

A route file turns framework inputs (awaited `params`, `searchParams`) into atoms and mounts exactly one owner of
`features/pages` (an `error.tsx` its `*ErrorPage`, a `loading.tsx` its `*LoadingPage`, a `layout.tsx` its
`features/layouts` owner), and every owner is mounted by some route.

Why: one visual responsibility per route keeps the route tree a table of contents; an unmounted owner is dead code.

Enforced by: R54 (`route-files-thin`, `route-adapter`), R57 (`owner-reachable`), R91 (`route-tree-holds-routes-only`).

## FE-ARCHITECTURE-2 Imports point down the tiers, through owner entries, without cycles

Route → features, modules; features → components, hooks, modules, and a page or layout owner → an overlay; blocks →
composites → branches → leaves, never block to block and never up; components → hooks only for intrinsic or
domain view hooks; hooks → hooks, modules, and `hooks/swr` alone → `modules/api`; modules → modules, acyclic.

Why: a one-way graph lets each unit be read alone, and a cycle makes two owners one.

- When a reusable unit needs product state → hand it the resolved values, or move the orchestration up to the block.

Enforced by: R26 (`tier-direction`), R27 (`owner-cycle`), R30 (`owner-export-bypass`).

## FE-ARCHITECTURE-3 A world is owned by a connected block, never by a page or a lower tier

A block that reads data, session, store, locale or the router owns that in its `"use client"` `index.tsx` and renders
its sibling `XBase`; pages and layouts are server components that resolve copy with `getTranslations` and compose
blocks, reading no data; composites, branches and leaves take resolved fields and own at most intrinsic interaction.

Why: each region reads its own data and fails alone, and every pure half can be drawn from a fixture.

Enforced by: R55 (`use-client-only-at-boundary`), R92 (`connected-block-has-presentational-twin`,
`presentational-purity`, `component-purity`), R58 (`no-copy-resolution-below-block`), R65 (`unit-hook-budget`).

## FE-ARCHITECTURE-4 Apps never import each other; shared code is a built package

Each app is independent; code two apps need is a workspace package under `fe/packages/<pkg>` imported through its
declared exports, and a package never imports an app.

Why: apps that import each other cannot build or deploy separately, and a package export is a distribution contract.

Enforced by: R64 (`app-isolation`), R21 (`cross-app-duplicate`), R30 (`package-export-bypass`), R26
(`package-imports-app`).

## FE-ROUTE The front end serves no API

No file carries `"use server"`, and the only route handlers are `app/health/live/route.ts` and the auth callback
`app/auth/callback/route.ts`, which exchanges the provider code or verifies the email-link token through
`modules/auth/server` and redirects to a validated path.

Why: a Server Action or a route handler is a second back end hidden in the front end, outside the API contract and
back-end authorization; a webhook, cron or public API is a back-end feature.

```ts
export const GET = async (request: NextRequest): Promise<NextResponse> => {
    const origin = requestOrigin(request)
    const next = callbackNext(request.nextUrl.searchParams.get("next"), origin) ?? AUTH_ROUTES.home
    const code = request.nextUrl.searchParams.get("code")
    if (code === null) return NextResponse.redirect(new URL(`${APP_ROUTES.login}?error=missing_code`, origin))
    const result = await exchangeAuthCode(code)
    return NextResponse.redirect(new URL(result.success ? next : APP_ROUTES.login, origin))
}
```

Enforced by: R243 (`no-server-action`; machine `server-action-forbidden`), R287 (`callback-shape`).
