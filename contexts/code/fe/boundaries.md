---
slots: [fe.app, fe.route, fe.feature, fe.components, fe.hooks]
---
# Boundaries

Which boundary handles a render failure or a wait, where the client boundary sits, where the client providers live,
and who writes a cookie.

## FE-BOUNDARY-1 Error, not-found and loading files mount a feature owner

`app/global-error.tsx` and every `error.tsx` are `"use client"` and render one `*ErrorPage` feature owner with
`onRetry={props.reset}`; every `loading.tsx` renders one `*LoadingPage` that draws that segment's skeleton; every
`not-found.tsx` renders one `*NotFoundPage`; a `Suspense` always has a visible fallback.

Why: without a boundary a render error blanks the page; a boundary that writes its own markup is a second look of the
same failure.

```tsx
"use client"

import { AppErrorPage } from "@/features/pages/AppErrorPage"

type ErrorProps = { readonly reset: () => void }

/** Catches a render failure below the locale layout and offers to render the segment again. */
const ErrorBoundary = (props: ErrorProps) => <AppErrorPage onRetry={props.reset} />

export default ErrorBoundary
```

Enforced by: R53 (`no-null-suspense-fallback`; machine `error-boundary-missing`), R54 (`route-files-thin`), R91
(`route-slot-fixed-name`).

## FE-BOUNDARY-2 Server first; `"use client"` only where a slot allows it

Route files, page and layout owners and pure halves are server components; `"use client"` sits on a connected block's
`index.tsx`, an overlay entry, a leaf with intrinsic interaction, an error boundary, `app/[locale]/providers.tsx`,
`redux/ReduxProvider.tsx`, `modules/toast/toast.tsx` and a `hooks/effects/*SideEffect.tsx`; a client file never imports
`next/headers`, `server-only` or a Node built-in, and a module that does starts with `import "server-only"`.

Why: a client layout ships its whole subtree and catalog to every page, and a server module reached from the client
breaks the build or leaks a secret.

Enforced by: R55 (`use-client-only-at-boundary`, `client-no-server-import`, `server-module-marks-server-only`,
`client-reaches-server`).

## FE-BOUNDARY-3 The client providers are one file under the locale layout

`app/[locale]/providers.tsx` nests, once, the next-intl client provider, the redux provider, the vendor i18n
provider, the theme provider, the grammar root (given the router's `navigate` and `useHref`, FE-I18N-4), the SWR
configuration keyed by the viewer, the toast region and the app-wide side effects (`features/layouts/SideEffectsLayout`, which mounts the `hooks/effects` components); the
locale layout renders it around its children.

Why: one provider stack per app makes the client runtime readable in one file, and keying the SWR cache by the viewer
drops one user's cached data when another signs in.

```tsx
<NextIntlClientProvider locale={props.locale} messages={props.messages} timeZone={props.timeZone}>
    <ReduxProvider>
        <GrammarProviders>
            <SWRConfig key={viewerId ?? "signed-out"} value={{ ...READ_DEFAULTS, provider: () => new Map() }}>
                {props.children}
                <ToastProvider />
                <SideEffectsLayout />
            </SWRConfig>
        </GrammarProviders>
    </ReduxProvider>
</NextIntlClientProvider>
```

Enforced by: R55 (`use-client-only-at-boundary`); the composition is review only.

## FE-BOUNDARY-4 A cookie the front end writes states its attributes

The session cookie is written by the identity client of `modules/auth` or by the back end; a cookie the front end
writes itself (the locale in `proxy.ts`, a remembered workspace) passes one `as const` options constant of its owning
module with a literal `httpOnly`, `secure` from `modules/config` and `sameSite` `lax` or `strict`.

Why: a cookie left to defaults is readable by any script and rides cross-site requests.

Enforced by: R107 (`response-cookie-attributes`).
