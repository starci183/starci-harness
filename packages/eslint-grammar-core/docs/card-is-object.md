# A card is one object

Law module: `card-is-object.ts`. Finding code: `FE_CARD_IS_OBJECT`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#CARD-OBJECT`.

A `SurfaceCard` is ONE object: a customer, an agent, a provider, a plan, a message, an approval, a dialog or an overlay. Its body holds the object's name, its facts and a control. A collection (a list, a table, facts, figures, disclosures, a choice), a form and a placeholder stand flat: in a `Section`, or on their own. The Grammar family 0.45.0 removed the card kinds `table`, `details`, `figures`, `accordion` and `select`; this rule refuses the same shapes written as the body of a card.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/card-is-object`

A Grammar `SurfaceCard` of the body kind (no `kind`, or `kind="body"`) whose ONLY content is one of the following, looked through fragments, `cond && x`, `cond ? x : y`, `.map`, and the layout wrappers `Stack`, `Cluster`, `Inline`, `Grid` and a plain `div` (message `collection`, which names the replacement):

| Only content | Stands instead |
|---|---|
| `DataTable` | `<Section title ...><DataTable .../></Section>` |
| `Section` of any kind | the `Section` alone, no card around it |
| `DescriptionList` | `<Section title ...><DescriptionList isDivided items={...} /></Section>` |
| `DisclosureList`, `Accordion` | `<Section title ...><DisclosureList items={...} /></Section>` |
| `Form`, `Fieldset`, `Input`, `Textarea`, `Select`, `ComboBox`, `SearchField`, `NumberField`, `RadioGroup`, `CheckboxGroup` | `<Section title ...><Form .../></Section>` |
| `EmptyNotice` | the `EmptyNotice` on its own |
| `Markdown`, `MarkdownArticle` | `<Section title ...><Markdown .../></Section>` |
| `BarChart`, `LineChart`, `Sparkline`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram` | `<Section title ...><BarChart .../></Section>` |

Not flagged: a card with `measure="formCompact"` (the sign-in form with no page around it), a `kind="tile"` card, a body card with more than one content (an object's name or facts beside a control is an object), a card with a JSX spread, a `kind` that is not a literal, a non-Grammar `SurfaceCard`, and non-product source. `Meter`, `Progress`, `Timeline` and `ListBox` are not in the table. There is no autofix: the card's `label` becomes the `Section` title, which the author reads.

**Invalid**

```tsx
<SurfaceCard label="Runs"><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Profile"><Form onSubmit={save}><Input label="Name" /></Form></SurfaceCard>
<SurfaceCard><EmptyNotice title="No runs" /></SurfaceCard>
```

**Valid**

```tsx
<Section title="Runs"><DataTable columns={columns} rows={runs} /></Section>
<SurfaceCard label="Agent"><DescriptionList items={facts} /><Button>Pause</Button></SurfaceCard>
<SurfaceCard measure="formCompact" label="Sign in"><Form onSubmit={signIn}><Input label="Email" /></Form></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
