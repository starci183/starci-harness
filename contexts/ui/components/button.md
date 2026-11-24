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
| icon | not the view's primary, the glyph is universally understood, and it sits in a toolbar, a row's actions or chrome | `IconButton` with an accessible `label` and its tooltip | candidate: every `IconButton` has a non-empty name and a tooltip |
| file | the command hands the product a file (an attachment in a composer, an upload in a toolbar or a row), as one action among others | `FileButton` with an accessible `label`, the size of an `IconButton`; a drop area is the `Dropzone` of `@starci/grammar/core/ext/dropzone` ([upload](upload.md)) | judgement |
| suggest | the user is offered a few things to say or ask next (quick replies, suggested questions, empty-state shortcuts) | the ONLY pattern: a `Cluster gap="inline"` (with a `label`) of border `Button size="sm"` (with `width="wrap"` when a label may outgrow its container, `button.choose.width`), which every Button size draws as a pill; never `TagGroup`, `Badge`, a `Chip` or a row of `Link`s ([chip](chip.md) `chip.choose.role:suggest`) |
| text | any other command or destination, and always the view's primary | `Button` with a visible text label | candidate: every accent-filled button has visible text |

Choice `button.choose.variant`: which of the THREE looks the action takes. A Button and an IconButton take one prop, `variant`: `primary`, `border` (the default) or `danger`. There is no intent, step,
ghost, tertiary, secondary, flat or soft-danger look. The first row that applies wins; the label word never decides ("Cancel offer" is
destructive, a "Cancel" that changes nothing is `border`).

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| danger | the press is destructive or irreversible: cancel an order, delete, disconnect, stop for good (the entry that opens the confirmation and the confirming press alike). It is always confirmed and never the filled primary | `variant="danger"` | judgement |
| primary | the ONE main forward action of its region (a page head, a card, a review sheet): the next step of its one decision. At most one per region, and none when the region has no clear main action | `variant="primary"` | `DNA-COMMON-ONE-PRIMARY-PER-REGION` (one per region), `DNA-COMMON-ONE-ACCENT-FILL`; lint `single-commit-per-render`, `no-commit-in-collection-item` |
| border | every secondary action: opening another view, cancel, close, back, a retry, a negative outcome of the decision ("Not won", "Decline"), the other option beside the primary, a command outside the decision, any per-item command, a section head action, a suggestion pill | `variant="border"` or no `variant` | judgement |

**The CTA rule**: primary is the one main forward action of a region, border is every secondary action (a negative
outcome included), danger is the destructive one, confirmed and never filled. A destination to another page is a `Link`; a command is a Button.
The gate is law `DNA-COMMON-ONE-PRIMARY-PER-REGION` ([contract.yaml](../../grammars/contract.yaml)): a region (a `SurfaceCard` or
`EntitySummaryCard`, a `Section` or `PaneSection`, a `Dialog`, `AlertDialog` or `Drawer`, the page head `PageHeader`) holds at most one filled
`primary` Button of its own; a nested region counts its own, `border` and `danger` never count. Its finding names the region; the fix is to keep
one primary and turn the others to `border` ("giữ 1 nút chính, nút còn lại đổi sang border").

The view (a page, or the open modal) has one primary (CTA-1; the red budget, [composition.md](../composition.md) ACCENT-6: one accent CTA per
view, every other call to action `border` or a `Link variant="plain"`; lint `single-commit-per-render` refuses a second `variant="primary"`, so a
form never holds two): a second candidate falls to `border`, and peers of equal consequence get no primary at all. A text link is a `Link`,
never a Button. Grammar maps the looks onto the vendor internally: primary is HeroUI `primary`, border is `outline`, danger is `danger`; the
look does not depend on where the Button sits.

Choice `button.choose.width`: content, fill, fill-narrow or wrap.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| fill | the button is a form submit, the action of an auth panel, or the only action of a phone action bar (a single-column band at a narrow width, a pinned action bar) | `width="fill"` | candidate: a fill button's row holds no other control |
| fill-narrow | the button is a primary submit that hugs its label on a desktop form and fills the width on a phone (a booking card, a public form) | `width="fill-narrow"` (content width above 30rem, `fill` below) | judgement |
| wrap | the label is not the app's own short copy and may be longer than its container: a suggestion pill or quick reply carrying an agent's or a customer's sentence | `width="wrap"`: content width capped at the container; a short label is exactly `content`, a longer one wraps inside the pill (same radius and inline padding, text at the reading edge) and grows the box from its step (`DNA-COMMON-CONTROL-FILL`). Never `fill` to stop a long pill spilling: `fill` stretches the short ones too. Replies a `MessageCard` offers are not pills: they are `Section kind="list" layout="suggestions"` ([message-bubble](message-bubble.md) `message-bubble.choose.suggestions`) | story `Navigation & Data/Message card fill (0.37.30)` `LongSuggestionsNarrow` |
| content | every other place, and always a page or pane command: it hugs its label and sits at the end of its header row (R352 refuses `width="fill"` in `Page` `header.actions` and in `labelEnd`) | omit `width` | judgement |

Choice `button.choose.glyph`: what a button's glyph says. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| leads | the press goes somewhere: a page, a tab, a next step (any look; the arrow is not an icon under the primary-only rule) | `endArrow`: the grammar's arrow ends the label, slides toward the reading end on hover and focus and mirrors right to left. Never a typed arrow in the label, never an arrow icon through `endContent` | lint `starci-grammar/button-arrow` |
| does | the press does something (add, upload, send, download) AND the button is the primary (`variant="primary"`, the CTA) | `startGlyph` naming the action (`plus`, `upload`, `send`, ...) | type: `startGlyph` / `startContent` need `variant="primary"` |
| text-only | the button is not the primary: `border`, `danger`, a suggestion pill, a row or tile action | no glyph: the label alone (only the primary button carries a leading icon). `IconButton` (icon only, named by its label) is unaffected | type |
| both | the button would carry both an arrow and a glyph | neither pair is written: `endArrow` and `startGlyph` exclude each other; the start says what the action is, the end says where it goes, and one button says one | type: the pair does not compile; lint `starci-grammar/button-arrow` (message `both`) |
| plain | neither is true | no glyph | judgement |

The same words apply to an `EmptyNotice` action (`actionEndArrow`) and to a row or tile `ItemAction` (`endArrow`).

**No typed arrows, anywhere**. No arrow character
(→ ← ↑ ↓ ↗ ⇒ ➜ ➔: the Unicode Arrows block U+2190-U+21FF, the dingbat arrows U+2794-U+27BF, the long arrows U+27F0-U+27FF, or ASCII `->`)
appears in any rendered text: a label, a title, a description, a row, a chip, a toast. A direction is the Grammar's: `Button endArrow`,
`Link`'s own arrow (`variant="head"`, the external icon of `kind="external"`) or the Grammar arrow or chevron icon, which slide on hover and
mirror in RTL. Lint `starci-grammar/no-typed-arrow` (`FE_NO_TYPED_ARROW`) refuses one in JSX text, a literal child and a text attribute;
`starci-grammar/button-arrow` keeps the Button's own law (a `›` or `»` in its label, an arrow icon as `endContent`, `endArrow` with a start mark).

Choice `button.choose.link`: how a destination written inside text looks. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| row-title | the row or its chevron already opens the destination | no link: the row is the one pressable and its title is plain text (a second target on the same row is a second tab stop for the same place) | lint `starci-grammar/row-title-link` |
| inline | a destination inside a sentence or a description | `Link`, which inherits the size of the text around it (`size` defaults to `inherit`) and wears the exact primary colour | judgement |
| external | the destination leaves the product | `Link` with its external `href`: the grammar adds the trailing external glyph | judgement |

## Variants
Three, from `button.choose.variant`: `primary` (solid), `border` (outline, the default) and `danger`. `tone` is not a fourth: it is the colour of a
`primary` (below). `IconButton` takes the same three; with neither `source` nor `glyph` it draws the close glyph.

## Size
Every size takes the same pill radius (`--grammar-radius-pill`), `sm` included: a small Button is a pill like `md`, never a 12px rounded box. Suggestions, quick replies and empty-state shortcuts have one pattern, a `Cluster gap="inline"` (with a `label`) of border `Button size="sm"` (the single Button radius stays); the alternatives (a Link row, a `Chip` that sends) are not suggestions.

The step is `scale.choose.step` ([../scale.md](../scale.md#the-ramp)); size is never emphasis, and `width="fill"`
changes width only: the step stays the box's floor and a wrapped label alone grows it (`DNA-COMMON-CONTROL-FILL`); `width="wrap"`
holds the same floor.

A Button label is one line (`white-space: nowrap`): a content-width button never breaks its label, `DNA-COMMON-BUTTON-ONE-LINE` judges it at 320, 360 and 390; only `width="fill"`, `"fill-narrow"` and `"wrap"`, whose width is their container's, may wrap. At 320, 360 and 390 every Button and IconButton that is not an explicit `sm` is at least 40px tall (`DNA-COMMON-CONTROLS-PHONE-40`); inside a `TopBar` an `sm` one draws at 40 as well. There is no height prop, so an app cannot shrink the step.

## States
Disabled, pending and skeleton per CTA-3: pending keeps the label and box and refuses a second press; never
replace pending with disabled. A disabled button states why in `disabledReason` (`DNA-COMMON-DISABLED-REASON`). A
disabled primary never stands in for an empty state (CTA-5). A disabled button is neutral whatever its variant:
a neutral fill (the foreground at 6% over the surface) and neutral words (40%) at full opacity, no hover or press change; a
`border` button keeps no fill. A disabled primary is never an accent wash and a disabled danger never a pale red; pending and
loading keep their look.

The reason reaches every input. It is one description element the button and its trigger point at, so a screen
reader hears it once. Where a pointer can hover it shows in the tooltip on hover and keyboard focus; where none can
(`(hover: none)` or `(pointer: coarse)`, a touch phone), the tooltip never opens, so the same words stand as a muted helper
line under the button (the field-description style, xs), and a row of buttons keeps its peers on one top edge. The input
decides, never a prop. The line is not drawn for a pointer, whatever the look: a disabled button has one
look (it is neutral whatever its variant), and a page whose reader must see why its primary waits before pointing at it says
so in its own content (the field's error or description, an `Alert`), not through the button. Story
`Controls/Button disabled reason on touch (0.43.1)`.

## Owner split
- **Grammar owns:** how the three looks draw (the vendor mapping), sizes and their values, the pill shape, pending anatomy,
  the destination/command split by `href`.
- **Knowledge decides:** the role, the variant and the width (the tables above), group order.
- **App author decides:** the label, the handler or `href`, the disabled reason, and which one action is the primary.

## Icon and size
A `sm` Button never carries an icon, not even the primary: a leading icon (`startGlyph`, `startContent`) is for the primary at `md` or `lg`.
The type refuses a start icon at `size="sm"`. `Alert` and `EmptyNotice`
draw their primary action at `md` when it carries an icon and at `sm` as text.

## Rules
CTA-6..5, ACTION-1..3, ACCENT-6. Lint: `starci-grammar/button-arrow`, `starci-grammar/no-typed-arrow`, `starci-grammar/row-title-link`,
`starci-fe/single-commit-per-render`, `no-commit-in-collection-item`, `control-height`. Codemod: `v0550` (the intents and vendor variants onto `variant`).
Proof: TASTE-5, TASTE-11, UX-4, UX-10, A11Y-2.

## Icons inside Grammar are outline
Every mark Grammar draws itself is stroked, never filled: the search icon, the Select chevron, the number steppers, the scroll arrows, and the Alert status marks use the closed glyph vocabulary (`glyphSource`, `inlineGlyph` for a vendor slot). The vendors' filled defaults are never drawn; the three-dot `more` glyph stays dots.

## Icon measures
A Button with a start icon or an end arrow uses HeroUI v3's padding: 12 (sm) or 16 (md, lg) on both sides, gap 8, a -2px inline margin on the icon. Its icon follows its height (the icon size table, `packages/grammar/src/common/ramps.css`): 20 in a 40 (md) or 48 (lg) button at every width, 16 in a 32 (sm) one; an IconButton the same (20 at md, 16 at sm). Enforcer: story `Controls/Button icon sizes`.

## App bar custom buttons (TOPBAR-CUSTOM-BUTTONS)
`TopBar customButtons` (`{ id, glyph, label, badge?, onPress | href }`) are the app's own round outline icon buttons (a bell, a help) in the end cluster BEFORE the fixed cluster (language dropdown, light/dark switch, account avatar), whose order never changes. They are border `IconButton`s like the language button, `label` is the accessible name, `badge` draws the attention dot only when work is waiting. At phone width (under 48rem) only the first stays in the bar; the others are the entries `useTopBarOverflowEntries()` returns (glyph + label) for the account menu to append to its own entries. Never a hand-built button beside the bar's cluster. A `WorkspaceShell` takes the bar through its `header` slot, so the prop passes through with the `TopBar` the app composes. Story `Surfaces/Top bar custom buttons`.

## A Button on a band, and the head link's hit area
`Button ground="accent" | "inverse"` is a Button on a band that is not the page's ground: an `accent` band (the brand colour, a site's call-to-action band) or an `inverse` one (the foreground as the ground). The looks keep their rank and take the band's contrast: `primary` is filled with the band's foreground and inked in the band's colour, `border` and `danger` are the band's foreground as an outline and its ink, transparent inside. An app writes no class for it (`DNA-COMMON-BUTTON-GROUND-CONTRAST`: at least 4.5:1).

`Button variant="primary" tone="accent" | "info" | "success" | "warning"` is the primary SOLID in the tone's own colour, `--<tone>` with
`--<tone>-foreground`, on the vendor's `primary` painted (HeroUI ships no success, warning or info variant); never an outline. `tone` is only the colour of a primary, never a fourth look: the types refuse it on `border` and `danger`, and a
destruction is `variant="danger"`. It keeps the primary's rules (the icon rule, the one-primary count). An `Alert`'s buttons do not use it: they take the
banner's tint, the `border` rank painted one step over the banner's soft fill in its ink at 500 ([toast-alert](toast-alert.md) "Buttons in a banner"). Not with `ground`.

Every Button label is the label.item weight, 500: Grammar states it on `.starci-core-button` rather than leaning on the vendor's `--font-weight-medium`.

A head link (`Link variant="head"`: a section head's "Xem tất cả", a Bento tile's "Tìm hiểu thêm") keeps its drawn line and gains an unseen 48 x 48 hit layer centred on it, so a standalone link meets the touch floor without a visual change (`DNA-COMMON-LINK-HEAD-HIT-44` at 320, 360 and 390). A link inside prose keeps its line. Stories `Surfaces/Figures, rows, bands and pages (0.48.0)` (ButtonOnBands) and `Navigation & Data/Phone fixes (0.48.0)` (LinkHitArea).
