# Grammar surface composition

Law module: `surface-rules.mjs`. HFS rule: R318. Canon: ANATOMY-2 and PADDING-0.

## `starci-fe/nested-control-variant`

Finding code: `FE_NESTED_VARIANT`. Grammar context supplies field variants on the page background and inside painted surfaces. App code omits every static `variant` on layer-aware fields, including fields rendered by imported or helper components. Named import aliases, namespace imports, static constants and props spreads preserve Grammar ownership. Explicit primary `Tabs` inside a painted surface is also refused; its default follows the surface context.

Invalid:

```tsx
import { SearchField } from "@starci/grammar/core"
const Search = () => <SearchField variant="secondary" />
```

Valid:

```tsx
import { SurfaceCard, SearchField } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><SearchField /></SurfaceCard>
```

## `starci-fe/no-app-surface-paint`

Finding code: `FE_GRAMMAR_LAYOUT_ONLY`. App classes carry layout. A raw `bg-surface` utility paints a surface and is refused, including conditional classes, class builders, responsive variants, important modifiers and opacity suffixes. Compose a painted Grammar surface such as `SurfaceCard`. Static props spreads keep the same obligations. Typed app lint follows imported colocated class declarations as well as local constants.

## `starci-fe/no-list-panel-padding`

Finding code: `FE_LIST_PANEL_PADDING`. Within the nearest painted Grammar surface, a wrapper around `ListBox` or its section caption cannot add horizontal padding through `p-*`, `px-*`, `ps-*`, `pe-*`, `pl-*`, `pr-*` or arbitrary `padding-inline` properties. These insets add to the list's own padding. Page gutters outside that surface and lists outside any surface retain their layout padding. Unpainted containers such as `Rail` pass the parent context through.

Invalid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><div className="pl-2"><ListBox label="Members" items={members} /></div></SurfaceCard>
```

Valid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <div className="px-4"><SurfaceCard><ListBox inset="panel" label="Members" items={members} /></SurfaceCard></div>
```
