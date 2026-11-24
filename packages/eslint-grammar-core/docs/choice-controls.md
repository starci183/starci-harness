# One way to choose among a few

Law module: `choice-controls.ts`. Catalogue: R380 FE_GROUPED_CHOICE_CONTROL.

A choice among a few has one component by meaning (owned by `contexts/ui/components/select.md` for a form value and `tabs.md` for views). The rules below hold what is still writable: buttons dressed as tabs and misused primary tabs.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-button-view-switch`

Finding code: `FE_GROUPED_CHOICE_CONTROL` (R380). Two or more adjacent `Button` or `IconButton` elements, or one written in a `.map`, that carry `aria-pressed`, `isSelected` or `isActive` are a view switch drawn as buttons and are a finding; one toggle button on its own is a command with a state and is not. Use `Tabs`.

**Invalid** (`src/components/blocks/Cash/component.tsx`)

```tsx
<div>
  <Button aria-pressed={period === "this"} onPress={() => setPeriod("this")}>This month</Button>
  <Button aria-pressed={period === "last"} onPress={() => setPeriod("last")}>Last month</Button>
</div>
```

**Valid**

```tsx
<Section title="Cash" action={<Tabs appearance="primary" label="Period" items={periods} selectedKey={period} onSelect={setPeriod} />}><DataTable label="Cash" columns={columns} rows={rows} renderCell={renderCell} emptyContent={empty} /></Section>
```

## `starci-grammar/no-primary-tabs-misuse`

Finding code: `FE_GROUPED_CHOICE_CONTROL` (R380). `Tabs appearance="primary"` (HeroUI's primary variant, a pill in a track) in a `Section action` switch a mode or period of the same data among two to four short, fixed options. An `items` array literal with an item carrying `count`, `href` or `isAttention`, with one item, or with more than four items is a finding; views, filters with counts and destinations are the secondary (underline) `Tabs`. Grammar also refuses these at run time in development, and its types refuse them.
