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
| explains, or states a neutral fact | `Text`, default role, no state |
| reports an outcome authority settled | `Badge` or another state owner |
| reports a verified measurement 0-100 | `Progress` / `Meter` with its label and value |
| the principal figure of an overview cell | `Text` at the leading-value rank (FONT-5) |
| feels important but matches no role | name the job in the spec first; no type utility stands in for a rank |

### HIERARCHY-2 One anchor per region
Each region has exactly one strongest semantic anchor (`SectionHeader`, `Heading` or a labelled surface). A status
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
handler. A destination may look like a button; it stays an anchor and takes the same intent as the command it
stands for. An anchor with a click handler and no address does not exist. The dominant action keeps a visible text
label; glyphs only support it.

### CTA-3 Disabled, pending and skeleton are three conditions
This is the one statement of this distinction; other rules cite it.

| Condition | Carrier | What it looks like |
| --- | --- | --- |
| the work cannot start (permission, prerequisite) | `isDisabled` on that control | inert |
| this control accepted work that has not settled | `isPending` on the initiator only | label and box unchanged, busy exposed, second press refused |
| content never resolved, no action taken | `isSkeleton` on the content owner | the resolved anatomy as inert geometry |

Pending is never page-wide, never on a peer that started nothing, and never swapped for `isDisabled`. A recovery
inside an empty or failed region forwards pending through that region's owner (`EmptyNotice.isActionPending`).
An owner that publishes no pending prop is a grammar gap, not an app substitute.

### CTA-6 Intent from facts
The app never chooses a button's look. It declares three objective facts from the spec, and the grammar resolves
the variant from the declared intent and the placement it reads from context.

| Fact | Values | Decides |
| --- | --- | --- |
| consequence | none, neutral, negative, destructive | whether it is a way out, an ordinary command or destructive |
| rank in its decision | next, alternative, way-out | whether it is the decision's commit |
| step (destructive only) | entry (opens the confirm, or removes an unsubmitted row), confirm (the final irreversible press) | soft or solid danger |

| Facts | Intent |
| --- | --- |
| rank next, consequence neutral or negative, the view's decision | `commit` |
| a real alternative in the same decision (Reject beside Approve) | `alternative` |
| consequence none (Cancel, Close, Back, Skip, Not now) | `dismiss` |
| a command that is not part of a decision (Edit, Export, Details), any per-item command, a next step outside the view's one decision | `neutral` |
| consequence destructive | `destructive` + `step` |

The label word never decides: "Cancel offer" is destructive; "Cancel" that changes nothing is `dismiss`. A
reversible negative outcome (decline, reject an application) is not destructive.

Placement (`decision`, `item`, `chrome`) is read by the grammar from the surrounding composition, never declared
by the app. The intent x placement -> variant map is grammar data, declared once by the grammar contract
([../grammars/contract.md](../grammars/contract.md)) and realised by each family. Its logic, which every family keeps: only `commit` in a
decision reaches the strongest emphasis; the same intent repeated per item drops a step, so a list never shows a
column of strong buttons; destructive is soft at entry and solid only at confirm.
Lint: `starci-fe/button-intent-required`, `starci-fe/button-no-variant`.

### CTA-1 One commit per view
A view (a page, or an open modal overlay; the page behind a modal is inert) has exactly one `commit`. It is the
next step of the page's one job. Every other next step on that view is `neutral`. While a collection is empty, its
`EmptyNotice` owns the command as the commit and the header omits it; once content exists the header owns it.
Equal-consequence peers get no commit at all: no paint breaks a tie. A landing may repeat its one conversion
command once, never in the same viewport (`budgets.commitPerView`).
Peer choices are not buttons: choosing among values is `Tabs`, `SegmentedControl`, a selectable `TagGroup` or a
`ListBox`, chosen by [components/tabs.md](components/tabs.md), and no commit sits among them.
Lint: `starci-fe/single-commit-per-render`, `starci-fe/no-commit-in-collection-item`.

### CTA-4 Destructive needs its own authority
Destructive is `danger-soft` at entry and solid `danger` only at confirm, inside an `AlertDialog` that holds no
commit and puts initial focus on `dismiss`. Stored data needs that confirm; an unsubmitted row (a pasted link, a
queued file) is removed at once by a `danger-soft` icon button named for screen readers ("Remove link 2"). The
grammar's danger treatment is the only red on a destructive control; a destructive verb on a neutral or
alternative look is a defect. Lint: `starci-fe/destructive-confirm-in-dialog`,
`starci-grammar/destructive-menu-entry-needs-danger-tone`.

### CTA-5 Group order
A decision group runs **way out, alternative, commit**: `dismiss` first, the commit last, as separate buttons at
the inline gap (GAP-2). The order is identical at every width; when the group stacks, the commit lands last,
nearest the thumb. A decision and its way out never share a `ButtonGroup` (see
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
indicator geometry, underline). A destination in body copy is identifiable at rest. Proof: COLOR-3.

### ACCENT-4 An accent fill states a real measurement
A progress fill presents a verified value from authority and nothing else; an unresolved value is a skeleton; a
decorative or ranking bar carries no progress semantics; the fill states the measurement and a separate owner
states any outcome.

### ACCENT-5 Status hues and notices report authority
Success, warning and danger appear only where authority reports that state, never as a category, a peer marker
or decoration. A figure that reports a state keeps the default tone with a toned `Badge` beside it. Status is
never a text colour choice. A notice is the grammar `Alert`, never a hand-built row and never an `IconTile` posing
as its indicator: on the canvas it takes the default `surface` appearance; when it belongs to a band, row or step
it takes `soft`. An informative soft notice spends accent and counts in the budget. The Alert's action variant per
tone is contract data. See [components/toast-alert.md](components/toast-alert.md).

### ACCENT-6 Budget and the one strong mass
About nine tenths of the painted content area is neutral (canvas, surfaces, foreground, muted, separators);
accent fills, soft grounds and accent text together stay under `budgets.accentArea`. The count of strongest
treatments is the same in every state and at every width. The commit is the one accent mass the eye finds first:
no second full-strength painted slab (accent, or an inverted ink band) shares a working page's first screen with
it, and figures, headers and summaries stay on neutral surfaces. A full-strength slab carries no copy and no
control (SURFACE-6), so it is never a KPI band; it is used only as the page's signature moment (DISCIPLINE-3), on
an overview or an entry page. Proof: TASTE-5.

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
component in skeleton mode, never a separate generic layout. A collection shows `budgets.skeletonRows` rows unless
its size is known. A failed region fails in place (its `EmptyNotice` with a safe retry, or a soft negative
`Alert`); a failed route keeps its chrome and puts one negative `Alert` where the first region would be. Each route
ships its own loading and error views. Lint: `starci-fe/no-resting-twin-component`,
`starci-fe/no-placeholder-prop`.

### FEEDBACK-1 Correct at the nearest owner
A field failure lives on that field (`errorMessage` plus `isError` on the same fact), exactly once; standing
guidance is a `hint` that does not come and go with validation; the entry survives revalidation.

### FEEDBACK-2 Recover at the smallest owner
A failed or empty region recovers through its own `EmptyNotice` action, scoped to the failed operation; an unsafe
repeat (a purchase) becomes a distinct safe operation; work outside the region survives. An empty drawing (map,
chart, graph) still renders what is known, with the notice as the card's last band.

### FEEDBACK-3 Claim only after settlement
Pending clears on a real settlement; the result names the outcome that arrived; one `live="polite"` owner
announces a non-urgent result (`assertive` only for a real interruption); a result that matters later has a
durable owner. Transient confirmations are toasts; see [components/toast-alert.md](components/toast-alert.md).

## 5. Collection

### COLLECTION-1 A list of entities is a section, never a card
Three or more of one kind sit in a page section under its own heading; title, count, filter and section action
belong to that heading region. No card encloses the rows. A published collection container is used where one
exists (see [components/list-table.md](components/list-table.md)); none existing is a grammar gap, never a
substitute card. Several values of one kind entered by the user are one single-value field per row with its own
remove action and an "add another" command, never a "one per line" textarea.

### COLLECTION-2 A card is one subject
A card presents one entity or one summary of one subject. Several kinds of content of that subject are bands of
the same card divided by separators, never inner cards. Comparison is equal rows in one section, not equal cards
that each repeat a heading. See [components/card.md](components/card.md).

### COLLECTION-3 A group identity shows its members
A group or conversation identity is one composite of its members' identities, distinguishable from one person's,
with a count when members overflow; the composite carries the group meaning, so no group glyph sits beside the
name. Each identity is an uploaded image or the grammar's generated initials. An agent identity adds the grammar's
bot badge. The family owns renderers, cells and sizes.

## 6. Layout

### LAYOUT-1 Which regions exist
One task with no support is one region. Support the reader consults alongside the task is a rail with a named
role. Every further region names its task role. A list, detail and info screen is one joined surface with vertical
dividers; panes touch, and a pane that disappears takes its divider with it. Options that apply to a whole batch
and rarely change sit closed in one disclosure card below the main task, its summary saying in words who the result
is for. In a panel offering several sources, each source sits with its own kind.

### LAYOUT-2 Every region's owner is a published composition
Tracks, slots and bounds belong to a published composition (shell, primary-rail layout, chat workspace); the spec
names only its props. No vendor grid and no width arithmetic owns a region; a missing composition is a gap. A family
may replace a region's renderer, never its role or its number of owners.

### LAYOUT-3 One owner per region and per scroll axis
Each region has one composition owner. Each scroll axis has one named owner; a nested scroller differs in axis or
task. Content wider than its column has exactly one horizontal scroll region; the page never scrolls sideways.

### LAYOUT-4 Regions that leave normal flow
Sticky, fixed, drawer and floating regions use their composition's contract and return to flow below its narrow
width. Order differences across widths are composition only; DOM, reading, focus and action order never change.

### FE-APP-SHELL-1..7 App chrome
| Id | Rule |
| --- | --- |
| FE-APP-SHELL-1 | One shell owns the frame: a fixed viewport, a persistent navbar with one full-width separator, an optional sidebar; sidebar and main scroll independently; the document never scrolls; regions sit flush. Inline navigation shows on wide viewports only, with a leading drawer below them. |
| FE-APP-SHELL-2 | Every bar control shares the bar-control height ([scale.md](scale.md)) and one glyph size. The workspace identity is one named control; search is named and has a visible shortcut hint. |
| FE-APP-SHELL-3 | The right cluster runs language, theme, notifications, account. Sign-out and every destructive menu entry carry danger. A public site's bar (flow shell, no account) is site chrome: brand, links, language, sign-in, one call to action, still at the bar-control height. |
| FE-APP-SHELL-4 | On compact widths the navbar keeps identity, search, notifications and account; a row of the same band height below it holds only the named navigation opener; the drawer opens from the leading edge, holds all groups plus language and theme, traps focus, closes on destination, backdrop or Escape. No tab row, no bottom tab bar. |
| FE-APP-SHELL-5 | A create action lives on the page whose content it changes, never in the navbar. |
| FE-APP-SHELL-6 | A collapsed sidebar is an icon rail: one icon-only item per destination, tooltip labels, count badges, persisted per user, settings-type groups at the bottom. |
| FE-APP-SHELL-7 | A conversation panel: title, nested search, a filter row, then one list sorted by latest message; rows aligned to the panel's content edge; each row shows identity, name, time, last message and unread count; the open row is highlighted. |

Lint: `starci-grammar/app-shell-frame`, `navbar-control-size`, `navbar-cluster`, `no-shell-bottom-tabs`,
`no-navbar-create`. The shell's component and prop names are the grammar contract's
([../grammars/contract.md](../grammars/contract.md)).

## 7. Responsive

### RESPONSIVE-1 What survives
The compact branch keeps the meaning, the commit and the current state in one readable flow; support stays
reachable. Content recomposes instead of clipping, squeezing or scrolling the page sideways. A hidden branch is
absent and replaced by a trigger with controlled state and focus return. A form inside a narrow owner (drawer,
rail, dialog) stays one column at every viewport; field columns come only from a container query on the form's
own owner.

### RESPONSIVE-2 The query owner is named, never the device
Every branch names one owner: a composition's container query or its viewport query. No generic tablet
breakpoint governs a region a composition owns. Values belong to the composition.

### RESPONSIVE-3 One branch at a time
Exactly one form of a composition exists at a time; the other leaves no layout or accessibility footprint.

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
smaller and muted; its unit is lighter than the value; figures compared across cells use tabular numerals (or the
gap is recorded). A figure never takes a status colour. A row of key figures is an ordinary card with a stat strip,
at most `budgets.ribbonCells` cells, never a bare strip on the canvas and never a painted slab. Type counts:
`type.region`, `type.view`. Proof: TASTE-6.

### DISCIPLINE-3 One signature moment per page
The spec names the page's one signature moment: the brand art band where the brand record allows its mascot on
this surface, otherwise one declared motif, otherwise none. It is never the focal point unless the page's job is
the image, it counts in the accent budget, and it never appears on errors, forms, tables or loading states. A
promotional strip never sits on a working page. Proof: TASTE-8, BRAND-2.

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
