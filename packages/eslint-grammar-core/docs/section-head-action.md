# A section head is one row with at most one thing at its end

Law module: `section-head-action.ts`. Finding code: `FE_SECTION_HEAD_ACTION`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SECTION-HEAD-ACTION`.

A `Section` head is ONE row: the label (14, weight 500) and an optional count chip at the start, and at the end at most ONE thing: a navigation `Link variant="head"` (the label then an arrow that slides about 3px on hover), an info `IconButton`, or a neutral small text `Button` (0.37.25). A `description` is not under the label: it is a caption below the body.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/section-head-action`

- A Grammar `Button` inside a `Section`'s `action` prop that is not exactly `intent="neutral" size="sm"` (message `button`), or that carries an icon prop (`startGlyph`, `startContent`, `endContent`, `icon`; message `icon`).
- More than one Grammar `Button`, `Link`, `IconButton` or `TextAction` inside that `action` (message `many`).

**Invalid**

```tsx
<Section title="Runs" action={<Button intent="commit" size="sm" onPress={open}>Open</Button>}>...</Section>
<Section title="Runs" action={<Button intent="neutral" size="sm" startGlyph="plus" onPress={open}>Add</Button>}>...</Section>
<Section title="Runs" action={<><Link href="/a">A</Link><IconButton label="About" glyph="more" /></>}>...</Section>
```

**Valid**

```tsx
<Section title="Runs" count={3} action={<Link variant="head" href="/runs">All runs</Link>}>...</Section>
<Section title="Runs" action={<IconButton label="About runs" glyph="more" />}>...</Section>
<Section title="Provider" count={2} action={<Button intent="neutral" size="sm" onPress={add}>Add provider</Button>}>...</Section>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
