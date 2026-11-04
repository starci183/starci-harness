# One way to choose among a few

Law module: `choice-controls.ts`. Catalogue: R380 FE_GROUPED_CHOICE_CONTROL.

The Grammar draws no group of attached buttons. A choice among a few has one component by meaning: `Tabs` switches a view or filters a list that stays in place (`kind="filter"`: compact underline tabs with a `count` each, in the list pane under its search field), `ChoiceChips` or `RadioGroup` chooses a value of a form (a tablist is not a form field), separate `Button`s or a `DropdownMenu` carry actions, and a date is the `Calendar` with a time as `ChoiceChips`. `ButtonGroup`, `FilterButtonGroup` and `SegmentedControl` stay exported and deprecated for one release so existing screens build; the rule stops new uses.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-grouped-choice-controls`

A JSX element named `ButtonGroup`, `FilterButtonGroup` or `SegmentedControl` (bare or as a member) in product source is a finding; the message names the replacement for that component.
