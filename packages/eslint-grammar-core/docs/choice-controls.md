# One way to choose among a few

Law module: `choice-controls.ts`. Catalogue: R380 FE_GROUPED_CHOICE_CONTROL.

The Grammar draws no group of attached buttons and no choice chips. A choice among a few has one component by meaning: `Tabs` switches a view or filters a list that stays in place (`kind="filter"`: underline tabs with a `count` each, in the list pane under its search field), `Tabs appearance="primary"` switches a mode or period of the same data, a dropdown `Select` chooses a value of a form or a toolbar (`RadioGroup` when each option needs a sentence, `ChoiceButtons` for options with a button's weight), separate `Button`s or a `DropdownMenu` carry actions, and a date is the `Calendar` with a time as a `Select` of the free times. `SegmentedControl` and `ChoiceChips` are removed (owner 2026-11-24: "xóa choicechips ra không xài, đủ hết cả rồi mà, trong form thì chọn dropdown"); the rules stop new uses.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## Which component switches what

- `Tabs` switches the views or periods of one block, or filters its list: the primary underline, `kind="filter"` in the `filter` row of the block's `Section`, one line under the strip.
- A dropdown `Select` chooses a value of a form or a toolbar, however few the options; `RadioGroup` when each option needs a sentence, `ChoiceButtons` for options with the weight of a button (as tall as a Button). Several values are a `CheckboxGroup` or a multi-selection list, never chips.
- A `Button` holds a command, never a selection state; a `ButtonGroup` holds commands only.
- A switch between modes or periods of one block ("This month / Last month", "Day / Week / Month", "List / Board") is `Tabs appearance="primary"` in the `action` of the block's `Section`.
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
<Section title="Cash" action={<Tabs appearance="primary" label="Period" items={periods} selectedKey={period} onSelect={setPeriod} />}><DataTable label="Cash" columns={columns} rows={rows} renderCell={renderCell} emptyContent={empty} /></Section>
```

## `starci-grammar/no-primary-tabs-misuse`

Finding code: `FE_GROUPED_CHOICE_CONTROL` (R380). `Tabs appearance="primary"` (HeroUI's primary variant, a pill in a track) in a `Section action` switch a mode or period of the same data among two to four short, fixed options. An `items` array literal with an item carrying `count`, `href` or `isAttention`, with one item, or with more than four items is a finding; views, filters with counts and destinations are the secondary (underline) `Tabs`. Grammar also refuses these at run time in development, and its types refuse them.

## `starci-grammar/no-grouped-choice-controls`

A JSX element named `ButtonGroup`, `FilterButtonGroup` or `SegmentedControl` (bare or as a member) in product source is a finding; the message names the replacement for that component.

## `starci-grammar/no-choice-chips`

Finding code: `FE_GROUPED_CHOICE_CONTROL` (R380). `ChoiceChips` is removed from the Grammar. An import that names `ChoiceChips`, `ChoiceChip` or `ChoiceChipsProps` (from any module, under any alias) and a `G.ChoiceChips` written through a namespace import are findings, in every file. The message names the replacement by meaning: secondary `Tabs` (`kind="views"` or `kind="filter"`, the count in the tab's `count`) to switch views or filter a list, `Tabs appearance="primary"` to switch a period or mode of the same data, a dropdown `Select` to choose one value in a form or a toolbar.

**Invalid**

```tsx
import { ChoiceChips } from "@starci/grammar/common"
export const A = () => <ChoiceChips label="Time" options={slots} empty={null} />
```

**Valid**

```tsx
import { Select } from "@starci/grammar/common"
export const A = () => <Select label="Time" options={slots} value={time} onValueChange={setTime} />
```
