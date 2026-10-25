# Grammar boundary

Law module: `grammar-boundary.mjs`. Catalogue: R62 FE_NATIVE_FORM_CONTROL (the grammar owns the element), R65 FE_SIZE_AND_STATE_BUDGET (timer ownership).

Page structure and text are composed from `@starci/grammar` (or the repository's `<family>-ui` package), not drawn as raw HTML.

Every rule below is an error in `starciFeConfig`; none can be switched off or suppressed inline.

## `starci-fe/no-raw-structural-element`

Page structure and text are grammar components, not raw `div`-family HTML; only `fe.package.ui` renderers draw raw tags.

Applies to app source that composes the grammar (slots `fe.feature`, `fe.components`, `fe.route`, `fe.hooks`) and to every workspace package except the `<family>-ui` package (`fe.package.ui`), whose components are the renderers. Spec files render raw HTML as a harness and are not judged; a file no slot owns is not judged.

The refused tags are exactly those `@starci/grammar` has a component for (the twin test reads the package source): `h1-h6` (`Heading`), `p` and `span` (`Text`), `hr` (`Divider`), `label` (`Label`), `form` (`Form`), `fieldset` (`Fieldset`), `dl` `dt` `dd` (`DescriptionList`), `table` `thead` `tbody` `tr` `td` `th` (`DataTable`), `ul` `ol` `li` (`List` and `ListItem` for a plain semantic list, `SurfaceListCard`, `StaticStateRow`), `header` (`SectionHeader`, `TopBar`), `footer` (`Footer`), `nav` (`NavLandmark` for a named row of links, `Subnav`, `Breadcrumbs`, `NavigationFeatureNav`), `section` (`Region` for a named non-card region, `SurfaceCard`), `main` (`WorkspaceShell`), `figure` and `figcaption` (`MediaFrame`). `div`, `br`, `aside` and `article` are not refused: the grammar has no component for them.

Native `<time>` remains available for an absolute timestamp. Live relative time and countdown labels use `RelativeTime`.

**Invalid** (`src/features/pages/home/component.tsx`)

```ts
export const Home = () => <section><p>{t("intro")}</p></section>
```

**Valid** (`src/features/pages/home/component.tsx`)

```ts
export const Home = () => <SurfaceCard><Text>{t("intro")}</Text></SurfaceCard>
```

**Finding code:** `FE_NATIVE_FORM_CONTROL`

**Why:** Raw `<tag>` in `<file>`. Page structure and text are composed from grammar components, not written as raw HTML.

**Fix:** Replace it with the matching grammar component (`Heading`, `Text`, `SurfaceCard`, ...); if the grammar lacks one, add it to the grammar or the ui package instead of drawing it in place.

## `starci-fe/no-app-relative-clock`

Grammar owns the shared clock for live relative time and countdowns. App components, hooks, modules and shared packages, including a product UI package, pass `dateTime`, `locale` and `mode` to `RelativeTime`.

The rule rejects a recurring `setInterval` or self-scheduling `setTimeout` whose callback or same-file helper reads `Date.now()`, `Date()`, zero-argument `new Date()` or `performance.now()`. It follows local aliases and destructured platform methods. Static reads, one-shot delays and timers that do not read the clock remain available. Indirect external clock helpers and counters that only decrement state need semantic review.

**Invalid** (`src/hooks/time/useNow.ts`)

```ts
const timer = setInterval(() => update(Date.now()), 1000)
```

**Valid** (`src/components/leaves/UpdatedAt/index.tsx`)

```tsx
const UpdatedAt = () => <RelativeTime dateTime={instant} locale={locale} mode="relative" />
```

**Finding code:** `FE_SIZE_AND_STATE_BUDGET`

**Fix:** Render the Grammar primitive and pass the instant; its single shared ticker owns updates and its deterministic fallback owns the server render.
