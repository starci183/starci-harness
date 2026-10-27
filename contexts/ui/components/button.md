# Button and IconButton

Contract: [Button](../../grammars/contract.md#button). Vendor: [Button](../../vendor/heroui.md#button).

## Job
Carry one action: a command (changes state) or a destination (goes to an address, `href`). One button, one
effect (ACTION-1).

## Choose

| Need | Use |
| --- | --- |
| a command or destination that must be visible | `Button` with a text label |
| the same, where the glyph is universally understood and space is tight (toolbar, row actions, chrome) | `IconButton` with an accessible `label` and a tooltip |
| a command that reads as part of a sentence or a link list | `TextAction` |
| choosing among values | not a button: [tabs](tabs.md), [segmented-control](segmented-control.md), [chip](chip.md) |
| more than about three row commands, or rarely used ones | the frequent one visible, the rest in a [menu](menu.md) |
| the whole card is the target | the surface's whole-action contract ([card](card.md)), not a button inside |

The view's commit always has a visible text label; an icon-only commit does not exist.

## Variants
The app declares `intent` (and `step` for destructive) from the spec's facts; the grammar reads the placement from
context and resolves the variant ([../composition.md](../composition.md) CTA-6). The map lives in the contract. Why
the emphasis is spread this way:

- Emphasis tells the reader what happens next, so the strongest step is reserved for the one commit of the view
  (CTA-1). A second strong button halves what the first meant.
- Repetition lowers emphasis: a command repeated per item is `neutral` and renders quiet, so a list never shows a
  column of strong buttons.
- A way out is visibly weaker than the decision it leaves, but still a button.
- Destructive has its own colour axis: soft at entry, solid only at the final confirm (CTA-4).

## Size
`md` by default; `sm` inside an item or an all-`sm` toolbar; `lg` only for the landing hero call to action;
`control` in bars ([../scale.md](../scale.md)). Size is never emphasis. `width="fill"` changes width only.

## States
Disabled, pending and skeleton per CTA-3: pending keeps the label and box and refuses a second press; never
replace pending with disabled. A disabled button states why in `disabledReason`. A disabled commit never stands in for an empty state (CTA-5).

## Owner split
- **Grammar owns:** variants, the intent x placement map, sizes and their values, the pill shape, pending anatomy,
  the destination/command split by `href`.
- **Knowledge decides:** which intent the facts give, one commit per view, group order, which step a placement takes.
- **App author decides:** the label, the handler or `href`, the disabled reason, the three facts in the spec.
  Nothing visual.

## Rules
CTA-6..5, ACTION-1..3, ACCENT-6. Lint: `starci-fe/button-intent-required`, `button-no-variant`,
`single-commit-per-render`, `no-commit-in-collection-item`, `destructive-confirm-in-dialog`, `control-height`.
Proof: TASTE-5, TASTE-11, UX-4, UX-10, A11Y-2.
