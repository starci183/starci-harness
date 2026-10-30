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
- **The token roles, bound or declared.** The HeroUI semantic variables are the interface between Common's
  anatomy and a grammar's material. A grammar binds each one or declares that it keeps HeroUI's default; an
  unbound role silently takes the host theme, which is how a grammar ends up with two accents.
  Spacing and control heights are Common's tokens and never a grammar's: a grammar that re-spaced or resized
  would change layout, and layout is the same in every grammar.
- **A DNA module of one shape.** The same keys in every grammar make grammars comparable and let a generator
  read any of them. Colour is per theme because dark is its own palette, not an inversion. `accentText` exists
  because a fill colour that reads well behind text rarely reads well as text; `accentSoft` is the tint both
  `accentText` and `muted` stay legible on. Elevation names its two layers because depth decides the edge.
  Intent, arrangement and the item defaults are Common's, so they are not in a grammar's DNA.
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

Card is one subject on its own surface. Its edge comes from depth, not from a choice: the top layer is raised, a
layer inside another surface is subordinate, and never both raised. `joined` stacks full-bleed bands divided by
separators instead of nesting cards; `measure` caps a form card's width so the page does not. Highlight is a claim
that this card is the next step, so one per view. `treatment` is the face: `surface`, `soft` (the brand's light
tint, `accentSoft`, under the default foreground) or `ink` (the brand ink, the signature band); `soft` and `ink`
carry the decorative artwork slot, `ink` also the motif. A painted treatment rebinds the whole surface pair on its
ground (surface, foreground, muted, separator, border and the accent and tone text tokens), because a child that
paints its own circle or ring from the surface token and its text from a foreground token stays legible only while
both move together. A grammar decides the material (fill, edge, radius, the ink and its inks) and whether the label
sits inside the material; the slots, the treatments' grounds and the depth logic are the same everywhere.

### Button

Button is a command (`onPress`) or a destination (`href`) drawn as a button; the kind decides semantics, the shape
only paints. Its variant comes from intent and placement, its size from the ramp: `sm`, `md`, `lg`, and `control`
in a bar. `pending` means this control accepted work: label and box unchanged, a second press refused.
`disabled` means the work cannot start, and its `disabledReason` says why in a tooltip on hover and keyboard focus
that is also the button's accessible description, since a disabled control is otherwise mute; `skeleton` means the
content never resolved. A grammar may repaint each vendor variant through its tokens and give the press its own
motion; it keeps the variant names, so the emphasis ladder means the same in every grammar. `IconButton` is the same contract drawn square or round at the step;
`TextAction` is the quietest command, set in text.

### ButtonGroup

An action group is two to five peers of one intent acting on one object (zoom, align). The vendor joins them:
squared inner corners, collapsed borders, no press scale; the group takes its buttons' size. A decision and its
way out are not peers, so they are two buttons at the inline gap, never a group.

### Tabs

Tabs switch whole panels; each tab owns its panel. HeroUI's `primary` is a segmented pill on a soft track and its
`secondary` is an underline bar; the contract keeps those names one to one (decision D-2). The look follows
placement and the grammar resolves it from nesting: page tabs (outside a painted surface, the page's area
switcher) take the underline, region tabs (inside a surface) take the pill. The app never passes `variant`. Both
bars land on the `md` height, which is why Tabs have no size.

### SegmentedControl

A segmented control is one value inside a form or a toolbar (period, audience, density), not navigation. Its
selected segment takes the soft accent with an accent border, the paint of selection rather than of a command. It
publishes `sm` and `md`, default `md`.

### Chip

A chip is a label, not a target, on two axes: tone (which settled fact) and emphasis. Its label starts with an
uppercase letter. A grammar's Badge is the vendor chip at soft emphasis and below the ramp, so status reads as
tinted text, never as a filled button-like shape; its `muted` tone drops the fill for a quiet marker.

`StatusDot` is a status drawn as a dot, in three variants that share one dot-size token and five tones.
With text it is the dot, the text and the tone's light tint, drawn as the vendor soft Chip of the same size, so its
padding and height are the Chip's, with a 4px gap from dot to text; `Badge isDot` is this same anatomy. Without
text it is the dot alone, `static`, or `echo` with a ring that expands and fades in the tone's light stop and stops
under reduced motion; a dot alone is named by `aria-label` and shows that name in a tooltip on hover and focus.

When peers are picked from, the chip is a `TagGroup` tag, interactive and keyboard reachable, on the ramp at `sm`
(the default: filter rows are dense) or `md` when its row holds `md` controls; a reorderable group moves tags by
drag and by Alt+arrow keys and announces each move.

### Input

A field is a label, a control, a description and an error slot, drawn in that order, HeroUI's: the label is the
accessible name and sits on the control, the description is standing guidance under the control, and the error
lives in the field's own slot last. Label and control stay adjacent so a row of fields can align on its controls:
`FormGrid` lays fields in rows whose label, control, description and error are shared tracks, so neighbouring
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

A list is rows of peers: a `ListBox` when picking is the task, a list card of static rows when rows only report,
a data table when columns matter. n rows have n-1 seams, separators are full bleed, and rows and captions share
one content edge. A static row's description is one line, because the row is scanned; an option's description in
a `ListBox` wraps, because it is read before picking, and a list clamps it only by `descriptionLines`. A table row
with `href` is one link to its record; a column with `editor` hosts its field in the cell; `low`-priority columns
fold into the first column as stacked secondary text on a narrow table. The leading slot follows the ramp, so a
row's identity mark matches the controls beside it. Loading shows the same rows at rest.

### Alert

An alert is feedback in the page; a toast is the same anatomy in the one region. The tone is a settled fact and
paints only the indicator and the title; the surface stays neutral, or takes the tone's soft tint in the `soft`
appearance. A negative tone is announced assertively, everything else politely. A toast with an action, or a
negative one, stays until dismissed.

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

### Backdrop

A backdrop is the brand's own ground in a split screen: the family's light tint (`accentSoft`), full-bleed in its host,
with the brand copy at the top and the artwork (a hero `Mascot`) filling the height left. It is a ground, not a card:
no border, no shadow, no card inset, and square corners except the one `accentCorner` names (ruling backdrop). A brand
moment among other content stays a soft `SurfaceCard`.

### PageHeader

The page header is the top of one page: the trail, the page heading (the document's one h1) with the subject's mark,
status chips and summary, the page's commands, and the page tabs. It is a band, not a card: a surface across the
primary region, whose content sits in a `PageContainer` of the page's measure so header and content share their edges,
and which ends in its own full-width separator, drawn with or without tabs. Page tabs stand on that separator and the
selected underline lies over it, so the tabs read as the switch of everything below. A grammar decides the band's
paint and the separator's weight; the slots, the inset, the separator and where tabs stand are the same everywhere.

### Page

A page is one route's frame: the page header band (PageHeader's slots, given as data) across the region, then the
body in the page measure and gutter. The page is the single owner of the page inset and the vertical rhythm: the band
and the body, and the body's sections, sit a region step apart, and the body clips past its content box so nothing in
it reaches across the gutter. Layout frames place regions and never inset a page. A page without a band starts its
body one region step down. A bleed page is an app surface: no gutter, no block padding and no clip, its body filling
the region, under the band or the trail alone. Skeleton passes to the band; the body's blocks own their loading.

### Diagram

A diagram draws a structure the reader follows: `MermaidDiagram` renders an article's Mermaid source in the grammar's
tokens, `FlowGraph` draws nodes and edges the app holds (flowchart shapes, edge labels, layered or radial layout). A
diagram is one named image in a frame that reserves its height in every state: the loading skeleton keeps that box,
and a source the renderer refuses stays in the region as code under an error. A labelled edge is also spoken in the
graph's text list. A grammar decides the frame and the paint; the reserved box and the error carrier are the same
everywhere.

### Shell

The shell is the frame of an app: one shell owns the bar, the navigation and the mobile drawer, and one owner
scrolls each axis. Every bar control is `control`. There is no bottom tab bar: on a phone the navigation is the
drawer.
