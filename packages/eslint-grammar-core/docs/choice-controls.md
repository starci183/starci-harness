# One way to choose among a few

Law module: `choice-controls.ts`. Catalogue: R380 FE_GROUPED_CHOICE_CONTROL.

The Grammar draws no group of attached buttons. A choice among a few has one component by meaning: `Tabs` switches a view or filters a list that stays in place (`kind="filter"`: compact underline tabs with a `count` each, in the list pane under its search field), `ChoiceChips` or `RadioGroup` chooses a value of a form (a tablist is not a form field), separate `Button`s or a `DropdownMenu` carry actions, and a date is the `Calendar` with a time as `ChoiceChips`. `ButtonGroup`, `FilterButtonGroup` and `SegmentedControl` stay exported and deprecated for one release so existing screens build; the rule stops new uses.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## Which component switches what

- `Tabs` switches the views or periods of one block, or filters its list: the primary underline, `kind="filter"` in the block's `filter` (or `toolbar`) header zone of a `SurfaceCard`, one line under the strip.
- `ChoiceChips` or `RadioGroup` chooses a value of a form.
- A `Button` holds a command, never a selection state; a `ButtonGroup` holds commands only.
- A switch between modes or periods of one block ("This month / Last month", "Day / Week / Month", "List / Board") is `Tabs appearance="primary"` in the card's `switch` header zone.
- Two joined buttons or pills acting as tabs are banned. `SegmentedControl` is removed.

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
<SurfaceCard kind="list" label="Cash" headers={[{ kind: "filter", label: "Period", items, selectedKey: period, onSelect: setPeriod }]} items={rows} empty={empty} />
```

## `starci-grammar/no-primary-tabs-misuse`

Finding code: `FE_GROUPED_CHOICE_CONTROL` (R380). `Tabs appearance="primary"` (HeroUI's primary variant, a pill in a track) and a card's `{ kind: "switch" }` header zone switch a mode or period of the same data among two to four short, fixed options. An `items` array literal with an item carrying `count`, `href` or `isAttention`, with one item, or with more than four items is a finding; views, filters with counts and destinations are the secondary (underline) `Tabs`. Grammar also refuses these at run time in development, and its types refuse them.

## `starci-grammar/no-grouped-choice-controls`

A JSX element named `ButtonGroup`, `FilterButtonGroup` or `SegmentedControl` (bare or as a member) in product source is a finding; the message names the replacement for that component.
