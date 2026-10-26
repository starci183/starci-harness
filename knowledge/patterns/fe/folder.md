---
slots: [fe.app, fe.app.next, fe.feature, fe.components, fe.hooks, fe.modules, fe.package, fe.package.api, fe.package.i18n]
# The files Next.js loads from the source root (the directory holding app/). Exact basenames, read by the source-layout
# check; which of them a repository may keep is the slot fe.source-root-pinned's decision.
frameworkPinnedRootFiles: [middleware.ts, middleware.js, middleware.mjs, proxy.ts, proxy.js, proxy.mjs, instrumentation.ts, instrumentation.js, instrumentation.mjs, instrumentation-client.ts, instrumentation-client.js, instrumentation-client.mjs, next-env.d.ts]
# Export names the framework mandates in a pinned root file, by file stem; they keep the framework's spelling.
frameworkPinnedRootExports:
  middleware: [config, middleware, default]
  proxy: [config, proxy, default]
  instrumentation: [register, onRequestError]
  instrumentation-client: [onRouterTransitionStart]
---
# Folders, units, apps and packages

Which directory and which file a piece of front-end code gets. The paths are owned by the slots of
[hfs/slots.yaml](../../hfs/slots.yaml); this topic gives the reasons and the choices the slots leave.

## FE-FOLDER-1 Responsibility directories

Every front end is `fe/apps/<app>/` even with one app, each app declared in `hfs.json` `sides.fe.apps`, and all
product source lives under `fe/apps/<app>/src`. In a source root: `app/` holds framework adapters;
`features/{pages,layouts,overlays}` route-facing product composition; `components/{blocks,composites,branches,leaves}`
product units and `components/providers` the client providers the root layout mounts; `hooks/` React hooks; `redux/`
the app-wide store; `modules/<capability>` cohesive technical and domain capabilities. Each concern's library and home
is [stack/fe.yaml](../../stack/fe.yaml). Only the framework-pinned files (front matter) sit directly in the source root,
each a thin adapter; locale routing uses `proxy.ts`, never `middleware.*`.

Why: one fixed shape per app keeps every front end alike and leaves no undeclared owner for helpers and buckets.

- When a file such as `i18n/request.ts` or `config.ts` sits in the source root → move it to its module and point
  `next.config.ts` at the new path.

Enforced by: R01 HFS_SLOT_UNDECLARED, R02, R59, R91 FE_SOURCE_FORM, R94 FE_SLOT_FILE_ROLE.

## FE-FOLDER-2 The file set of one unit

A split unit (a connected block, a feature page, layout or overlay) has `index.tsx` for the connected `X` and a
sibling `component.tsx` for the pure `XBase`, its `XBaseProps` and `xDefaultState`; only that `index.tsx` imports
`component.tsx`. Pure blocks, composites, branches and leaves have `index.tsx` only and never an empty twin.
`classNames.ts` exists only when the unit owns layout classes. A composition-only feature may render an existing
public pure component directly instead of a forwarding `component.tsx`. Sizes stay within the slot budgets.

Why: stable basenames make the connected and pure halves discoverable without forwarding twins.

Enforced by: R02, R20 HFS_SIZE_GROWTH, R65, R92 FE_COMPONENT_API.

## FE-FOLDER-3 Every app has its boundaries

Every app has `app/global-error.tsx`, `app/[locale]/layout.tsx`, `app/[locale]/error.tsx`,
`app/[locale]/not-found.tsx` and a `loading.tsx` for each route group that reads data ([boundaries.md](boundaries.md)).
A redirect from an old URL lives in `next.config` `redirects()`, never in a page.

Enforced by: R53 FE_ERROR_BOUNDARY_MISSING.

## FE-FOLDER-4 Hooks are hooks; transport and capabilities live in modules

`hooks/` holds React hooks only, one per file: `hooks/swr` (one wrapper per `modules/api` operation, plus
`SwrSideEffects.tsx`), `hooks/rhf` (forms), `hooks/zustand/<store>`, `hooks/socketio`, `hooks/effects` (app-wide
side effects), `hooks/reuseables` (generic hooks) and `hooks/<domain>` with at most one `<domain>.shared.ts` for that
domain's non-hook helpers. The Apollo clients and operations, generated wire types and the axios calls live in
`modules/api`; the session in `modules/auth`; mutation feedback in `modules/toast`; environment reads in
`modules/config`; href builders in `modules/routes`; locale routing in `modules/i18n`; colour in `modules/brand`.

Why: saying what a hooks folder is also says where everything else goes, so no helper is copied and no transport
hides in a hook.

Enforced by: R49 FE_ENV_OWNER, R56 FE_HOOKS_ARE_HOOKS, R21 HFS_DUPLICATE_CODE.

## FE-FOLDER-6 Keep units cohesive

A unit folder holds files that change for one responsibility. No `helpers/` or `utils/` bucket inside components,
no deployment configuration read in presentation, no file split only to meet a count. A private subordinate render
stays local; one with a stable public responsibility gets its own owner.

Why: cohesion prevents helper sprawl without one-component-per-folder ceremony.

Enforced by: R21, R49.

## FE-APPS-1 One independent app per audience

Each app is `fe/apps/<app>/`, an npm workspace of the app root named `@<project>/<app>`, declared in `hfs.json`
`sides.fe.apps`. It carries the required module instances of slot `fe.modules`, its own `modules/api` unless a shared
api package owns transport, and its own default locale in `modules/i18n`.

Why: independent apps build, deploy and fail separately.

Enforced by: R64 FE_APP_ISOLATION.

## FE-APPS-2 A draft is a branch, not an app

A design draft or preview of an app is a branch or a preview deployment, never a second app folder with the same
routes. Two apps serving the same routes with the same files are one app.

Why: a copied route tree diverges byte by byte and doubles every change.

## FE-APPS-3 A screen record names its app

Every UI screen record in `.starciwork` declares `app`, a name from `sides.fe.apps`, and its implementation points at
`fe/apps/<app>`. Drawing and implementing read the app from the record, never from the screen name or route.

Enforced by: R64.

## FE-PACKAGES-1 A package builds to `dist`

A shared package is `fe/packages/<pkg>/`, declared in the root `workspaces`, with `package.json` whose `exports`
point at `dist`, `src/index.ts` and `tsconfig.json`. Its `build` script produces `dist`; consumers import the built
output.

Why: a package that ships source depends on the consumer's compiler and cannot be versioned or cached as a unit.

Enforced by: R63 FE_PACKAGE_SHAPE.

## FE-PACKAGES-2 Named exports, no dead unit, no visuals

`src/index.ts` re-exports named symbols only; every export has a consumer. A shared package holds transport, i18n
catalogs, types or pure logic, never a visual component, colour or world lifecycle: visuals two apps share belong to
the grammar.

Why: explicit exports keep the surface reviewable, and a second visual owner beside the grammar is a fork.

Enforced by: R25 HFS_UNUSED_EXPORT, R63.

## FE-PACKAGES-3 One version of every dependency

A dependency has one exact version across the root and workspace manifests, equal to [stack/pins.yaml](../../stack/pins.yaml),
with root `overrides` for the framework and the grammar; no nested copy of the grammar exists. A version is raised in
the pins first, then each app moves in its own upgrade.

Why: two versions of one design system in one bundle give one component two behaviours.

## FE-PACKAGES-4 Dependencies follow the declared stack

Every front-end dependency is a package of [stack/fe.yaml](../../stack/fe.yaml) or is declared in `hfs.json`
`fe.extraPackages` with a reason, and every product Next app declares the stack's `core` runtime packages. Build tools
may be installed once at the app root.

Why: a declared stack keeps each concern on one library and makes an extra dependency an explicit decision.

Enforced by: R244 FE_STACK_FORBIDDEN, R288 FE_STACK_UNLISTED.
