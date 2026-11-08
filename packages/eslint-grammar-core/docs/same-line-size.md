# One line, one size

Law module: `same-line-size.ts`. Finding code: `FE_SAME_LINE_SIZE`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SAME-LINE-SIZE`.

Texts that stand side by side on one line share one size; the size is the size of the line's role. The final type scale has 14px for all UI text (`md`, and `sm`, which is kept as a name and equals `md`), 12px for small names (`xs`: meta lines, badges, counts, timestamps) and display sizes (`figure`). A line that mixes 14, 12 and display words reads as several lines glued together.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/same-line-size`

Among the direct `Text` children of one `Cluster` (and of a `Text` that holds `Text` runs, whose own size is the line size), seen through fragments, `cond && <Text />` and ternaries, the first `Text` sets the line's size (an absent `size` is `md`, and `sm` counts as `md`: both are 14) and every later `Text` of another size is a finding. A `Text` whose `size` is not a literal, or that has a spread attribute, is skipped. `Badge`, `StatusDot`, `Chip` and `TagGroup` are not `Text`, so they are exempt. Nested Clusters are separate lines.

**Invalid**

```tsx
<Cluster><Text>Deploy</Text><Text size="xs" tone="muted">2 min ago</Text></Cluster>
```

**Valid**

```tsx
<Cluster><Text>Deploy</Text><Text size="sm" tone="muted">2 min ago</Text></Cluster>
<Cluster><Text size="xs">Deploy</Text><Text size="xs" tone="muted">2 min ago</Text></Cluster>
<Cluster><Text>Deploy</Text><Badge>Live</Badge></Cluster>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
