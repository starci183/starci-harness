# No raw scroll

Law module: `no-raw-scroll.ts`. Finding code: `FE_NO_RAW_SCROLL`. Knowledge: `runtime/knowledge/ui/presentation/grammar-laws.yaml#NO-RAW-SCROLL`.

NIVO never shows scrollbars (owner, 2026-11-09). Every scroll area is drawn by Grammar with HeroUI's ScrollShadow behaviour: a fading edge where content continues, the bar hidden, wheel, touch and keyboard scrolling kept. An app element that makes its own scroll area with an `overflow-y-auto` or `overflow-auto` class has no fading edge.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-raw-scroll`

The `className` (or `class`) of any element in product source is a finding when it holds `overflow-auto`, `overflow-scroll`, `overflow-x-auto`, `overflow-y-auto`, `overflow-x-scroll` or `overflow-y-scroll`, with or without a variant prefix. The fix is the Grammar scroller: `VerticalScrollRegion` or `HorizontalScrollRegion`, or `PaneSection` with `scroll` for a pane.

`overflow-hidden`, `overflow-clip` and `overflow-visible` are not judged.

**Invalid**

```tsx
<div className="flex-1 overflow-y-auto">{messages}</div>
```

**Valid**

```tsx
<PaneSection scroll={{ label: "Messages", role: "log" }}>{messages}</PaneSection>
<VerticalScrollRegion isScrollable aria-label="Files">{rows}</VerticalScrollRegion>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
