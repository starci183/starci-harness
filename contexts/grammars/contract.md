# The grammar contract

Every grammar implements one contract, so a new grammar can be added without touching the others and two apps on
the same grammar come out the same. The data a gate checks is [contract.yaml](contract.yaml); this file is the
reasoning behind each entry. It says what a role IS in every grammar; [ui/components](../ui/README.md) says
WHEN to use it; a grammar file ([core](core.md), [offset-pop](offset-pop.md)) says how that grammar fills it.

## What a grammar provides

- **A root and a scope.** One `GrammarRoot` replacement that stamps `data-grammar-family`, one stylesheet that
  imports Common first and writes only inside its own layer and scope. A grammar is a scope because that is the
  only way two grammars can share every renderer: paint changes, the DOM never does. Overlay and toast mechanics
  are Common's ([common](common.md#one-root)); a grammar inherits them and never re-portals.
- **Names that describe the UI role.** A component, prop or token name says what it does as a layout or UI role
  (`PaneGrid`, `SurfaceCard`, `Rail`), never a product feature (chat, customer, order, invoice), so any product
  can reach for it. The grammar is a generic UI/UX layer (ruling `grammar-names-are-generic`).
- **The token roles, read from HeroUI and set by the app.** The HeroUI semantic variables are the interface between
  Common's anatomy and the paint. The structure is the same in every app, the paint is the app's (ruling
  `app-owns-theme`): an app sets HeroUI's tokens in its own CSS and every part follows, and a grammar declares no token
  on its root, so no host value loses to the family. A grammar publishes its default palette as an optional `theme.css` of
  HeroUI tokens (`DNA-COMMON-TOKENS-BOUND` reads it with the app's) and writes no private colour name. Spacing and control
  heights are Common's tokens and never a grammar's: a grammar that re-spaced or resized would change layout, and layout
  is the same in every grammar.
- **A DNA module of one shape.** The same keys in every grammar make grammars comparable and let a generator
  read any of them; they name the family's defaults, which an app may replace. Colour is per theme because dark is
  its own palette, not an inversion. The key `accentText` is the token `--accent-soft-foreground`: the accent painted as
  text, because a fill colour that reads well behind text rarely reads well as text, and the accent alone stays `--accent`.
  `accentSoft` is the tint both `accentText` and `muted` stay legible on. Intent, arrangement and the item defaults are
  Common's, so they are not in a grammar's DNA.
- **A lint factory**, even when it only re-exports Common's checks: a grammar without one would give its apps
  zero grammar rules without anyone noticing.
- **Conformance**: every universal rule id is inherited or carries family evidence that names the mechanism.
  Accounting does not prove behaviour, so a departure also needs its reason in the grammar's file.
- **Vendor parity** in one mode, `strict` or `custom` ([vendor/parity.yaml](../vendor/parity.yaml)): strict
  keeps HeroUI's paint and arrangement and changes tokens only; custom may re-skin and re-arrange. Neither may
  change anatomy, roles, keyboard or focus.
- **Its DNA laws held on every render.** `mustKeep.common` holds in every grammar and `mustKeep.<id>` in that
  grammar only; each entry is a law and the measurement a DNA gate performs (layer 1 of
  [README](README.md#three-layers)). A role lists its ids under `dna`. A grammar that departs from a common law
  does not delete it: the departure is a decision with family evidence, and the law moves from `common` to the
  grammars that keep it.

## The shared scale

A row of controls reads as one object, so its controls share one height. The ramp has the vendor's names and
three steps in equal increments (reference 32, 40, 48 px), held at every breakpoint (ruling `control-height-40`);
`control` is not a fourth height but the `md` height held for bar controls, set by the bar composition and never
by an app (decision D-3). HeroUI steps controls down on desktop and draws fields one step shorter than buttons;
the contract removes both, because mixed rows are exactly where they disagreed
([vendor/heroui](../vendor/heroui.md#how-sizes-align)). Fields have one step, `md`. Badges and glyphs keep their
own smaller scales: they label, they are not pressed. Which step a control takes is the choice
`scale.choose.step` in [ui/scale](../ui/scale.md); what every step measures is `DNA-COMMON-CONTROL-*`. The
heights are Common tokens (`--grammar-control-height-*`, decision D-4).

**Drawn height and target are two facts** ([ui/scale](../ui/scale.md#drawn-height-and-target-size-are-two-facts)):
the box is the ramp, the hit area meets its floor without redrawing the box (`DNA-COMMON-TARGET-COARSE`,
`DNA-COMMON-TARGET-FINE`). The floors are Common tokens (`--grammar-target-*`).

**Corners are roles.** HeroUI derives every corner from `radius` and `field-radius`, and a Button's corner is
three times `radius`, so whether a Button is a pill follows from the grammar's radius, never from a per-button
choice. The grammar publishes the corner roles an app may name (`tiny`, `compact`, `control`, `surface`, `hero`,
`pill`) as `--grammar-radius-*`, each set from its base radius; an app never writes a literal corner, which would
freeze one grammar's value into every grammar. One corner may stand out: a SurfaceCard or MediaFrame names it in
`accentCorner` (a logical corner, `start-start` to `end-end`), drawn at the Common accent radius
`--grammar-accent-corner` while the others keep the family's radius (ruling accent-corner); an app never rounds one
corner itself.

## Intent x placement -> variant

The app states what a command does; the composition states where it sits; Common's map turns the pair into a
HeroUI variant. The app never passes `variant`.

- `intent`: `commit` (the step forward), `alternative` (a real other option), `dismiss` (no consequence: cancel,
  close, back), `neutral` (not part of a decision), `destructive` with `step` `entry` (opens the confirmation) or
  `confirm` (the irreversible press).
- `placement`: `decision` (form, dialog or drawer footer, page-header decision, empty state), `item` (once per
  collection item), `chrome` (toolbar, top bar, panel header); an icon button also knows `navbar`. The composing
  Grammar component sets it, never the button.

The map walks HeroUI's emphasis ladder (filled accent; neutral fill with accent text; neutral fill; border;
nothing; and the danger pair):
- emphasis follows consequence, so `commit` takes the top step where a decision is made;
- a command repeated per item drops a step, because a column of primaries is noise and an item never holds the
  view's commit;
- `neutral` is quiet everywhere and quietest where it repeats;
- `destructive` is the soft danger at entry and the solid danger only at confirm, inside the dialog that
  confirms it, dismiss first and focused.

The exact map is Common data: `intent` in the DNA modules, resolved by `src/core/buttonIntent.tsx`, generated
into the package's `docs/button-intent-props.generated.md` (decision D-6 makes it one Common module).

## Roles

Each heading is one role of [contract.yaml](contract.yaml) `roles`.

### Card

Card is one subject on its own surface, and a surface never stands inside another (a card, a `Pane surface`, a `Dialog`,
`Drawer`, `AlertDialog` or `Popover`): the card has one depth, raised, and no nested edge exists. Its body is a
compiler-checked `kind`: `body` (the default, the app's children), `figures`, `list`, `accordion`, `bands` and `tile`. A
list needs its `items` and an `empty` state, `wholeAction` exists only where the card holds no inner control, and `bands`
stacks full-bleed faces (any number of `body`, `figures` and `media`, then at most one collection, last) divided by the n-1
seams the shell draws instead of nesting cards or a `Divider`; `measure` caps a form card's width so the page does not. Highlight is a claim
that this card is the next step, so one per view. `treatment` is the face: `surface`, `soft` (the brand's light
tint, `accentSoft`, under the default foreground) or `ink` (the brand ink, the signature band); `soft` and `ink`
carry the decorative artwork slot, `ink` also the motif. A painted treatment rebinds the whole surface pair on its
ground (surface, foreground, muted, separator, border and the accent and tone text tokens), because a child that
paints its own circle or ring from the surface token and its text from a foreground token stays legible only while
both move together. A grammar decides the material (fill, edge, radius, the ink and its inks); the slots, the kinds, the
treatments' grounds and the refusal of nesting are the same everywhere.

Where the name sits follows the card's kind, in every grammar (ruling `card-label-by-kind`). A card that heads a section
carries its label outside the material, an unpainted row above it, because the label names what follows. A tile, one of
several peers repeated in a grid, carries its name inside, beside its logo or mark, because the tile is the thing named and
an outside label would float away from it. A docked region is a `Pane`, never a card. No prop moves the name, and a family
paints it but never moves it.

A row of key figures is `kind="figures"`: touching cells (gap 0), each a box in the card at the nested inset (8), divided by lines, not gaps - a vertical line between the cells of a row and a horizontal line between rows, running to the strip's edge and never on its outer edge. The strip answers its own width (container query, no script): one row from 40rem, 2 x 2 from 18rem, one column below, a last odd cell spanning its row, with the right line at every wrap. In a `bands` card it is a face and the shell's seam divides it from the next face (a Meter face, say). Its skeleton keeps the same cells and lines. The line colour is the family's separator (`--separator`, ink in Offset Pop), so dark mode follows the tokens.

A tile (`kind="tile"`) is one peer repeated in a `Grid kind="cards"`: its name stays inside. A compact identity has a
typed mark; a media identity has a typed `poster`, retaining the same frame for its image or localized absence text.
The poster reuses Image-owned data, aspect and fit. Supporting `facts` is plain text. One badge or a typed tuple of
up to three operational badges accompanies it. The primary `ItemAction` remains a native destination or command;
secondary commands use typed `menu` data. `wholeAction` excludes both inner action and menu, so nested interactive
targets do not compile. Loading keeps the poster and action geometry inert. A tile takes no `label`, `fact` or
`labelEnd`; its name and mark or poster carry its identity.

### Button

Button is a command (`onPress`) or a destination (`href`) drawn as a button; the kind decides semantics, the shape
only paints. Its variant comes from intent and placement, its size from the ramp: `sm`, `md`, `lg`, and `control`
in a bar. `pending` means this control accepted work: label and box unchanged, a second press refused.
`disabled` means the work cannot start, and its `disabledReason` says why in a tooltip on hover and keyboard focus
that is also the button's accessible description, since a disabled control is otherwise mute; `skeleton` means the
content never resolved. A grammar may repaint each vendor variant through its tokens and give the press its own
motion; it keeps the variant names, so the emphasis ladder means the same in every grammar. `IconButton` is the same contract drawn square or round at the step;
`FileButton` is an `IconButton` whose press opens the browser's file picker and reports the files; `TextAction` is the quietest command, set in text.
`IconButton.isPending` keeps its accessible name and box while drawing the native spinner, setting busy state and
refusing duplicate activation. `isLoading` remains unresolved content, not an action's progress.

### ButtonGroup

An action group is two to five peers of one intent acting on one object (zoom, align). The vendor joins them:
squared inner corners, collapsed borders, no press scale; the group forwards the vendor's size to every member.
Each action's `isPending` keeps its own label and geometry while drawing the native busy state and refusing another
activation. Group `isLoading` means unresolved content and keeps the whole fused skeleton inert. Icon-only members
follow the same `IconButton.isPending` contract. Neither pending nor loading overrides the vendor's joined corners.
A decision and its way out are not peers, so they are two buttons at the inline gap, never a group.

### Tabs

Tabs switch whole panels; each tab owns its panel. HeroUI's `primary` is a segmented pill on a soft track and its
`secondary` is an underline bar; the contract keeps those names one to one (decision D-2). Every tab bar, page tabs
and region tabs inside a surface alike, takes the underline, with the first label on the content edge, so Tabs have no
look to pass. A filter over a collection is a `FilterButtonGroup`, never a tab bar. The bar lands on the `md` height,
which is why Tabs have no size.

Each item accepts `isDisabled`, forwarded to HeroUI's tab: unavailable tabs retain the vendor's disabled semantics,
are skipped by keyboard traversal and cannot select or navigate their `href`. The controlled `selectedKey` still
owns the visible panel, including when every item is temporarily disabled.

### SegmentedControl

A segmented control is one value inside a form or a toolbar (period, audience, density), not navigation. Its
selected segment takes the soft accent fill, the paint of selection rather than of a command. It
publishes `sm` and `md`, default `md`.

### FilterButtonGroup

A filter button group is peer values that filter a collection which stays in place: `sm` toggle buttons on one row (a radio
group to assistive technology), one selected, an optional count per option. It never wraps: the fit is measured from the real
width, the options that do not fit go behind a "+n" button that opens a search list, and a chosen hidden option takes its place
in the row, so the selection is always seen. The first option stays. Selected paints the soft accent pair; the rest take the
surface. It replaces the selectable tag group, which no longer has a selection.

### Chip

A chip is a label, not a target, on two axes: tone (which settled fact) and emphasis. Its label starts with an
uppercase letter. A grammar's Badge is the vendor chip at soft emphasis and below the ramp, so status reads as
tinted text, never as a filled button-like shape; its `muted` tone drops the fill for a quiet marker.

`StatusDot` is a status drawn as a dot alone, static or `echo`, named by its `aria-label`; the dot and its size token are shared with `Badge isDot`, the status with its words, whose `isLive` makes it the state of a live feed.

A `TagGroup` holds values the user entered, to remove or to reorder, and has no selection: its tag is interactive and
keyboard reachable on the ramp at `sm` (the default: tag rows are dense) or `md` when its row holds `md` controls, and a
reorderable group moves tags by drag and by Alt+arrow keys and announces each move. Peer values that filter a collection
are a `FilterButtonGroup`.

### Input

A field is a label, a control, a description and an error slot, drawn in that order, HeroUI's: the label is the
accessible name and sits on the control, the description is standing guidance under the control, and the error
lives in the field's own slot last. Label and control stay adjacent so a row of fields can align on its controls:
`Grid kind="form"` lays fields in rows whose label, control, description and error are shared tracks, so neighbouring
controls stand on one line whatever their neighbours carry, and its columns come from its own width. Groups
(`RadioGroup`, `CheckboxGroup`, `Fieldset`) keep HeroUI's group order, their description before the options they
explain. Its look comes from context: `primary` on the canvas, `secondary` inside a surface, so a field never
vanishes into its surface; the app omits `variant`. A field has one step, `md`, so a field and its submit align and
mobile text stays at the size that prevents focus zoom.

### CopyField

A copy field is a read-only value the reader takes away: a field whose control is the value and, at its end inside
the frame, the copy action, at the height and in the anatomy of every field so it sits level with them in a row.
The value is a read-only textbox whose text is the whole value; a value too long for its box gives up its middle
under an ellipsis and keeps its end, because the end is what tells two keys or URLs apart, and the whole value
shows in a tooltip on hover and focus. A masked field is a secret: bullets and the last four characters, no
tooltip, and the clear value exists only in the app's `onCopy`, so the page never holds it. The action names
itself in the app's words; a copy confirms for about two seconds (glyph and name swap, announced politely), and a
refused copy is the field's error.

### Select

A select is a field whose control opens a list in a popover. It keeps the vendor's required trigger and popover;
the popover portals into the root so it keeps the grammar; its options are list rows. One step, `md`.

### Dialog

A dialog, an alert dialog, a drawer, a popover or a tooltip. Every modal overlay is named and closable, traps
focus, closes on Escape and returns focus to its trigger. A dialog's size is its maximum width, not a control
size. A drawer comes from an edge. An alert dialog confirms one irreversible decision: dismiss first and
focused, confirm last.

### Menu

A menu is a list of commands behind a trigger. Sections are separated by the vendor's separator; a destructive
item carries the danger tone because its consequence, not its label, decides. Arrangement (which side the
selection mark sits on, the leading glyph size) is the grammar's to declare.

### List

A list is rows of peers: a `ListBox` when picking is the task, `SurfaceCard kind="list"` when a standalone bounded list
reports on the page canvas, `Section kind="list"` when an existing surface owns the region or the list searches,
filters or pages, a data table when columns matter. The chosen owner carries one heading and accessible name.
n rows have n-1 seams, separators are full bleed, and rows and captions share
one content edge. A static row's description is one line, because the row is scanned; an option's description in
a `ListBox` wraps, because it is read before picking, and a list clamps it only by `descriptionLines`. A table row
with `href` is one link to its record; a column with `editor` hosts its field in the cell; `low`-priority columns
fold into the first column as stacked secondary text on a narrow table. The leading slot follows the ramp, so a
row's identity mark matches the controls beside it. A `ListRowData` title remains text; `href` turns that title into a
native `Link`, whose `onFollow` reports navigation to its owning region. Without `href`, `onFollow` is unrepresentable.
The title link and any row command or menu are separate targets, never nested. Loading shows the same rows at rest and
removes the title link.

### Link

`Link` is a native destination carried by text or one image. Its text form takes string `children`; its media form
takes `media` as the existing `ImageProps` data and a required accessible destination `label`, with no children.
The compiler rejects mixing the forms. Image owns aspect, fit, dimensions, provenance, load state and fallback;
In a media destination, `plate="none"` preserves a cut-out mark's transparent, unclipped shape. Navigation, disabled state, external-tab safety,
focus and `onFollow` are the same for both forms. Media keeps its supplied destination name while the image loads or fails.

### Grid

`Grid` names a track layout by the content it carries: peer `cards`, aligned `form` fields, `main-rail`, independent
working `sections`, a reading `pair`, one `featured` focus with symmetric support, a dated event `week` or a
`week-summary` of daily metrics. `sections` holds children whose named regions remain independent. `pair` requires
`leading` and `trailing`; `featured` requires `leading`, `featured` and `trailing`. Both slot forms reject children,
arbitrary column counts and look props. Their DOM and focus order remains the supplied reading order. A pair's
portions are equal; a featured focus stays between symmetric support tracks. These roles use the section gap and
keep one reading column when constrained; independent sections follow the wide workspace viewport, while a pair
and featured layout answer their own container. Choose by the content relation, never the desired breakpoint.

Week kinds take a region `label` and seven consecutive day regions in
reading order, including empty days; the development check refuses another count. The shared week renderer owns its
container queries. A week is an agenda in a narrow container and seven tracks at the medium width, at the inline gap.
A week summary wraps through one, four and seven tracks, at the section gap. The exact thresholds belong to
`packages/grammar/src/common/styles.css`; an app takes no breakpoint, gap or arbitrary column count. Existing day
content, empty states and actions remain inside their day regions. `Calendar` remains the date-selection control.

### EntryFrame

`EntryFrame` owns one full-height entry task. Its required `label` names the main landmark. Required named frame
slots `artwork`, `intro`, `identity`, `tools` and `footer` preserve the app's content, while `children` holds its
bounded form or outcome. The desktop context and task panes are equal; on a phone the context pane is hidden and
the compact identity remains above the form. Tools stay at the top trailing edge and supporting navigation below
the vertically centred form. The frame takes no width, gap, class or breakpoint prop. Artwork crop and paint stay
with the app's asset composition inside `artwork`; no content slot owns the surrounding page layout.

### ColorSwatch

`ColorSwatch` previews an actual color value as content, with a required accessible `label`; the vendor owns the typed
`color` data, its paint and transparency checkerboard. The fixed small square preview takes no children or appearance
props. Visible name and value copy accompany it through existing text and layout components. Loading preserves its
geometry under the inert skeleton. A color value is not a semantic status tone and the swatch selects or drags nothing.

### Figure destinations

Each `Figure` may carry a native `href`, optional `Link.onFollow` and `isDisabled`. Its whole cell is one named keyboard
target through the root router; values retain their default-tone figure treatment (DISCIPLINE-2). Loading, disabled
figures and pending cards open nothing. A figure without `href` carries no follow handler or disabled destination state.
### Item actions

`ItemAction.isPending` forwards the Button's action-owned spinner and duplicate-press guard in both row and tile actions;
it differs from the unresolved-content `isLoading` geometry.

### Alert

An alert is feedback in the page; a toast is the same anatomy in the one region. The tone is a settled fact and
paints only the indicator and the title; the surface stays neutral, or takes the tone's soft tint in the `soft`
appearance. A negative tone is announced assertively, everything else politely. A toast with an action, or a
negative one, stays until dismissed.

### Quote

A quote is words taken from a source, drawn as a `<blockquote>` on a tinted ground at the nested inset, one radius below
the surface that hosts it. It is not a surface: it has no shadow, no outline and no action, so it stands in a pane, a card
or a drawer without putting a surface inside a surface. It names its source in one short word and, optionally, where and
when the words were said. It reports no outcome (that is an alert) and carries no thread (that is a message bubble).

### MessageBubble

A message bubble is one message of a conversation; every conversation is `MessageBubble`s in a thread the app keeps, and no screen draws its own
bubble. The reader's own message (`side="outgoing"`) is the brand fill (`--accent`) with its foreground (`--accent-foreground`),
the other party's is the surface with its foreground, and inline content (a link, a mention, code, a muted line) inherits the
bubble's foreground so it reads on either face. The corner on the author's side tightens to point at the avatar.

### EmptyState

An empty state is a region with nothing to show, or whose read failed: one message in the region's place inside
the unchanged surface, and one action only when a real next step exists. Its one mark is a glyph or, for a page
that has never held content, the artwork: generated character art the grammar draws as the `Mascot` at `md`, with
the asset slot it was requested under as a required field, so a first-run notice is the same size and as traceable
as every other mascot.

### Avatar

An avatar is an identity mark on the ramp (`sm`, `md`, `lg`, and `control` in a bar), so it matches the controls
beside it. Without an image it draws generated initials coloured by a stable seed; an agent carries a badge and an
accessible name that says so; a group is one composite at one size.

### Mascot

A mascot is generated character art on its own size scale, so one character comes out at one size on every screen:
square boxes `sm`, `md` and `lg` (Common tokens `--grammar-mascot-*`, 96, 160 and 240 px) and `hero`, which fills its
host's height up to a cap for a split screen. The art is always contained, never cropped, on a transparent ground
with no loading plate; below 48rem a square step drops one step, and a hero is absent below 64rem unless the app keeps
it. It is decorative unless its `alt` names it. It carries the asset-slot props of `Image` and `MediaFrame`, so the
render is tied to the request that generated it; generated art reaches the page only through `Mascot` or a
`MediaFrame` (lint R338, R339). The scale is Common's: a grammar changes nothing about it.

### PaneGrid

A pane grid divides a bounded height into named areas (`["a b c", "d d d"]`): A, B and C side by side with D below. Panes
sit flush with no gap and one divider between neighbours (vertical between columns, horizontal between rows, n-1 lines,
none on an outer edge), all in the same border colour and weight as every other divider. Columns and rows are track roles (`auto`,
`fill`, `fill-2`, `fill-3`, `compact`, `standard`, `wide`), and `areas`, `columns` and `rows` may be given per breakpoint
(`base`, `medium` from 48rem, `wide` from 70rem), chosen by container query on the grid's own width. Each `Pane` is a
borderless surface (`surface`) or a plain div, may be its own scroll owner, and may collapse into a drawer where its
area is not arranged. A pane owns its content inset (`inset`: `content`, the default, or `flush` for a nested grid or
a full-bleed canvas): it never pads itself, so dividers, nested grids and scrollbars stay full-bleed, and it publishes
the clearance of each side by contact (the content clearance inline on both sides and at an outer block end, the
separator clearance at the block start and facing a divider) to its `PaneSection` bands. A `PaneSection` is the one
band of a pane: it pads inline by the pane inset, stacks with the row gap between its siblings, may take the remaining
height (`grow`), be its own full-bleed scroll owner with the inset inside it (`scroll`), centre a head band (`align`),
let one horizontal scroller reach both pane edges (`bleed`), and space its own children (`gap`); a pane and a section
take no class and no style. Inside a pane, a list resolves the panel inset and an unpainted secondary tab track drops its
track padding, so every box starts at the content edge while the text inside a box keeps the vendor's own padding.
The grid refuses a child that is not a pane, and a pane holds sections or one nested grid.

### Freestyle

Freestyle is the one sanctioned escape hatch: a div that fills its host, where the app writes its own plain elements and
CSS because no Grammar component fits (a sign-in brand art, say). It adds no paint, inset or radius, names its `reason`
(stamped as `data-grammar-freestyle-reason`), and is a last resort: the rest of the page stays on the grammar, and a
Grammar component inside it keeps its contract (ruling grammar-freestyle-region).

### Page

A page is one route's frame, and its `header` is data: the trail, the page heading (the document's one h1) with the subject's mark,
status chips and summary, the page's commands, and the page tabs. The header is a band, not a card: a surface across the
primary region, whose content shares the page's measure so header and body share their edges, and which ends in its own
full-width separator, drawn with or without tabs. Page tabs stand on that separator and the selected underline lies over it,
so the tabs read as the switch of everything below. A grammar decides the band's paint and the separator's weight; the slots,
the inset, the separator and where tabs stand are the same everywhere. The page is the single owner of the page inset and the
vertical rhythm: the band and the body, and the body's sections, sit a region step apart, and the body clips past its content
box so nothing in it reaches across the gutter. Layout frames place regions and never inset a page. A page without a band
starts its body one region step down. A bleed page is an app surface: no gutter, no block padding and no clip, its body filling
the region, under the band or the trail alone. A panes page (`chrome="panes"`) is a tabbed app page whose body is one pane grid:
the band (with or without tabs) or the trail, then the grid attached to the band's separator with no gap, block padding, radius
or card, reaching both content edges and the viewport bottom less the grammar's bottom chrome (the page measures the fill box
itself). `isLoading` passes to the band; the body's blocks own their loading.

### Section

A section is a named region whose title is its heading and its landmark name; no free heading exists (ruling
`section-is-the-heading`). `kind="list"` holds rows of the same typed items a list card holds, with a `filter` slot for a
`FilterButtonGroup`; it is the unpainted list owner within an existing surface and the list owner for search, filters or
paging on the canvas. Its head, filter and content stand one section step (24) apart, and its page command hugs its label at
the end of the head row. A card heads itself with its `label`, so a section around one card is refused.

`kind="figures"` is the unpainted key-figure strip inside an existing surface. It reuses the exact FigureCells renderer
and typed `Figure` data of `SurfaceCard kind="figures"`, including neutral values, dividers, responsive wrapping and
native destinations. Loading uses the same known cells or shared default three-cell shape; error replaces the strip.
A strip that owns its visible heading supplies `title`. An already-headed strip supplies required `ariaLabel` and
adds no heading; the compiler rejects mixing the forms or supplying head controls to a headless strip.

### Diagram

A diagram draws a structure the reader follows: `MermaidDiagram` renders an article's Mermaid source in the grammar's
tokens, `FlowGraph` draws nodes and edges the app holds (flowchart shapes, edge labels, layered, radial, manual or lanes layout), and `BubbleMap` draws value-sized bubbles. A
diagram is one named image in a frame that reserves its height in every state: the loading skeleton keeps that box,
and a source the renderer refuses stays in the region as code under an error. A labelled edge is also spoken in the
graph's text list. A grammar decides the frame and the paint; the reserved box and the error carrier are the same
everywhere.

### Shell

The shell is the frame of an app: one shell owns the bar, the navigation and the mobile drawer, and one owner
scrolls each axis. Every bar control is `control`. There is no bottom tab bar: on a phone the navigation is the
drawer.
