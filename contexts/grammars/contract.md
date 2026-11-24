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
  can reach for it. The grammar is a generic UI/UX layer.
- **The token roles, read from HeroUI and set by the app.** The HeroUI semantic variables are the interface between
  Common's anatomy and the paint. The structure is the same in every app, the paint is the app's: an app sets HeroUI's tokens in its own CSS and every part follows, and a grammar declares no token
  on its root, so no host value loses to the family. A grammar publishes its default palette as an optional `theme.css` of
  HeroUI tokens (`DNA-COMMON-TOKENS-BOUND` reads it with the app's) and writes no private colour name. Spacing and control
  heights are Common's tokens and never a grammar's: a grammar that re-spaced or resized would change layout, and layout
  is the same in every grammar.
- **A DNA module of one shape.** The same keys in every grammar make grammars comparable and let a generator
  read any of them; they name the family's defaults, which an app may replace. Colour is per theme because dark is
  its own palette, not an inversion. The key `accentText` is the token `--accent-soft-foreground`: the accent painted as
  text, because a fill colour that reads well behind text rarely reads well as text, and the accent alone stays `--accent`.
  `accentSoft` is the tint both `accentText` and `muted` stay legible on. The Button variant, arrangement and the item defaults are
  Common's, so they are not in a grammar's DNA.
- **The core's ext, for its own situations only.** `src/core/ext/graph` and `src/core/ext/markdown` (the entries
  `@starci/grammar/core/ext/graph` and `@starci/grammar/core/ext/markdown`) are part of the core: they import the core's
  components and tokens, and the core entry never imports them, so their libraries are optional peers an app installs
  only when it uses an ext (`starci-grammar/ext-boundary`, `DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`). An ext is used ONLY
  in its situation: a graph when the reader must see a structure of steps, relations or clusters (a run's flow, a data
  ERD, a knowledge map); markdown for long authored documents. Everything else is core: a list, `Timeline`, `Stepper`,
  cards. Offset Pop gets no ext.
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
three steps in equal increments (reference 32, 40, 48 px), held at every breakpoint;
`control` is not a fourth height but the `md` height held for bar controls, set by the bar composition and never
by an app. HeroUI steps controls down on desktop and draws fields one step shorter than buttons;
the contract removes both, because mixed rows are exactly where they disagreed
([vendor/heroui](../vendor/heroui.md#how-sizes-align)). Fields have one step, `md`. Badges and glyphs keep their
own smaller scales: they label, they are not pressed. Which step a control takes is the choice
`scale.choose.step` in [ui/scale](../ui/scale.md); what every step measures is `DNA-COMMON-CONTROL-*`. The
heights are Common tokens (`--grammar-control-height-*`).

**Drawn height and target are two facts** ([ui/scale](../ui/scale.md#drawn-height-and-target-size-are-two-facts)):
the box is the ramp, and a control is pressed where it is drawn: no invisible hit area extends it on a coarse pointer (owner, 2026-11-21: "không thêm vùng chạm vô hình gì giữ 40 đi đừng cãi thầy"; Button md 40, sm 32). On a fine pointer the hit area meets its floor (`DNA-COMMON-TARGET-FINE`). The floors are Common tokens (`--grammar-target-*`).

**Corners are roles.** HeroUI derives every corner from `radius` and `field-radius`, and a Button's corner is
three times `radius`, so whether a Button is a pill follows from the grammar's radius, never from a per-button
choice. The grammar publishes the corner roles an app may name (`tiny`, `compact`, `control`, `surface`, `hero`,
`pill`) as `--grammar-radius-*`, each set from its base radius; an app never writes a literal corner, which would
freeze one grammar's value into every grammar. One corner may stand out: a MediaFrame names it in
`accentCorner` (a logical corner, `start-start` to `end-end`), drawn at the Common accent radius
`--grammar-accent-corner` while the others keep the family's radius; an app never rounds one
corner itself.

**Space and type are closed scales too.** Spacing is the roles identity 4, inline 8, row 12, section 24 and region 32, plus
the card's own inset 16 (never a gap); a container's children stand at least one step closer than the container stands to
its siblings (the proximity law, [ui/presentation](../ui/presentation.md#space) G6), which every grammar's defaults hold.
Type is one size and one weight per role, on the final scale: 14 for all UI text (`Text` `md`, and `sm`, the same step), 12 for
small names (`xs`), `isStrong` weight 500, titles 600; display sizes flagged: page title 18 and a big figure value 20; card and
section title 14, and every tab label 14 ([ui/presentation](../ui/presentation.md#type) FONT-7). Sizes and weights are
Common tokens (`--grammar-text-*`); a grammar may repaint a face but not move a role to another size.

## Button variant

A Button has three looks, one prop (owner 2026-11-22: "chỉ có danger, border, và primary thôi, k có tertiary nữa"): `variant` is `primary`
(solid, the ONE main action of a card or region), `border` (an outline, every secondary action; the default) or `danger` (a destructive action:
delete, disconnect, stop for good, at its entry and at its confirm). There is no intent, step, placement, ghost, tertiary, secondary, flat or
soft-danger look, and the look never depends on where the Button sits. Common maps the looks onto the vendor: primary is HeroUI `primary`,
border is `outline`, danger is `danger` (`BUTTON_VENDOR_VARIANT`, `src/core/leaf/Button/index.tsx`; the table is in the package's
`docs/button-variant-props.md`). `tone` (`accent`, `info`, `success`, `warning`) is only the colour of a `primary`, never a fourth look: a toned
notice's action (an `Alert`) is its primary in the notice's colour. `IconButton` takes the same three.

The view keeps one primary (lint `single-commit-per-render`, `DNA-COMMON-ONE-ACCENT-FILL`) and a collection item none (lint
`no-commit-in-collection-item`); only the primary carries a leading icon (the types); a retry is `border` (`RETRY_VARIANT`).

## Roles

Each heading is one role of [contract.yaml](contract.yaml) `roles`.

### Card

A card is ONE object on its own surface (a customer, an agent, a provider, a plan, a message, an approval), a dialog or an
overlay; a collection (a list, a table, facts, figures, disclosures, a choice) is never a card and stands flat in a `Section`
([ui/composition](../ui/composition.md) COLLECTION-2). A card never stands inside another card; a `Dialog`, `Drawer` or `Popover` may
host an object card with the same look, so the card has one depth and no nested edge exists. Its body is a
compiler-checked `kind`: `body` (the default, the object's free content) and `tile`. `wholeAction` exists only where the card
holds no inner control. A `body` card takes one `actions` band at its foot, under a `--separator` hairline, for the object's
commands (approve and decline, reconnect, choose); `Tabs`, `SearchField` and `Divider` there throw in development
(`useRefuseInCardActions`, `src/core/zoneContext.tsx`). The card holds its content 16 in and its label 8 above the surface (4 in a
cards grid). `measure` is `content` (the default, the card fills its host), `narrow` (30rem, start-aligned) or `formCompact`
(the centred measure of the one form with no page around it). `emphasis="accent"` marks the one card a set of peers recommends or
the reader has chosen. Its edge and its whole-action fills are [ui/presentation](../ui/presentation.md#boundary) BOUNDARY-6
(`DNA-CORE-EDGE-TOP`). A grammar decides the
material (fill, edge, radius); the slots, the kinds and the refusal of nesting are the same everywhere.

Where the name sits follows the card's kind, in every grammar. A card that heads a section
carries its label outside the material, an unpainted row above it, because the label names what follows. A tile, one of
several peers repeated in a grid, carries its name inside, beside its logo or mark, because the tile is the thing named and
an outside label would float away from it. A docked region is a `Pane`, never a card. No prop moves the name, and a family
paints it but never moves it.

A tile (`kind="tile"`) is one peer repeated in a `Grid kind="cards"`: its name stays inside. A compact identity has a
typed mark; a media identity has a typed `poster`, retaining the same frame for its image or localized absence text.
The poster reuses Image-owned data, aspect and fit. Supporting `facts` is plain text. One badge or a typed tuple of
up to three operational badges accompanies it. The primary `ItemAction` remains a native destination or command;
secondary commands use typed `menu` data. `wholeAction` excludes both inner action and menu, so nested interactive
targets do not compile. Loading keeps the poster and action geometry inert. A tile takes no `label`, `fact` or
`labelEnd`; its name and mark or poster carry its identity, and a tile with neither (a table of a floor plan) is named by its `name` alone (0.47.1).
`groundTone` (`accent`, `success`, `warning`, `danger`; 0.47.1) paints the whole tile with the tone's soft pair, its words the pair's
foreground, in both families (`DataTableRow.groundTone` is the row's twin); the badge still carries the status in words. A marked tile
shorter than its row keeps its rows at the top (`align-content: start`) instead of stretching them to the row's height.
`poster.bleed: true` (0.47.2) makes the poster a full-bleed cover: flush to the card's top and both side edges, clipped by the card's top corners
(the card clips; the picture has no radius of its own), while the name, badges, facts and figure keep the card's padding below it. It holds
for every `aspect` and `fit`, the absence frame and the loading skeleton, and in both families (Offset Pop: the picture sits inside the outline,
flush to it, with the outline's weight drawn under it).

### Button

Button is a command (`onPress`) or a destination (`href`) drawn as a button; the kind decides semantics, the shape
only paints. Its look is its `variant` (primary, border or danger), its size from the ramp: `sm`, `md`, `lg`, and `control`
in a bar. `pending` means this control accepted work: label and box unchanged, a second press refused.
`disabled` means the work cannot start, and its `disabledReason` says why in a tooltip on hover and keyboard focus
that is also the button's accessible description, since a disabled control is otherwise mute; where no pointer can hover, the
same description stands as a helper line under the button, since a tooltip cannot be reached there; `skeleton` means the
content never resolved. A grammar may repaint each vendor variant through its tokens and give the press its own
motion; it keeps the variant names, so the emphasis ladder means the same in every grammar. `IconButton` is the same contract drawn square or round at the step;
`FileButton` is an `IconButton` whose press opens the browser's file picker and reports the files; `TextAction` is the quietest command, set in text.
`IconButton.isPending` keeps its accessible name and box while drawing the native spinner, setting busy state and
refusing duplicate activation. `isLoading` remains unresolved content, not an action's progress.

A button's glyph says one thing. Only the primary button (`variant="primary"`, the CTA) carries a leading icon:
`border` and `danger` buttons, suggestion pills and row actions are text only, which the types enforce; `IconButton` is unaffected. `endArrow` (any look) marks a button that leads somewhere (a page, a tab, a next step): the grammar's
`arrow-end` glyph ends the label, slides one step toward the reading end on hover and focus (still under reduced motion) and
mirrors right to left. `startGlyph` (a named glyph, among them `plus` and `upload`), on the primary only, marks one that does something. A button
never takes both, which the types refuse, and a typed arrow in the label or an arrow passed through `endContent` is refused
by lint `button-arrow`. `EmptyNotice` `actionEndArrow` and `ItemAction.endArrow` carry the same on a notice's action and a
row or tile's action.

### Tabs

Tabs switch whole panels; each tab owns its panel. HeroUI's `primary` is a segmented pill on a soft track and its
`secondary` is an underline bar; the contract keeps those names one to one. Page tabs, region tabs inside a surface and
filter tabs over a collection (`kind="filter"`) take the underline, with the first label on the content edge; `primary` is
only the switch of a mode or period of the same data, two to four options, as the `action` of the `Section` that holds that data or a row's `control`. Every label is
one size, 14 (the selected one 500 plus the underline, 40 high), in every layer and in the pill. A page stacks at most two underline layers: the page tabs and one region
set, which `Page header.subTabs` draws as the second row of the header band on its own full-width separator (a region set
inside a page tab's panel draws its own separator). `end` puts a command at the strip's end, inside the strip frame, so the
strip's line spans the column under it. The bar lands on the `md` height, which is why Tabs have no size.

Each item accepts `isDisabled`, forwarded to HeroUI's tab: unavailable tabs retain the vendor's disabled semantics,
are skipped by keyboard traversal and cannot select or navigate their `href`. The controlled `selectedKey` still
owns the visible panel, including when every item is temporarily disabled.

### SegmentedControl

The value role is one value inside a form or a toolbar (period, audience, density), not navigation, and its renderer is
`ChoiceChips` (or a `RadioGroup` when each option needs a sentence). The pill-in-a-track look belongs to `Tabs
appearance="primary"`, a mode or period switch.

### Removable filter chips

Peer values that filter a collection which stays in place are `Tabs kind="filter"` (`FilterButtonGroup` was deleted in 0.55.0). A removable group may end with `onClearAll` and `clearAllLabel` (0.47.1): a "Clear all" text action
after the last chip, for a row of active filter values under a toolbar; it wraps under the chips when the row is full and leaves with
the last chip.

### Chip

A chip is a label, not a target, on two axes: tone (which settled fact) and emphasis. Its label starts with an
uppercase letter. A grammar's Badge is the vendor chip at soft emphasis and below the ramp, so status reads as
tinted text, never as a filled button-like shape; its `muted` tone drops the fill for a quiet marker.

`StatusDot` is a status drawn as a dot alone, static or `echo`, named by its `aria-label`; the dot is a solid disc in its tone (never a ring), 6px, and it and its size token are shared with `Badge isDot`, the status with its words, whose `isLive` makes it the state of a live feed. A dot is the live state of a system process (an agent, a connection, a run, a sync, presence): a record's business status or result is a `Badge tone` without a dot, and one entity carries at most one dotted `Badge`.

A `TagGroup` holds values the user entered, to remove or to reorder, and has no selection: its tag is interactive and
keyboard reachable on the ramp at `sm` (the default: tag rows are dense) or `md` when its row holds `md` controls, and a
reorderable group moves tags by drag and by Alt+arrow keys and announces each move. Peer values that filter a collection
are `Tabs kind="filter"`.

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

The field rule spaces every control alike, whatever it is (Input, Select, NumberField, Textarea, ComboBox, the date and time
fields, Search, CopyField, Checkbox and Radio groups, ChoiceChips, Switch, Slider): the label (md 14 / 500) stands 8 above the
control, the help, error or counter 4 below it, and fields stand 24 apart, set by the `Form`, the form `Grid` and the
`Fieldset`, never by a field; a `Fieldset` legend stands 8 above its fields and its actions 24 below them
([ui/components/field](../ui/components/field.md) FIELD-1..4). A hand-made label beside a control is refused by lint
`field-label`.

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

A list is rows of peers: a `ListBox` when picking is the task, `Section kind="list"` wherever the rows report (an existing
surface or the page canvas, bounded or searched, filtered or paged), a data table when columns matter. A list is never a card. The chosen owner carries one heading and accessible name.
n rows have n-1 seams, separators are full bleed, and rows and captions share
one content edge. A static row's description is one line, because the row is scanned; an option's description in
a `ListBox` wraps, because it is read before picking, and a list clamps it only by `descriptionLines`. A table row
with `href` is one link to its record; a column with `editor` hosts its field in the cell; `low`-priority columns
fold into the first column as stacked secondary text on a narrow table. The leading slot follows the ramp, so a
row's identity mark matches the controls beside it. A `ListRowData` title remains text; `href` turns that title into a
native `Link`, whose `onFollow` reports navigation to its owning region. Without `href`, `onFollow` is unrepresentable.
The title link and any row command or menu are separate targets, never nested. A row that opens something (`onPress`,
`onAction`, `href`, `chevron`, or `onRowAction` on a table) is itself the one pressable and its title is plain text, never a
`Link` (lint `row-title-link`); a table's pressable row takes the pointer cursor and the secondary hover fill, and its row
commands stay separate presses. A list has one look wherever it stands, flat rows divided by hairlines and aligned with the title ([ui/presentation](../ui/presentation.md#boundary)
BOUNDARY-7; lint `surface-in-surface`). Loading shows the same rows at rest and
removes the title link.

**Selected and hover.** A navigation item (a `Sidebar` item, the current one) and a selectable list row (a `ListBox` option, a selected table row and its phone list row) mark the selected state with the accent soft pair: the `--accent-soft` fill, `--accent-soft-foreground` words and glyph, rounded like the item, and NO bar on any one edge. Hover is the neutral soft fill (`--default`; a table row `--surface-secondary`) with the words unchanged, and a selected item under the pointer keeps its accent soft fill. Keyboard focus keeps its ring. A status `edgeTone` bar is not a selected mark and stays.

### Link

`Link` is a native destination carried by text or one image. An inline text link takes the size of the text around it
(`size` defaults to `inherit`) and the exact primary colour; the external glyph `↗` ends an EXTERNAL destination (`kind="external"`) only (0.37.14): an internal text link has none and keeps the accent
colour, and `variant="plain"` (a navigation row's title, a shell brand) has no colour, underline or glyph because the component around it is the affordance. Its text form takes string `children`; its media form
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
keep one reading column when constrained (a `main-rail` takes the region gap); independent sections follow the wide workspace viewport, while a pair
and featured layout answer their own container. Choose by the content relation, never the desired breakpoint.

`Grid kind="cards"` takes `size` (0.47.1): `card` (the default) holds a track floor of 16rem, so a phone shows one card per row; `tile` lowers
the floor to 9rem for small peers (a product, a table), so two stand side by side at 390 and a wide page fits as many as `columns` allows.
The floor narrows the track, never the controls inside it (their touch floors stay).

Week kinds take a region `label` and seven consecutive day regions in
reading order, including empty days; the development check refuses another count. The shared week renderer owns its
container queries. A week is an agenda in a narrow container and seven tracks at the medium width, at the inline gap.
A week summary wraps through one, four and seven tracks, at the inline gap, like a cards grid. The exact thresholds belong to
`packages/grammar/src/common/styles.css`; an app takes no breakpoint, gap or arbitrary column count. Existing day
content, empty states and actions remain inside their day regions. `Calendar` remains the date-selection control.

### Marketing motion

Four pieces give a public page its movement, over one set of ramps (0.47.3): `Reveal`, `Marquee`, `CountUp` and `StickyStory`. The ramps are Common's
(`--grammar-motion-ease-out`, `-ease-in-out`, `-duration-base`, `-duration-reveal`, `-duration-count`, `-stagger`, `-distance-reveal`, `-distance-step`,
`--grammar-loop-marquee`, `-compact`, `--grammar-story-pin-top`, `-height`); a family overrides a step on its own root (Offset Pop settles a rise with a small overshoot and
reaches further), and no piece, and no app, writes a duration or a distance of its own. Every piece draws its static, complete content first and adds movement only under
`prefers-reduced-motion: no-preference`, so reduced motion, a failed script and a browser without scroll timelines all land on the same complete content.

`Reveal` (`kind`: `rise` or `stagger`) fades a region, or each direct child in turn, up as it enters the viewport: by `animation-timeline: view()` with no script where the
browser has it, otherwise by a small observer that marks only a region that starts below the fold. `Marquee` (`label`, its items) is an endless strip that pauses under the pointer
and while focus is inside; it draws its content twice and the repeat is `aria-hidden` and `inert`; under reduced motion it is one wrapped run. `CountUp` (`value`, `locale`,
`format`, `prefix`, `suffix`) counts to its value the first time it is seen; the final value is the text from the server's first byte, the moving figure is `aria-hidden` while it
runs, and under reduced motion it never counts. `StickyStory` (`label`, `steps` of `id`, `content` and `panel`, `stage`) pins a stage on a wide screen and shows the panel of the step
in the middle of the viewport; on a phone and under reduced motion there is no stage and each step shows its own panel below its text. The picture-led marketing card is not a fifth
piece: it is a `SurfaceCard kind="tile"` with `poster.bleed`.

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
is drawn as its soft pair: the row is the tone's soft tint at full strength and the glyph, title and description its soft foreground,
with no shadow and no border, in every family. A negative tone is announced assertively, everything else politely. A toast with an action, or a
negative one, stays until dismissed.

### Quote

A quote is words taken from a source, drawn as a `<blockquote>` on a tinted ground at the nested inset, one radius below
the surface that hosts it. It is not a surface: it has no shadow, no outline and no action, so it stands in a pane, a card
or a drawer without putting a surface inside a surface. It names its source in one short word and, optionally, where and
when the words were said. It reports no outcome (that is an alert) and carries no thread (that is a message bubble). Its `line`
variant is one muted, ellipsized line with a rule on its start edge and no ground: the line a chat answer quotes, over that answer.

`Inset` is the same ground around anything else: a tinted box at the nested inset, one radius below the surface, with an optional
muted label above its content that also names the group. It is not a surface (a card inside it is refused like a card in a card). A
loading `Inset` is a loading region: its children draw the geometry of their ready boxes and it carries the one `aria-busy`.

`Disclosure` takes a `leading` step mark (the same mark as an accordion row) and its `summary` stays the meta at the end of the trigger row;
`DisclosureList` joins sibling disclosures into one list divided by full-bleed lines, each section opening on its own. A loading region keeps
the titles and draws each step mark and summary as geometry.

### MessageBubble

Message receipts and transport outcomes use `MessageStatus` in the existing footer slot, without widening the bubble's
props. Its `kind="receipt"` has `sent`, `delivered` and `seen` facts, with typed readers only for `seen`;
`kind="transport"` has `queued`, `sent`, `failed` and `unknown`. Localized `label` remains visible beside native
marks; readers retain accessible names and localized overflow copy. Its announcement is polite and atomic.

A message bubble is one message of a conversation; every conversation is `MessageBubble`s in a thread the app keeps, and no screen draws its own
bubble. Every chat draws the same three faces (`DNA-COMMON-CHAT-SURFACES`, 0.37.31): the thread is the page tone (`--background`),
the reader's own message (`side="outgoing"`) is the brand fill (`--accent`) with its foreground (`--accent-foreground`), and the
other party's (incoming, and every `MessageCard`) is one look on every host, the 1px `--border` edge with no fill and no shadow
(`DNA-COMMON-CHAT-INCOMING-OUTLINE`, 0.52.0). A chat is one frame on any page (`DNA-COMMON-CHAT-FRAME`, 0.37.33):
`Pane content="chat"` paints its head, thread and composer footer `--background` wherever it stands, with no app tone, and its thread
is the only scroller (`DNA-COMMON-CHAT-FRAME-SCROLL`). Inline content (a link, a mention, code, a muted line) inherits the
bubble's foreground so it reads on either face. The replies a card offers are `Section kind="list" layout="suggestions"`. The
corner on the author's side tightens to point at the avatar. An app never restyles a face.

### EmptyState

An empty state is the one answer for a region or a page with nothing to show, a no-match, or a failure: a centred stack of media, a
title, a description and actions, in the place of what is missing inside the unchanged surface. The actions are one primary and at most one
secondary, and only when a real next step exists. The media follows the scope of the state. A state inside a page (`scope="region"`, the
default) takes an icon on a soft brand-tone circle (the accent soft pair). A state of the whole page (`scope="page"`: a first visit, an empty
page, a paywall, a 404, a 500) takes an `illustration`, drawn by Illustration at the state step (160px, 120px below 48rem), decorative and
tied to its asset slot; the type refuses an illustration on a region, so a working page carries no art. The loading of its illustration never
changes the stack's size, and a failed file keeps the stack and its actions.

### Image

An image is one picture that carries content, in a box that claims its ratio before the bytes arrive. Its `alt` is required (empty only
for decorative art); its `ratio` is one of 1:1, 4:3, 3:4, 16:9, 9:16, 21:9 or auto; its renditions become `srcset` and `sizes`; it is lazy and
async-decoded by default; a shimmer stands in the box while it loads and a neutral glyph on the plate when it fails; a caption makes it a
figure, and `zoom` opens it in a lightbox on the Grammar's overlay mechanics. The corner is the theme's one radius. The file is a `src`
or a `staticsKey` resolved by the nearest `StaticsProvider` (an app's statics, addressed by key, never by host); a raw `img` is refused
(R442).

### Video

A video is one element for every recording: MP4 and WebM natively, HLS natively where the platform reads it and through hls.js elsewhere,
and MPEG-DASH through dash.js. Its `sources` are listed in order of preference and the first one the browser can play is loaded; the player
libraries are the Grammar's own dependencies, imported dynamically only when a source needs them and never fetched from a CDN. The box claims
its ratio (16:9, 9:16 or 1:1), shows the poster, requests no stream until it nears the viewport, and ends in an in-place notice when the stream
fails or nothing listed can play. Captions and subtitles are WebVTT `tracks`. `autoPlay` is muted and inline and does nothing under reduced
motion. A raw `video` is refused (R442).

### Illustration

An illustration is decorative art for a hero, a marketing band or a page-level state: it says nothing the words beside it do not and is hidden
from assistive technology unless its `alt` names it. It claims a ratio (or fills its host), and below 48rem a `compact` source and ratio may
replace the wide crop (art direction through `picture`). Its states are a shimmer while it loads and the bare plate when it fails. Generated art
reaches the page through `Mascot`, `Illustration` or a `MediaFrame` (R338). A raw `picture` is refused (R442).

### Avatar

An avatar is an identity mark on the ramp (`sm`, `md`, `lg`, and `control` in a bar), so it matches the controls
beside it. Without an image it draws generated initials coloured by a stable seed, or, as a MARK, an icon on a round brand-colour plate (a
provider or a channel); an agent's avatar is initials only with an accessible name that says so, and its "AI" is the neutral Chip that
follows the NAME (`AgentName`, `isAgent` on the name slots); avatars in a row or from a list are one `AvatarGroup` of people and marks
at one size, with `max - 1` items then a "+N" tile (lint `avatar-row-uses-group`). The provider connections something uses are an `AvatarGroup` of `kind: "logo"` items (a
brand logo on a white surface in both themes, fitted inside, a hairline edge), and a lone logo an `Avatar kind="logo"` of the same
`size`; logos are sized by `size` alone. The exported `PlainPressable` lets an app wrap its own content as a menu trigger.

### Mascot

A mascot is generated character art on its own size scale, so one character comes out at one size on every screen:
square boxes `sm`, `md` and `lg` (Common tokens `--grammar-mascot-*`, 96, 160 and 240 px) and `hero`, which fills its
host's height up to a cap for a split screen. The art is always contained, never cropped, on a transparent ground
with no loading plate; below 48rem a square step drops one step, and a hero is absent below 64rem unless the app keeps
it. It is decorative unless its `alt` names it. It carries the asset-slot props of `Image` and `MediaFrame`, so the
render is tied to the request that generated it; generated art reaches the page only through `Mascot` or a
`MediaFrame` (lint R338, R339). The scale is Common's: a grammar changes nothing about it.

### CalendarDay

`CalendarDay` is a passive calendar-region heading, not a date-selection control. Its vendor-owned date-only `value`
provides the day number and `<time dateTime>` value; the app supplies the full localized `label` and authoritative
`isToday`. Only that current date receives `aria-current="date"` and the current-date emphasis. The app's cell actions
remain separate; the leaf selects nothing and adds no scheduler behavior.

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

`PaneHeader` is the head band of one pane, the content of a `PaneSection align="center"`: the back control of a phone
(drawn only where the grid shows one pane at a time, below 48rem), an identity mark, the title with one status beside
it and one muted line under it, and the pane's commands at the trailing end. The row is as tall as a touch target, so
the heads across one grid row share a height whether or not they hold a command; a long title truncates, and a loading
head lays its slots out unseen under a shimmer so the band keeps its box. It paints no surface or rule.

A region that fails reads its message as the title, the way out as one muted line and the retry as an alternative
command: in a pane (not in a card or an overlay) as a soft danger band across the region, elsewhere as the centred
notice. An empty region reads the same way, its message as the title and its description as the muted line.

### Data views

Three data views answer situations no other component does, each in the four states of a region. A `Board` is peer
columns of rows (stages) that scroll as one row and snap, one stage at a time on a phone; each column is a tinted ground whose items are object cards, 8 apart, with
its title and count, answers for its own empty state, and a loading board keeps its titles and draws its rows as geometry. A
`ScheduleGrid` places entries by row and column (a week by hour, people by day, a month by week) in a real table with a
caption, column headings and a heading per row; below 48rem of its own width it reads as an agenda in which each entry names
its column and empty cells are not drawn, and a loading grid keeps its headings and draws shimmering entries. Bars, lines and
sparklines are the charts extension's (`@starci/grammar/core/ext/recharts`); core draws no chart of its own (0.55.0).

The Grammar has no group of attached buttons: a choice among a few has one component by meaning. `Tabs` switches a view or, with
`kind="filter"`, narrows a list that stays in place (the same underline at the same size, inside the list pane under its search field, a `count` per tab drawn as a grey chip, an attention count (`isAttention`) on the accent soft pair, the tabs that do not fit folded into a "+n" menu with the selected one always visible); `ChoiceChips` or `RadioGroup` chooses a value
of a form, since a tablist is not a form field; a date is the `Calendar` and a time `ChoiceChips`; actions are separate `Button`s or a
`DropdownMenu`. `ButtonGroup` and `FilterButtonGroup` were deleted in 0.55.0, and R380 still names the replacement in product source.

The `Calendar` takes a controlled `value`, `minValue` and `maxValue`, `isDateUnavailable` with an `unavailableReason` (a full day says so
on hover and to a screen reader), a `locale` (and so the week's first day: Monday for Vietnamese) with `firstDayOfWeek` to override,
and `isLoading` (header and cells kept, numbers as geometry, nothing focusable). A taken time is a `ChoiceChips` option that is
disabled with a `disabledReason`.

`ChoiceChips` is one choice among a few short options (a time, a size) as pills that wrap onto as many rows as the width needs,
so every option stays visible. It behaves as a radio group (one selected, arrows move, a taken option is disabled and keeps its
place) and answers for its own empty, loading and error states. It is neither a filter (`Tabs kind="filter"`, one row with a "+n"
fold) nor a mode switch (`Tabs appearance="primary"`).

### Freestyle

Freestyle is the one sanctioned escape hatch: a div that fills its host, where the app writes its own plain elements and
CSS because no Grammar component fits (a sign-in brand art, say). It adds no paint, inset or radius, names its `reason`
(stamped as `data-grammar-freestyle-reason`), and is a last resort: the rest of the page stays on the grammar, and a
Grammar component inside it keeps its contract.

### Fragment

Fragment is the broad escape hatch: a region that renders no element, only its children (like React's Fragment), where the app and its fans write any markup, any class name
and use any library (a graph editor, an animation library) because no Grammar component fits. It adds no paint, inset or radius,
names its `reason` (for the lint and the inventory; with no element there is nothing to stamp), and is a last resort. The Grammar lint reports nothing in its subtree, nor an import used
only there; outside it every rule stays. The Grammar ships no graph component and imports no graph or animation library (its motion is the CSS
transitions its tokens drive); an app uses such a library only inside Fragment, and every use is listed by the Fragment inventory.

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
itself). `isLoading` passes to the band; the body's blocks own their loading. Every console page states its trail: `header.breadcrumbs`,
or `breadcrumbs: "root"` for the console's root page, which draws nothing (lint `page-breadcrumbs`). `header.subTabs` is the
second row of region tabs, see Tabs.

### Section

A titled section is a named region whose title is its heading and its landmark name; no free heading exists. `kind="list"` holds rows of typed items (`ListRow`), with a `filter` slot for
`Tabs kind="filter"` and a `layout` (`rows`, `keyValue`, `suggestions`); it is the one list owner, within a surface and on the
canvas. Its head, filter and content stand one row step (12) apart, because the page body stands its sections a region step apart and
a container's children stand closer than its siblings, and its page command hugs its label at the end of the head row, its
text at `md`. The head carries `title`, `count` (marked `isAttention` when the number is work waiting for the reader), `fact`,
`meta` and that one `action`; the `caption` stands under the content. A card heads itself with its `label`, so a section around one card is refused.

A region (`kind="region"`, the default) holds children under an optional `filter` that narrows all of them. A list's filter and a
region's are one flat wrapping row: the filter tabs, the search and its selects share a line on one bottom edge; below the narrow
step the tabs and the search take a line each and the compact selects share the next at their content width. A region the page title already names supplies `ariaLabel` in place of `title`, as a headless list or strip does.

`kind="figures"` is the one look of key figures, the ribbon, wherever it stands (the page, a pane, a drawer): a 1px `--border`
hairline on its top and bottom edges, open ends, no fill, no radius and no shadow, its touching cells (gap 0) divided by vertical
`--border` hairlines between the cells of a row and a horizontal one between rows, never on its outer edge. A cell's inset and
type are [ui/presentation](../ui/presentation.md) `space.choose.component` and FONT-5, and a cell may be a native destination.
The strip answers its own width (container query, no script): one row from 40rem, 2 x 2 from 18rem, one column below, a last odd
cell spanning its row; five cells take one row from 52rem, 3 + 2 from 30rem and 2 + 2 + 1 below. The strip stands in its own
`Section`, above the section it summarises. Loading uses the same known cells or the shared default three-cell shape; error
replaces the strip. A strip that owns its visible heading supplies `title`. An already-headed strip supplies required
`ariaLabel` and adds no heading; the compiler rejects mixing the forms or supplying head controls to a headless strip.

### Diagram

A diagram draws a structure the reader follows: `MermaidDiagram` renders an article's Mermaid source on the core's graph ext canvas
(`@starci/grammar/core/ext/graph`, Mermaid the parser, xyflow the renderer, in the grammar's tokens); a node graph is the core's graph ext (`@starci/grammar/core/ext/graph`: a run's flow, a data ERD, a knowledge map, and
ONLY those; [graph](../ui/components/graph.md)), never a `Fragment` and never an app's own xyflow. A
diagram is one named image in a frame that reserves its height in every state: the loading skeleton keeps that box,
and a source the renderer refuses stays in the region as code under an error. A grammar decides the frame and the paint; the reserved box and the error carrier are the same
everywhere.

### Charts

A chart or a sparkline is drawn by the charts extension of the core grammar (`@starci/grammar/core/ext/recharts`), never by hand-drawn SVG and never by a chart library imported in an app. The library is imported only inside that extension; core never imports it; it is an optional peer dependency. A chart is one named image in a box that keeps its height in loading, empty and ready; its series are tone tokens, its axes and grid muted tokens, its tooltip a shadowless surface. An area's soft fill is its series token through the opacity tokens; a donut draws at most six parts, the rest folded into Other under the app's label, with its legend of values and shares as text beside the image.

### PDF

A PDF document is shown by the PDF extension of the core grammar (`@starci/grammar/core/ext/pdf`, `PdfViewer`), and that extension is used only to show PDF documents. Its pages are drawn to a canvas by pdfjs, never an iframe; the library is imported only inside that extension, lazily; core never imports it; it is an optional peer dependency. The viewer is a shadowless surface with a 1px border, its commands core IconButtons and a Button at the control size on every screen, its loading all Skeleton and its failure a negative Alert; highlights are tone-soft overlays.

### Upload

Every upload is taken by the upload extension of the core grammar (`@starci/grammar/core/ext/dropzone`, `Dropzone` over react-dropzone, loaded lazily), never by react-dropzone or another upload library imported in an app. The library is imported only inside that extension; core never imports it; it is an optional peer dependency. The zone is a surface with a 1px dashed edge and no shadow that takes files and folders (a folder flattens into its files with their relative paths); drag-over paints the info soft surface, a refused drop the danger soft surface with the reason in words (too big, wrong type, too many). Each upload the app runs is a row: a 24px file-type icon, the name, an info Progress and an inline status of the three glyphs. Every word comes from the app's `labels`.

### AI chat

A chat with an assistant is the chat extension of the core grammar (`@starci/grammar/core/ext/chat`, `AiChatThread` over assistant-ui's headless primitives and its external store runtime), never assistant-ui or another chat library imported in an app and never a hand-built thread for an assistant. The library is imported only inside that extension; core never imports it; it is an optional peer dependency. The app owns the messages and the run; every part is Grammar: the chat frame on `--background`, the reader's turns neutral soft bubbles at the end side, an assistant turn plain markdown across a centred reading column, a tool call a folded row with its status mark, the proposed result a card whose approve is its one primary, and one bordered composer box, the core Textarea over a foot row with the hint and a send that turns into stop while an answer runs. Every word comes from the app's `labels`.

### Shell

The shell is the frame of an app: one shell owns the bar, the navigation and the mobile drawer, and one owner
scrolls each axis. Every bar control is `control`. The only bottom bar is the `BottomNav` in `WorkspaceShell`
`compactNavigation` (two to five places); otherwise on a phone the navigation is the drawer.
