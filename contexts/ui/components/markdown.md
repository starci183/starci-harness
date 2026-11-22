# Markdown: the core's markdown ext

`@starci/grammar/core/ext/markdown` is part of Grammar core, used ONLY for long authored documents (an article, a lesson, a report
written as markdown). A short plain-text note is core `Markdown` or `Text`; everything else is core ([situations](../situations.md)).
The ext imports the core; the core entry never imports the ext, so an app that draws no document installs none of its libraries
(`unified`, `remark-*`, `mdast-util-directive`, `shiki`, `beautiful-mermaid` are optional peers of `@starci/grammar`), and an app never
imports them itself. A mermaid figure the import-time renderer cannot draw is drawn in the browser by the Grammar's own Mermaid.

Markdown drawn with Grammar core. It parses with unified, remark-gfm and remark-directive, judges the text against a profile, draws
mermaid figures to SVG at import time, highlights code with Shiki on the server, and renders with Grammar core components and CSS.
Raw HTML is never drawn. The package holds no copy of its own: every word it shows comes from `labels`, which default to plain English.

## Minimal use

```tsx
import "@starci/grammar/core/styles.css"
import "@starci/grammar/core/ext/markdown.css"
import { Markdown } from "@starci/grammar/core/ext/markdown/react"

<Markdown source={"## Hello\n\nSome `code` and a list:\n\n- one\n- two"} labels={{ copy: t("copy"), copied: t("copied") }} />
```

On a server, highlight first and pass the tree:

```tsx
import { prepare } from "@starci/grammar/core/ext/markdown/server"
const { tree, issues } = await prepare(text, "prose")
return <Markdown tree={tree} />
```

An importer checks a text and prerenders its figures once:

```ts
import { isValid, validate } from "@starci/grammar/core/ext/markdown"
import { prerender } from "@starci/grammar/core/ext/markdown/prerender"

if (!isValid(validate(text, "stem"))) refuse()
const { diagrams } = await prerender(text) // store beside the text, pass as <Markdown diagrams>
```

## Entries

| entry | holds |
|---|---|
| `@starci/grammar/core/ext/markdown` | `parse(source, { legacyCaption? })`, `validate(markdown, profile, options?)`, `isValid`, `PROFILES`, `compareSegments`, `diagramKey`, the tree types |
| `@starci/grammar/core/ext/markdown/server` | `prepare(source, profile, options?)`, `highlight(tree)`, `highlightCode(code, lang)` (Shiki, css-variables theme) |
| `@starci/grammar/core/ext/markdown/prerender` | `prerender(source \| tree, { fallback? })`: beautiful-mermaid, then the Grammar's Mermaid (neo look) where a DOM exists; recoloured onto Grammar tokens and sanitized |
| `@starci/grammar/core/ext/markdown/react` | `<Markdown>`, `DEFAULT_LABELS`, the `MarkdownHandle` and `MarkdownHighlight` types |
| `@starci/grammar/core/ext/markdown.css` | only what Grammar has no part for: the Shiki-to-token map, the code line grid, the compare columns, the highlight marks, the figure |

## `<Markdown>` props

| prop | |
|---|---|
| `profile` | `prose` (default), `stem`, `option` or `report`: an allow-list; what it does not allow is not drawn |
| `source` / `tree` | the text, or a tree from `parse` / `prepare` (a tree wins) |
| `parseOptions` | `{ legacyCaption: RegExp }`: a paragraph under a captionless mermaid fence matching it becomes the caption |
| `diagrams` | prerendered figures by key; a missing one is drawn in the browser |
| `labels` | copy, copied, copyError, tabs, code, preview, tab, expected, received, table, diagram, diagramError, info, warn, danger, tip |
| `highlights` | `{ id, start, end, note?, tone? }[]` |
| `onHighlightPress(id)` | given, every mark is a button (click, Enter, Space) |
| `ref` | `{ scrollToHighlight(id): boolean }` |
| `isLoading`, `measure`, `ariaLabel`, `renderPreview(code, lang)` | |

## Highlights

`start` and `end` are character offsets into `source` (end exclusive), the offsets `parse` records on every text. Each range is drawn
as a `<mark>` in a Grammar soft pair: `tone` is `neutral`, `accent`, `info`, `success`, `warning` (the default) or `danger`. The split is
exact inside a run of text, an inline code it meets is marked whole, a line break stays inside the mark, and a range across blocks is
marked in each block. `note` is drawn as a caption line under the block where the range ends. Code blocks are not marked.

## What a text may hold

- Fences: ```` ```ts file= highlight= start= ````, ```` ```diff title= lang= ````, ```` ```terminal ````, ```` ```mermaid caption= ```` (caption required).
- `:::compare` with two fences flagged `expected` and `received`.
- Callouts `:::muted|info|warn|danger|tip` with `[title]` or `{title}`.
- Legacy containers: `::::::accordion` of `:::::panel{title}`, and `::::tab` of `:::code` / `:::preview`.

`validate` returns `{ code, severity, message, line?, column? }[]`, sorted by line; any `error` means refuse.

## Built on Grammar core

The package draws headings as `Heading`, paragraphs and list items as `Text` in the body role, and inline code as `Code`. Code blocks
are `FencedCodeBlock`, with Grammar's header, a language `Badge` and a `Button` for Copy; their lines use the code role. A terminal is
`Terminal`, a callout is `Alert`, an accordion is `Disclosure`, tabs are `Tabs`, a table is `MarkdownTableFrame`, a rule is `Divider`,
and links and images are `Link` and `Image`. The only markup of its own is the mermaid figure, inside a Grammar `Fragment`.
`@starci/grammar` is a peer (`~0.55.0`).
