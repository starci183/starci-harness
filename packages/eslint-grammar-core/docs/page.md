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

A route draws exactly one `Page`. In a page owner (`fe.feature`, kind `pages`) the element that draws it is a `Page`, or an element of one of the app's connected blocks (`fe.components`, kind `blocks`, imported from `@/` or a relative path) whose source draws a `Page` in its connected half or in the pure half it draws through (`./component`). The rule reads that block one level deep: a block the block relays to is not followed. This is how a server page owner gets a header built from client data: it renders that block as its root and passes the page's content as the block's children.

Findings, each reported on the element:

- `sibling`: an element that draws the `Page` has an element sibling in its parent.
- `twice`: an element that draws a `Page` sits inside another one (a `Page` in a `Page`, or a block that draws one inside a `Page` or inside the root block).
- `part`: any `PageHeader` or `PageContainer`: both are Page's own parts.
- `missing`: a page owner file draws JSX but nothing that draws the `Page`, and draws no element imported from its own pure half, reported on its first element: the page has no frame at all.

A `Page` (or the root block) alone in a fragment or a provider, and one per branch of a conditional, are legal; the root block's children are the page body. Not judged for `missing`:

- files outside a page owner, and a page owner that draws no JSX: its body only calls `redirect()` or `notFound()`, or returns null, so it draws no UI;
- the segment boundary owners of FE-BOUNDARY-1 (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`): an app-level boundary stands in for whichever page failed or waits and draws its notice;
- an auth page: every route `page` file of the app (`src/app/**/page.tsx`) that imports the owner (`@/features/pages/<Owner>`) lies under the route group `(auth)`, and that group has its own `layout`. The Grammar ships no auth frame; the app's `(auth)` layout draws it, and it is the page frame of the sign-in, sign-up, password and callback pages it holds. An owner no route mounts, one also mounted outside the group, or a group without a layout gets no exemption.

A workbench page is an ordinary page: it draws its `Page` like any other, usually through its root block.

**Invalid** (`src/features/pages/ConnectionPage/component.tsx`)

```tsx
<>
  <PageHeader title="Main account" />
  <PageContainer><WebhookCard /></PageContainer>
</>
```

**Invalid** (`src/features/pages/HomePage/component.tsx`)

```tsx
<>
  <Heading level={1}>Home</Heading>
  <SignInForm />
</>
```

**Invalid** (`src/features/pages/DecisionsPage/component.tsx`, `DecisionsBoard` draws the `Page`)

```tsx
<>
  <Banner />
  <DecisionsBoard />
</>
```

**Valid**

```tsx
<Page header={{ title: "Main account" }}>
  <WebhookCard />
</Page>
```

**Valid** (`src/features/pages/AgentProfilePage/component.tsx`, the connected block `AgentProfileHead` draws the `Page` from client data)

```tsx
<AgentProfileHead agentId={agentId}>
  <AgentProfileOwner agentId={agentId} />
  <AgentProfileRecent agentId={agentId} />
</AgentProfileHead>
```

**Finding code:** `FE_ROUTE_PAGE_OUTSIDE_PAGE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
