# A route page is one Page

Law module: `page.ts`. Catalogue: R324 FE_PAGE_TABS_OUTSIDE_HEADER, R325 FE_ROUTE_PAGE_OUTSIDE_PAGE.

Grammar's `Page` is a route page: the header band full width, then the body inside the page measure and gutter one region step below it. It is the single owner of the page inset and the page rhythm, so the page tabs belong to its header and nothing of the page sits beside it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/page-tabs-in-header`

A `Tabs` element that is the first element child of a `Page`, or the next element sibling of a `PageHeader`, is a finding, reported on the `Tabs`. Whitespace text and JSX comments are not children. A `Tabs` lower in the body, or inside a body section, is region tabs and is not judged.

**Invalid** (`src/features/pages/ConnectionPage/component.tsx`)

```tsx
<Page header={{ title: "Main account" }}>
  <Tabs label="Connection" items={items} selectedKey={tab} onSelect={setTab} />
  <WebhookCard />
</Page>
```

**Valid**

```tsx
<Page header={{ title: "Main account", tabs: { label: "Connection", items, selectedKey: tab, onSelect: setTab } }}>
  <WebhookCard />
</Page>
```

**Finding code:** `FE_PAGE_TABS_OUTSIDE_HEADER`

## `starci-grammar/route-page-is-one-page`

In a page owner (`fe.feature`, kind `pages`), a `Page` with an element sibling in its parent is a finding, and so is any `PageHeader` or `PageContainer`: both are Page's own parts. A `Page` alone in a fragment or a provider, and one `Page` per branch of a conditional, are legal. Files outside a page owner are not judged.

**Invalid** (`src/features/pages/ConnectionPage/component.tsx`)

```tsx
<>
  <PageHeader title="Main account" />
  <PageContainer><WebhookCard /></PageContainer>
</>
```

**Valid**

```tsx
<Page header={{ title: "Main account" }}>
  <WebhookCard />
</Page>
```

**Finding code:** `FE_ROUTE_PAGE_OUTSIDE_PAGE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
