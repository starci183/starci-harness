# Common

Common is the layer every grammar is drawn over. It owns every renderer, prop and anatomy, the spacing rhythm,
the size ladder, the presentation states, the intent map and the root mechanics, and it owns no colour.
A grammar changes paint inside its scope and nothing else ([contract](contract.md)), so everything in this
file holds in every grammar.

Owner of the code: `@starci/grammar src/common/**` (registry, spacing, state, the Common sheets) and the
renderers it re-exports from `src/core/**`, whose physical path is internal storage.

## Anatomy: wrap HeroUI once, never redraw it

Each renderer is a HeroUI component (or a composition of them) with its parts, roles, keyboard and focus kept;
[vendor/parity.yaml](../vendor/parity.yaml) lists what must stay. Common adds three things the vendor leaves
to the caller:

- **Context instead of props.** A painted surface (`SurfaceCard`, `SurfaceListCard`, a painted
  `SurfaceAccordionCard`, `Sidebar`, `Dialog`, `AlertDialog`, `Drawer`, `Popover`) opens a nesting context.
  Fields, choice controls and `Tabs` read it to pick their look, the way HeroUI's own `secondary` field exists
  for a field inside a surface: on the canvas a field is a filled box, inside a surface it would vanish into
  the same white, so it takes the neutral fill. The surface derives its own depth from the same context: the
  top layer is raised, a nested layer is subordinate, never both raised
  (`owner: src/core/surfaceContext.tsx`). The app omits these props; lint refuses a static one.
- **Typed meaning instead of looks.** A command declares `intent`, a destination is an `href`, a status is a
  `PresentationState` (`neutral`, `informative`, `affirmative`, `cautionary`, `negative`, `pending`,
  `unavailable`; `owner: src/common/state.ts`). A state paints a fact authority already settled; it never
  creates one.
- **Rule stamps.** Every renderer stamps the universal rule ids it realises in `data-contract`, and every
  grammar accounts for each id as inherited or grammar-owned with evidence
  (`owner: src/common/conformance.ts`, catalogue generated from [ui](../ui/README.md)).

## Spacing: one scale, four relationships

`COMMON_SPACING_SCALE` is the only scale (`owner: src/common/spacing.ts`); a grammar does not re-space. Its
rungs are whole and unevenly spaced, so half a rung is off the ladder, not between two. Common publishes the
rhythm as four relationship tokens plus a page inset, each named for what it separates, not for its size:
`--grammar-inline-gap`, `--grammar-row-gap`, `--grammar-section-gap` and `--grammar-region-gap` are the relations
GAP-2 to GAP-5, and `--grammar-page-inset` is the page edge, responsive and owned by `PageContainer`. Which
relation a gap expresses is the choice `space.choose.gap` in [ui/presentation](../ui/presentation.md#space), with
the side-contact law for insets; that the tokens stay strictly ordered is `DNA-COMMON-RHYTHM-MONOTONIC`. Because
the rhythm is a relationship, a denser rhythm changes the four values together in Common, never one of them in a
grammar.

## Size and intent

The shared size ladder, the corner rule and the intent x placement map are part of every grammar's
interface, so they are stated once in [contract](contract.md#the-shared-scale). Common implements them.

## One root

Mount exactly one grammar root (`<Grammar>GrammarRoot`) around the whole app, with the grammar stylesheet
imported once. Every overlay trigger renders inside it: `Dialog`, `AlertDialog`, `Drawer`, `Popover`,
`DropdownMenu` and the field popovers portal into the nearest root (`owner: src/core/overlayScope.tsx`), so
they keep the grammar's tokens, theme and forced-colours mapping; a trigger outside the root opens an unstyled
overlay in `<body>`. Mount exactly one `Toaster`, inside the root; it renders in place with one polite and one
assertive live region, so a second one duplicates every announcement. The root also owns client-side
navigation: it takes the app router's `navigate` and `useHref` once and mounts the vendor `RouterProvider`, so every
Grammar `href` (a `Link`, a `Button`, a `Breadcrumbs` item, a `ListBox` or `Menu` item, a `DataTable` row, a
`FlowGraph` node) navigates inside the app without a reload; the app mounts no router provider of its own. This is
the only statement of these rules; grammar files and lint cite it.

## Idioms

An idiom is a composition of published renderers that has been chosen at least twice for the same job. A
composition seen once is not house style and is never cited as one. Take an idiom whole: half of a
relationship is a different shape.

| Idiom | When | Composition |
|---|---|---|
| Joined bands | One heading holds several kinds of content | One `SurfaceCard` with joined composition; full-bleed bands divided by separators, never inner cards. Insets follow side contact (gap G-7) |
| Neutral summary band | A card states a measure before its evidence | The first band on the secondary surface; it is a summary, never a verdict. It takes a state colour only for a proven outcome |
| Bottom action band | A card has one way onward | One action in the last band against the bottom edge; at most one per card |
| Art is a band | Generated imagery belongs to a surface | Its own full-bleed band, the asset's ratio kept, no inset frame; decorative art is `aria-hidden` |
| Title and one supporting line | A row, cell or surface names a thing | Title, then one muted qualifying line, stacked at the tightest gap; `SurfaceCopyGroup` owns it (gap G-8) |
| Pending is the same tree | Data is loading | The finished tree at rest: same card, bands and row count, skeleton on every owner, never a spinner; an action that must not fire yet is disabled, not removed |
| One highlighted card | Peers share a view and one is the next step | `isHighlight` on that one card only; the peers keep the same props, so the difference reads as rank (gap G-9) |
| Single-column form | A step asks for input | `Form`, fields in one column, the status sentence, one commit; secondary ways onward follow as text actions, never a second commit |

## Playbook shapes

A shape is a business situation and the composition that answers it. Read in this order: name the shape and
its one outcome; then the reference, if supplied; then the idioms in the shape's order; then confirm every
renderer and prop against the installed package; then compose what remains from Common semantics.

**A reference contributes** region order, which decision dominates and what folds away. It never contributes
layout, brand, palette, type scale or anatomy: those are owned by the grammar and by [ui](../ui/README.md).
A reference that can be honoured only by breaking an idiom is evidence about the reference.

**Authority split.** Product facts and approved region order come from the product's spec; meaning from
[ui](../ui/README.md); anatomy and style from the selected grammar. A material choice whose answer is absent
from all three is asked, not invented.

| Shape | Composition |
|---|---|
| Single-offer decision page | Explanation in the primary column as joined bands (summary band, art band, title-and-line rows); the decision card highlighted in the rail of `PrimaryRailLayout` with the bottom action band; pending as the same tree |
| Multi-section overview | One joined card per section; a summary band where a section states a measure; a bottom action band where it leads on; one highlighted section (the next step) per page |
| Sign-in | Surface header as title and line; one single-column form per step, one commit each; the way to the other journey last, as a text action |
| Settings or profile form | `Form` (server refusals in `validationErrors` by field name) around one `Fieldset` per named group; each field carries its own label, description and error, and short fields that pair sit in a `FormGrid` so a row aligns on its controls; a value the product holds is a `CopyField`; a switch applies immediately, a checkbox submits with the form; one commit after the last group |
| Destructive confirmation | Entry button `intent="destructive"`; `AlertDialog` naming the consequence, dismiss first and focused, confirm last; a reversible action is not confirmed: act, then offer undo in a toast |
| Secondary task | `Drawer` (side on wide layouts, bottom on a phone) or `Dialog` when the task is short and must block the page; one overlay at a time (gap G-10) |
| App shell | One root; `WorkspaceShell` owns the frame, the bar and the mobile drawer; bar controls share one height; one `Toaster` last in the root; the shell's meaning is in [ui](../ui/README.md) and its checks in the grammar lint |
| One question per screen | Progress from a real count; the prompt as the heading; the answer choices as the control itself (radio group, checkbox group or segmented control), each choice a full-width row; one commit at the bottom, disabled until a choice exists so nothing moves; the outcome as an Alert in place above the action; an optional explanation in a bottom drawer. A wrong answer is an outcome, never a field error |
| Result | One highlighted card with the display heading, the score and its facts as real labelled values, one commit onward and a quieter way to review; an earned reward announced politely as a toast |
| Browse and pick | A labelled search field; filters as a selectable tag group; a list box when picking is the task, a list card when rows only report; pagination; pending keeps the list shape |
| Data status of a region | Loading, forbidden, failed and empty (a signed-out viewer never reaches a region: the session gate redirects) render through the product's one status view in that region's place, inside the unchanged surface; the recipe belongs to [code/fe](../code/fe/README.md) |

A grammar file lists only the shapes it composes differently.
