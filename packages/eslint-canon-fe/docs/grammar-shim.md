# Grammar shims (R321)

Law module: `grammar-shim.mjs`. HFS rule: R321. Knowledge: `contexts/code/fe/ui.md` FE-UI-1 (the app makes no visual choice; the Grammar owns every visual element) and the Grammar follow-up C-7 in `contexts/decisions/open-grammar.md`.

An app imports a Grammar component where it renders it. It never hands one on from an app path under its own name: such a shim makes one app green while the defect it works around (a missing `"use client"`, a wrong prop, a broken export) stays in the Grammar for every other app. The defect is reported to the Grammar instead; an op files `blocked` naming the package, the component and the error.

| Rule | Finding code | Required behavior |
| --- | --- | --- |
| `starci-fe/no-grammar-shim` | `FE_GRAMMAR_SHIM` | No `export { X } from "@starci/grammar..."`, no `export * from "@starci/grammar..."`, and no re-export of a binding imported from the Grammar (`export { X }`, `export const Y = X`, `export const Y = G.X`, `export default X`). Rendering an imported component, wrapping it in an app component and type-only re-exports are allowed. Source inside the `@starci/grammar` package itself is out of scope. |

Invalid:

```tsx
"use client"

export { SurfaceCard } from "@starci/grammar/common"
```

Valid:

```tsx
import { SurfaceCard } from "@starci/grammar/common"

export const Panel = ({ children }: PanelProps) => <SurfaceCard>{children}</SurfaceCard>
```
