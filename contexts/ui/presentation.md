# Presentation

Presentation resolves values on boundaries the **app** owns, after composition chose the tree and the
components. Inside a grammar component every value is the grammar's. This file holds the relations between
space, type, paint and room; the values themselves are tokens and roles named by the grammar contract
([../grammars/contract.md](../grammars/contract.md)) and set by each grammar.

| The app may | The app must not |
| --- | --- |
| name the relation between blocks it places, through a role prop (`Stack`/`Cluster` `gap`, `Grid` `kind`, `PaneSection`, `Page` `chrome`) | choose or rebuild a component, its layout or its anatomy |
| set the measure, column count and order of its own content through the props that carry them | write any spacing value: a padding, margin, gap or space utility, an arbitrary value, a `style` |
| choose `Text` / `Heading` rank and tone props from the information rank | reach into a component with a selector or a passed class |
| resolve wrapping and overflow of its own content | write a colour, a px length or an arbitrary value |

Lint: `starci-fe/no-spacing-utility`, `starci-fe/no-arbitrary-value`, `starci-fe/no-raw-brand-value`,
`starci-fe/no-app-surface-paint`, `starci-fe/no-grammar-internal-selector`, `starci-fe/class-names-in-colocated-file`.

## Space

Every distance on a screen is the grammar's. The grammar owns every value (padding, gap, margin) through tokens and
the anatomy of its components; the app only names the relation between two blocks it placed side by side, because only
the app knows whether they belong together, and the grammar resolves the name to its step. Lint:
`starci-fe/no-spacing-utility` in app class strings, `starci-grammar/spacing-scale` in the grammar's own stylesheets (its `npm test`), `starci/spacing-scale` in app stylesheets (R350).

### The scale

One closed scale, and no value outside it: **0 · 4 · 8 · 12 · 16 · 24 · 32** (px at 16px to the rem; owner:
`@starci/grammar src/common/spacing.ts`, the root tokens of `src/common/styles.css`). The 16 is the card's inset and
nothing else (`--grammar-inset-card`): it is never a gap, so no `GapRole` names it, and separation beyond the inset
belongs to the parent's gap, never to a larger inset. A measured 6 (a meter gap), 3 (a body offset), 20 or a fluid
`clamp()` is a second, private scale and is refused. A 1px or 2px line is a stroke, not a step.

| Step | Role as a gap (`GapRole`) | Token | Rule id |
| --- | --- | --- | --- |
| 0 | seam: a separator or joined faces already divide the two | none | GAP-0 |
| 4 | identity: two lines read as one cluster (title and qualifier, label and field and help, value and unit) | `--grammar-identity-gap` | GAP-1 |
| 8 | inline: companions inside one unit (glyph and label, chips of one set, a decision and its way out) | `--grammar-inline-gap` | GAP-2 |
| 12 | row: peers of one row or group, each read on its own (bands of a card, rows of a rail, the head, filter and body of one `Section`) | `--grammar-row-gap` | GAP-3 |
| 24 | section: independent blocks of one region, each with its own heading or edge (the groups of a rail, the sections of a `Grid kind="sections"`, a field stack in a form) | `--grammar-section-gap` | GAP-4 |
| 32 | region: page regions with their own heading (summary above history, main and rail, header and body) | `--grammar-region-gap` | GAP-5 |

GAP-6 (a named major transition) takes the region step: the scale holds nothing above it.

Choice `space.choose.gap`: the relation between two siblings picks the role; the first row of the table above that
applies wins, and the proximity law below caps it by the container. A flex that holds two relations is two Stacks, one
inside the other.

### Four inset levels

An inset steps down one level each time a box sits inside another, and an inner inset is never larger than its parent's.

| Level | Box | Inset (the token that owns it) |
| --- | --- | --- |
| 0 frame | the page gutter; the overlay as a floating page | gutter 12, 24 from the medium breakpoint (48rem), 32 from wide (70rem), stepped, never fluid (`--grammar-page-inset`), except on `Page chrome="panes"`, where the header takes 12 at every width so the gutter column starts at the pane content edge; a dialog or drawer 12 on every side (`--grammar-overlay-inset`) |
| 1 surface | a card (dense or holding a form or prose alike) and a zone of a card; a pane | a card and its zones 16 on every side (`--grammar-inset-card`, `--grammar-card-padding-*`; rows a card divides by lines keep the row step on the block sides and 16 inline); a pane 12 (`--grammar-inset`, `--grammar-pane-inset-*`) |
| 2 box in a surface | a notice in a card, a `Quote`, a list option, a table cell's block side, a stat cell, the bordered list of a `Section kind="list"` (BOUNDARY-7) (never a card: a surface does not stand in a surface) | 8 (`--grammar-inset-nested`) |
| 3 control | a button, field, tab, chip, badge | the control's height decides the block padding; inline sm 8, md 12, lg 24, one step less on a glyph's side (`--grammar-control-padding-*`) |

The named exceptions above a parent's level are the card's 16 (the one use of that step: a card stands in a page
gutter of 12 on a phone) and a low-density region, an empty state or a drop target, which takes 24 on every side
(`--grammar-inset-open`, PADDING-6).

### Laws

Padding (inline and block chosen apart):

- **P1 Side contact.** Each side of a box takes its inset from what it touches: an outer edge takes its level's inset;
  a side whose child already owns the edge takes 0. A pane's every side, divider-facing or outer, is the same 12. The
  grammar owns the flush-band API: a `Pane` publishes its inset and a `PaneSection` applies it, so a band in a pane
  carries no padding of its own. Lint: `starci-grammar/no-pane-section-padding`.
- **P2 Inline belongs to the container, block to the item.** Every box in one container starts at the same content
  edge (a search field, the first tab label, the selected row, a meter, a chip); the text inside a box keeps the box's
  own padding. Block padding is the density of each band. Lint: `starci-fe/no-list-panel-padding`.
- **P3 Nesting steps down.** 32/24/12 → 16 or 12 → 8: an inner inset is smaller than its parent's, or the inner box reads as a
  surface inside a surface. The card's 16 is the one intentional step between the shared edge and the content, and the
  card-inset step is used for nothing else.
- **P4 Closed boxes are symmetric.** A closed box has equal block sides, and its inline and block insets never differ
  by two steps; extra separation belongs to the parent's gap, never to one side of the box. Reading comfort comes from
  measure (MEASURE-4), not from a larger inset, so a card holding a form or prose keeps its 16.
- **P5 Controls are measured by height.** Block padding is derived from the size step (32 / 40 / 48), never chosen;
  inline padding follows the step, one step less on the side a leading or trailing glyph stands on.
- **P6 Optical anatomy stays inside components.** A large figure or heading keeps its own leading; a one-line row is
  8 + 24 + 8 = 40 at `md`, and a two-line row keeps 8 and grows by its content.
- **P7 The 44 target never comes from padding.** On a coarse pointer the grammar extends the hit area (UI-6).
- **P8 Responsive only at the gutter and the header's top.** Surfaces, panes and divider-facing sides keep one value
  at every breakpoint. The page container owns the page's inline inset; routed content owns only its block inset.

Gap (row and column chosen apart):

- **G1 Gap owns sibling distance**, never a margin or a child's padding (`DOUBLE_OWNER` otherwise).
- **G2 Rhythm is monotonic**: region > section > row > inline > identity > seam, and equal peers get equal gaps
  (`DNA-COMMON-RHYTHM-MONOTONIC`; proof TASTE-4).
- **G3 One relation per axis.** A wrapping chip or filter set takes inline on both axes (a wrapped line is the same
  set); a toolbar takes inline inside a group and section between groups; a card or tile grid takes inline on both axes and sits a row step under its heading; a
  two-column form takes the section step on both axes (the Field rule, FIELD-3); main and rail take region on both axes when they stack.
- **G4 Heading to content.** Title and its supporting line: identity. A section header and its content: row (G6). A page
  header and its body: region, or 0 when the body is a pane grid (`Page chrome="panes"`).
- **G5 Rows and messages.** Rows divided by lines: seam. A pill list: identity, so two hover fills never touch. Chat
  bubbles of one sender: identity; a sender change: row; a day divider: section.
- **G6 The proximity law.** Inside any container, its children stand at least one step closer than the container stands to
  its siblings: the gap roles rise strictly (identity 4, inline 8, row 12, section 24, region 32), so a nested layout takes a role
  below its parent's, and a reader never sees a group whose inside is as loose as its outside. The grammar's defaults already
  hold it: a `Section` spaces its head, filter and body by the row step (12, GAP-3) because the page body stands its
  sections a region step (32) apart; a `PaneSection` defaults to `gap="inline"` (8) because bands stand 12 apart (a band alone
  in its pane may take `row` or `section`); a `SurfaceCard` label stands 8 above its surface (4 in a cards `Grid`); `Grid`
  kinds `cards`, `week` and `week-summary` 8, `sections`, `pair`, `featured` 24, `main-rail` 32; a `Board` column's cards 8; the
  `Footer` 32 (main and legal), 24 (brand and directory), 12 (groups), 8 (links; the links are `Link variant="plain"`, foreground colour, never the accent: red budget). The author's `Stack`/`Cluster` `gap` follows
  the same ladder. Three exemptions: the region step is the ceiling (nothing above 32 exists to be compared); a box with its
  own edge (a card surface, a board column's ground, an overlay) groups by that edge, so the comparison starts again inside it;
  and a field stack (`Stack gap="section"` of controls, 24) directly in a `Form` or `Fieldset` is the Field rule's rhythm
  ([field](components/field.md) FIELD-3), not a layout gap. Measure: lint `starci-grammar/gap-proximity` (the literal
  roles of nested Grammar layout elements in a file), and the DOM audit `node packages/grammar/scripts/audit-gap.mts <url>...
  [--storage-state file] [--json out]` (every container in a rendered page whose gap is not below its spacing ancestor's;
  it is not yet a step of `app check`).

Padding and gap together:

- **R1 A closed box's content sits 12 apart inside its inset**, and the blocks under a heading stand a row step apart (G6:
  children closer than the container's siblings); a card or tile grid is closer still, its siblings 8 apart under a heading
  12 above.
- **R2 Touching panes take 0 and a divider; floating cards take the grid step of their kind.** The two never mix.
- **R3 A divider is full-bleed**; padding sits on the bands beside it, never on an ancestor of the divider. Lint:
  `starci-fe/divider-full-bleed`.

Margin:

- **M1 No margin in layout.** Only the grammar writes one, in three named cases: `MARGIN-AUTO` centring a capped
  container (a form card, a reading measure, the page body and the workspace main pane: MEASURE-8), an absolutely placed marker (a badge on an avatar), and a vendor part's
  internal offset kept for parity.
- **M2 Bleed is an API, never a negative margin**: `PaneSection bleed="inline"` (a horizontal chip row reaching both
  pane edges, the inset becoming its scroll padding), `SurfaceCard` `headers` and `footers` (zones to the card edge), the
  artwork band of a painted card (its first face, edge to edge and clipped by the card's radius, never inset).

### Text edge

The page title, the tab labels and the section headings share one text edge with the card or pane box below them:
every underline tab bar, page, region or filter, has its first label on the content edge; only a mode or period switch
is a pill (`Tabs appearance="primary"`, [tabs](components/tabs.md) `tabs.choose.role:switch`). The card's inner inset at 16 is the one intentional step.

### The table (the grammar's decision per component)

Choice `space.choose.component`: who decides the distance of a situation, and what the author writes. Values in px at the `core`
family; each is a token or the anatomy of the component that names it. The last column is everything the author writes for
the spacing of that row: a role prop or nothing, never a gap, margin, padding or px.

| Situation | Gap | Padding | Margin | The author writes |
| --- | --- | --- | --- | --- |
| Page body | main and rail region; header to body region (0 under `chrome="panes"`) | gutter 12 / 24 / 32 | none | `Page` `chrome`, `Grid kind="main-rail"` |
| Page header | title to description identity, copy to tabs row | gutter, 12 under `chrome="panes"`; top section, bottom 0 over tabs | none | `header` data |
| Page tabs (underline) | labels 24 apart; a second row (`header.subTabs`) on its own separator | first label 0, 12 per side | none | `header.tabs`, `header.subTabs` |
| Sidebar item and rail | items identity, groups section | item 12 by derived 40; collapsed rail 12 | none | `groups` data |
| `Section` | head, filter and content one row step (12) apart (G6); title to count identity; the action slot's text at `md` | none: the section adds none | none | `title`, `kind` |
| `SurfaceCard`, any kind | zones row; label 8 above the surface (4 in a cards `Grid`); label to fact inline; label to head `description` identity; title to meta identity; seams between zones 0 | 16 on every side; a zone of a card the same, so a seam runs full-bleed | none | `kind`, `label`, `description`, `fact`, `footer` |
| `kind="list"` rows | rows divided by lines (n-1, seam 0) or by gap, never both | row 8 block, the content inset inline (a 40 row for one line) | none | `items` |
| `kind="figures"` | cells touching (0) with a line between cells and rows; label to figure to meta identity | cell 8 | none | `items` |
| `kind="tile"` | mark to name inline; status and action at the bottom row | 12 | none | `name`, `mark`, `badge`, `action` |
| Card or tile grid (`Grid kind="cards"`), `week`, `week-summary` | inline (8) on both axes; the title to the grid row (12), because siblings sit closer than their heading | none | none | `kind` |
| `Grid kind="sections"`, `pair`, `featured` | section (24) on both axes | none | none | `kind` |
| Pane (`PaneGrid`) | 0 and a divider; the bands of a `PaneSection` inline (8) by default, 12 apart as bands (`gap` `row` or `section` only for a band alone in its pane) | 12 on every side | none | `areas`, `columns`, `rows` |
| Dialog, Drawer | header, body and footer row; footer actions inline; a field stack in the body section (24, the Field rule) | 12 | none | `title`, `body`, `footer` |
| `Footer` | main and legal region (32), brand and directory section (24), groups row (12), links inline (8) | none | none | `Footer` data |
| `Board` | a column's cards inline (8) | the column's ground | none | `columns` |
| Box in a surface (a notice, a `Quote`, a stat cell) | identity | 8 | none | the component |
| `ListBox` option | avatar to text row; title to description identity | 8 (h 40) | none | `items` |
| Table | seam | cells 12 inline, 8 block (h 40) | none | `columns`, `rows` |
| `Alert`, `Toast` | glyph to text inline; identity | 12 (8 in a surface); the toast's close side 8 | none | `title`, `description`, `action` |
| `EmptyNotice`, `FileDropzone` | line to action row | 24 on every side | none | `title`, `action` |
| `MessageBubble` | avatar to bubble inline; one sender identity, a sender change row, a day divider section (G5) | 12 inline, 8 block | none | the thread's order |
| `Meter` | label to value inline; header to bar identity | 0 | none | `value` |
| `Button` sm / md / lg | glyph to label inline | 8 / 12 / 24, glyph side 4 / 8 / 12 (h 32 / 40 / 48) | none | `size` at most |
| Field (every control) | label to control inline (8); control to help, error or counter identity (4); field to field section (24), set by the `Form` or field stack, never by a field; `Fieldset` legend to fields 8, fields to actions 24 | 12 (h 40) | none | `label`, `description` ([field](components/field.md)) |
| `Chip`, `Tag` | inline in a set; inline when it wraps | vendor 8, derived block | none | the set |
| `Badge` | dot to text identity | vendor 8, block 0 | none | `children` |
| A wrapping set | one role on both axes (G3) | none | none | `Cluster gap` |
| A stack of blocks | one role between neighbours | none | none | `Stack gap` |

A margin appears nowhere in the author's column: M1 names the three cases the grammar writes one itself.

### Padding ids

The `PADDING-*` ids name the clearance a boundary needs, not a step: PADDING-0 none (a child or the content owns the
edge: grouping containers, flush bands, lists in panels); PADDING-1 minimal (a marker over a canvas, the focus
clearance of a scroll region); PADDING-2 compact (an auxiliary strip); PADDING-3 the container inset (a card, a pane,
an overlay, a side facing a separator); PADDING-4 readable content, which takes the same container inset (reading
comfort is measure); PADDING-5 a page-level tab frame; PADDING-6 a low-density region (the open step); PADDING-7..9
responsive, indent and routed block inset (P8, and subordinate content indents at the inline start only, so the
reading measure stays). `MARGIN-0..6` are the same steps used as a named placement exception (M1).

### Who writes what

| Owner | Writes |
| --- | --- |
| grammar | every number: the role tokens, the insets of every component, the divider-facing sides, the bleed API, the row and bubble rhythm, and the `data-contract` stamps (`PADDING-*`, `GAP-*`) on each part |
| app | structure and relation names: `<Stack gap="region \| section \| row \| inline \| identity">`, `<Cluster gap>` (a wrapping set, one role on both axes), `<Grid kind="cards \| form \| main-rail">`, `PaneGrid`/`PaneSection`, `Page chrome`; measure and columns through props; no spacing class |
| lint | `starci-fe/no-spacing-utility` (app class strings, R350), `starci-grammar/spacing-scale` (grammar stylesheets, the package's `npm test`), `starci/spacing-scale` (app stylesheets, R350), `no-pane-section-padding`, `no-list-panel-padding`, `divider-full-bleed`, `starci-grammar/gap-proximity` (G6), `starci-grammar/surface-in-surface` (BOUNDARY-7), `starci-grammar/field-label` (FIELD-1), `starci-grammar/same-line-size` (FONT-8), `starci-grammar/table-cell-type` (FONT-9); proof TASTE-4 measures the rhythm on the live page, and `packages/grammar/scripts/audit-gap.mts` measures G6 in the DOM |

An app moves onto role props with `starci app codemod spacing-roles` (dry run by default, a report of every rewrite
and of every utility left for a person).

## Type

The app chooses an **information rank**; the grammar realises it. Ranks (contract: text sizes, heading levels,
weights):

| Id | Rank | Carrier |
| --- | --- | --- |
| FONT-1 | lowest supporting: small names (meta, badges, chips, counts, timestamps) | `Text size="xs"` 12 (always muted) |
| FONT-2 | supporting reading: a full supporting line | `Text size="sm"` 14 muted (`sm` is kept as a name and equals `md`; there is no 13) |
| FONT-3 | ordinary reading | `Text` default `md` 14 |
| FONT-4 | page heading: one per document | `Heading` level 1, xl 18 (a display size) |
| FONT-5 | leading value: the principal figure of a region | the value of a `kind="figures"` item, `Text size="figure"` 20 (a display size; was 30) |
| FONT-6 | display: a landing introduction | `Heading scale="display"`, outline unchanged (an opt-in display size, as before) |

- **FONT-7 The final type scale (owner, 2026-11-09).** One role, one size, one weight everywhere it appears. It overrides every
  earlier size for these roles. Measure: `check:type` (`packages/grammar/scripts/check-type-roles.mts`).
  - **14px for ALL UI text**: body, labels, section and card titles (were 16), row titles, tabs (were 13), buttons, links
    (including `Section.action`), inputs, descriptions, captions, hints, zone text (was 13), and the figure labels and meta of
    `figures` cells.
  - **12px only for small names**: meta lines, badges, chips, counts, timestamps, breadcrumb separators.
  - **No 13 anywhere.** `Text size="sm"` and `--grammar-text-sm` are 14; `sm` stays as a name and equals `md`.
  - **Hierarchy only from weight and tone**: titles are semibold 600 (page, section and card titles, `Heading` levels 1 to 3);
    row and selected names are medium 500 (`Text isStrong`, list row names, the table row header, the selected tab); secondary
    text is muted.
  - **Display sizes are flagged as such**: the page title 18 (xl) and a big figure value 20 (`Text size="figure"`, figures
    cells). Two opt-in display headings stay as they were: `PageHeader titleScale="title"` / `Heading scale="title"` (24) and
    `Heading scale="display"`; Markdown article headings keep their prose scale.

  | Role | Size and weight | Carrier |
  | --- | --- | --- |
  | page title (display) | xl 18 / 600 | `Page` `header.title`, `Heading` level 1 |
  | card or section title | md 14 / 600 | a card `label`, a `Section` `title`, `Heading` levels 2 and 3 |
  | row or table primary text, a field label, a selected name | md 14 / 500 | `<Text isStrong>`, a control's `label`, a list row name |
  | body, table cells, buttons, links, inputs, the section action's text | md 14 / 400 | `Text`, `Button`, `Link` |
  | row secondary text, descriptions, captions, hints | md 14 muted | `<Text tone="muted">` (or `size="sm"`, the same step), a card head `description` |
  | big figure value (display) | figure 20 | `Text size="figure"`, the value of a figures cell |
  | meta, badges, chips, counts, timestamps | xs 12 muted | meta lines, `Badge`, `Chip` |
  | every tab (page, region, filter) | md 14 / 400, the selected one 500 plus the underline; 40 high | `Tabs` ([tabs](components/tabs.md) Size) |
  | zone and bar labels and their counts (a selection bar "20 / 72 selected", a filter caption, a toolbar note) and a zone hint | md 14 (a hint muted) | any `Text` in a card or board header or footer zone: the zone sets 14, whatever size the `Text` names |
  | the one caption under a lone table, list or chart | md 14 muted | `Section caption` ([composition](composition.md) COLLECTION-4) |
  | table header | md 14 / 500 muted | the table's own header |

- **FONT-8 One line, one size.** Words that stand side by side on one line share one size step: 14 (`md`, and `sm`, which is
  the same step), 12 (`xs`) or a display size (`figure`). A chip or `Badge` beside the words is below the ramp and exempt.
  Lint: `starci-grammar/same-line-size` (no mixed `Text` steps among the direct children of one `Cluster`; `sm` next to `md`
  is valid, `xs` next to `md` is a finding). Measure: `check:type`.
- **FONT-9 A table cell and a list row are read in a column of equals.** Their text is 14 only (primary 14 / 500, secondary 14
  muted) and 12 for a small name; a larger `Text` (`figure`), a `Heading` or an `h1`-`h6` there is a heading drawn
  in a list. The `DataTable` header is 14 / 500 muted, cells 14 / 400, the row header 14 / 500. Lint:
  `starci-grammar/table-cell-type` (a `DataTable` cell and a `ListRow` title or description). Measure: `check:type`.
- A heading's level is its document position and sets its size together, so tag and size never drift; levels stop
  at four, because a fifth means the page nested deeper than a reader holds. Lint:
  `starci-grammar/no-raw-structural-element`, `starci-grammar/no-text-heading` (R358).
- **Weight refines a rank, never creates one**; structure must hold with weight and colour removed.
- Body copy is never shrunk to fit a container; the layout is repaired instead.

Type per region (counts: `type.region`, `type.view` in [proof/thresholds.yaml](proof/thresholds.yaml)):

| Region | Ranks it uses |
| --- | --- |
| page header | page heading (xl 18 / 500), one supporting line, one lowest-rank summary line |
| section header | section heading (level 2), optional supporting line |
| card | title (level 3, 14 / 600), body (ordinary or supporting, 14), meta (lowest, 12) |
| list row | title (md 14 / 500, the contract's unread weight when unread), one description line (14, muted), meta (xs 12) |
| stat cell | leading value, label (supporting, muted), unit lighter than the value |
| landing hero | display heading, ordinary-reading lead line |

**Tone** is the second axis of type, ordered by attention:

| Id | Tone | Use |
| --- | --- | --- |
| TONE-1 | default | ordinary content; both lines of a title and explanation the reader must read |
| TONE-2 | muted | a line that recedes because something beside it carries the meaning; every lowest-rank line; heading level 4 |
| TONE-3 | accent | one short span whose emphasis is already decided; never a paragraph, never repeated across peers |

Status is never a tone choice: success, warning, danger and information belong to the owners that carry them. What sits
behind a mark picks its colour token, by name, in every theme.

Choice `tone.choose.pair`: which token a status tone x paints with. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| on-tint | the content sits on a background of the tone: a tint, a tinted tile, a tinted band | the pair `x-soft` (the ground) with `x-soft-foreground` (the content) | lint `starci-grammar/status-text-uses-soft-foreground`; story `status-pair--bare-marks` |
| solid | the content sits on a solid fill of the tone | the fill `x` with `x-foreground` | judgement |
| alone | a mark stands alone: no background of the tone behind it (a bare glyph, a count, a title on the page or on a neutral surface) | `x` itself | lint `starci-grammar/status-text-uses-soft-foreground` |
| accent | the accent painted as text, on the page or on its tint | `--accent` alone; on its tint `--accent-soft-foreground` | judgement |

The app sets the values of `x`, `x-soft` and `x-foreground` in its own CSS and no gate judges them;
a family's default tones are proved at `contrast.statusSoft` and `contrast.text` in the package's stories. Offset Pop's light
theme is the one named exception: its pastel tones are kept and a bare mark there wears the soft foreground.

## Paint

### Surface
A surface and its foreground always travel as a pair. Prefer the earliest that works:

| Id | Face | When |
| --- | --- | --- |
| SURFACE-1 | none: inherit the parent face | a layout container whose children own their faces; a chat or log scroll region on the background tone |
| SURFACE-2 | surface face + surface foreground | one bounded object (the card face); grammar-painted |
| SURFACE-3 | secondary surface + foreground | a neutral recessed band inside a card zone |
| SURFACE-4 | accent-soft + a foreground paired with it (its soft accent text on a band; the default foreground and muted on a whole card, `SurfaceCard treatment="soft"`) | a band or a card the product deliberately raises; it still says in words why |
| SURFACE-5 | success-soft under the neutral foreground | a band whose outcome authority settled; before settlement it stays SURFACE-3 |
| SURFACE-6 | full accent, no foreground | a decorative slab carrying no copy and no control; inside a card it is a `custom` header zone |

Soft faces are translucent, so contrast is measured on the composed pixels, never on the token.

**The layer chain** holds on every screen: page background, then an owning surface, then its nested controls.
Grouped content stands in a surface; only page-level marks (a brand lockup, the page heading) sit on the
background. A form is one unit: its fields and its actions stand in the same surface. Controls in a surface take the
grammar's treatment, resolved from context; the app never passes a field variant (the prop types have none).

### Boundary
`separator` draws a line **between** things; `border` outlines **one** thing.

| Id | Edge | Rule |
| --- | --- | --- |
| BOUNDARY-1 | one seam between two bands | a presentation `Divider`, full-bleed |
| BOUNDARY-2 | per-row trailing lines | the last row drops its line: a set of n rows has n-1 lines |
| BOUNDARY-3 | one parent declaration for a uniform set | no row can miss or add a line |
| BOUNDARY-4 | inline-axis seams | exist only at the width where the columns exist |
| BOUNDARY-5 | an outline | belongs to a grammar object (media frame, code block, a quote's ground) |
| BOUNDARY-6 | elevation | a card on the page ground is raised (the card shadow) and wears a 1px `separator` border at the card radius; a surface nested in a card keeps the border and drops the shadow, so there is one depth and no doubled edge |
| BOUNDARY-7 | a list of rows inside a surface | a nested surface, not a stack of dividers: the rows of a card body, a Drawer or Dialog body, a `PaneSection` or a rail sit in a 1px `separator` border at the card radius, clipped, rows divided by lines (n-1); `Section kind="list"` draws it by itself, and a hand-made list (blocks divided by `Divider`) is refused. Lint: `starci-grammar/surface-in-surface` |

Elevation is the family's (contract: the card's edge).

### Radius
A corner follows the **level** of the box, and the ramp moves as one body when a grammar changes its base radius.
The app names a role, never a literal.

| Id | Role | Box |
| --- | --- | --- |
| RADIUS-2 | tiny | a swatch, a skeleton line |
| RADIUS-4 | compact | a compact mark, an `sm` box, a small notice inside a surface |
| RADIUS-5 | control / nested region | a field, an `md` box, a band, notice or bordered group inside a surface, an identity tile |
| RADIUS-6 | surface | a card or panel standing as its own surface |
| RADIUS-7 | hero | a page-opening hero band |
| RADIUS-9 | pill / circle | buttons, chips, badges, tags, region-tab pills, avatars, dots |

- **Nesting law:** an inner box's corner is at most its container's. A pill is its own shape, not a box.
- **Size coupling:** a box's corner stays a similar share of its height, so a smaller box takes a smaller role;
  a corner of half the height or more is a pill. See [scale.md](scale.md).
- **One family per view:** corners resolve to one set of roles. Proof: TASTE-7.
- A rounded surface that paints or lays out children also clips them.

## Room

### Measure
Prefer **fluid, then fitted, then capped; never fixed.**

| Id | Kind | Rule |
| --- | --- | --- |
| MEASURE-1 | page measure | a routed page adopts the page container's measure (default, reading, full); it never caps a region |
| MEASURE-2 | fluid | the region takes its host's width |
| MEASURE-3 | fitted | follows its content, always with a full-width cap |
| MEASURE-4 | capped | one step of the contract's width scale; prose caps at the reading measure; a form, auth panel or single-task region caps itself (the surface's form measure, or a capped centred region), never left-aligned in a wide column |
| MEASURE-5 | minimum height | a stable floor that still grows; the same floor in empty and populated states |
| MEASURE-6 | inherited height | fills a definite host height |
| MEASURE-7 | capped height | travels with a scroll owner; a cap without one clips silently |
| MEASURE-8 | band left, well centred | the page header band is full width with its text flush left at the page inset; the content in the pink well (a report page, and the content of a workspace pane that holds cards, `Pane content="cards"`) is capped at `--grammar-content-max` (80rem) and centred in the well, the ground filling the whole well; the pane grid and its side panes always span the full width, and a chat, graph or editor pane (`content="full"`) is never capped |

Every region that can receive long content carries a zero minimum width so it can shrink.

### Page tiers
Three viewport tiers, owned by Grammar and never written by an app ([composition](composition.md#responsive-5-the-page-tiers)): desktop from
1280 (page inset 32), tablet 768 to 1279 (24), phone below 768 (16). The gap between a report page's cards is 24, 16 on a phone (12 until the scale gains a 16 step); the
content is at most 1280 wide; the type stays 14 and 12 at every tier.

### Overflow
One owner per axis; two nested scrollers on one axis trap the reader.

| Id | Behaviour | When |
| --- | --- | --- |
| OVERFLOW-1 | visible | a child's ring, shadow or badge must cross the edge |
| OVERFLOW-2 | clipped | rounded surfaces, media crops, decorative regions; never text the reader needs |
| OVERFLOW-3 | scrolls one axis | content always exceeds it (a scroll region, a rail body) |
| OVERFLOW-4 | scrolls when needed | content sometimes exceeds it (wide tables, long code, chip rows with edge carets) |
| OVERFLOW-5 | contained | panels, drawers and overlays stop scroll chaining; never the page's own scroller |
| OVERFLOW-6 | no scrollbar | NIVO never shows scrollbars (owner, 2026-11-09): every scroll area (pane, `PaneSection scroll`, drawer and modal body, ListBox, chat thread, tab strip, DataTable overflow) hides the bar and fades its edge where content continues (HeroUI ScrollShadow); wheel, touch and keyboard still scroll; an app element with `overflow-y-auto` / `overflow-auto` is refused (lint `no-raw-scroll`) |

### Text flow
The default (start-aligned, wrapping) is right far more often than any rule here.

| Id | Rule |
| --- | --- |
| FLOW-1 | start alignment; numeric columns compared down a column align end; centring only a single short line in a symmetric region; never justified |
| FLOW-2 | text wraps; no `nowrap` on translated or user text; controls, badges and tabs keep their own one-line rule |
| FLOW-3 | strings that can hold a URL, token or pasted value break inside words |
| FLOW-4 | one-line truncation only when the full value is reachable elsewhere and the accessible name stays whole; never on a value the reader acts on (price, status, error, deadline) |
| FLOW-5 | multi-line clamping only with an affordance that reveals the rest |

## Relations at a glance

| When you change | Check |
| --- | --- |
| a control's step | its corner role, glyph, label rank and the row's other controls ([scale.md](scale.md)) |
| a surface's face | the paired foreground, contrast on composed pixels, the controls' treatment |
| a card's bands | separator count (`budgets.hairlinesPerCard`), side-contact padding, full-bleed dividers |
| a region's gap | its role (G2: monotonic against its parent and children), R1 against the inset of its box |
| a region's measure | `min-w-0`, overflow owner, truncation rules of its text |
