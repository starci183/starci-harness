# Grammar surface composition

Law module: `surface-rules.mjs`. Canon: ANATOMY-2 and PADDING-0.

## `starci-fe/nested-control-variant`

Finding code: `FE_NESTED_VARIANT`. Grammar surfaces supply the secondary field default through their nesting context. An explicit primary field inside a surface subtree in the same component is refused. Named import aliases and namespace imports preserve Grammar ownership. A different component owns a separate static subtree; overlay triggers belong outside the overlay content.

App `className` values carry layout. A raw `bg-surface` utility paints a surface and is refused, including conditional classes, class builders, responsive variants, important modifiers and opacity suffixes. Static props spreads keep the same obligations. Typed app lint follows imported colocated class declarations as well as local constants.

Invalid:

```tsx
import { SurfaceCard, SearchField } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>
```

Valid:

```tsx
import { SurfaceCard, SearchField } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><SearchField /></SurfaceCard>
```

## `starci-fe/no-list-panel-padding`

Finding code: `FE_LIST_PANEL_PADDING`. A wrapper around Grammar `ListBox` or its section caption cannot add `px-*`, `ps-*` or `pe-*`. These insets add to the list's own padding. Grammar's panel inset aligns rows, section captions and the surface header to one content edge.

Invalid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><div className="px-2"><ListBox label="Members" items={members} /></div></SurfaceCard>
```

Valid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><ListBox inset="panel" label="Members" items={members} /></SurfaceCard>
```
