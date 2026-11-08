# Every console page states its trail

Law module: `page-breadcrumbs.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#PAGE-BREADCRUMBS`. Finding code: `FE_PAGE_BREADCRUMBS`.

Every page of the app console gives the reader a way up. The root page of a console says so with `breadcrumbs: "root"`, which draws no trail.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/page-breadcrumbs`

A Grammar `Page` whose `header` is an object literal (in place, or a `const` of the same file) with no `breadcrumbs` property is refused. Not judged: no `header` (a sign-in card, a landing), a `header` that is not an object literal, a header with a spread.

Console pages are the `Page` elements drawn in a page owner or layout owner (`fe.feature`, kind `pages` or `layouts`) that is not a segment boundary (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`) and is not mounted only under the app's `(auth)` route group, and in an app block (`fe.components`, kind `blocks`), which may draw the page from client data.

**Invalid**

```tsx
<Page header={{ title: "Main account" }}>...</Page>
```

**Valid**

```tsx
<Page header={{ title: "Main account", breadcrumbs: { label: "Trail", items } }}>...</Page>
<Page header={{ title: "Overview", breadcrumbs: "root" }}>...</Page>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
