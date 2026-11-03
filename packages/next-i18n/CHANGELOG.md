# Changelog

## 0.1.0 - 2026-11-03

The next-intl stack of a StarCi front end, lifted from the product that ran it in production and from the starter's per-app i18n workspace package, and generalised over the app's locales: typed, no product names, no component.

- Added: `defineI18n` (`@starci/next-i18n`), the one description of an app's languages: the locales and the default, the product time zone, the locale prefix mode (`as-needed` unless the app says otherwise), the locale cookie, locale detection and alternate links, the Intl tags (`intlTagOf` reads any other value as the default). It returns the typed next-intl routing plus `isLocale`, `localeOf` and `intlTagOf`, and imports no server module, so a client component may read it.
- Added: `createProxy` (`@starci/next-i18n/proxy`), the locale-negotiating proxy: next-intl's middleware over the app's routing, with the API, health, `_next` and `_vercel` roots (or the roots the app lists) and any file with an extension left alone. It never imports the navigation.
- Added: `createI18nNavigation` (`@starci/next-i18n/navigation`), the locale-aware `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname` of the app's routing.
- Added: `createRequestConfig` (`@starci/next-i18n/request`), the request config next-intl's plugin loads: the locale of the request (the route's own through `readRouteLocale`, else the header the proxy set, else the cookie, else the default), the product time zone, the app's own catalog from its `loadMessages` and `<app>:<namespace>.<key>` for a missing key.
- Added: `createReadLocaleSegment` (`@starci/next-i18n/layout`), what a `[locale]` layout resolves before it mounts the shell; an unknown segment is a 404.
- The proxy, the locale order, the catalog check and the navigation run under real next-intl in the specs, at 90% line coverage or more.
