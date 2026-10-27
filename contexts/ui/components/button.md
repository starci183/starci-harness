# Button and IconButton

Contract: [Button](../../grammars/contract.md#button). Vendor: [Button](../../vendor/heroui.md#button).

## Job
Carry one action: a command (changes state) or a destination (goes to an address, `href`). One button, one
effect (ACTION-1).

## Choose

Choice `button.choose.role`: which element carries the action. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| whole | the whole card is the target | the card's whole action (`card.choose.role:whole`), no button inside | judgement |
| value | the press picks among values, not an action | not a button: `tabs.choose.role` | judgement |
| overflow | an item has more than three commands, or rarely used ones | the most frequent one visible, the rest behind `menu.choose.placement:overflow` | candidate: at most one visible command per collection item |
| text-action | the command reads as part of a sentence or a list of links | `TextAction` | judgement |
| icon | not the view's commit, the glyph is universally understood, and it sits in a toolbar, a row's actions or chrome | `IconButton` with an accessible `label` and its tooltip | candidate: every `IconButton` has a non-empty name and a tooltip |
| text | any other command or destination, and always the view's commit | `Button` with a visible text label | candidate: every accent-filled button has visible text |

Choice `button.choose.intent`: which intent the spec's facts give (the facts are CTA-6). The first row that
applies wins; the label word never decides ("Cancel offer" is destructive, a "Cancel" that changes nothing is
`dismiss`).

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| destructive-confirm | consequence destructive, and this is the final irreversible press inside the `AlertDialog` | `destructive` with `step="confirm"` | lint `destructive-confirm-in-dialog` |
| destructive-entry | consequence destructive, and this press opens the confirmation or removes an unsubmitted row | `destructive` with `step="entry"` | candidate: a solid danger fill appears only inside an `alertdialog` |
| dismiss | consequence none: cancel, close, back, skip, not now | `dismiss` | judgement |
| alternative | the other real option of the view's decision, standing beside its commit (Reject beside Approve) | `alternative` | judgement |
| commit | the next step of the view's one decision (consequence neutral or negative; a reversible decline is negative, not destructive), and no other button of this view holds it | `commit` | `DNA-COMMON-ONE-ACCENT-FILL` |
| neutral | anything else: a command outside the decision, any per-item command, a second next step, an equal-consequence peer | `neutral` | lint `no-commit-in-collection-item`, `single-commit-per-render` |

The view (a page, or the open modal) has one commit (CTA-1): a second candidate falls to `neutral`, and peers of
equal consequence get no commit at all. "Secondary or ghost" is this table, never a look: an `alternative`
renders the secondary step and a `neutral` repeated per item renders quiet, by the contract's
[intent x placement map](../../grammars/contract.md#intent-x-placement---variant).

Choice `button.choose.width`: content or fill.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| fill | the button is the only action of a single-column action band at a narrow width (a phone form's submit, a pinned action bar) | `width="fill"` | candidate: a fill button's row holds no other control |
| content | every other place | omit `width` | judgement |

## Variants
None for the app: the grammar resolves the variant from `button.choose.intent` and the placement it reads from
context ([contract](../../grammars/contract.md#intent-x-placement---variant)).

## Size
The step is `scale.choose.step` ([../scale.md](../scale.md#the-ramp)); size is never emphasis, and `width="fill"`
changes width only.

## States
Disabled, pending and skeleton per CTA-3: pending keeps the label and box and refuses a second press; never
replace pending with disabled. A disabled button states why in `disabledReason` (`DNA-COMMON-DISABLED-REASON`). A
disabled commit never stands in for an empty state (CTA-5).

## Owner split
- **Grammar owns:** variants, the intent x placement map, sizes and their values, the pill shape, pending anatomy,
  the destination/command split by `href`.
- **Knowledge decides:** the role, the intent and the width (the tables above), group order, which step a
  placement takes.
- **App author decides:** the label, the handler or `href`, the disabled reason, the three facts in the spec.
  Nothing visual.

## Rules
CTA-6..5, ACTION-1..3, ACCENT-6. Lint: `starci-fe/button-intent-required`, `button-no-variant`,
`single-commit-per-render`, `no-commit-in-collection-item`, `destructive-confirm-in-dialog`, `control-height`.
Proof: TASTE-5, TASTE-11, UX-4, UX-10, A11Y-2.
