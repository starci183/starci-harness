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

Which directory and which file a piece of front-end code gets. The paths are the slots of
[hfs/slots.yaml](../../hfs/slots.yaml); this topic gives the reasons and the choices the slots leave.

## FE-FOLDER-1 Every source file sits in its tier folder

All product source is `fe/apps/<app>/src/` with `app/` (route files, `[locale]/providers.tsx`, `globals.css`),
`features/{pages,layouts,overlays}/<Name>/`, `components/{blocks,composites,branches,leaves}/<Name>/`, `hooks/`,
`redux/` and `modules/<capability>/`; only the framework-pinned files (front matter) sit beside them, and the request
interceptor is `proxy.ts`, never `middleware.ts`.

Why: one fixed shape per app leaves no undeclared home for a helper, so nothing is written twice.

- When a file such as `config.ts` or `i18n/request.ts` sits in the source root → move it into its module and point
  `next.config.ts` at the new path.

Enforced by: R01 (`slot-undeclared`), R91 (`frontend-source-layout`, `route-tree-holds-routes-only`), R54
(`no-middleware-file`), R94 (machine `fe-slot-allows`).

## FE-FOLDER-2 A unit folder holds `index.tsx`, an optional `component.tsx` and an optional `classNames.ts`

A connected block, page, layout or overlay keeps the connected `X` in `index.tsx` and the pure `XBase` with its
`XBaseProps` in `component.tsx`; a composite, branch or leaf is `index.tsx` alone; `classNames.ts` exists when the unit
writes layout classes; nothing else lives in the folder, and each file stays within its slot budget.

Why: stable basenames make both halves findable without opening a file, and a helper in a component folder is
invisible to the next author who needs it.

Enforced by: R91 (`surface-folder-two-files-only`, `no-helper-folder-in-components`, `export-matches-folder`),
R92 (`base-import-pair`), R65 (`component-line-budget`), R20 (`file-size-growth`).

## FE-FOLDER-3 `hooks/` holds hooks; everything else is a module

`hooks/` holds one hook per `use*.ts` file in its families (`swr`, `rhf`, `zustand/<store>`, `effects` with its
`*SideEffect.tsx`, `reuseables`, `socketio`) and in `hooks/<domain>/` with an `index.ts` and at most one
`<domain>.shared.ts` for that domain's constants, view types and pure helpers; the transport, session, toast,
environment, routes, i18n, storage and brand each live in their `modules/<capability>`.

Why: saying what a hooks folder is also says where everything else goes, so no transport hides in a hook and no helper
is copied.

Enforced by: R56 (`hooks-folder-holds-hooks-only`, `hooks-are-hooks`, `hook-location`), R49 (`no-env-outside-config`),
R21 (`duplicate-code`, `duplicate-symbol`).

## FE-FOLDER-4 Every app has its boundary files

Every app has `app/global-error.tsx` and, under `app/[locale]/`, `layout.tsx`, `error.tsx`, `not-found.tsx` and
`loading.tsx`, plus an `error.tsx` and a `loading.tsx` for each route group whose regions fail or wait on their own
([boundaries.md](boundaries.md)); a redirect from an old URL lives in `next.config.ts` `redirects()`.

Why: without a boundary a render error blanks the page and a slow segment shows nothing.

Enforced by: R53 (machine `error-boundary-missing`), R02.

## FE-APPS-1 One independent app per audience

Each app is `fe/apps/<app>/`, a private npm workspace declared in `hfs.json` `sides.fe.apps`, with its own required
modules (`config`, `i18n`, `routes`) and catalogs; a draft or preview of an app is a branch or a preview deployment,
never a second app folder with the same routes.

Why: independent apps build, deploy and fail separately, and a copied route tree diverges byte by byte.

Enforced by: R64 (`app-isolation`), R144 (hfs `monorepo`); a draft app folder is review only.

## FE-PACKAGES-1 A shared package builds to `dist` and exports named symbols

A shared package is `fe/packages/<pkg>/` with `package.json` whose `exports` point at `dist/*.js` and `.d.ts`, a
`build` script (`tsc -p tsconfig.build.json`) and `src/index.ts` plus one source file per declared subpath export.

Why: a package that ships source depends on its consumer's compiler, and a declared export with no file breaks the
first consumer that reaches for it.

```json
{
  "name": "@<project>/i18n",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./proxy": { "types": "./dist/proxy.d.ts", "default": "./dist/proxy.js" }
  },
  "scripts": { "build": "tsc -p tsconfig.build.json" }
}
```

Enforced by: R63 (machine `package-shape`), R30 (`package-export-bypass`), R25 (`dead-exports`).

## FE-PACKAGES-2 A shared package holds no visual

A shared front-end package holds transport, the i18n stack, catalogs, types or pure data and logic, never a component,
a class string, a colour or a world lifecycle; visuals two apps share belong to the grammar.

Why: a second visual owner beside the grammar is a fork of the design system.

Enforced by: R91 (`monorepo-tier-belongs-to-its-side`), R63 (machine `package-shape`).

## FE-PACKAGES-3 One version of every dependency, from the declared stack

Every front-end dependency is a package of [stack/fe.yaml](../../stack/fe.yaml) or is declared in `hfs.json`
`sides.fe.extraPackages` with a reason, at the one exact version of [stack/pins.yaml](../../stack/pins.yaml) across the
root and workspace manifests.

Why: two versions of one library in one bundle give one component two behaviours, and an undeclared dependency is a
second library for a concern that already has one.

Enforced by: R244 (`fe-stack-import`), R288 (hfs `fe-stack-allowlist`); the pins are review only.
