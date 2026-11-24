# A route page is one Page

Law module: `page.ts`. Catalogue: R324 FE_PAGE_TABS_OUTSIDE_HEADER, R325 FE_ROUTE_PAGE_OUTSIDE_PAGE.

Grammar's `Page` is a route page: the header band full width, then the body inside the page measure and gutter one region step below it (or, with `chrome="bleed"`, an app surface whose body fills the region). It is the single owner of the page inset and the page rhythm, so the page tabs belong to its header and nothing of the page sits beside it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/page-tabs-in-header`

A `Tabs` element that is the first element child of a `Page` is a finding, reported on the `Tabs`. Whitespace text and JSX comments are not children. A `Tabs` lower in the body, or inside a body section, is region tabs and is not judged.

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
  <SurfaceCard ariaLabel={label} composition="joined" height="fill">{rail}{thread}</SurfaceCard>
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
