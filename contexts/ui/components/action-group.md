# Action group

Contract: [Button](../../grammars/contract.md#button). The Grammar has no group of attached buttons: `ButtonGroup` was
deleted in 0.55.0, so every group below is separate `Button`s or a `DropdownMenu`.

## Job
Place several actions together. A decision group (one decision, unequal ranks) and a set of peer commands (equals on one
object) look alike and must not be confused.

## Choose

Choice `action-group.choose.kind`: which kind of group the actions form. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| value | the actions choose one value | not a group of buttons: `ChoiceChips` or `RadioGroup` (`segmented-control.choose.role`) | judgement |
| item | per-item commands on a collection row | the row's actions slot: one visible `border`, the rest behind `menu.choose.placement:overflow` | candidate: at most one visible command per item |
| pinned | a page decision that must stay in thumb reach on a narrow screen | `PinnedActionBar`: the one primary, or a `summary` (a selection count, unsaved changes) with its `border` way out and its `primary` | judgement |
| decision | one decision with its way out and maybe an alternative, unequal in rank: a dialog, drawer, form or wizard footer, a page-header decision | separate `Button`s at the inline gap (GAP-2) at the footer's trailing edge, ordered way out, alternative, commit (CTA-5) | candidate: in a footer the commit is the last button and the gaps equal `--grammar-inline-gap` |
| approval | something waits on a person's yes: what it is, who asked, why | a `SurfaceCard` labelled with what, a `DescriptionList` of who and why, and a decision group: the `border` way out, a `border` alternative when one exists, and the `primary` named for the act ("Approve and send", never "OK") | candidate: the card holds one commit (CTA-1) |
| peers | 2 to 5 commands of the same look on one object, none outranking another (zoom in, out, fit; align left, centre, right), none destructive | separate `Button`s (or `IconButton`s) at the inline gap in a labelled `Cluster`, or a `DropdownMenu` for the overflow | lint `starci-grammar/no-grouped-choice-controls` (R380) |

A decision and its way out are never drawn as equals, and a destructive command never stands among peers: each keeps its
own button so its rank and consequence stay visible.

## Variants
Peer commands share one look (`border`). A decision group's members each carry their own: the way out and the alternative `border`, the decision `primary`.

## Size
A group takes one step for all members ([../scale.md](../scale.md) rule 1). Stacking at narrow width keeps DOM
order, so the commit lands last, nearest the thumb.

## States
Pending sits on the button that started the work; its peers keep their own state (CTA-3).

## Owner split
- **Grammar owns:** each button's look, the `Cluster` gap and wrap, footer alignment in dialogs.
- **Knowledge decides:** decision group vs peers, order, gap, one commit, no destructive among peers.
- **App author decides:** which actions exist and their facts.

## Rules
CTA-1, CTA-3, CTA-5, ACTION-1. Lint: `starci-fe/single-commit-per-render`, `starci-grammar/no-grouped-choice-controls`. Proof: UX-9
(destructive and commit separated by a target width), UX-10.
