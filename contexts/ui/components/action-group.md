# Action group and ButtonGroup

Contract: [ButtonGroup](../../grammars/contract.md#buttongroup). Vendor:
[ButtonGroup](../../vendor/heroui.md#buttongroup).

## Job
Place several actions together. A decision group (one decision, unequal ranks) and a peer command group (equals
fused into one block) look alike and must not be confused.

## Choose

Choice `action-group.choose.kind`: which kind of group the actions form. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| value | the actions choose one value | not a group of buttons: `segmented-control.choose.role` | judgement |
| item | per-item commands on a collection row | the row's actions slot: one visible `neutral`, the rest behind `menu.choose.placement:overflow` | candidate: at most one visible command per item |
| pinned | a page decision that must stay in thumb reach on a narrow screen | `PinnedActionBar`: the one commit, or a `summary` (a selection count, unsaved changes) with its `dismiss` and `commit` | judgement |
| decision | one decision with its way out and maybe an alternative, unequal in rank: a dialog, drawer, form or wizard footer, a page-header decision | separate `Button`s at the inline gap (GAP-2) at the footer's trailing edge, ordered way out, alternative, commit (CTA-5) | candidate: in a footer the commit is the last button and the gaps equal `--grammar-inline-gap` |
| peers | 2 to 5 commands of the same intent on one object, none outranking another (zoom in, out, fit; align left, centre, right), none destructive | `ButtonGroup` | `DNA-COMMON-BUTTONGROUP-ONE-INTENT` |

A `ButtonGroup` fuses its members into one object, so it states "these are equals". Putting a decision and its way
out into it erases their difference in rank; putting a destructive command into it hides the consequence. Neither
ever joins one. Reordering a `ButtonGroup`'s members would surprise no one; if it would, it is a decision group.

## Variants
Members of a `ButtonGroup` share one intent and therefore one variant. A decision group's members each carry
their own intent.

## Size
A group takes one step for all members ([../scale.md](../scale.md) rule 1). Stacking at narrow width keeps DOM
order, so the commit lands last, nearest the thumb.

## States
Pending sits on the member that started the work; peers keep their own state (CTA-3).

## Owner split
- **Grammar owns:** the fused anatomy, separators, `width="fill"` distribution, footer alignment in dialogs.
- **Knowledge decides:** decision group vs peer group, order, gap, one commit, no destructive in a group.
- **App author decides:** which actions exist and their facts.

## Rules
CTA-1, CTA-5, ACTION-1. Lint: `starci-fe/single-commit-per-render`. Proof: UX-9 (destructive and commit
separated by a target width), UX-10.
