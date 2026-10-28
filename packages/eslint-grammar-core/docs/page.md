# A route page is one Page

Law module: `page.ts`. Catalogue: R324 FE_PAGE_TABS_OUTSIDE_HEADER, R325 FE_ROUTE_PAGE_OUTSIDE_PAGE.

Grammar's `Page` is a route page: the header band full width, then the body inside the page measure and gutter one region step below it (or, with `chrome="bleed"`, an app surface whose body fills the region). It is the single owner of the page inset and the page rhythm, so the page tabs belong to its header and nothing of the page sits beside it.

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

A route draws exactly one `Page`. In a page owner (`fe.feature`, kind `pages`) or a layout owner (`fe.feature`, kind `layouts`) the element that draws it is a `Page`, or an element of one of the app's connected blocks (`fe.components`, kind `blocks`, imported from `@/` or a relative path) whose source draws a `Page` in its connected half or in the pure half it draws through (`./component`). The rule reads that block one level deep: a block the block relays to is not followed. This is how a server owner gets a header built from client data: it renders that block as its root and passes the page's content as the block's children.

A tabbed segment has its `Page` in its layout. A route segment `layout` file (`src/app/**/layout.tsx`) frames every route `page` below it; when it, or a layout owner it renders (through that owner, its pure half or its one root block, as above), draws a `Page` whose `header` carries `tabs` (an object literal written in place or held in a `const` of the same file), that `Page` is the one `Page` of every route under the segment. For a page owner the rule finds the route `page` files that import it, walks up from each through the `layout` files of the segments above it to the app folder, and resolves each layout's owner. A layout whose `Page` carries no `tabs` frames no segment: the pages under it draw their own.

Findings, each reported on the element:

- `sibling`: an element that draws the `Page` has an element sibling in its parent, in a page owner or a layout owner.
- `twice`: an element that draws a `Page` sits inside another one (a `Page` in a `Page`, or a block that draws one inside a `Page` or inside the root block), or sits in a page owner mounted by a route under a segment layout that draws the `Page`; the finding names that layout.
- `part`: any `PageHeader` or `PageContainer` in a page or layout owner: both are Page's own parts.
- `missing`: a page owner file draws JSX but nothing that draws the `Page`, and draws no element imported from its own pure half, reported on its first element: the page has no frame at all.

A `Page` (or the root block) alone in a fragment or a provider, and one per branch of a conditional, are legal; the root block's children are the page body. Not judged for `missing`:

- files outside a page owner, a layout owner (a pure frame draws no `Page`), and a page owner that draws no JSX: its body only calls `redirect()` or `notFound()`, or returns null, so it draws no UI;
- a page owner every route of which lies under a segment layout that draws the `Page`: it draws body content only;
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

**Valid** (`src/features/pages/ChatPage/component.tsx`'s root block `AgentChat` draws an app surface under the trail alone)

```tsx
<Page chrome="bleed" header={{ breadcrumbs }}>
  <FillViewport minHeight="md" bottomInset="page">
    <SurfaceCard ariaLabel={label} composition="joined" height="fill">{rail}{thread}</SurfaceCard>
  </FillViewport>
</Page>
```

**Valid** (`src/features/layouts/InstanceLayout/component.tsx` frames the segment `app/**/[instance]/layout.tsx`; its root block `InstanceFrame` draws `<Page header={{ title, tabs: { label, items } }}>{children}</Page>`, items with `href`)

```tsx
<InstanceFrame instanceId={instanceId}>{children}</InstanceFrame>
```

and a page owner under it draws its body only:

```tsx
<SettingsGrid instanceId={instanceId} />
```

**Invalid** (`src/features/layouts/InstanceLayout/component.tsx`: the head drawn beside the segment's `Page`)

```tsx
<>
  <InstanceHeader instanceId={instanceId} />
  <Page>{children}</Page>
</>
```

**Invalid** (`src/features/pages/SettingsPage/component.tsx` under that segment: a second `Page`)

```tsx
<Page header={{ title: "Settings" }}>
  <SettingsGrid instanceId={instanceId} />
</Page>
```

**Finding code:** `FE_ROUTE_PAGE_OUTSIDE_PAGE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
