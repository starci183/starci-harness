# Scale

One size model for every interactive component, so that a row of mixed controls reads as one object and two
apps built on the same grammar size the same thing the same way. This file decides **which step** and **why**;
the grammar contract ([../grammars/contract.md](../grammars/contract.md)) names the size tokens and each family
sets their values. The resolved numbers and the alternatives considered are recorded in
[../decisions/open-ui.md](../decisions/open-ui.md) (UI-5, UI-6).

## Why one ramp

A row is read as one object. When a button, a field, a switch and an avatar in one bar have different heights,
the eye reads misalignment, not hierarchy. The vendor sizes each family on its own (buttons step down on desktop,
fields sit a step below buttons, chips and glyphs have their own scales), which breaks every mixed row. So every
control in a grammar sits on **one control-height ramp**, and emphasis never comes from size: emphasis is the
intent's job ([composition.md](composition.md) CTA-6), rank is the type scale's job.

## The ramp

The step names `sm`, `md`, `lg`, `control` are the ones the contract's size sets use; this table is their meaning.

| Step | Role | Where it is used | Who picks it |
| --- | --- | --- | --- |
| `md` | the one control height | every standalone control: buttons, icon buttons, fields, selects, segmented controls, tab bars, switches, bar avatars, composer send | default; the app omits `size` |
| `sm` | the nested step, one increment below | a control nested in a collection item, or a dense toolbar whose every control is `sm` | the app, only in those two placements |
| `lg` | the hero step, one increment above | the one conversion call to action of a landing hero | the app, only there |
| `control` | the bar step: the `md` height, held for bar controls | every control in a navbar, top bar or site bar, so identity, search, switches and avatars align | the bar composition; the app passes nothing or `control` |

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
| SegmentedControl | `sm`, `md` | `md` | a control row; `sm` in a dense toolbar |
| Tabs | none: the bar is `md` | `md` | a tab bar aligns with the controls beside it; region tabs' pill track and page tabs' bar both land on `md` |
| selectable TagGroup (filter chips) | `sm`, `md` | `sm` | filter rows are dense; `md` when the row also holds `md` controls |
| Switch, Checkbox, Radio | the row (label included) is the target | `md` row | the glyph is small, the labelled row is what is pressed |
| ListBox and Menu rows | `sm`, `md`, `lg` leading slot | `md` | the step sizes the row's leading identity (glyph, avatar); the row height is that slot plus the vendor row inset, so the leading mark and the row stay aligned |
| Avatar | `sm`, `md`, `lg`, `control` | `md` | the identity ramp is the control ramp, so an avatar in a bar or a row matches the controls beside it |
| IconTile | `sm`, `md` | by its copy | a tile matches the line box of the copy it anchors: `sm` beside a one-line title, `md` beside a title with a description |
| Badge, display Chip | below the ramp | — | labels, not targets: sized to the text line they annotate, never pressed |
| Spinner, glyphs | the glyph scale | by host | a glyph follows its host control's step |

## What travels with a step

| Step | Glyph | Label rank | Corner | Gap to a neighbour |
| --- | --- | --- | --- | --- |
| `sm` | small glyph | supporting reading (FONT-2) | compact corner, or pill | inline gap (GAP-2) |
| `md` | standard glyph | supporting reading (FONT-2) | control corner, or pill | inline gap (GAP-2) inside a group, row gap (GAP-3) between peers |
| `lg` | standard glyph | ordinary reading (FONT-3) | pill | inline gap (GAP-2) |

- **Corner follows the box, not the step.** A box (field, select, tile) takes the control corner at `md` and
  the compact corner at `sm`, so the corner stays a similar share of the height. A short label-like control
  (button, chip, tag, segment) may be a pill: its corner is at least half its height at every step, so the
  shape is the same at every size. Corner roles: [presentation.md](presentation.md) "Radius".
- **Glyphs come from one icon scale**, small and standard for controls, large only for standalone marks
  (an empty state, an identity tile). Lint: `starci-grammar/no-off-scale-glyph-size`, `no-icon-size-class`.
- **Label rank** never changes the step: a long label wraps or the control fills its parent.

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
