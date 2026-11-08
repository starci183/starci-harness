# Chip, Badge, StatusDot, TagGroup and SuggestionChips

Contract: [Chip](../../grammars/contract.md#chip). Vendor: [Chip, Badge, Tag](../../vendor/heroui.md#chip).

## Job
Three different jobs share the pill shape, and a status may shrink to its dot:

| Role | Job | Interactive |
| --- | --- | --- |
| `Badge` (display chip) | label an outcome authority settled, next to the thing it qualifies; `isDot` adds the status dot before its words, `isLive` makes it the state of a live feed in a polite live region | no |
| `StatusDot` | state an entity's status as a dot alone, with the words as its name | no |
| `TagGroup` | values the user entered, to remove or to order (it has no selection) | yes |
| `SuggestionChips` | things to say or ask in one press: quick replies, suggested questions, empty-state shortcuts; a press sends the chip (`onSelect(id)`) and picks no value | yes |

## Choose

Choice `chip.choose.role`: what carries the label or the pick. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| value | one value is chosen in a form | not a chip: `ChoiceChips` or `RadioGroup` (`segmented-control.choose.role`) | judgement |
| filter | peer values filter a collection that stays in place | `Tabs kind="filter"`: compact underline tabs under the list pane's search field, one selected, a `count` per tab when the app has it (R353 refuses a selection on `TagGroup`; `FilterButtonGroup` is deprecated, R380) | judgement |
| suggest | the user is offered a few things to say or ask next (quick replies in a chat, suggested questions in the assistant drawer, shortcuts in an empty state) | `SuggestionChips` with a `label` and `items`; not `ChoiceChips` (a form value that stays chosen), not `TagGroup` or `Badge` (labels), not a row of `Button`s | lint `starci-grammar/suggestion-chips` |
| entered | values the user entered, to remove or order | `TagGroup` tags with their remove action, and `onReorder` when order matters | `DNA-COMMON-TAG-REMOVE`, `DNA-COMMON-TAG-REORDER-KEYS` |
| dot | a status with no room or need for words beside it (a row marker, presence, a live process) | `StatusDot`, named by `aria-label`; never a `Badge` without text | `DNA-COMMON-DOT-NAMED` |
| state | an entity's operational state that authority reports (active, failed, pending review) | `Badge` in that state's tone, with `isDot` when the state has a dot | candidate: toned labels per entity at most `budgets.badgesPerEntity` |
| category | a category or peer marker | plain `Text`, or a `neutral` or `muted` `Badge`; never a status tone | candidate: a status tone appears only on a fixture-declared reported state |
| fact | a plain fact (version, region, owner, count) | plain `Text`, never a badge | judgement |

Choice `chip.choose.dot`: how a `StatusDot` draws its state.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| echo | the state is live now (running, recording, online) | `echo` | judgement |
| static | any settled state | `static` | judgement |

Choice `chip.choose.connection`: the state of a live feed. It is the feed's own, never a server fact the page invents.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| receiving | events arrive | `Badge isDot isLive tone="success"` | judgement |
| dropped, retrying | the link broke and a retry runs | `Badge isDot isLive tone="warning"`; hide figures that are no longer true (a time remaining) | judgement |
| down | no retry runs | `Badge isDot tone="danger"` (no `isLive`: nothing is arriving) with the action that restores it beside it | judgement |

## SuggestionChips
A pill (radius full), 28px high, label in `sm` 13, with an optional start glyph or icon (`glyph`, `iconSource`). The chips sit in one wrapping row. A suggestion is an action, not a value: a press calls `onSelect(id)` and nothing stays selected, so it differs from `ChoiceChips` (the value of a form) and from `TagGroup` and `Badge` (labels that do nothing on press). A row of neutral `sm` `Button`s whose press sends their own label is this component drawn by hand.

Accessibility: the group is a toolbar named by its `label` (always required, even when not shown), and each chip is a button, so a screen reader hears the group and then each suggestion; `isDisabled` disables the group or one chip, `isLoading` shows the chips as a skeleton while suggestions load.

## Variants
Tone and emphasis are two axes in the contract. Tone comes from the authority-reported state (ACCENT-5): neutral
by default, a status tone only for a real state, never accent for identity. A tag is a control with a visible border and
no selection. A selected filter spends accent, a view switch does not ([tabs](tabs.md)).

## Size
A badge is below the ramp, sized to the text line it annotates; a `Badge isDot` takes the Chip `sm` step. A tag is a control: `sm` in dense rows,
`md` beside `md` controls, and its target meets the floor ([../scale.md](../scale.md)).

## States
A badge has no hover or press. A badge, which carries its tone tint, takes the tone's soft foreground on it, and a status glyph with no tint behind it takes the tone itself (presentation "Tone"). A dot
alone shows its name in a tooltip on hover and focus; its echo stops under reduced motion.

## Owner split
- **Grammar owns:** tone x emphasis paint, the dot and its echo, sizes, selection treatment, remove action, reorder
  keys and announcement.
- **Knowledge decides:** badge vs status dot vs text vs tag; which state earns a tone; how many badges an entity
  carries.
- **App author decides:** the state (from authority), the words (a chip label starts uppercase, R322), the dot's
  accessible name, the filter items.

## Rules
SUGGESTION-CHIPS (`knowledge/ui/presentation/grammar-laws.yaml`), ACCENT-2, ACCENT-5, DISCIPLINE-1 (`budgets.badgesPerEntity`), HIERARCHY-4, CTA-1. Proof: TASTE-5, TRUTH-1,
COLOR-5.
