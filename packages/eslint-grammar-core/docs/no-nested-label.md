# One Label per section

Law module: `no-nested-label.ts`. Finding code: `FE_NO_NESTED_LABEL`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#LABEL-SUBLABEL-HIERARCHY`.

A section has exactly ONE Label (its head, 14 / 500, 12px above its content). The groups inside it are named by a Sublabel (12 / 500 muted, 8px above the card): a `Section` or `SurfaceCard` takes `sublabel` and then has no `title` / `label` (the types refuse both together). Groups stand 24px apart.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-nested-label`

A Grammar `Section` with `title`, or a `SurfaceCard` with `label`, whose JSX ancestor in the same file is a Grammar `Section` with `title` or `SurfaceCard` with `label` (message `nested`). Nesting across files and elements passed as attribute values are not read.

**Invalid**

```tsx
<Section title="What the assistant knows">
  <SurfaceCard kind="select" label="Allowed" ... />
</Section>
```

**Valid**

```tsx
<Section title="What the assistant knows">
  <SurfaceCard kind="select" sublabel="Allowed" ... />
  <SurfaceCard kind="select" sublabel="Ask first" ... />
</Section>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
