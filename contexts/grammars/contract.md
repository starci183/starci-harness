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

## The shared scale

A row of controls reads as one object, so its controls share one height. The ramp has the vendor's names and
three steps in equal increments (reference 32, 40, 48 px), held at every breakpoint (ruling `control-height-40`):
`md` is the default of every standalone control; `sm` is for a control nested in a collection item or a dense
toolbar; `lg` is for a landing hero call to action. `control` is not a fourth height: it marks a control inside a
bar row and renders at `md`; the bar composition sets it and the app never passes it (decision D-3). HeroUI steps
controls down on desktop and draws fields one step shorter than buttons; the contract removes both, because mixed
rows are exactly where they disagreed ([vendor/heroui](../vendor/heroui.md#how-sizes-align)). Fields have one
step, `md`. Badges and glyphs keep their own smaller scales: they label, they are not pressed. When a step is
chosen is [ui/scale](../ui/scale.md). The heights are Common tokens (`--grammar-control-height-*`, decision D-4).

**Drawn height and target are two facts.** The box is the ramp; the hit area has its own floor (coarse and fine
pointer, values in [ui/proof/thresholds.yaml](../ui/proof/thresholds.yaml)). Every pressable part extends its hit
area to the floor without redrawing its box, so a 40px control meets a 44px touch floor; a row of `sm` controls
whose extensions would overlap takes `md` on a coarse pointer. The floors are Common tokens
(`--grammar-target-*`).

**Corners are roles.** HeroUI derives every corner from `radius` and `field-radius`, and a Button's corner is
three times `radius`, so whether a Button is a pill follows from the grammar's radius, never from a per-button
choice. The grammar publishes the corner roles an app may name (`tiny`, `compact`, `control`, `surface`, `hero`,
`pill`) as `--grammar-radius-*`, each set from its base radius; an app never writes a literal corner, which would
freeze one grammar's value into every grammar.

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
that this card is the next step, so one per view. A grammar decides the material (fill, edge, radius) and whether
the label sits inside the material; the slots and the depth logic are the same everywhere.

### Button

Button is a command (`onPress`) or a destination (`href`) drawn as a button; the kind decides semantics, the shape
only paints. Its variant comes from intent and placement, its size from the ramp: `sm`, `md`, `lg`, and `control`
in a bar. `pending` means this control accepted work: label and box unchanged, a second press refused.
`disabled` means the work cannot start; `skeleton` means the content never resolved. A grammar may repaint each
vendor variant through its tokens and give the press its own motion; it keeps the variant names, so the emphasis
ladder means the same in every grammar. `IconButton` is the same contract drawn square or round at the step;
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

A chip is a label, not a target, on two axes: tone (which settled fact) and emphasis. A grammar's Badge is the
vendor chip at soft emphasis and below the ramp, so status reads as tinted text, never as a filled button-like
shape. When peers are picked from, the chip is a `TagGroup` tag, interactive and keyboard reachable, on the ramp
at `sm` (the default: filter rows are dense) or `md` when its row holds `md` controls.

### Input

A field is a label, a control, a description and an error slot; the label is the accessible name and the error
lives in the field's own slot. Its look comes from context: `primary` on the canvas, `secondary` inside a surface,
so a field never vanishes into its surface; the app omits `variant`. A field has one step, `md`, so a field and
its submit align and mobile text stays at the size that prevents focus zoom.

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
a data table when columns matter. n rows have n-1 seams, separators are full bleed, rows and captions share one
content edge, and a description is one line by default. The leading slot follows the ramp, so a row's identity
mark matches the controls beside it. Loading shows the same rows at rest.

### Alert

An alert is feedback in the page; a toast is the same anatomy in the one region. The tone is a settled fact and
paints only the indicator and the title; the surface stays neutral, or takes the tone's soft tint in the `soft`
appearance. A negative tone is announced assertively, everything else politely. A toast with an action, or a
negative one, stays until dismissed.

### EmptyState

An empty state is a region with nothing to show, or whose read failed: one message in the region's place inside
the unchanged surface, and one action only when a real next step exists.

### Avatar

An avatar is an identity mark on the ramp (`sm`, `md`, `lg`, and `control` in a bar), so it matches the controls
beside it. Without an image it draws generated initials coloured by a stable seed; an agent carries a badge and an
accessible name that says so; a group is one composite at one size.

### Shell

The shell is the frame of an app: one shell owns the bar, the navigation and the mobile drawer, and one owner
scrolls each axis. Every bar control is `control`. There is no bottom tab bar: on a phone the navigation is the
drawer.
