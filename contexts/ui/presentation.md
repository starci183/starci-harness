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
`starci-fe/no-spacing-utility` in app class strings, `starci/spacing-scale` in grammar stylesheets (R350).

### The scale

One closed scale, and no value outside it: **0 · 4 · 8 · 12 · 24 · 32** (px at 16px to the rem; owner:
`@starci/grammar src/common/spacing.ts`, the root tokens of `src/common/styles.css`). There is no 16: a container holds
its content one row step in, and separation beyond that belongs to the parent's gap, never to a larger inset. A
measured 6 (a meter gap), 3 (a body offset), 20 or a fluid `clamp()` is a second, private scale and is refused. A
1px or 2px line is a stroke, not a step.

| Step | Role as a gap (`GapRole`) | Token | Rule id |
| --- | --- | --- | --- |
| 0 | seam: a separator or joined faces already divide the two | none | GAP-0 |
| 4 | identity: two lines read as one cluster (title and qualifier, label and field and help, value and unit) | `--grammar-identity-gap` | GAP-1 |
| 8 | inline: companions inside one unit (glyph and label, chips of one set, a decision and its way out) | `--grammar-inline-gap` | GAP-2 |
| 12 | row: peers of one row or group, each read on its own (fields of a form, bands of a pane or card, rows of a rail) | `--grammar-row-gap` | GAP-3 |
| 24 | section: blocks under one heading (cards of one collection, the groups of a rail) | `--grammar-section-gap` | GAP-4 |
| 32 | region: page regions with their own heading (summary above history, main and rail, header and body) | `--grammar-region-gap` | GAP-5 |

GAP-6 (a named major transition) takes the region step: the scale holds nothing above it.

Choice `space.choose.gap`: the relation between two siblings picks the role; the first row of the table above that
applies wins. A flex that holds two relations is two Stacks, one inside the other.

### Four inset levels

An inset steps down one level each time a box sits inside another, and an inner inset is never larger than its parent's.

| Level | Box | Inset (owner token) |
| --- | --- | --- |
| 0 frame | the page gutter; the overlay as a floating page | gutter 12, 24 from the medium breakpoint (48rem), 32 from wide (70rem), stepped, never fluid (`--grammar-page-inset`), except on `Page chrome="panes"`, where the header takes 12 at every width so the gutter column starts at the pane content edge; a dialog or drawer 12 on every side (`--grammar-overlay-inset`) |
| 1 surface | a card (dense or holding a form or prose alike), a pane, a band of a joined card | 12 on every side (`--grammar-inset`, `--grammar-card-padding-*`, `--grammar-pane-inset-*`) |
| 2 box in a surface | a nested card, a notice in a card, a list option, a table cell's block side, a stat cell | 8 (`--grammar-inset-nested`) |
| 3 control | a button, field, tab, chip, badge | the control's height decides the block padding; inline sm 8, md 12, lg 24, one step less on a glyph's side (`--grammar-control-padding-*`) |

The one named exception above its parent's level is a low-density region, an empty state or a drop target, which
takes 24 on every side (`--grammar-inset-open`, PADDING-6).

### Laws

Padding (inline and block chosen apart):

- **P1 Side contact.** Each side of a box takes its inset from what it touches: an outer edge takes its level's inset;
  a side whose child already owns the edge takes 0. A pane's every side, divider-facing or outer, is the same 12. The
  grammar owns the flush-band API: a `Pane` publishes its inset and a `PaneSection` applies it, so a band in a pane
  carries no padding of its own. Lint: `starci-grammar/no-pane-section-padding`.
- **P2 Inline belongs to the container, block to the item.** Every box in one container starts at the same content
  edge (a search field, the first tab label, the selected row, a meter, a chip); the text inside a box keeps the box's
  own padding. Block padding is the density of each band. Lint: `starci-fe/no-list-panel-padding`.
- **P3 Nesting steps down.** 32/24/12 → 12 → 8: an inner inset is smaller than its parent's, or the inner box reads as a
  card inside a card. The card's inner text at 12 is the one intentional step between the shared edge and the content.
- **P4 Closed boxes are symmetric.** A closed box has equal block sides, and its inline and block insets never differ
  by two steps; extra separation belongs to the parent's gap, never to one side of the box. Reading comfort comes from
  measure (MEASURE-4), not from a larger inset, so a card holding a form or prose keeps 12.
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
  set); a toolbar takes inline inside a group and section between groups; a card grid takes section on both axes; a
  two-column form takes row on both axes; main and rail take region on both axes when they stack.
- **G4 Heading to content.** Title and its supporting line: identity. A section header and its content: row. A page
  header and its body: region, or 0 when the body is a pane grid (`Page chrome="panes"`).
- **G5 Rows and messages.** Rows divided by lines: seam. A pill list: identity, so two hover fills never touch. Chat
  bubbles of one sender: identity; a sender change: row; a day divider: section.

Padding and gap together:

- **R1 Inner gap ≤ inset ≤ outer gap** for a closed box: a card's content sits 12 apart inside a 12 inset, and cards
  of one collection stand a section apart, so each card reads as its own unit.
- **R2 Touching panes take 0 and a divider; floating cards take section.** The two never mix.
- **R3 A divider is full-bleed**; padding sits on the bands beside it, never on an ancestor of the divider. Lint:
  `starci-fe/divider-full-bleed`.

Margin:

- **M1 No margin in layout.** Only the grammar writes one, in three named cases: `MARGIN-AUTO` centring a capped
  container (a form card, a reading measure), an absolutely placed marker (a badge on an avatar), and a vendor part's
  internal offset kept for parity.
- **M2 Bleed is an API, never a negative margin**: `PaneSection bleed="inline"` (a horizontal chip row reaching both
  pane edges, the inset becoming its scroll padding), `SurfaceCard composition="joined"` (bands to the card edge), the
  artwork band of a painted card.

### Text edge

The page title, the tab labels and the section headings share one text edge with the card or pane box below them:
page tabs are the underline bar, their first label on the content edge; pills are the shape of filters and chips
only (a filter over a collection is a selectable `TagGroup`). The card's inner text at 12 is the one intentional step.
Lint: `starci-fe/nested-control-variant`.

### The table (the grammar's decision per component)

Values in px at the `core` family; each is a token or the anatomy of the component that names it.

| Component | Inline | Block | Column gap | Row gap |
| --- | --- | --- | --- | --- |
| Page body | gutter 12 / 24 / 32 | bottom region | main ↔ rail region | region |
| PageHeader | gutter, 12 under `chrome="panes"` | top section, bottom 0 over tabs | title ↔ actions region | title ↔ description identity, copy ↔ tabs row |
| Page tabs (underline) | first label 0, each tab 12 per side | 0 | labels 24 apart | — |
| Header → body | — | — | — | region, or 0 under `chrome="panes"` |
| Sidebar rail (collapsed) | 12 | 12 | — | items identity, groups section |
| Sidebar item | 12 | derived (h 40) | glyph ↔ label row | identity |
| Dialog, Drawer | 12 | 12 | footer actions inline | header ↔ body ↔ footer row |
| SurfaceCard (any content) | 12 | 12 | two-column form row | bands row, title ↔ meta identity, fields row |
| Labelled card | card inset | label top = inset | — | label ↔ content row |
| Joined card band | card inset | card inset | — | seam |
| Card grid (`Grid kind="cards"`) | — | — | section | section |
| Pane (`PaneGrid`) | 12 | 12 on every side | 0 + divider | sections row |
| Composer | pane inset | pane inset | field ↔ send inline | chips ↔ field inline, field ↔ hint identity |
| Box in a card (nested card, notice, stat cell) | 8 | 8 | — | identity |
| ListBox option | 8 | 8 (h 40) | avatar ↔ text row | title ↔ description identity |
| Table | cells 12 | cells 8 (h 40) | — | seam |
| Alert, Toast | 12 (8 in a card; the toast's close side 8) | 12 (8 in a card) | glyph ↔ text inline | identity |
| EmptyNotice, FileDropzone | 24 | 24 | — | row |
| Chat bubble | 12 | 8 | avatar ↔ bubble inline | identity / row / section by G5 |
| Meter | 0 | 0 | label ↔ value inline | header ↔ bar identity |
| Button sm / md / lg | 8 / 12 / 24, glyph side 4 / 8 / 12 | derived (h 32 / 40 / 48) | glyph ↔ label inline | — |
| Field | 12 | derived (h 40) | glyph ↔ text inline | label ↔ field ↔ help identity |
| Chip, Tag | vendor 8 | derived | inline in a set | inline when it wraps |
| Badge | vendor 8 | 0 | dot ↔ text identity | — |

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
| lint | `starci-fe/no-spacing-utility` (app class strings, R350), `starci/spacing-scale` (grammar stylesheets, R350), `no-pane-section-padding`, `no-list-panel-padding`, `divider-full-bleed`, `no-fractional-step`; proof TASTE-4 measures the rhythm on the live page |

An app moves onto role props with `starci app codemod spacing-roles` (dry run by default, a report of every rewrite
and of every utility left for a person).

## Type

The app chooses an **information rank**; the grammar realises it. Ranks (contract: text sizes, heading levels,
weights):

| Id | Rank | Carrier |
| --- | --- | --- |
| FONT-1 | lowest supporting: brief metadata | `Text` smallest size (always muted) |
| FONT-2 | supporting reading: a full supporting line | `Text` small size |
| FONT-3 | ordinary reading | `Text` default size |
| FONT-4 | page heading: one per document | `Heading` level 1 |
| FONT-5 | leading value: the principal figure of a region | `Text` leading-value size, text semantics |
| FONT-6 | display: a landing introduction | `Heading` display treatment, outline unchanged |

- A heading's level is its document position and sets its size together, so tag and size never drift; levels stop
  at four, because a fifth means the page nested deeper than a reader holds. Lint:
  `starci-grammar/no-heading-tag-outside-heading-component`, `starci-grammar/no-hand-rolled-heading`.
- **Weight refines a rank, never creates one**; structure must hold with weight and colour removed.
- Body copy is never shrunk to fit a container; the layout is repaired instead.

Type per region (counts: `type.region`, `type.view` in [proof/thresholds.yaml](proof/thresholds.yaml)):

| Region | Ranks it uses |
| --- | --- |
| page header | page heading, one supporting line, one lowest-rank summary line |
| section header | section heading (level 2), optional supporting line |
| card | title (level 3), body (ordinary or supporting), meta (lowest) |
| list row | title (ordinary or supporting, semibold when unread), one description line (supporting, muted), meta |
| stat cell | leading value, label (supporting, muted), unit lighter than the value |
| landing hero | display heading, ordinary-reading lead line |

**Tone** is the second axis of type, ordered by attention:

| Id | Tone | Use |
| --- | --- | --- |
| TONE-1 | default | ordinary content; both lines of a title and explanation the reader must read |
| TONE-2 | muted | a line that recedes because something beside it carries the meaning; every lowest-rank line; heading level 4 |
| TONE-3 | accent | one short span whose emphasis is already decided; never a paragraph, never repeated across peers |

Status is never a tone choice: success, warning, danger and information belong to the owners that carry them. A
bare status glyph or title uses the tone's soft foreground (measured at `contrast.statusSoft`), never a darkened
solid tone. Lint: `starci-grammar/status-text-uses-soft-foreground`. When a pair fails contrast, the app changes
the surface, never the token.

## Paint

### Surface
A surface and its foreground always travel as a pair. Prefer the earliest that works:

| Id | Face | When |
| --- | --- | --- |
| SURFACE-1 | none: inherit the parent face | a layout container whose children own their faces; a chat or log scroll region on the background tone |
| SURFACE-2 | surface face + surface foreground | one bounded object (the card face); grammar-painted |
| SURFACE-3 | secondary surface + foreground | a neutral recessed band inside a joined card |
| SURFACE-4 | accent-soft + a foreground paired with it (its soft accent text on a band; the default foreground and muted on a whole card, `SurfaceCard treatment="soft"`) | a band or a card the product deliberately raises; it still says in words why |
| SURFACE-5 | success-soft under the neutral foreground | a band whose outcome authority settled; before settlement it stays SURFACE-3 |
| SURFACE-6 | full accent, no foreground | a decorative slab carrying no copy and no control; inside a card it is the joined card's first face, edge to edge |

Soft faces are translucent, so contrast is measured on the composed pixels, never on the token.

**The layer chain** holds on every screen: page background, then an owning surface, then its nested controls.
Grouped content stands in a surface; only page-level marks (a brand lockup, the page heading) sit on the
background. A form is one unit: its fields and its actions stand in the same surface. Nested controls take the
grammar's nested treatment, resolved from context; the app never passes a static field variant. Lint:
`starci-fe/nested-control-variant`.

### Boundary
`separator` draws a line **between** things; `border` outlines **one** thing.

| Id | Edge | Rule |
| --- | --- | --- |
| BOUNDARY-1 | one seam between two bands | a presentation `Divider`, full-bleed |
| BOUNDARY-2 | per-row trailing lines | the last row drops its line: a set of n rows has n-1 lines |
| BOUNDARY-3 | one parent declaration for a uniform set | no row can miss or add a line |
| BOUNDARY-4 | inline-axis seams | exist only at the width where the columns exist |
| BOUNDARY-5 | an outline | belongs to a grammar object (nested card, media frame, code block) |
| BOUNDARY-6 | elevation by depth | a top-level card is raised; a nested card is subordinate; never both raised |

Elevation per depth is the grammar's (contract: surface depth treatments).

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

Every region that can receive long content carries a zero minimum width so it can shrink.

### Overflow
One owner per axis; two nested scrollers on one axis trap the reader.

| Id | Behaviour | When |
| --- | --- | --- |
| OVERFLOW-1 | visible | a child's ring, shadow or badge must cross the edge |
| OVERFLOW-2 | clipped | rounded surfaces, media crops, decorative regions; never text the reader needs |
| OVERFLOW-3 | scrolls one axis | content always exceeds it (a scroll region, a rail body) |
| OVERFLOW-4 | scrolls when needed | content sometimes exceeds it (wide tables, long code, chip rows with edge carets) |
| OVERFLOW-5 | contained | panels, drawers and overlays stop scroll chaining; never the page's own scroller |

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
| a surface's face | the paired foreground, contrast on composed pixels, the nested controls' treatment |
| a card's bands | separator count (`budgets.hairlinesPerCard`), side-contact padding, full-bleed dividers |
| a region's gap | its role (G2: monotonic against its parent and children), R1 against the inset of its box |
| a region's measure | `min-w-0`, overflow owner, truncation rules of its text |
