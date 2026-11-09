# A tab count is a chip

Law module: `tab-count-chip.ts`. Finding code: `FE_TAB_COUNT_CHIP`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#TAB-COUNT-CHIP`.

A count on any tab (page layer 1 or 2, a filter tab) is a 12px chip the tab draws from `count`, never "\· N" text in the label. The chip is grey; it is pink only when the number is work waiting for the owner (`isAttention`). Page tabs hide the chip at 0; filter tabs keep a grey 0.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/tab-count-chip`

- An object with `id` and `label` (a tab item) in a file that imports `@starci/grammar`, whose string `label` ends in `\· <digits>`, or whose template label ends in `\· ${expression}` (message `label`).

**Invalid**

```tsx
{ id: "all", label: "All \· 5" }
```

**Valid**

```tsx
{ id: "all", label: "All", count: 5 }
{ id: "todo", label: "To approve", count: 3, isAttention: true }
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
