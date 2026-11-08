# Situations

An author says what the thing is; the grammar decides how it looks. This file is the front door: one row per situation of a
screen, each naming the component that is the answer, the spacing role the structure gives it, the one story that draws it,
and the type, lint or gate that refuses the wrong version. A wrong composition does not compile, and every allowed input
looks right. The Choose tables of [components](components/README.md) and the rules of
[composition](composition.md) own the finer decisions; this table routes to them and is not cited itself, except the
[loading](loading.md) page, which has no other owner.

A story is a Storybook id (`<title>--<export>`, lowercased) and names the baseline picture `core-light-<id>.png` under
[packages/grammar/proof/baselines](../../packages/grammar/proof/README.md), so a row's reference image is its story. A baseline
detects change and approves no look; the owner's eye does ([proof](proof.md#who-holds-each-proof)). A cell that says
`none yet` is a gap to close with a story, not a judgement.

## The situations

Spacing is a role, never a number: identity 4, inline 8, row 12, section 24, region 32; a card holds 16 inside, a box in a
card 8, an empty region 24 ([presentation](presentation.md#space)). Children stand at least one step closer than their
container stands to its siblings (G6). The author writes no gap, margin, padding or px; the role comes from the structure.

| Situation | Use | Spacing | Story | Refused by | Choose |
|---|---|---|---|---|---|
| A list whose region already has a surface | unpainted `Section kind="list"` of typed rows, one title as heading and accessible name | existing surface owns the inset; the list adds no surface | `surfaces--section` | R340/R356 forbid a surface in a surface | [list-table](components/list-table.md) `list-table.choose.role:contained` |
| A standalone bounded list to work through on the page canvas | `SurfaceCard kind="list"`, label outside, `footer` for its note | rows divided by lines (seam 0), label row inline 8, label 8 above the surface | `surfaces--surface-card-list` | type: a list needs `items` and `empty`; R355 hand rows; R354 a heading over one card | [card](components/card.md) `card.choose.role:task-list` |
| A long list with search or filter | `Section kind="list"` of rows, a `FilterButtonGroup` in its filter slot | head, filter and rows one row step apart (12, G6) | `surfaces--section` | R355 a `Section` around one card; R353 a selectable tag group | [list-table](components/list-table.md) `list-table.choose.role:entity` |
| Repeated tiles (providers, templates, products) | `SurfaceCard kind="tile"` in `Grid kind="cards"`: name and mark inside, status and button at the bottom | tiles inline 8 on both axes, title to grid row 12: siblings sit closer than their heading (UI-21) | `surfaces--surface-card-tile` | type: a tile has no `label`; R366 a labelled card repeated in a grid | [card](components/card.md) `card.choose.role:tile` |
| One bounded entry task with contextual identity | `EntryFrame` with its named content slots | frame-owned inset, form measure and desktop split | `frames-entryframe--ready` | type: named content slots and main label required | [entry-frame](components/entry-frame.md) `entry-frame.choose.role:entry` |
| Items in stages that move from one stage to the next (a pipeline, a funnel) | `Board` of columns, each a card of rows with its count | a column's cards inline 8; rows divided by lines inside a column | `navigation-data-data-views--board-states` | type: every column answers for its empty state | [data-views](components/data-views.md) `data-views.choose.view:board` |
| Entries that belong to a time or a place on two axes (a week by hour, a month, people by day) | `ScheduleGrid` with columns, rows and items placed by both | cell inset 4, entries stacked at 4 | `navigation-data-data-views--schedule-grid-states` | type: an `empty` answer is required; DNA `DNA-COMMON-SCHEDULE-HEADINGS` | [data-views](components/data-views.md) `data-views.choose.view:schedule` |
| A handful of amounts to compare at a glance (per day, per channel) | `BarChart` of labelled bars | bars inline 8 | `navigation-data-data-views--bar-chart-states` | type: an `empty` answer is required; DNA `DNA-COMMON-BAR-CHART-ONE-SCALE` | [data-views](components/data-views.md) `data-views.choose.view:bars` |
| Independent named working regions | `Grid kind="sections"` | section gap, two equal wide-workspace tracks | `frames-grid-relations--working-sections` | type: no look or column props | [composition](composition.md#6-layout) `grid.choose.content:sections` |
| Two portions of one reading or comparison unit | `Grid kind="pair"` | section gap, equal container-owned tracks | `frames-grid-relations--reading-pair` | type: two named slots, no children | [composition](composition.md#6-layout) `grid.choose.content:pair` |
| One focus between symmetric support groups | `Grid kind="featured"` | section gap, symmetric container-owned tracks | `frames-grid-relations--central-focus` | type: three named slots, no children | [composition](composition.md#6-layout) `grid.choose.content:featured` |
| A dated week of events or appointments | `Grid kind="week"` of seven day regions, including empty days | inline gap; one-column agenda in a narrow container | `compositions-renderers--grid-week` | type: region label required; development check: seven day children | [composition](composition.md#6-layout) `grid.choose.content:week` |
| Seven daily metric summaries | `Grid kind="week-summary"` of seven ordered day regions | inline gap (8); one, four or seven tracks by container width | `compositions-renderers--grid-week-summary` | type: region label required; development check: seven day children | [composition](composition.md#6-layout) `grid.choose.content:week-summary` |
| The passive date heading of a calendar region | `CalendarDay` | metadata ramp; the current-date fact owns its emphasis | `leaves-calendar-day--date-states` | type: date-only value; native time and aria-current date | [calendar-day](components/calendar-day.md) `calendar-day.choose.role:region` |
| A message receipt or transport outcome | `MessageStatus` in the existing message footer | metadata ramp and localized status label | `compositions-message-delivery--native-states` | type: receipt/transport states and readers only for seen | [message-bubble](components/message-bubble.md) `message-status.choose.fact` |
| A brand raster or image that leads to an address | `Link` with structured Image `media` and a required destination `label` | Image owns the target's dimensions | `leaves--link-media` | type: media data and text children are mutually exclusive | [button](components/button.md) `button.choose.role:media-destination` |
| Compare a fact across columns | `DataTable`, no card, a muted note below | note inline 8 below the table | `navigation-data--data-table` | R351 a table in a card | [list-table](components/list-table.md) `list-table.choose.role:table` |
| Key figures | `SurfaceCard kind="figures"` on the canvas; unpainted `Section kind="figures"` within an existing surface, retaining its heading owner | cells 8, dividers between cells and rows | `surfaces-section-figures--headless-in-pane` | type: shared Figure items and mutually exclusive title/ariaLabel; R340/R356 forbid another surface | [card](components/card.md) `card.choose.role:contained-figures` / `card.choose.role:figures` |
| Regions that touch (list, detail, info) | `PaneGrid` of `Pane`s in `Page chrome="panes"` | gap 0 and one divider, pane inset 12; a `PaneSection`'s bands inline 8 | `compositions-renderers--pane-inset` | R345 to R349 | [pane-grid](components/pane-grid.md) `pane-grid.choose.frame` |
| Peer filters over a collection | `FilterButtonGroup`: `sm` toggle buttons on one row, a "+n" dropdown with search | inline 8 | `status-pair--filter-button-group` | R353 | [chip](components/chip.md) `chip.choose.role:filter` |
| Quick replies or suggested questions (assistant drawer, chat composer, empty-state shortcuts) | `SuggestionChips`: pill chips, 28px, a labelled toolbar, a press sends the chip | inline 8 | `navigation-data-suggestion-chips--default` | `suggestion-chips` a row of neutral sm Buttons that send their own label | [chip](components/chip.md) `chip.choose.role:suggest` |
| One of two to five values in a form or toolbar | `ChoiceChips` (or `RadioGroup` when each needs a sentence) | field | `forms--choice-chips` | review | [segmented-control](components/segmented-control.md) `segmented-control.choose.role` |
| A page command | `Button intent="commit"` hugging its label, at the end of the header row | inline 8 | `compositions-renderers--page` | R352 a command filling its header; R319 | [button](components/button.md) `button.choose.width` |
| Empty | `EmptyNotice`: one line and its one action; the region keeps its place and the box collapses | line to action row 12, region inset 24 | `surfaces--empty-notice` | type: `empty` required on a list; `DNA-COMMON-EMPTY-ONE-ACTION` | [empty-state](components/empty-state.md) `empty-state.choose.cause:empty` |
| Not ready (needs setup before it works) | the state in plain words on a `Badge`, and the one next step as the item's action; a region that cannot work is an `EmptyNotice` with that action | inline 8 | `surfaces--empty-notice` | R322 chip label case; CTA-1; review | [empty-state](components/empty-state.md) `empty-state.choose.cause:not-ready` |
| A long process with stages (read, index, extract, review) | `Stepper` with its stages | row 12 | `navigation-data--stepper` | type: stages are typed data | [list-table](components/list-table.md) `list-table.choose.role:process` |
| A contradiction between two sources | `Section` whose title is the question, two `Quote`s side by side, the answers as a decision group | row 12 | `surfaces--contradiction` | review; `Quote` is not a surface | [quote](components/quote.md) `quote.choose.host:contradiction` |
| Needs approval (what, who, why, a named action) | `SurfaceCard` labelled with what, a `DescriptionList` of who and why, a decision group whose commit is named for the act | row 12 | `surfaces--needs-approval` | R319 one commit per view; CTA-5 group order | [action-group](components/action-group.md) `action-group.choose.kind:approval` |
| Chat | `MessageBubble` in a thread the app keeps: mine `side="outgoing"` on the accent, theirs on the surface | one sender identity 4, a sender change row 12, a day divider section 24 | `compositions-renderers--message-bubble` | type: `side`; the approved picture | [message-bubble](components/message-bubble.md) `message-bubble.choose.side` |
| One route | `Page` with its `header` as data (`breadcrumbs` or `"root"`) | region 32 between header and body | `compositions-renderers--page` | R323 to R325; `starci-grammar/page-breadcrumbs` | [page-header](components/page-header.md) `page-header.choose.head` |
| A form | `Form` of `Grid kind="form"` fields, one commit | label 8 above its control, help 4, field to field 24 (FIELD-1..3) | `forms--field-rhythm` | R319; `DNA-COMMON-FIELD-ROW-CONTROL-LINE` | [field](components/field.md) `field.choose.label` |
| An outcome in the page, or a passing one | `Alert` in the page; `Toast` for a transient confirmation | inline 8 inside | `overlays--alert` | type: tone is a settled fact; FEEDBACK-3 | [toast-alert](components/toast-alert.md) `toast-alert.choose.owner` |
| One irreversible confirm | `AlertDialog`, dismiss first and focused, the destructive confirm last | footer inline 8 | `overlays--alert-dialog` | R319 CTA-4 | [dialog-drawer](components/dialog-drawer.md) `dialog-drawer.choose.role` |
| A task that interrupts, or a task beside the page | `Dialog` that interrupts; `Drawer` that stays beside the page | overlay inset 12 | `overlays--dialog`, `overlays--drawer` | `DNA-COMMON-OVERLAY-IN-ROOT`; no surface in an overlay (R340) | [dialog-drawer](components/dialog-drawer.md) `dialog-drawer.choose.role` |
| The connections an agent uses | `LogoStack`: round 20px logos, at most 3 then "+N", an optional muted caption; one pressable or a `DropdownMenu` trigger through `isTrigger` | logos identity 4 | `navigation-data--logo-stack` | type: items with `src` or `iconSource` | [identity-mark](components/identity-mark.md) `identity-mark.choose.role` |
| A second row of views inside one page tab | `Page header.subTabs`: region tabs in the header band under the page tabs, on their own separator | first label on the content edge | `compositions-page-sub-tabs--sub-tabs` | type: `subTabs` only with `tabs`; `starci-grammar/tabs-depth` (two underline layers) | [tabs](components/tabs.md) `tabs.choose.level` |
| A command at the end of a tab strip | `Tabs end`: the strip's line spans the full width under the command | centred in the strip's height | `navigation-data-tabs-end-slot--end-slot` | review | [tabs](components/tabs.md) `tabs.choose.level` |
| Rows of a record that open a drawer | `DataTable` or `SurfaceCard kind="table"` with `onRowAction`: the whole row is the one pressable, the title plain text | row hover fill, commands separate presses | `surfaces-card-search-filters-description-and-pressable-rows--pressable-table-rows` | `starci-grammar/row-title-link` | [list-table](components/list-table.md) `list-table.choose.role:table` |

## Loading

Four states cover every region that reads data (skeleton, content, error, empty), and the rows that pick them are owned by [loading](loading.md); the situations above link there instead of repeating it.

## Where the other decision tables live

| Decision | Table |
|---|---|
| Gap, margin and padding by component and by relation | [presentation](presentation.md#space), "The table" |
| Which tier may do what | [contributing](../grammars/contributing.md#which-tier) |
| Card kinds and where the label sits | [card](components/card.md) `card.choose.role` and `card.choose.label` |
| What behind a mark picks its colour token | [presentation](presentation.md#type) `tone.choose.pair` |
| Loading, error and empty by what a region reads | [loading](loading.md) `loading.choose.status` |
| Filter, empty, not ready, approval, chat | the Choose anchors in the table above |
