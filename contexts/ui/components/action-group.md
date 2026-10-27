# Action group and ButtonGroup

Contract: [ButtonGroup](../../grammars/contract.md#buttongroup). Vendor:
[ButtonGroup](../../vendor/heroui.md#buttongroup).

## Job
Place several actions together. Two different things look alike here and must not be confused:

| Kind | What it is | Use |
| --- | --- | --- |
| decision group | one decision with its way out and maybe an alternative: unequal ranks | separate `Button`s at the inline gap (GAP-2), order way out, alternative, commit (CTA-5) |
| peer command group | 2 to 5 commands of the **same intent** on one object, none outranking another (zoom in/out/fit, align left/centre/right) | `ButtonGroup`, fused into one block |

## Choose

| Need | Use |
| --- | --- |
| dialog, drawer, form or wizard footer | decision group, trailing edge of the footer |
| a page decision in thumb reach on a narrow screen | `PinnedActionBar`: the one commit, or a `summary` (a selection count, unsaved changes) with its `dismiss` and `commit` |
| per-item commands on a row | the row's actions slot; one visible `neutral`, the rest in a [menu](menu.md) |
| toolbar of peer tools on one object | `ButtonGroup` |
| choosing one value | not a group of buttons: [segmented-control](segmented-control.md) |

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
