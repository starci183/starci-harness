# Page heads are PageHeader

Law module: `page-header.ts`. Catalogue: R323 FE_PAGE_HEADER_HAND_ROLLED.

A page is headed by Grammar's `PageHeader`: the trail, the page heading with its mark, status and summary, the page's commands and the page tabs, on a surface band whose content shares the page content's edges and which ends in its own full-width separator. A head composed by hand from `Breadcrumbs` and `SectionHeader` has no band, no top inset and no separator, and every page re-decides its spacing.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-hand-rolled-page-header`

Among the element children of one JSX element or fragment, a `Breadcrumbs` element followed by a `SectionHeader` element is a finding, reported on the `SectionHeader`. A trail and a heading in different parents, a heading before the trail, and either alone are not judged, so a region's `SectionHeader` under the page head stays legal.

**Invalid** (`src/components/blocks/ConnectionPage/component.tsx`)

```tsx
<div>
  <Breadcrumbs label="Breadcrumb" items={trail} />
  <SectionHeader title="Main account" level={1} action={<Button intent="neutral">Disconnect</Button>} />
</div>
```

**Valid** (`src/components/blocks/ConnectionPage/component.tsx`)

```tsx
<PageHeader
  breadcrumbs={{ label: "Breadcrumb", items: trail }}
  title="Main account"
  actions={<Button intent="neutral">Disconnect</Button>}
/>
```

**Finding code:** `FE_PAGE_HEADER_HAND_ROLLED`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
