# Chip, Badge and TagGroup

Contract: [Chip](../../grammars/contract.md#chip). Vendor: [Chip, Badge, Tag](../../vendor/heroui.md#chip).

## Job
Two different jobs share the pill shape:

| Role | Job | Interactive |
| --- | --- | --- |
| `Badge` (display chip) | label an outcome authority settled, next to the thing it qualifies | no |
| selectable `TagGroup` | choose peer filters or categories over a collection; enter structured tags | yes |

## Choose

| Need | Use |
| --- | --- |
| an entity's operational state (active, failed, pending review) | `Badge` with the tone of that state |
| a plain fact (version, region, owner, count) | plain `Text`, never a badge |
| a category or peer marker | plain `Text` or a neutral badge; never a status hue |
| filter a collection by peer values | selectable `TagGroup` |
| choose one value in a form | [segmented-control](segmented-control.md) |
| remove a value the user entered | a tag with its remove action |

## Variants
Tone and emphasis are two axes in the contract. Tone comes from the authority-reported state (ACCENT-5): neutral
by default, a status tone only for a real state, never accent for identity. A selectable tag reads as a secondary
control with a visible border; the selected one takes the selection treatment. A selected filter spends accent,
a view switch does not ([tabs](tabs.md)).

## Size
A badge is below the ramp, sized to the text line it annotates. A selectable tag is a control: `sm` in filter rows,
`md` beside `md` controls, and its target meets the floor ([../scale.md](../scale.md)).

## States
A badge has no hover or press. A badge with a status glyph uses the soft foreground (presentation "Tone").

## Owner split
- **Grammar owns:** tone x emphasis paint, the status dot, sizes, selection treatment, remove action.
- **Knowledge decides:** badge vs text vs tag; which state earns a tone; how many badges an entity carries.
- **App author decides:** the state (from authority), the words, the filter items.

## Rules
ACCENT-2, ACCENT-5, DISCIPLINE-1 (`budgets.badgesPerEntity`), HIERARCHY-4, CTA-1. Proof: TASTE-5, TRUTH-1,
COLOR-5.
