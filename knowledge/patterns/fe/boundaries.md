---
slots: [fe.app, fe.route, fe.feature, fe.components, fe.hooks]
---
# Boundaries

Which boundary handles a render failure, where the client boundary sits, who writes a cookie, and how a persistent
layout hosts overlays chosen by the URL.

## FE-BOUNDARY-1 Error, not-found and loading boundaries

Every app has `app/global-error.tsx`, `app/[locale]/error.tsx`, `app/[locale]/not-found.tsx` and
`app/[locale]/layout.tsx`, and a `loading.tsx` for every route group that reads data, drawing that group's skeleton.
The error boundaries are client components (Next requires it), follow the installed Next props contract, and their
retry re-runs the failed read. `Suspense` never has a `null` fallback.

Why: without a boundary a render error blanks the page, and a group with no loading file shows nothing while it waits.

Enforced by: R53 FE_ERROR_BOUNDARY_MISSING.

## FE-BOUNDARY-2 A boundary renders a status, never an error code

A boundary and a connected block turn a read or a caught error into a resource with `toSlot` and render it by the
status recipe ([README](README.md#data-status-of-a-region)); they never read `error.status`.

Enforced by: R51, R92.

## FE-BOUNDARY-3 Server first

Route files and layouts are server components. `"use client"` appears only in the `index.tsx` of a block or overlay
with interaction or client data hooks, in a leaf with intrinsic interaction, and in the error boundaries. A server
page or feature owner renders a client block or overlay entry without becoming a client component. Catalogs are split
by namespace, and a client component receives only its picked namespaces. `force-dynamic` is never set on a client page.

Why: a client layout ships the whole subtree and catalog to every page.

Enforced by: R55 FE_CLIENT_BOUNDARY, R60.

## FE-BOUNDARY-4 Cookies are written by the server, with stated attributes

The session cookie is written by the back end only (an HttpOnly cookie of its auth endpoint) or held by the identity
client in `modules/auth`. A cookie the front end writes itself (a locale preference in `proxy.ts`) uses one `as const`
options constant in the owning module, stating `httpOnly` literally, `secure` from `modules/config` and `sameSite`
`lax` or `strict`. A session token never reaches page script outside `modules/auth`.

Why: a cookie left to defaults is readable by any script and rides cross-site requests.

Enforced by: R107 FE_COOKIE_ATTRIBUTES.

## FE-BOUNDARY-5 The layout overlay host

A server layout that hosts overlays chosen by the URL imports its candidate overlay entries and a client
`OverlayRouteHost` overlay, and passes the candidates to it as rendered nodes, never as server-created callbacks. The
host owns `"use client"`, reads the route state through a `hooks/overlays` hook (locale-aware pathname and search
params) and renders the pure `components/branches/OverlayHost`, which receives the scalar selection and the nodes and
imports nothing from features. The search-parameter reader sits in `Suspense` with a visible, translated fallback.

```
features/layouts/<Shell>/index.tsx        imports OverlayRouteHost and each candidate overlay
  -> features/overlays/OverlayRouteHost   "use client"; useOverlayRouteState()
    -> components/branches/OverlayHost     pure; mounts the selected node
      -> features/overlays/<Name>          rendered composition, not an import
```

Why: a persistent layout mounts URL-selected overlays without turning every page into a client component, and
passing rendered nodes keeps the component graph pointing down.

Enforced by: R26, R55, R92.
