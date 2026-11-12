# A card has no description

Law module: `no-card-lead-description.ts`. Finding code: `FE_NO_CARD_LEAD_DESCRIPTION`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#CARD-NO-DESCRIPTION`.

A card head is its label, a count chip, one fact and one end action. It has no description or subtitle (the `SurfaceCard` type has no such prop). A line that explains the card's data (a legend, a source, a period) is the card `note`; a line that explains a row is that row's subtitle.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-card-lead-description`

A Grammar `Text` with `tone="muted"` written immediately before a Grammar `SurfaceCard` in the same children list (message `lead`). A muted `Text` anywhere else, a native `<p>` and any other tone are not read.

**Invalid**

```tsx
<Stack><Heading level={3}>General</Heading><Text tone="muted">Choose how the agent works.</Text><SurfaceCard kind="select" label="Mode" ... /></Stack>
```

**Valid**

```tsx
<SurfaceCard kind="select" label="Mode" items={[{ id: "auto", title: "Automatic", subtitle: "The agent answers at once; you review later." }]} ... />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
