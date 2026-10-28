# Presentation

Presentation resolves values on boundaries the **app** owns, after composition chose the tree and the
components. Inside a grammar component every value is the grammar's. This file holds the relations between
space, type, paint and room; the values themselves are tokens and roles named by the grammar contract
([../grammars/contract.md](../grammars/contract.md)) and set by each grammar.

| The app may | The app must not |
| --- | --- |
| set the relationship (gap, inset, measure, overflow) between components it already chose | choose or rebuild a component, its layout or its anatomy |
| style a page, section, container or content-region boundary it owns | add padding, type or paint inside a grammar component |
| choose `Text` / `Heading` rank and tone props from the information rank | reach into a component with a selector or a passed class |
| resolve wrapping, measure and overflow of its own content | write a colour, a px length or an arbitrary value |

Lint: `starci-fe/no-arbitrary-value`, `starci-fe/no-raw-brand-value`, `starci-fe/no-app-surface-paint`,
`starci-fe/no-grammar-internal-selector`, `starci-fe/class-names-in-colocated-file`.

## Space

Gap, padding and margin share **one closed spacing scale** (contract: spacing steps and the four rhythm tokens).
Its rule ids are ordinal positions on that scale, not utility numbers. Off-scale and fractional steps do not
exist for app layout. Lint: `starci-grammar/no-fractional-step`.

Choice `space.choose.gap`: which gap a relation between two siblings takes. The first row that applies wins; the
Choose column names the rule id each gap carries.

| Row | When (the relationship) | Choose | Measure |
| --- | --- | --- | --- |
| seam | a separator or joined faces already draw the seam (bands of a joined card, rows divided by lines) | GAP-0: no space | `DNA-COMMON-LIST-SEAMS` |
| identity | two lines read as one identity (title and its qualifier, value and unit) | GAP-1 | candidate: equals the tightest rung |
| inline | inline companions inside one unit (glyph and label, a badge row, a decision and its way out) | GAP-2, `--grammar-inline-gap` | candidate: computed gap equals the token |
| row | peers in one row or group, each read on its own (a field and its submit, two filters, row parts) | GAP-3, `--grammar-row-gap` | candidate: computed gap equals the token |
| section | sibling blocks under one heading (cards of one collection, field groups of one step) | GAP-4, `--grammar-section-gap` | candidate: computed gap equals the token |
| region | page regions, each with its own heading (summary above history, primary column and rail) | GAP-5, `--grammar-region-gap` | candidate: computed gap equals the token |
| transition | a named major transition (unrelated halves, spacious landing sections) | GAP-6 | judgement |

The tokens stay ordered region > section > row > inline (`DNA-COMMON-RHYTHM-MONOTONIC`).

Padding uses the same scale; its ids name the clearance a boundary needs, not a step number:

| Id | Clearance | Typical boundary |
| --- | --- | --- |
| PADDING-0 | none: a child or the content already owns the edge | grouping containers, flush bands, lists in panels |
| PADDING-1 | minimal | a marker over a canvas, focus clearance of a scroll region |
| PADDING-2 | compact | an auxiliary strip, a compact control bar |
| PADDING-3 | dense | a nested boundary, a side facing a separator, a metric cell |
| PADDING-4 | readable content | the boundary that protects readable content; a band's outer edge |
| PADDING-5 | generous | a deliberately spacious section, a page-level tab frame |
| PADDING-6 | low-density region | a large empty or waiting region |
| PADDING-7..9 | responsive, indent, routed block inset | laws 6 and 7 below |

`MARGIN-0..6` are the same steps used as a named placement exception, and `MARGIN-AUTO` centres a capped container.

How the three combine:

1. **Gap owns the distance between siblings**, padding the distance from an edge to content, margin only a named
   exception (an absolutely placed marker, a centred capped container via auto margins). Reaching for margin first
   gives one distance two owners (`DOUBLE_OWNER`).
2. **Rhythm is monotonic**: region > section > row > inline > identity, and equal peers get equal gaps.
   Proof: TASTE-4.
3. **Side contact sets padding.** Each side of a band takes its inset from what it touches: an outer edge takes
   the content clearance, a side facing a separator takes the smaller separator clearance, a side whose child owns
   the edge adds nothing. Inline sides of peer bands align. The grammar owns the clearances and the flush-band API.
4. **No duplicate inset.** A container that only groups children with their own boundaries adds none; a list in a
   panel aligns its row boxes to the panel's content edge and adds no wrapper padding. Lint:
   `starci-fe/no-list-panel-padding`.
5. **A divider is full-bleed**; padding sits on the bands beside it, never on an ancestor of the divider. Lint:
   `starci-fe/divider-full-bleed`.
6. **Subordinate content indents at the inline start only**, so the reading measure stays.
7. **Responsive insets step to the adjacent scale step**, and only on sides the boundary owns; separator-facing
   sides never step. The page container owns the page's inline inset; routed content owns only its block inset.

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
| SURFACE-4 | accent-soft + its foreground | a band the product deliberately raises; it still says in words why |
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
| a region's gap | monotonic rhythm against its parent and children |
| a region's measure | `min-w-0`, overflow owner, truncation rules of its text |
