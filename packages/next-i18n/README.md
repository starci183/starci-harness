# @starci/next-i18n

The next-intl stack of a StarCi Next.js front end, written once (FE-I18N-1) and generic over the app's locales. The app names its locales and keeps its message catalogs; the routing, the proxy, the navigation, the request config and the locale read of the `[locale]` layout come from here. No component, no class string, no lifecycle of its own (FE-PACKAGES-2).

| entry | export | what it is for |
|---|---|---|
| `@starci/next-i18n` | `defineI18n(options)` | the locales, the default, the time zone, the prefix mode and the cookie in one typed value: `routing` for next-intl, `isLocale`, `localeOf`, `intlTagOf`. Client-safe. |
| `@starci/next-i18n/proxy` | `createProxy(i18n, options?)` | the `proxy` of `src/proxy.ts`: locale negotiation, except for the roots the app lists and files with an extension |
| `@starci/next-i18n/navigation` | `createI18nNavigation(i18n)` | locale-aware `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` |
| `@starci/next-i18n/request` | `createRequestConfig(i18n, { app, loadMessages, readRouteLocale? })` | the default export of `modules/i18n/request.ts` that next-intl's plugin loads |
| `@starci/next-i18n/layout` | `createReadLocaleSegment(i18n)` | the `readLocaleSegment(params)` a `[locale]` layout calls; an unknown locale is a 404 |

The proxy, the navigation and the server entries are separate subpaths because they run under different React export conditions: the proxy must never evaluate the navigation.

## In an app

```ts
// modules/i18n/routing.ts: the one description of the languages
export const i18n = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "Asia/Ho_Chi_Minh" })

// src/proxy.ts
export const proxy = createProxy(i18n)

// modules/i18n/request.ts: the app only names its catalogs
export default createRequestConfig(i18n, { app: "web", loadMessages: (locale) => import(`./messages/${locale}.json`) })

// app/[locale]/layout.tsx
const { locale, messages, timeZone } = await createReadLocaleSegment(i18n)(props.params)
```

With `experimental.rootParams` the request config reads the locale from the route: `readRouteLocale: () => locale()` (from `next/root-params`).

## Tests

`npm test` typechecks, lints and runs the `node:test` specs under 90% line coverage; the specs drive next-intl's real middleware and navigation in Node (`src/next-esm.setup.ts` resolves Next's bare subpaths the way a bundler does and is no part of the package).

`next` (>= 16) and `next-intl` (>= 4) are peers, the versions of the app's stack.
