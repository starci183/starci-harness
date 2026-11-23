# Composition

Composition is decided while the page is still a description: which regions exist, which content outranks
which, which action carries the decision, which conditions exist and who carries each, and where the scarce
emphasis goes. Nothing here can be repaired later by a CSS value, which is why it comes first. Every rule
names its owner; numbers live in [proof/thresholds.yaml](proof/thresholds.yaml) under the key named.

Three ideas hold the whole layer together:

- **One fact, one carrier.** A meaning has exactly one owner, and an owner holds exactly one meaning. Two facts
  on one carrier become one fact; a fact with no carrier becomes a guess.
- **Scarcity.** One focal point per page, one anchor per region, one commit per view, one signature moment.
  Every extra strong thing lowers what the previous one meant.
- **Facts in, paint out.** The app declares objective facts (job, consequence, rank, state); the grammar
  resolves the look. An app that picks a look instead of declaring a fact creates a second reading.

## 1. Hierarchy

### HIERARCHY-1 Rank comes from the job

| Job of the content | Owner |
| --- | --- |
| names a page or section | `Heading`, at the level the outline needs |
| explains, or states a neutral fact | `Text role="body"` (the default line), no state |
| names a literal (identifier, path, hash, command) | `Text role="code"` on its own line, `Code` inside a sentence, `FencedCodeBlock` for a block |
| tails a live log | `Terminal` |
| reports an outcome authority settled | `Badge`, `StatusDot` or another state owner |
| reports a verified measurement 0-100 | `Progress` / `Meter` with its label and value; a `Meter` inside a dense row takes `size="sm"` |
| the principal figure of an overview cell | `Text role="figure"` (24 / 32 / 500, FONT-5) |
| feels important but matches no role | name the job in the spec first; no type utility stands in for a rank: a size is one of the ten type roles ([presentation](presentation.md) "The type roles"), `<Text role>` or `starci-type-<role>`, and `starci-grammar/no-raw-type-size` reports a raw one |

### HIERARCHY-2 One anchor per region
Each region has exactly one strongest semantic anchor (a `Section` title, a `Heading` or a labelled surface). A status
ranks below the name it qualifies. Peer regions settle their anchors independently.

### HIERARCHY-3 Reading order is task order
DOM, reading and focus order run prerequisite, decision, consequence, support. Help follows what it explains; an
action precedes the result it produces. CSS `order` never reverses meaning, at any width. A working (console)
page reads: header, summary, what needs the reader (notices), the collection, detail.

### HIERARCHY-4 Fact, measurement and outcome are three ranks
A neutral fact is plain text. A measurement is a measurement owner, never a fill standing for completion. An
outcome is a word plus its state owner. No ordinary fact takes a warning or success treatment; an unresolved
measurement is a skeleton, never a rendered zero.

### HIERARCHY-5 Rank survives reflow, loading and lost colour
Heading order and the anchor count are the same at every width; a skeleton carries the role of the content it
stands for; every rank still resolves with colour removed or in forced colours.

### HIERARCHY-6 One focal point, two or three secondaries, the rest background
The spec names one primary focal point (the element that answers the page's one job), then two or three
secondaries; everything else is named background. A fourth candidate is demoted or cut, never promoted.
A rank is made visible **by size first, then weight, then space; colour last**. A distinction carried only by
colour is not a rank. Proof: TASTE-1 (squint test). Budget: `budgets.focal`, `budgets.secondary`.

## 2. Action and CTA

Rules are listed in reasoning order; ids are stable addresses. Closed and folded in: `ACTION-2` and
`STATE-2` into CTA-3, `ACTION-3` into CTA-2, `ACCENT-1` into CTA-1.

### ACTION-1 One activation, one effect
One node owns each effect: a `Button`, or a `TextAction` where the command reads as text. No ancestor, wrapper or
document listener answers the same activation. A whole-surface action and a smaller action inside it occupy
disjoint boundaries (STATE-8). In a form the spec names `Button.type`.

### CTA-2 Command or destination
Consequence picks the element: going to an address is an anchor (`href`), changing state is a button with a real
handler. A destination may look like a button; it stays an anchor and takes the same look as the command it
stands for. An anchor with a click handler and no address does not exist. The dominant action keeps a visible text
label; glyphs only support it.

### CTA-3 Disabled, pending and skeleton are three conditions
This is the one statement of this distinction; other rules cite it.

| Condition | Carrier | What it looks like |
| --- | --- | --- |
| the work cannot start (permission, prerequisite) | `isDisabled` on that control | inert |
| this control accepted work that has not settled | `isPending` on the initiator only | label and box unchanged, busy exposed, second press refused |
| content never resolved, no action taken | `isLoading` on the content owner | the resolved anatomy as inert geometry |

Pending is never page-wide, never on a peer that started nothing, and never swapped for `isDisabled`. A recovery
inside an empty or failed region forwards pending through that region's owner (`EmptyNotice.isActionPending`).
An owner that publishes no pending prop is a grammar gap, not an app substitute.

### CTA-6 Three looks
A Button has three looks, one prop (owner 2026-11-22: "chỉ có danger, border, và primary thôi, k có tertiary nữa"): `variant` is `primary`
(solid, the one main action of the card or region), `border` (an outline, every other action; the default) or `danger` (a destructive action).
The app picks the look from the spec's facts by the decision table `button.choose.variant`
([components/button.md](components/button.md#choose)): the press destroys something, it is `danger`; it is the region's one next step, it is
`primary`; anything else is `border`. There is no intent, step, placement, ghost, tertiary, secondary or soft-danger look, and the look never
depends on where the Button sits ([../grammars/contract.md](../grammars/contract.md#button-variant)).

### CTA-1 One primary per view
A view (a page, or an open modal overlay; the page behind a modal is inert) has exactly one `variant="primary"` (the commit). It is the
next step of the page's one job. Every other next step on that view is `border`. While a collection is empty, its
`EmptyNotice` owns the command as the primary and the header omits it; once content exists the header owns it.
Equal-consequence peers get no commit at all: no paint breaks a tie. A landing may repeat its one conversion
command once, never in the same viewport (`budgets.commitPerView`).
Peer choices are not buttons and there is one component for each meaning: `Tabs` switches a view or filters a list that stays in place
(`kind="filter"`), `ChoiceChips` or `RadioGroup` chooses a value of a form, a `Calendar` with `ChoiceChips` picks a date and a time,
and separate `Button`s or a `DropdownMenu` carry actions. The Grammar draws no group of attached buttons (`ButtonGroup`,
`FilterButtonGroup` and `SegmentedControl` are deleted; R380 names the replacement), chosen by [components/tabs.md](components/tabs.md), and no commit
sits among them.
Lint: `starci-fe/single-commit-per-render`, `starci-fe/no-commit-in-collection-item`.

### CTA-4 Destructive needs its own authority
Destructive is `variant="danger"`, at the entry and at the confirm, which stands inside an `AlertDialog` that holds no
primary and puts initial focus on its `border` cancel. Stored data needs that confirm; an unsubmitted row (a pasted link, a
queued file) is removed at once by a `danger` icon button named for screen readers ("Remove link 2"). The
grammar's danger treatment is the only red on a destructive control; a destructive verb on a `border` look is a defect.
Lint: `starci-grammar/destructive-menu-entry-needs-danger-tone`.

### CTA-5 Group order
A decision group runs **way out, alternative, primary**: the `border` way out first, the primary last, as separate buttons at
the inline gap (GAP-2). The order is identical at every width; when the group stacks, the commit lands last,
nearest the thumb. A decision and its way out are never attached buttons (see
[components/action-group.md](components/action-group.md)). The commit's label never shows an empty count, and an
empty input does not leave it disabled and faded: it names the command and explains the missing input when
pressed. The spec names the longest translated label the group must hold; the group wraps, never overlaps.

## 3. Accent

Accent is an allocation, not a paint. It may go **only** on: the commit, the focus indicator, a verified
measurement fill, the current-selection indicator, and the page's one signature moment. Headings, eyebrows,
numbers, card borders, identity tiles and summary cells take none.

### ACCENT-2 Identity is neutral
A compact identity anchor (an `IconTile`, an avatar) is neutral. Only a tile that reports a real outcome takes a
status tone; no tile takes accent to say who a peer is. A mark never replaces the visible name.

### ACCENT-3 Selection, destination, command and focus stay distinct
Each resolves to its own owner and treatment, and each carries a non-colour cue (state attribute, outline,
indicator geometry, weight). A destination in body copy is identifiable at rest by its weight (a Link is HeroUI's own: 500, no underline until hovered, text.md "Link and Sublabel"). Proof: COLOR-3.

### ACCENT-4 An accent fill states a real measurement
A progress fill presents a verified value from authority and nothing else; an unresolved value is a skeleton; a
decorative or ranking bar carries no progress semantics; the fill states the measurement and a separate owner
states any outcome. A measurement on a view whose one accent mass is its commit, a usage quota beside an upload,
takes `tone="foreground"` on `Meter` or `Progress`: the fill is the text colour on the empty track and spends no accent
(ACCENT-6).

### ACCENT-5 Status hues and notices report authority
Success, warning and danger appear only where authority reports that state, never as a category, a peer marker
or decoration. A figure that reports a state keeps the default tone with a toned `Badge` beside it. Status is
never a text colour choice. A notice is the grammar `Alert`, never a hand-built row and never an `IconTile` posing
as its indicator: it has one look, its tone's soft pair. An informative notice is neutral (the default soft pair, 0.37.17) and spends no accent; the `accent` tone is the brand "new" band and counts in the budget. The Alert's action variant per
tone is contract data. See [components/toast-alert.md](components/toast-alert.md).

### ACCENT-6 Budget and the one strong mass
About nine tenths of the painted content area is neutral (canvas, surfaces, foreground, muted, separators);
accent fills, soft grounds and accent text together stay under `budgets.accentArea`. The count of strongest
treatments is the same in every state and at every width. The commit is the one accent mass the eye finds first:
no second full-strength painted slab (accent, or an inverted ink band) shares a working page's first screen with
it, and figures, headers and summaries stay on neutral surfaces. A full-strength slab carries no copy and no
control (SURFACE-6), so it is never a KPI band; it is used only as the page's signature moment (DISCIPLINE-3), on
an overview or an entry page. Red budget (owner, 2026-11-10): the primary red is the one main CTA of a view plus links inside sentences. A standalone secondary or navigation link (back, cancel, legal footer) is `Link variant="plain"` (foreground); an informative `Alert` is neutral. Proof: TASTE-5.

## 4. State and feedback

| Kind | Examples | Lasts | Carrier |
| --- | --- | --- | --- |
| transient cue | hover, focus, pressed | while the input lasts | the grammar, never a persistent value |
| persistent value | selected, expanded | across blur, rerender, reflow | a controlled value (`selectedKey`, `isOpen`) |
| lifecycle fact | unavailable, pending, unresolved | while the work runs | CTA-3 |
| settled outcome | success, error, cancellation | after authority answers | a state owner, a field error, a notice |
| absence | the branch does not exist | — | nothing: unmounted |

### STATE-1 Name meanings before carriers
The spec names every fact and transition before a carrier appears; each fact gets its own carrier; a
`PresentationState` paints only a fact authority already settled.

### STATE-3 Absence is complete
An absent branch is unmounted through the published optional contract, with no wrapper, track, divider, spacer,
reserved scroll range or focus stop left behind. Hidden-but-mounted is not absent.

### STATE-5 Whole-surface action or static surface
A surface that is one destination or one command uses the surface's whole-action contract (one target, one name).
A static surface carries no handler and no hover that implies interaction.

### STATE-6 Persistent peer choice
One controlled value drives a peer choice, with no local copy; each tab owns its panel; no node outside the
published owner carries tab semantics. Which owner holds the choice is [components/tabs.md](components/tabs.md).

### STATE-7 Controlled disclosure
A disclosure changes only through its controlled value from one trigger, never on hover; a closed body has nothing
focusable or announced; several disclosures each bind their own value.

### STATE-8 Loading and failure keep the page's anatomy
The loading view is the resolved view's own tree with the data missing: same layout owners, same cards, real text
for everything known without data; only unresolved content becomes inert geometry. Build it by rendering the page
component in skeleton mode, never a separate generic layout, and let the grammar frame derive the geometry from its own
structure: an app draws no skeleton, no fake item list and no row shape. A skeleton means a first load with no data;
content stays through a refresh; empty appears only after loading ends; an error never reads as empty. The
[loading rules](loading.md) decides each state. A collection draws `budgets.skeletonRows` rows unless
its size is known. A failed region fails in place (its `EmptyNotice` with a safe retry, or a soft negative
`Alert`); a failed route keeps its chrome and puts one negative `Alert` where the first region would be. Each route
ships its own loading and error views. Lint: `starci-fe/no-resting-twin-component`,
`starci-fe/no-placeholder-prop`.

The owner's rule of 2026-11-21 (Grammar 0.53.0) sets what the geometry is:
- In his words: "không có xxxx -> ske. và không có plain text như label -> ske nốt", "ý là đơn giản code ske là if else, if trả về Skeleton của heroui thôi chứ không đi sửa màu hay gì", "cái khung đỏ cũng bỏ nhe!!! cùng về plain nè".
- **Loading is a plain conditional, `isLoading ? <Skeleton/> : <Real/>`, with HeroUI's Skeleton as shipped.** A loading form control draws Skeleton shapes in its field anatomy: a line for its label and description, and its control box at its own size (a 40px field, a Switch track at its kind's size, a check box, pills, marks). It never draws its real control painted over.
- **No fake text and no real label.** No "xxxx" in a loading view; a label, description, section title, count or value is a skeleton line.
- **No tone, no border.** A loading card, region, alert or button keeps only the plain neutral surface and border, and a skeleton has no border or ring.
- **The content zone.** `Page isContentLoading` makes everything below the page header skeleton edge to edge, section headings included; the shell, the breadcrumbs and the header's static parts stay real. A data-driven header part (a record's name) may be a placeholder.
- **The flag is gated.** It comes from `@starci/next-data`'s `useSkeletonGate` / `skeletonGate` (shown only past 250ms, then held at least 500ms); Grammar has no timer.

### FEEDBACK-1 Correct at the nearest owner
A field failure lives on that field (`errorMessage` plus `isError` on the same fact), exactly once; standing
guidance is the field's `description`, which does not come and go with validation; the entry survives revalidation.

### FEEDBACK-2 Recover at the smallest owner
A failed or empty region recovers through its own `EmptyNotice` action, scoped to the failed operation; an unsafe
repeat (a purchase) becomes a distinct safe operation; work outside the region survives. An empty drawing (map,
chart, graph) still renders what is known, with the notice under it in its region.

### FEEDBACK-3 Claim only after settlement
Pending clears on a real settlement; the result names the outcome that arrived; one `live="polite"` owner
announces a non-urgent result (`assertive` only for a real interruption); a result that matters later has a
durable owner. Transient confirmations are toasts; see [components/toast-alert.md](components/toast-alert.md).

## 5. Collection

### COLLECTION-1 The host surface and list scope pick its owner
Rows of one kind are one `Section kind="list"` of typed rows wherever they stand: inside an existing surface, and on the
page canvas whether the list is a bounded worklist or searches, filters or pages (`Tabs kind="filter"` in its filter slot
when it narrows). A list is never a card; it draws the one look of BOUNDARY-7 ([presentation](presentation.md#boundary)).
The section carries the list's one visible heading and accessible name, its count and page command; no free heading repeats that name.
A published container is used where one exists (see
[components/list-table.md](components/list-table.md)); none existing is a grammar gap, never a substitute card. Several
values of one kind entered by the user are one single-value field per row with its own remove action and an "add another"
command, never a "one per line" textarea.

### COLLECTION-2 A card is one object
A card is ONE object with its own face (a customer, an agent, a provider, a plan, a message, an approval), a dialog or an
overlay. The object's own facts, copy and controls are its body, and its commands its one `actions` band at the foot; a
section of content, a page's facts or a form with a page around it is no object and is never a card. Comparing a fact across
peers is rows, a `Section kind="list"` or a table; recognising and opening a peer is a tile (`kind="tile"`), several of which
stand in a `Grid kind="cards"`. Equal labelled cards that each repeat a heading are neither. A surface never stands inside
another surface. Measure: lint `card-is-object` in `@starci/eslint-grammar-core` refuses a `body` card whose only content,
through layout wrappers, is a collection, a form or a placeholder (a `DataTable`, a `Section kind="list"`, a `DescriptionList`,
a `DisclosureList`, a `Form`, a `Fieldset` or fields, an `EmptyNotice`, a chart), and passes `measure="formCompact"`. See
[components/card.md](components/card.md).

### COLLECTION-4 A collection stands flat in a Section
A collection is never in a card: it stands flat in a `Section`, which carries its title, count, fact, one page command and its
`caption`. Each collection has one owner:

| collection | owner |
| --- | --- |
| rows of peers | `Section kind="list"` (COLLECTION-1) |
| records compared across columns | `Section`, its `filter` row, a flat `DataTable` and the `DataTable footer` pager ([components/list-table.md](components/list-table.md) `list-table.choose.role:table`) |
| facts of a page or a region | `Section` + `DescriptionList isDivided`; the facts of ONE object stay a `DescriptionList` in that object's card body |
| key figures | `Section kind="figures"`, the ribbon ([../grammars/contract.md](../grammars/contract.md#section)) |
| disclosures | `Section` + `DisclosureList` |
| a choice of one or several options | `RadioGroup` or `CheckboxGroup` (options with a `description`) in a `Section` or `Form`; a row with an end control is a `Section kind="list"` row's `control` |

A standalone chart is the surface the same way: its title a `Section title` above it and one `Section caption` below. Measure:
lint `card-is-object` (COLLECTION-2); lint `rows-in-card` refuses a `DescriptionList` or `DisclosureList` that stands neither in
a `Section` nor in the body of an object card.

### COLLECTION-3 A group identity shows its members
A group or conversation identity is one composite of its members' identities, distinguishable from one person's,
with a count when members overflow; the composite carries the group meaning, so no group glyph sits beside the
name. Each identity is an uploaded image or the grammar's generated initials. An agent identity adds the grammar's
bot badge. The family owns renderers, cells and sizes.

### COLLECTION-5 One toolbar per collection
A collection has exactly one toolbar, in the `Section` that owns it, and it carries the whole way the reader narrows and acts on that
collection, in this order: the view picker, the count, a compact search, the filter and the create action. A view picker (all, a
status, a saved view) is a `Select`, never a second tab strip under the page's tabs; `Tabs` stay for panels (the page's own
destinations), not for views of one collection. On desktop the toolbar is one row; on 390 it is two lines (the picker with the
count above, search, filter and the create action below), never a third strip, and the create action keeps its place. A second
toolbar, a search that stands apart from the filter, or a view strip repeated under the tabs is one fact on two carriers.
Reason: the shop-table case, where the view picker was drawn as a second tab strip under the page tabs, so two navigation strips and a search row stood before the first record (LAYOUT-6). See [components/list-table.md](components/list-table.md).

## 6. Layout

Choice `grid.choose.content`: which track owner carries the content.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| week | dated events or appointments belong to seven consecutive day regions | `Grid kind="week"` with an accessible region `label` and seven ordered days, including empty days | one-column agenda in a narrow container, seven tracks at the medium container width |
| week-summary | each of seven consecutive days reports a daily metric summary | `Grid kind="week-summary"` with an accessible region `label` and seven ordered days | one, four and seven tracks by container width, same reading order |
| sections | independent named working regions retain separate tasks and heading owners | `Grid kind="sections"` of those regions | one column, two equal tracks in a wide workspace viewport; a theme may draw a hairline between the two tracks with `--starci-core-grid-section-divider` (0.42.0, default none), never before the row-start column nor in one column |
| pair | two equal portions form one reading or comparison unit | `Grid kind="pair"` with required `leading` and `trailing` slots | one column, two equal tracks when their container supports both measures |
| featured | one central focus has two symmetric secondary support groups | `Grid kind="featured"` with required `leading`, `featured` and `trailing` slots | one reading column or three symmetric tracks, preserving source order |
| cards | peers are recognised and opened as a collection | `Grid kind="cards"` of tiles (0.37.3: the card gap, 12 phone / 24 from 48rem, `gap="inline"` for tiles; `align="stretch"` by default so a row stands at one height; a cell that is a `Section fill` lets its `SurfaceCard height="fill"` or `DataTable fill` fill it; `pair` and `featured` slots stretch too) | `card.choose.role:tile` |
| form | neighbouring fields share aligned control rows | `Grid kind="form"` | `text-field.choose.columns` |
| main-rail | one task has subordinate support beside it | `Grid kind="main-rail"` | one primary and one rail |

Each kind's gap holds the proximity law ([presentation](presentation.md#space) G6): `cards`, `week` and `week-summary` inline (8),
`sections`, `pair`, `featured` and `form` section (24), `main-rail` region (32). These kinds name content relations. An independent working region is not one portion of a reading pair, and a
featured focus is not a primary task with an asymmetric rail. Their types own the slots and their styles own every
threshold and gap; an author does not choose a kind for a desired width or breakpoint.

### LAYOUT-1 Which regions exist
One task with no support is one region. Support the reader consults alongside the task is a rail with a named
role. Every further region names its task role. A list, detail and info screen is one `PaneGrid` of `Pane`s, mounted as
`Page chrome="panes"` on a tabbed app page; panes touch, one divider stands between neighbours, and a pane that
disappears takes its divider with it. Each pane's content is `PaneSection` bands at the pane's content inset. Options that apply to a whole batch
and rarely change sit closed in one disclosure (a `Section` with a `DisclosureList`) below the main task, its summary saying in words who the result
is for. In a panel offering several sources, each source sits with its own kind (a cloud picker a secondary button under
the drop zone, links a list of inputs with an "add" command), with no separate staging step.

### LAYOUT-5 One axis in a report, panes in a workspace
A page is one of two frame types, declared by `Page layout="report" | "workspace"` (which `chrome` carries: `standard` is a report, `panes` and `bleed` are workspaces; a `layout` that disagrees with its `chrome` throws `PAGE_LAYOUT_CHROME_MISMATCH`), and never a mix. Ask: is there a persistent selection column or a
full-height chat or editor? Then B, else A.

- **A, report page** (`chrome="standard"`): the page well is pink and its sections and object cards stack in ONE direction, a vertical column 24 apart.
  Side by side only for sibling cards of the same role and height (figure cells, short equal cards). A card beside a column of
  other cards is two axes and is refused, and so are cards of different kinds in one row. Lint `starci-grammar/layout-two-axis`.
- **B, workspace page** (`chrome="panes"`, or `"bleed"` for a full-height chat or editor): a grid of panes split by dividers. Side
  panes are white surfaces at full height, never cards. The main pane may contain a pink well that follows A inside it.

Examples. Report: Tổng quan, Bàn làm việc, Kết nối, Tri thức, the runs list. Workspace: /chat, Đầu vào, Lượt chạy with the
workflows rail, the run detail, the settings page with a chat, the graph editor.

### LAYOUT-2 Every region's owner is a published composition
Tracks, slots and bounds belong to a published composition (`WorkspaceShell`, `Page`, `Grid kind="main-rail"`, `PaneGrid`); the spec
names only its props. No vendor grid and no width arithmetic owns a region; a missing composition is a gap. A family
may replace a region's renderer, never its role or its number of owners.

### LAYOUT-3 One owner per region and per scroll axis
Each region has one composition owner. Each scroll axis has one named owner; a nested scroller differs in axis or
task. Content wider than its column has exactly one horizontal scroll region; the page never scrolls sideways.

### LAYOUT-4 Regions that leave normal flow
Sticky, fixed, drawer and floating regions use their composition's contract and return to flow below its narrow
width. Order differences across widths are composition only; DOM, reading, focus and action order never change.

### LAYOUT-6 No two stacked navigation strips of the same level
Navigation of one level appears once: the page tabs, a view strip, a breadcrumb trail and a step list each stand alone in their band.
Two strips of the same level stacked under one another (page tabs over view tabs, two tab rows, a segmented bar under tabs) are one
fact on two carriers, and the lower one becomes a `Select` in the collection's toolbar (COLLECTION-5) or a panel inside the tab. The
shop-table case is the reason: a view strip drawn under the page tabs.

### FE-APP-SHELL-1..6 App chrome
| Id | Rule |
| --- | --- |
| FE-APP-SHELL-1 | One shell owns the frame: a fixed viewport, a persistent navbar with one full-width separator, an optional sidebar; sidebar and main scroll independently; the document never scrolls; regions sit flush. Inline navigation shows on wide viewports only, with a leading drawer below them. |
| FE-APP-SHELL-2 | Every bar control shares the bar-control height ([scale.md](scale.md)) and one glyph size. The workspace identity is one named control; search is named and has a visible shortcut hint. The bar is 64 high by default, 56 `compact`, or `density="adaptive"` (0.46.0): 64 from 48rem and 52 below it, its controls staying the md 40; no law fixes the bar height (`DNA-COMMON-BAR-ONE-HEIGHT` measures the controls; evidence NIVO canvas `01-shell-app.html:71`, `:186`, `:216`). |
| FE-APP-SHELL-3 | The right cluster runs language, theme, notifications, account; notifications are required only when the shell has a notification source (its file calls a hook that reads notifications, `use…Notification…()`), so a shell with none (a platform-admin shell with no workspace) runs language, theme, account and draws no placeholder popover. Sign-out and every destructive menu entry carry danger. A public site's bar (flow shell, no account) is site chrome: brand, links, language, sign-in, one call to action, still at the bar-control height, and it is `TopBar fit` (`navigationItems`, `actionItems`, `overflowLabel`), never hand-built: what does not fit the row moves into the three-line menu, no label wraps and no control is under 40px at 320, 360 and 390 ([presentation.md](presentation.md#controls-and-headers-on-a-phone) PHONE-1..4). |
| FE-APP-SHELL-4 | On compact widths the navbar keeps identity, search, notifications and account; a row of the same band height below it holds only the named navigation opener; the drawer opens from the leading edge, holds all groups plus language and theme, traps focus, closes on destination, backdrop or Escape. No tab row. The one bottom bar is the Grammar `BottomNav` as the `compactNavigation` of the `WorkspaceShell` (two to five places, its more place a bottom sheet; the phone slot, drawn below 48rem); a hand-made bottom tab bar and a `BottomNav` anywhere else are refused (R316). |
| FE-APP-SHELL-5 | A create action lives on the page whose content it changes, never in the navbar. |
| FE-APP-SHELL-6 | A collapsed sidebar is an icon rail: one icon-only item per destination, tooltip labels, count badges, persisted per user, settings-type groups at the bottom. |

Lint: `navbar-control-size`. The shell's component and prop names are the grammar contract's
([../grammars/contract.md](../grammars/contract.md)).

## 7. Responsive

### RESPONSIVE-1 What survives
The compact branch keeps the meaning, the commit and the current state in one readable flow; support stays
reachable. Content recomposes instead of clipping, squeezing or scrolling the page sideways. A hidden branch is
absent and replaced by a trigger with controlled state and focus return. A form inside a narrow owner (drawer,
rail, dialog) stays one column at every viewport; field columns come only from Grammar's `Grid kind="form"`, whose
container query reads its own width, never the viewport.

### RESPONSIVE-2 The query owner is named, never the device
Every branch names one owner: a composition's container query or its viewport query. No generic tablet
breakpoint governs a region a composition owns. Values belong to the composition.

### RESPONSIVE-3 One branch at a time
Exactly one form of a composition exists at a time; the other leaves no layout or accessibility footprint.

### RESPONSIVE-5 The page tiers
Grammar owns every breakpoint of a page, through `Page layout` and `PaneGrid`; an app writes no media query. Desktop is from 1280, tablet 768
to 1279, phone below 768. Type keeps its roles at every tier (the ten type roles of [presentation](presentation.md), 0.54.0): no size changes with the width. Page inset 32 / 24 / 16; the gap between a report page's cards 24, 16 on a phone
(`--grammar-card-gap`; both are 12 on a phone until the spacing scale 0 4 8 12 24 32 gains a 16 step); content at most 1280 wide (`--grammar-content-max`).

| Piece | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Report page (A): key figures | the ribbon answers its own width, not the tier ([../grammars/contract.md](../grammars/contract.md#section) Section) | the same | the same |
| Report page (A): sibling equal cards | side by side | stacked | stacked |
| Report page (A): DataTable | table | table | a row list: the primary column is the title, the other columns merge into the description line (`priority="low"` columns fold under `collapseBelow`) |
| Report page (A): tab strips | one line | one line | scroll horizontally |
| Workspace (B): panes | selection pane, main pane and right aside all visible | the aside becomes a Drawer opened by a header button | one pane at a time: choosing in the list opens the detail full screen with a back button; chat is the thread full screen with the composer pinned to the bottom; the aside is a bottom sheet |
| App sidebar | collapses to icons | icons | a menu button (the drawer) |
| A page-level primary action | in the header | in the header | pinned to the bottom (`PinnedActionBar`) |

### RESPONSIVE-4 Pressure that is not width
Zoom, text scaling, translation growth, the virtual keyboard and safe areas recompose the layout; no fixed text
height carries them. The spec names the longest label, and expanded states (errors, open panels) are decided
together with the resting state. Fit is checked twice: candidates are compared at every coverage viewport
before building, and the audit measures every viewport after.

## 8. Taste

### DISCIPLINE-1 Reduce before adding
Every element names its job for the page's one job; an element with no job is removed, not made quieter. Budgets:
hairlines per card `budgets.hairlinesPerCard`, badges per entity `budgets.badgesPerEntity` (operational state
first, then one exception; never a badge restating the title or a plain fact), under a title one supporting line
and one meta line (`budgets.linesUnderTitle`). A need no grammar component meets is a grammar proposal, never an
inline build.

### DISCIPLINE-2 Numbers are the heroes of an overview
Each lead figure is the largest text in its cell, at the leading-value rank in the default tone; its label is
smaller and muted; its unit is lighter than the value; figures compared across cells or updated in place use
tabular numerals (`Text tabular`). A figure never takes a status colour. A row of key figures is a `Section
kind="figures"`, the ribbon, at most `budgets.ribbonCells` cells, never a card and never a painted slab.
Type counts: `type.region`, `type.view`. Proof: TASTE-6.

### DISCIPLINE-3 One signature moment per page
The spec names the page's one signature moment: the brand art band where the brand record allows its mascot on
this surface, otherwise one declared motif, otherwise none. It is never the focal point unless the page's job is
the image, it counts in the accent budget, and it never appears on errors, tables, loading states or forms other
than the steps of the app's first-run wizard. A first-run wizard is the onboarding flow the spec declares as such
(the one flow a new account walks before its first real page, its steps a `Stepper`); on its steps the mascot may
stand small (`mascot.choose.size`: `sm` or `md`, never `hero`), in its own place beside or above the form and never
over a field, a description, an error or an action. Every other form, including a later setup or settings flow,
carries no signature moment. A promotional strip never sits on a working page. Proof: TASTE-8, BRAND-2.

### DISCIPLINE-4 Generated images carry their provenance and show no real person or brand
An AI-generated image lives in the app's statics folder (`statics/` at the repository root, [project/statics.md](../project/statics.md)) with a
sibling `<name>.prompt.yaml` holding `prompt`, `model`, `seed`, `ratio`, `aiGenerated: true` and `approvedBy`, so it can be
regenerated and traces to the person who approved it; the app reads it through a statics key, never a committed copy. An image
generated at runtime is a draft in object storage and is public only after a person approves it. It never shows a real person or
a third-party brand. Proof: BRAND-2; judgement (no gate reads the files yet).

## 9. Coverage

### COVERAGE-1 What the spec enumerates
| Inventory | Each entry names |
| --- | --- |
| actions | pointer route, keyboard route, every state (enabled, disabled, pending, settled), the settlement of every pending path |
| regions | its composition owner and the family idiom it follows |
| responsive branches | exactly one query owner |
| states | the meaning before the carrier; no carrier on two meanings |
| layers | the grammar output, the family delta and the app delta separately |
| surface class | exactly one of `console`, `form`, `landing`, `catalog`, `reader` |

The surface class is the key every banded threshold reads (density, step budget, navigation depth, accent
allowance). A spec with no class leaves those rules unjudgeable.
