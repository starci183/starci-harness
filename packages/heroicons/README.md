# @starci/heroicons

Heroicons-compatible glyphs for stable shapes that the upstream catalogue does
not contain. The two public subpaths mirror Heroicons:

```tsx
import { MindMapIcon } from "@starci/heroicons/24/outline"
import { MindMapIcon as MindMapSolidIcon } from "@starci/heroicons/16/solid"
```

Shape cuts include `InsetHomeIcon`, `OpenBookLinesIcon`, `SplitPaneIcon`,
`CodeWindowIcon`, `CardStackIcon`, `MicNotesIcon`, `FoundationBlocksIcon`,
`SandboxIcon`, `MindMapIcon`, `PodiumIcon`, and `QuestionAnswerIcon`, plus `BrainIcon`
(a shared memory). The former names of the first ten (`CourseOverviewIcon` and the like) remain as deprecated
aliases for one minor.

Both subpaths export custom StarCi cuts only. Consumers import upstream icons directly from
`@heroicons/react`, which is used first; this package never re-exports them and never redraws one of them: its
package spec (run by `prepack`) refuses a custom cut named like any `@heroicons/react` icon. A glyph missing from both is
added here. Custom outline cuts use the native
`24 × 24`, `1.5` round-stroke grammar. Custom
micro cuts use the native `16 × 16` solid grammar. Every glyph inherits `currentColor`.

The package is a drawing vocabulary, not a product meaning map. Applications still expose semantic
names such as `mindMap` through their own closed icon leaf.
