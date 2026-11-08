# One line, one size

Law module: `same-line-size.ts`. Finding code: `FE_SAME_LINE_SIZE`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SAME-LINE-SIZE`.

Texts that stand side by side on one line share one size; the size is the size of the line's role (md for a primary line, sm for a secondary or meta line). A line that mixes 14px and 13px words reads as two lines glued together.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/same-line-size`

Among the direct `Text` children of one `Cluster` (and of a `Text` that holds `Text` runs, whose own size is the line size), seen through fragments, `cond && <Text />` and ternaries, the first `Text` sets the line's size (an absent `size` is `md`) and every later `Text` of another size is a finding. A `Text` whose `size` is not a literal, or that has a spread attribute, is skipped. `Badge`, `StatusDot`, `Chip` and `TagGroup` are not `Text`, so they are exempt. Nested Clusters are separate lines.

**Invalid**

```tsx
<Cluster><Text>Deploy</Text><Text size="sm" tone="muted">2 min ago</Text></Cluster>
```

**Valid**

```tsx
<Cluster><Text size="sm">Deploy</Text><Text size="sm" tone="muted">2 min ago</Text></Cluster>
<Cluster><Text>Deploy</Text><Badge>Live</Badge></Cluster>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
