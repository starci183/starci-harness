# Page heads are Page header

Law module: `page-header.ts`. Catalogue: R323 FE_PAGE_HEADER_HAND_ROLLED.

A page is headed by Grammar's `Page`, whose `header` is the band: the trail, the page heading with its mark, status and summary, the page's commands and the page tabs, on a surface band whose content shares the page content's edges and which ends in its own full-width separator. `PageHeader` and `Breadcrumbs` are Page's parts and are not exported; a head composed from them has no band, no top inset and no separator, and every page re-decides its spacing. The law reduces to imports.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-hand-rolled-page-header`

A `PageHeader` or `Breadcrumbs` imported from `@starci/grammar` (by name, through an alias, or as a member of a namespace import) is a finding, reported on the import or the member. The types of the header's slots (`PageHeaderBreadcrumbs`, `PageHeaderTabs`) stay public and are not judged; the same names from another module are not the Grammar's.

**Invalid** (`src/components/blocks/ConnectionPage/component.tsx`)

```tsx
import { PageHeader } from "@starci/grammar/core"

<PageHeader title="Main account" actions={<Button intent="neutral">Disconnect</Button>} />
```

**Valid** (`src/components/blocks/ConnectionPage/component.tsx`)

```tsx
<Page
  header={{
    breadcrumbs: { label: "Breadcrumb", items: trail },
    title: "Main account",
    actions: <Button intent="neutral">Disconnect</Button>,
  }}
>
  <WebhookCard />
</Page>
```

**Finding code:** `FE_PAGE_HEADER_HAND_ROLLED`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
