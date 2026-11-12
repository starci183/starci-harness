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
| media-destination | the target is one image or brand raster leading to an address | `Link` with structured `media` from Image's data contract and a required accessible destination `label`; no JSX children | type: media and text forms are mutually exclusive |
| overflow | an item has more than three commands, or rarely used ones | the most frequent one visible, the rest behind `menu.choose.placement:overflow` | candidate: at most one visible command per collection item |
| text-action | the command reads as part of a sentence or a list of links | `TextAction` | judgement |
| icon | not the view's commit, the glyph is universally understood, and it sits in a toolbar, a row's actions or chrome | `IconButton` with an accessible `label` and its tooltip | candidate: every `IconButton` has a non-empty name and a tooltip |
| file | the command hands the product a file (an attachment in a composer, an upload in a toolbar or a row), as one action among others | `FileButton` with an accessible `label`, the size of an `IconButton`; a drop area is `FileDropzone` (`text-field.choose.role:file`) | judgement |
| suggest | the user is offered a few things to say or ask next (quick replies, suggested questions, empty-state shortcuts) | the ONLY pattern: a `Cluster gap="inline"` (with a `label`) of neutral `Button size="sm"` (with `width="wrap"` when a label may outgrow its container, `button.choose.width`), which every Button size draws as a pill; never `ChoiceChips`, `TagGroup`, `Badge`, a `Chip` or a row of `Link`s ([chip](chip.md) `chip.choose.role:suggest`) | lint `starci-grammar/suggestion-buttons` |
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

The view (a page, or the open modal) has one commit (CTA-1; the red budget, [composition.md](../composition.md) ACCENT-6: one accent CTA per view, every other call to action neutral, `alternative` or a `Link variant="plain"`, and an informative `Alert` is neutral; lint `single-commit-per-render` refuses a second `commit`, so a form never holds two): a second candidate falls to `neutral`, and peers of
equal consequence get no commit at all. "Secondary or ghost" is this table, never a look: an `alternative`
renders the secondary step and a `neutral` repeated per item renders quiet, by the contract's
[intent x placement map](../../grammars/contract.md#intent-x-placement---variant).

Choice `button.choose.width`: content, fill, fill-narrow or wrap.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| fill | the button is a form submit, the action of an auth panel, or the only action of a phone action bar (a single-column band at a narrow width, a pinned action bar) | `width="fill"` | candidate: a fill button's row holds no other control |
| fill-narrow | the button is a primary submit that hugs its label on a desktop form and fills the width on a phone (a booking card, a public form) | `width="fill-narrow"` (content width above 30rem, `fill` below) | judgement |
| wrap | the label is not the app's own short copy and may be longer than its container: a suggestion pill or quick reply carrying an agent's or a customer's sentence | `width="wrap"`: content width capped at the container; a short label is exactly `content`, a longer one wraps inside the pill (same radius and inline padding, text at the reading edge) and grows the box from its step (`DNA-COMMON-CONTROL-FILL`). Never `fill` to stop a long pill spilling: `fill` stretches the short ones too. Replies a `MessageCard` offers are not pills: they are `SurfaceCard kind="list" layout="suggestions"` ([message-bubble](message-bubble.md) `message-bubble.choose.suggestions`) | story `Navigation & Data/Message card fill (0.37.30)` `LongSuggestionsNarrow` |
| content | every other place, and always a page or pane command: it hugs its label and sits at the end of its header row (R352 refuses `width="fill"` in `Page` `header.actions` and in `labelEnd`) | omit `width` | judgement |

Choice `button.choose.glyph`: what a button's glyph says. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| leads | the press goes somewhere: a page, a tab, a next step (any intent; the arrow is not an icon under the primary-only rule) | `endArrow`: the grammar's arrow ends the label, slides toward the reading end on hover and focus and mirrors right to left. Never a typed arrow in the label, never an arrow icon through `endContent` | lint `starci-grammar/button-arrow` |
| does | the press does something (add, upload, send, download) AND the button is the primary (`intent="commit"`, the CTA) | `startGlyph` naming the action (`plus`, `upload`, `send`, ...) | type: `startGlyph` / `startContent` need `intent="commit"`; lint `starci-grammar/button-icon-primary-only` |
| text-only | the button is not the primary: neutral, alternative, dismiss, destructive, a suggestion pill, a row or tile action | no glyph: the label alone (only the primary button carries a leading icon). `IconButton` (icon only, named by its label) is unaffected | type and lint `starci-grammar/button-icon-primary-only` |
| both | the button would carry both an arrow and a glyph | neither pair is written: `endArrow` and `startGlyph` exclude each other; the start says what the action is, the end says where it goes, and one button says one | type: the pair does not compile; lint `starci-grammar/button-arrow` (message `both`) |
| plain | neither is true | no glyph | judgement |

The same words apply to an `EmptyNotice` action (`actionEndArrow`) and to a row or tile `ItemAction` (`endArrow`).

Choice `button.choose.link`: how a destination written inside text looks. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| row-title | the row or its chevron already opens the destination | no link: the row is the one pressable and its title is plain text (a second target on the same row is a second tab stop for the same place) | lint `starci-grammar/row-title-link` |
| inline | a destination inside a sentence or a description | `Link`, which inherits the size of the text around it (`size` defaults to `inherit`) and wears the exact primary colour | judgement |
| external | the destination leaves the product | `Link` with its external `href`: the grammar adds the trailing external glyph | judgement |

## Variants
None for the app: the grammar resolves the variant from `button.choose.intent` and the placement it reads from
context ([contract](../../grammars/contract.md#intent-x-placement---variant)).

## Size
Every size takes the same pill radius (`--grammar-radius-pill`), `sm` included: a small Button is a pill like `md`, never a 12px rounded box. Suggestions, quick replies and empty-state shortcuts have one pattern, a `Cluster gap="inline"` (with a `label`) of neutral `Button size="sm"` (the single Button radius stays); the lint `suggestion-buttons` refuses the alternatives (a Link row, a `ChoiceChips` that sends, a `Chip` that sends).

The step is `scale.choose.step` ([../scale.md](../scale.md#the-ramp)); size is never emphasis, and `width="fill"`
changes width only: the step stays the box's floor and a wrapped label alone grows it (`DNA-COMMON-CONTROL-FILL`); `width="wrap"`
holds the same floor.

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

## Icon and size
A `sm` Button never carries an icon, not even the primary (owner, 2026-11-09): a leading icon (`startGlyph`, `startContent`) is for the primary at `md` or `lg`.
The type refuses a start icon at `size="sm"`, and lint `starci-grammar/button-icon-primary-only` reads the literal cases. `Alert` and `EmptyNotice`
draw their primary action at `md` when it carries an icon and at `sm` as text.

## Rules
CTA-6..5, ACTION-1..3, ACCENT-6. Lint: `starci-grammar/button-arrow`, `starci-grammar/button-icon-primary-only`, `starci-grammar/suggestion-buttons`, `starci-grammar/row-title-link`,
`starci-fe/button-intent-required`,
`single-commit-per-render`, `no-commit-in-collection-item`, `destructive-confirm-in-dialog`, `control-height`.
Proof: TASTE-5, TASTE-11, UX-4, UX-10, A11Y-2.

## Icons inside Grammar are outline (0.37.4)
Every mark Grammar draws itself is stroked, never filled: the search icon, the Select chevron, the number steppers, the scroll arrows, the Alert status marks and the FlowGraph zoom controls use the closed glyph vocabulary (`glyphSource`, `inlineGlyph` for a vendor slot). The vendors' filled defaults are replaced; the three-dot `more` glyph stays dots.

## Icon measures (0.37.5)
A Button with a start icon or an end arrow uses HeroUI v3's measures: padding-inline 12 (sm) or 16 (md, lg) on both sides, gap 8, the icon 20px on a phone and 16px from 640px (16px on sm), a -2px inline margin on the icon. HeroUI has no 24px button icon. Enforcer: story `Controls/Button icon sizes`.

## App bar custom buttons (TOPBAR-CUSTOM-BUTTONS, 0.37.15)
`TopBar customButtons` (`{ id, glyph, label, badge?, onPress | href }`) are the app's own round outline icon buttons (a bell, a help) in the end cluster BEFORE the fixed cluster (language dropdown, light/dark switch, account avatar), whose order never changes. They are `IconButton intent="dismiss"` like the language button, `label` is the accessible name, `badge` draws the attention dot only when work is waiting. At phone width (under 48rem) only the first stays in the bar; the others are the entries `useTopBarOverflowEntries()` returns (glyph + label) for the account menu to append to its own entries. Never a hand-built button beside the bar's cluster. A `WorkspaceShell` takes the bar through its `header` slot, so the prop passes through with the `TopBar` the app composes. Story `Surfaces/Top bar custom buttons`.
