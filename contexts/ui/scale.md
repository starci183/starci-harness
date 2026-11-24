# Scale

One size model for every interactive component, so that a row of mixed controls reads as one object and two
apps built on the same grammar size the same thing the same way. This file decides **which step** and **why**;
the grammar contract ([../grammars/contract.md](../grammars/contract.md)) names the size tokens and each family
sets their values.

## Why one ramp

A row is read as one object. When a button, a field, a switch and an avatar in one bar have different heights,
the eye reads misalignment, not hierarchy. The vendor sizes each family on its own (buttons step down on desktop,
fields sit a step below buttons, chips and glyphs have their own scales), which breaks every mixed row. So every
control in a grammar sits on **one control-height ramp**, and emphasis never comes from size: emphasis is the
intent's job ([composition.md](composition.md) CTA-6), rank is the type scale's job.

## The ramp

The step names `sm`, `md`, `lg`, `control` are the ones the contract's size sets use.

Choice `scale.choose.step`: which step, and so which control height, a button or any other control takes. The
first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| bar | the control sits in a navbar, top bar or site bar | nothing: the bar composition sets `control`, the `md` height held so identity, search, switches and avatars align; an `sm` passed in a bar still draws at 40 (`DNA-COMMON-HEADER-CONTROLS-40`) | `DNA-COMMON-BAR-ONE-HEIGHT` |
| field-row | the row holds a field (fields have one step) | `md` | `DNA-COMMON-FIELD-MD` |
| hero | the one conversion call to action of a landing hero | `lg`, once per view | `DNA-COMMON-CONTROL-LG`; candidate: at most one `lg` control per view |
| nested | the control is nested in a collection item, or sits in a dense toolbar whose every control is `sm` | `sm` | `DNA-COMMON-CONTROL-SM`; candidate: every `sm` control sits in an item or an all-`sm` toolbar |
| standalone | every other control: buttons, icon buttons, selects, tab bars, switches, composer send | `md`: omit `size` | `DNA-COMMON-CONTROL-MD`; a full-width button `DNA-COMMON-CONTROL-FILL` |

Rules, each with one place to harden:

1. **One size per row.** Controls that share a row share a step. Lint: `starci-fe/control-height`.
2. **Default is `md`.** Omit `size`. A larger step is never a way to add emphasis.
3. **`sm` only by placement.** Inside an item (a list row, a table row, a card's item actions) or a dense toolbar
   where every control is `sm`. A row that contains a field is an `md` row, because fields have one step.
4. **`lg` only for the landing hero call to action**, once per view.
5. **A full-width control keeps its step.** Filling the parent changes width, not height; a wrapping label is the
   only thing that may grow it.

## Drawn height and target size are two facts

The drawn box is the ramp. The **target** (the hit area a pointer or finger can press) has its own floor:
`target.coarse` on a coarse pointer or a narrow viewport, `target.fine` on a fine pointer, both in
[proof/thresholds.yaml](proof/thresholds.yaml). The grammar meets the coarse floor by extending the hit area
(a minimum size on the pressable part, or an invisible extension), not by redrawing one control taller than its
row. Where the extension would overlap a neighbour (two `sm` controls at the inline gap), the row takes `md` on
coarse pointers. The floor applies to **every** interactive target, including chips, list options, segments,
calendar days and the stepper and clear glyphs of fields. Proof: A11Y-4, TASTE-11, UX-9.

## How each component sits on the ramp

| Component | Steps it publishes | Default | Reasoning |
| --- | --- | --- | --- |
| Button, IconButton | `sm`, `md`, `lg` | `md` | the action ladder; an icon button is the same box as a square or circle |
| Input, text field, search, number, date, time | `md` only | `md` | a field is read and typed into; a smaller field costs legibility, and mobile text must stay at the size that prevents focus zoom |
| Select, ComboBox trigger | `md` only | `md` | a field: same reason |
| Tabs | none: the bar is `md` | `md` | a tab bar aligns with the controls beside it; region tabs' pill track and page tabs' bar both land on `md`; every label is one size, 14, in every layer |
| Switch, Checkbox, Radio | the row (label included) is the target | `md` row | the glyph is small, the labelled row is what is pressed |
| ListBox and Menu rows | `sm`, `md`, `lg` leading slot | `md` | the step sizes the row's leading identity (glyph, avatar); the row height is that slot plus the vendor row inset, so the leading mark and the row stay aligned |
| Avatar, AvatarButton, AvatarGroup | `sm` 24, `md` 40 | `md` | two round-mark sizes, no 32: `md` 40 is the common size and the bar's control height, so an avatar in a bar matches the controls beside it; `sm` 24 is the icon size, inline beside text, in a cell or a chip |
| IconTile | `row` 40, `head` 48 | `row` | the row tile (40, radius 10, glyph 20) leads a list row; the head tile (48, radius 12, glyph 24) stands beside a page title or in an empty state; a status mark is the round 40 |
| Badge, display Chip, StatusDot | below the ramp; a Badge takes the Chip's `sm`, a StatusDot's hit area follows `sm`, `md`, `lg` | StatusDot `md` | labels, not targets: sized to the text line they annotate, never pressed |
| Spinner, glyphs | the glyph scale | by host | a glyph follows its host control's step |

## What travels with a step

| Step | Glyph | Label rank | Corner | Gap to a neighbour |
| --- | --- | --- | --- | --- |
| `sm` | small glyph | supporting reading (FONT-2, 14) | compact corner, or pill | inline gap (GAP-2) |
| `md` | standard glyph | supporting reading (FONT-2) | control corner, or pill | inline gap (GAP-2) inside a group, row gap (GAP-3) between peers |
| `lg` | standard glyph | ordinary reading (FONT-3) | pill | inline gap (GAP-2) |

- **Corner follows the box, not the step.** A box (field, select, tile) takes the control corner at `md` and
  the compact corner at `sm`, so the corner stays a similar share of the height. A short label-like control
  (button, chip, tag, segment) may be a pill: its corner is at least half its height at every step, so the
  shape is the same at every size. Corner roles: [presentation.md](presentation.md) "Radius".
- **Glyphs come from the icon table below**, by role, never by pixels. Lint: `starci-grammar/no-icon-size-class` (any size class on a
  glyph is refused, so no other size can be written).
- **Label rank** never changes the step: a long label wraps or the control fills its parent.

## The icon table

Owner: `@starci/grammar src/common/ramps.css` "THE ICON TABLE" (tokens `--grammar-icon-*`, `--grammar-tile-*`), Icon `usage`, IconTile `size`.
Three icon sizes, 16, 20 and 24, each drawn at its native size (no scaling, no odd size), plus the trailing caret:

| Where | Glyph | Stroke | Beside it | Icon `usage` |
| --- | --- | --- | --- | --- |
| Beside 14px text: a list row, a label, a menu entry, a search field, a chip, a sidebar navigation entry | 16 | 1.5 | gap 8 (`inline`), centred on the text line; the text is regular (400) | `control` |
| A labelled button, 32 or 40 | 16 | 1.75 (the label is 500) | the label, gap 8 | the Button draws it |
| An icon-only button | 16 in a 32, 20 in a 40 | 1.75 | none | the IconButton draws it |
| A row tile, leading a list row (a run, a document) | 20 in a 40 tile, radius 10 | 1.75 | the row | `row` (IconTile `size="row"`, the default) |
| A head tile: beside a page title, an empty state | 24 in a 48 tile, radius 12 | 1.75 | the title | `head` (IconTile `size="head"`) |
| A disclosure caret (Disclosure, Accordion, a list group fold): expands HERE | 1em of its label, at any size, in the label's colour (muted on a quiet disclosure) | the text's (the label is regular) | BEFORE the label; turns 90 degrees down when open with a short motion, one glyph never swapped; the whole row is the press target, the focus ring on keyboard only | the Disclosure draws it |
| A trailing caret or "go" arrow: goes ELSEWHERE | 1em of its text, at any size | the text's | AFTER the words; never turns | `text` |
| A status mark (InlineStatus, a status Badge): circle-check done, circle-x failed, the empty circle pending, the triangle a warning | 1em of its text, at any size (a 12px meta line, a table cell, a 14px row) | the text's (regular) | before the word, both in the state's tone | InlineStatus draws it |

- **No icon on a heading** (18 to 28): a heading takes the head tile beside it. **No icon on 12px meta or caption text**: words only
  ("16 hours ago", never a clock before it). The 1em family is exactly three: the leading disclosure caret, the leading status glyph and the trailing go caret or arrow. Position
  carries meaning: a caret before words expands in place, one after words goes elsewhere. Every other icon beside 14px words is 16.
- **Text that carries an icon is regular** (400): the owner's rule. Any rule styling text with a leading or trailing icon or status glyph sets no weight above 400; a status word is regular too. Exception: a **control** (a button, a text action, a tab, a chip) keeps its 500 label. Bold words inside a sentence stay allowed. Grammar's spec `icon-sizes` enforces it.
- **Every icon strokes 1.5, buttons included; the stroke never follows the text weight**. It is written once, on the glyph; there is no stroke variable and no per-control stroke.
- **Never filled**, not for a current, selected or active state: the state is shown by colour and background.
- **One set: Tabler outline.** Grammar draws its own glyphs from it (`src/core/leaf/Icon/tabler.tsx`); an app takes the rest from
  `@tabler/icons-react`.
- **Logos and people are Avatars**, sized by `size` only (`sm` 24, `md` 40): a row of channel logos is an `AvatarGroup` of `kind: "logo"`
  items, a lone logo an `Avatar kind="logo"` of the same `size` (a white surface in both themes, the logo fitted inside, a hairline edge).
- **Manual composition is allowed**: `<Text><Icon usage="control" source={…} /> 16 hours ago</Text>` in a 14px role is laid out as the pair
  (a flex row, centred, gap 8, the glyph 16, the text regular); no other role styles a leading icon.

The references the table follows: Primer (12, 16, 24; 16 the default), Atlassian (16 the core size at a 1.5 stroke; 12 only for carets and
status), Carbon (16, 20, 24, 32 at their native sizes, centre-aligned with the text). Not adopted: Fluent's and Material's filled glyph for a
selected state.

## The spacing roles

Owner: `@starci/grammar src/common/spacing.ts` (`COMMON_GAP_ROLES`, `COMMON_SPACING_TOKENS`) and the root of `src/common/styles.css`. The
scale is HeroUI's 4px spacing (`--spacing`) at the steps 0 4 8 12 16 24 32; an app names the ROLE (`Stack gap`, `Cluster gap`, `Grid`,
`PaneSection`, `Page`, the inset of a Grammar box), never a raw gap, margin or padding: R350 `FE_SPACING_UTILITY` (lint
`starci-fe/no-spacing-utility` for class strings), `starci-grammar/no-raw-spacing-style` for `style` objects.

| Role | px | Between |
| --- | --- | --- |
| `identity` | 4 | the parts of one reading cluster: a label and its value, a name and its meta line |
| `inline` | 8 | companions in one unit: an icon and its text, chips or buttons in a row |
| `row` | 12 | peers in a list or group: rows, the cards of one list, the fields of a form |
| inset (`--grammar-inset-card`) | 16 | a card's padding to its content; never a gap |
| `section` | 24 | blocks under one heading: the cards or blocks of a section |
| `region` | 32 | regions with their own heading: the sections of a page, a page head and its content |
| tab line (`--grammar-tab-line-gap`) | 16 | what stands under an underline tab row and that row's line |

The proximity law holds in every container: its children stand at least one step closer than it stands to its siblings
(`starci-grammar/gap-proximity`).

## Density

Density is the share of a surface doing work. It is reached by grouping, ordering and spacing, **never by
shrinking targets** below the floor or a control below its step.

| Surface class | Controls | Density band |
| --- | --- | --- |
| `console` | `md`; `sm` inside items and dense toolbars | `density.console` |
| `catalog` | `md`; `sm` filter chips | `density.catalog` |
| `form` | `md` only | `density.form` |
| `reader` | `md` | `density.reader` |
| `landing` | `md`; one `lg` hero call to action | `density.landing` |

A denser surface steps the **space** down (region to section gap, section to row gap), not the controls.
