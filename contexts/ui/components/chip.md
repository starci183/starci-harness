# Chip, Badge, StatusDot and TagGroup

Contract: [Chip](../../grammars/contract.md#chip). Vendor: [Chip, Badge, Tag](../../vendor/heroui.md#chip).

## Job
Two different jobs share the pill shape, and a status may shrink to its dot:

| Role | Job | Interactive |
| --- | --- | --- |
| `Badge` (display chip) | label an outcome authority settled, next to the thing it qualifies | no |
| `StatusDot` | state an entity's status as a dot, with its words beside it or alone with the words as its name | no |
| selectable `TagGroup` | choose peer filters or categories over a collection; enter structured tags | yes |

## Choose

Choice `chip.choose.role`: what carries the label or the pick. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| value | one value is chosen in a form | not a chip: `segmented-control.choose.role` | judgement |
| filter | peer values filter a collection that stays in place | selectable `TagGroup` | judgement |
| entered | values the user entered, to remove or order | `TagGroup` tags with their remove action, and `onReorder` when order matters | `DNA-COMMON-TAG-REMOVE`, `DNA-COMMON-TAG-REORDER-KEYS` |
| dot | a status with no room or need for words beside it (a row marker, presence, a live process) | `StatusDot` without text, named by `aria-label`; never a `Badge` without text | `DNA-COMMON-DOT-NAMED` |
| state | an entity's operational state that authority reports (active, failed, pending review) | `Badge` in that state's tone, or `StatusDot` with its text | candidate: toned labels per entity at most `budgets.badgesPerEntity` |
| category | a category or peer marker | plain `Text`, or a `neutral` or `muted` `Badge`; never a status tone | candidate: a status tone appears only on a fixture-declared reported state |
| fact | a plain fact (version, region, owner, count) | plain `Text`, never a badge | judgement |

Choice `chip.choose.dot`: how a `StatusDot` without text draws its state.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| echo | the state is live now (running, recording, online) | `echo` | judgement |
| static | any settled state | `static` | judgement |

## Variants
Tone and emphasis are two axes in the contract. Tone comes from the authority-reported state (ACCENT-5): neutral
by default, a status tone only for a real state, never accent for identity. A selectable tag reads as a secondary
control with a visible border; the selected one takes the selection treatment. A selected filter spends accent,
a view switch does not ([tabs](tabs.md)).

## Size
A badge is below the ramp, sized to the text line it annotates; a `StatusDot` with text takes the Chip step of
the line it sits in. A selectable tag is a control: `sm` in filter rows,
`md` beside `md` controls, and its target meets the floor ([../scale.md](../scale.md)).

## States
A badge has no hover or press. A badge with a status glyph uses the soft foreground (presentation "Tone"). A dot
alone shows its name in a tooltip on hover and focus; its echo stops under reduced motion.

## Owner split
- **Grammar owns:** tone x emphasis paint, the dot and its echo, sizes, selection treatment, remove action, reorder
  keys and announcement.
- **Knowledge decides:** badge vs status dot vs text vs tag; which state earns a tone; how many badges an entity
  carries.
- **App author decides:** the state (from authority), the words (a chip label starts uppercase, R322), the dot's
  accessible name, the filter items.

## Rules
ACCENT-2, ACCENT-5, DISCIPLINE-1 (`budgets.badgesPerEntity`), HIERARCHY-4, CTA-1. Proof: TASTE-5, TRUTH-1,
COLOR-5.
