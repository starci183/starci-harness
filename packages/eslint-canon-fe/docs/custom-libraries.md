# Custom-only libraries

Law module: `custom-libraries.ts`. The exemption itself is `lib/custom.ts` (`customContext`, `exemptCustom`, `exemptCustomRules`).

The Grammar draws motion with CSS transitions its tokens drive and ships no graph component, so a motion library or a graph toolkit is not part of an app's stack. An app that needs one writes it inside `<Custom reason="...">` (`@starci/grammar`), where any library may be used.

Every rule below is an error in `starciFeConfig`; none can be switched off or suppressed inline.

## `starci-fe/custom-only-library`

No import (static, re-export, dynamic `import()` or `require`) of `motion`, `motion/*`, `framer-motion`, `@xyflow/react`, `reactflow`, `@reactflow/*` or `react-flow-renderer` unless every use of the import is inside a `<Custom>` region. A same-file component that is not exported and that only a region renders counts as inside. A type-only import (`import type`) is free.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```ts
import { motion } from "framer-motion"
export const A = () => <motion.div animate={{ opacity: 1 }} />
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```ts
import { Custom } from "@starci/grammar/core"
import { motion } from "motion/react"
export const A = () => <Custom reason="entrance motion"><motion.div animate={{ opacity: 1 }} /></Custom>
```

## The Custom exemption

The canon laws that judge markup, look and libraries (`ui-rulings`, `brand-values`, `type-scale`, `button-intent`, `control-height`, `class-names`, `explicit-surface`, `grammar-shim`, `landmark`, `lists`, `loading`, `native-controls`, `drawing`, `surface-rules`, `tokens`, `spacing`, `renderer-purity`, `skeleton-states`, `fe-stack`, `custom-libraries`) report nothing inside a `<Custom>` subtree, nor on an import used only there. The repository's integrity laws (inline lint directives, comments, type safety, translation, transport, project graph, size budgets) are never exempted.
