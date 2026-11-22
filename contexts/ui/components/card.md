# Card

Contract: [Card](../../grammars/contract.md#card). Vendor: [Card](../../vendor/heroui.md#card).

## Job
Present **one object** (a customer, an agent, a provider, a plan, a message, an approval) as one bounded thing with its own
face (COLLECTION-2). A dialog and an overlay are the other surfaces; a collection is never a card (COLLECTION-4).

## Choose

Choice `card.choose.role`: what presents the subject, which is the card's `kind` (a compiler-checked union of `body` and
`tile`). The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| collection | rows, a table, facts, figures, disclosures or a choice, wherever they stand | not a card: the collection stands flat in a `Section`, by the owner COLLECTION-4 names for it (`list-table.choose.role`) | lint `starci-grammar/card-is-object`, `starci-grammar/rows-in-card` |
| form | fields with a page around them | not a card: a `Section` and a `Form`, which caps its own width (MEASURE-4) | lint `starci-grammar/card-is-object` |
| sign-in | the one form with no page around it (sign-in, a sign-in callback) | `SurfaceCard measure="formCompact"`, centred | lint `starci-grammar/card-is-object` passes it |
| whole | the whole card is one destination or command | `wholeAction`, present only where the card holds no inner control (STATE-5) | type: a nested interactive does not compile |
| tile | one of several peers repeated in a grid, each a thing to recognise or open (a provider, a template, a product, a table of a floor plan) | `kind="tile"`: its name inside with its typed mark or media poster (or no mark: the name alone), operational badges and one visible action; further commands use its menu, in `Grid kind="cards"` (`size="tile"` for small peers: two a row on a phone); `groundTone` tints the whole tile by a status the badge also says; a product picture is full-bleed with `poster.bleed` (flush to the top and side edges, clipped by the card's corners) | type: poster image/absence, single/three badges and wholeAction/inner controls are exclusive; a tile has no `label`; R366 |
| object | one object whose face is free content (a message, an approval, a receipt, a plan) | `SurfaceCard` of the default `body` kind: label outside; its own facts a `DescriptionList` in the body; its commands the one `actions` band at its foot | judgement |

Choice `card.choose.label`: where the card's name sits. The kind decides, in both families.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| section | the card heads a section (`body`) | `label` as an unpainted row above the material, `fact` its one fact, `labelEnd` the action, `note` the muted line under the card | `DNA-COMMON-CARD-LABEL-ABOVE`, `DNA-CORE-CARD-LABEL-OUTSIDE`, `DNA-OFFSET-POP-CARD-LABEL-OUTSIDE`; R354 |
| tile | the card is one peer in a grid | `name` and `mark` inside, no label, fact, labelEnd or ariaLabel title | type; R366 |
| docked | the region is docked in a layout | not a card: a `Pane` | R345 to R349 |

An agent's card (a `label` that names an AI agent) takes `isAgent` on the head (`agentLabel` for the Chip's word, `AI` by default): the head draws the small neutral "AI" Chip right after the label (`AgentName`, owner 2026-11-22). The app never places the Chip by hand.

Choice `card.choose.emphasis`: whether a card stands out from its peers.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| accent | the one card a set of peers recommends or the reader has chosen (the popular plan, the chosen path) | `emphasis="accent"`: a 1px accent edge and the accent ring (`--grammar-ring-width`, the accent at 22%); the reason stays in words beside it (a badge) | judgement |
| plain | every other card | no emphasis | judgement |

A card carries its own title, fact, action and note: the title is its `label`, the fact its `fact`, the action its `labelEnd`
and the note its `note`. A `Section` whose only child is one card is a heading over one card and is refused (R354), as is a card
whose `ariaLabel` repeats the section's title; several cards under one `Section` stay legal.

## Actions
A `body` card's commands (approve and decline, reconnect, choose) stand in its one `actions` band at the foot, under a
`--separator` hairline across the card, at the row step on the block sides and the card's 16 inline. The band holds buttons and
links; a `Tabs`, `SearchField` or `Divider` in it throws in development (`useRefuseInCardActions`,
`packages/grammar/src/core/zoneContext.tsx`). A card has no other band: what it says is its body, a filter or a pager belongs to a
collection's `Section` (COLLECTION-4).

## Look
Every card, on every ground, is white at the card radius with a 1px `--border` edge and no shadow (BOUNDARY-6,
`DNA-CORE-EDGE-TOP`); a whole-action card fills `--surface-secondary` on hover and `--default` on press, with the 2px `--focus`
ring inside its edge. The card radius is HeroUI's Card radius (24 at `--radius` 0.5rem); a theme tightens it to its own scale with the
hook `--starci-core-card-radius`, which every card follows (owner: @starci/grammar `src/common/theme-hooks.json`). Captions and
titles stay outside the card. A card never stands inside another card: a development throw (`src/core/surfaceContext.tsx`) and
R340 (`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`) refuse it, and across files the render graph refuses it too (R356). A `Drawer`,
`Dialog` or `Popover` may host an object card with the same look, its own content flat in sections; a `Pane surface` is itself
the face and holds none (`pane-grid.choose.frame:cards`). What sits in a surface is a box at the nested inset (a notice, a
`Quote`), not a card.

A label has no description under it (CARD-NO-DESCRIPTION): a section's line is its `caption` and a card's line is its `note`, both under it (lint
`starci-grammar/no-label-description`). The words that explain the object's data (a legend, a source, a period) go in `note`, 12
muted under the card; a free-standing muted `Text` directly above a card is the same description drawn by hand and is refused (lint
`starci-grammar/no-card-lead-description`).


## Icons are outline (ICONS-OUTLINE)
Never a filled or solid icon (lint `starci-grammar/outline-icons-only` refuses a solid icon-set import anywhere). An icon that stands alone as the mark of a row, card, empty state or graph step gets an icon tile (a soft-tone square with an outline icon);
an icon inline with text (a status beside a label, a search field, a button start icon, a link arrow, meta) is a plain outline icon at text size with no tile. A status is a tone-coloured outline icon with no tile (check-circle success,
x-circle danger, a spinner for running): the Stepper and the disclosure step marks follow it.

## Size
A card's `label` is 14 / 600 (the final type scale, FONT-7). Measure: `check:type` (`packages/grammar/scripts/check-type-roles.mts`).

The card holds its content 16 in (`--grammar-inset-card`) and its label stands 8 above the surface (4 in a cards `Grid`)
([../presentation.md](../presentation.md#space) G6). `measure` is `content` (the default, the card fills its host), `narrow`
(30rem, start-aligned: an order card in a chat bubble) or `formCompact` (the centred measure of the one form with no page around
it, MEASURE-4).

## States
`isLoading` renders the same card from its own fields: a tile keeps its cells, the label stays real text (STATE-8, the
[loading table](../loading.md)). A failed card fails in place through its `error` slot (message, description, action).

## Owner split
- **Grammar owns:** face, corner, edge, inset, the `actions` band, the tile anatomy, the measures.
- **Knowledge decides:** an object or a collection, which kind, the emphasis.
- **App author decides:** the object, its content, the label.

## Rules
COLLECTION-2, COLLECTION-4, DISCIPLINE-1 (`budgets.hairlinesPerCard`), BOUNDARY-1..4, BOUNDARY-6, SURFACE-2. Lint:
`starci-fe/no-app-surface-paint`, `starci-grammar/no-raised-surface-in-surface` (R340),
`surface-card-kind` (R355), `card-is-object` (COLLECTION-2), `rows-in-card` (COLLECTION-4),
`no-label-in-grid` (R366), `starci-fe/no-heading-above-card` (R354), `starci-grammar/surface-in-surface` (a list of rows inside
the card body is a `Section kind="list"`, BOUNDARY-7), `starci-grammar/gap-proximity`. Proof: TASTE-7.

## Rows and labels

### Row titles are nouns (ROW-TITLES-NOUNS)
A row title names the thing (Telegram, Đơn DH-1001, Chế độ trả lời), never a sentence or a verb phrase; what the row says about it is its subtitle or its value.

### A row carries one control at its end (CHOICE-ROW-CONTROL)
A list row's `control` takes Grammar content: a primary `Tabs` pill ("Tự động | Hỏi", 2 to 4 options, the mode of a write
capability; lint `tabs-switch-zone`, [tabs](tabs.md) `tabs.choose.role:switch`), a `Switch`, a `Badge`, a `Checkbox`. Grammar
seats it at the row's end centred on the title line; the title and subtitle wrap before it (also at 390). The slot is its own hit
target: presses, clicks and keys inside never press the row, it is outside the row's accessible name (name the control itself,
e.g. the Tabs `label` = the row title), and a disabled row dims and blocks it. Never raw elements with handlers in `control` (held
by review: no lint rule reads a slot's content yet).

### A row that opens something is pressable whole, with a chevron (LIST-ROW-NAVIGATION)
A list row that opens something (a detail, a page, a drawer) is clickable as a WHOLE row (`href` or `onPress` on the row) and ends in a trailing chevron. An internal `href` row keeps its real anchor but its title is plain text colour with no ↗ (the ↗ is for `kind="external"` links only). There is no per-row small "Xem" or "Mở" button, and no navigation Link beside the row. Row actions that DO something (not navigation: Tạm dừng, Gỡ, Xoá) go in the row menu. `href` rows stretch their title Link over the whole row exactly as `onPress` rows do.

### One Label per section, Sublabels for the groups inside (LABEL-SUBLABEL-HIERARCHY)
A section has exactly ONE Label (its head, 14 / 500) and Grammar sets it 12px (`--grammar-row-gap`, gap-3) above its content, in `Section` and in `SurfaceCard label`. The groups nested inside a labelled section are named by a Sublabel (12 / 500 muted), set 8px (`--grammar-inline-gap`, gap-2) above the group: `Section sublabel="..."` or `SurfaceCard sublabel="..."`, which draw the Sublabel and the 8px gap themselves, so an app never composes a `Sublabel` and a group by hand. Sibling groups inside the same Label are ALSO 8px apart (gap-2), so they visibly belong to it; the larger step (24px) applies only BETWEEN top-level Label sections. Never a Label inside a labelled Section: `sublabel` and `title` / `label` are never given together (the types refuse it) and the lint rule `starci-grammar/no-nested-label` flags a labelled Section or SurfaceCard nested in a labelled one of the same file. Example: the Label "Agent hiểu gì về việc của bạn" holds two groups, the Sublabels "Được tự làm" and "Phải hỏi bạn", each over its `Section` of a `CheckboxGroup`. Story: `Surfaces/Label hierarchy`.

## A card that waits on the reader, and an agent's tile (0.55.0)

- `SurfaceCard tone` (`neutral`, `accent`, `info`, `success`, `warning`, `danger`): only the 1px edge takes the tone's standard border token
  `--<tone>-border` ("card chờ duyệt có viền vàng" is `tone="warning"`); the fill stays the surface, and the reason is said in words (a status,
  a needs-you line). Law `DNA-COMMON-CARD-TONE-BORDER`. A card in a chat bubble takes the same edge through `MessageBubble content="card" tone`
  (one rule, `toneEdge.ts`); never wrap a SurfaceCard in the bubble for it (the layout collapses and the edges double).
- `SurfaceCard kind="tile" isAgent agentLabel?`: the AgentName Chip follows the tile's name, as on a ListRow title and a card head.
