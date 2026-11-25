# `@starci/grammar`

`@starci/grammar` splits a UI kit into one shared contract and several visual families. The
contract has no business logic. Common owns the typed props, semantics, renderer anatomy, universal
states and scales, and the family registry. Core and Offset Pop are sibling families.
Each one implements the same contract with its own scoped visual DNA. The package contains no
routes, domain entities, product decisions or feature-named shells.

Common publishes its renderers through `COMMON_GRAMMAR_COMPONENTS`. Every family renders all of them. A family changes presentation
only: props, DOM, ARIA and keyboard behaviour stay the same.

## Install

```sh
npm install @starci/grammar @heroui/react react react-dom
```

The package needs Node.js 22 or newer. Its peer dependencies are React 18+, `react-aria-components` and `@heroui/react`
3.2+. Mermaid (for `MermaidDiagram`) is a pinned dependency, imported lazily on the first diagram. Load the HeroUI stylesheet once in the app, as HeroUI's own setup describes. Then import
exactly one Grammar family stylesheet. Each family sheet already imports Common anatomy first.

| Entry point | Root component | Stylesheet |
| --- | --- | --- |
| `@starci/grammar/common` | `GrammarRoot` (neutral) | `@starci/grammar/common/styles.css` (`common.css`) |
| `@starci/grammar/core` | `CoreGrammarRoot` | `@starci/grammar/core/styles.css` (`core.css`) |
| `@starci/grammar/offset-pop` | `OffsetPopGrammarRoot` | `@starci/grammar/offset-pop/styles.css` (`offset-pop.css`) |

The Core and Offset Pop entry points re-export all of Common, so an app imports its components and
its root from one place.

## Usage

### Button variant

`Button` and `IconButton` have three looks, one prop:
`variant` is `primary` (solid, the ONE main action of a card or region), `border` (an outline, every secondary action; the default) or
`danger` (a destructive action: delete, disconnect, stop for good). Grammar draws them with HeroUI's `primary`, `outline` and `danger`
(`BUTTON_VENDOR_VARIANT`); there is no intent, step, placement, ghost, tertiary, secondary or soft-danger look, and a Button looks the
same in a row, a bar or a dialog. `tone` (`accent`, `info`, `success`, `warning`) is only the colour of a `primary` (a toned notice's action);
the types refuse it on `border` and `danger`. A text link is a `Link`, never a Button. The [button props catalog](docs/button-variant-props.md)
lists the published values.

`AlertDialog` renders its border cancel first, focuses it on entry, then renders its danger confirm last. The `Leaves/Button variant`
stories show the three looks in light and dark, including a toned primary, destination, pending and skeleton states.

### App shell

The [app-shell canon](../../contexts/ui/composition.md) owns `FE-APP-SHELL-1` through `FE-APP-SHELL-7`.
The `Compositions/App shell` stories show the fixed shell, grouped sidebar, icon rail and mobile drawer.

- `size="control"` is available on `TextAction`, `IdentityLockup`, `Switch`, `Avatar` and `AvatarButton`; `Button`, `IconButton`, `Input` and `SearchField` take the one control height.
- `SidebarItem.badge`, `badgeLabel` and `badgeMax` show and announce unread counts in both sidebar presentations. `SidebarGroup.placement="end"` places settings groups after the main groups and pushes them to the bottom.
- The collapsed Sidebar uses Grammar's internal `AnchoredTooltip` on hover and focus. HeroUI Tooltip positions the annotation beside the selected collection item and portals it into the same family DOM scope, preserving HeroUI's collection anatomy. `onAction` runs for every activated destination, including the selected item, so a drawer can close consistently.
- A fixed `WorkspaceShell` frames its `compactHeader` slot as the mobile opener band; pass a client `Drawer` with an ellipsis `IconButton` trigger. The `navigationDrawer` form owns the same band when it supplies the opener.
- `AvatarButton seed` passes the stable identity id to Grammar's shared `Avatar`, which draws two initials on a name-coloured plate whenever `src` is absent; an uploaded `src` takes precedence.
- `DropdownMenuItem.mark` accepts a decorative identity mark and is mutually exclusive with `iconSource`. A destructive item uses `tone="danger"`.

Compose the interactive shell in a Client Component, where its glyph functions, callbacks and
state are created. A server layout can pass its rendered children to that component. Load the
selected family stylesheet and place the family's root around the layout.

```tsx
// components/WorkspaceFrame.tsx
"use client"

import { Sidebar, WorkspaceShell } from "@starci/grammar/core"
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline"
import type { ReactNode } from "react"

const groups = [{ id: "main", items: [{ id: "home", label: "Home" }] }]

export default function WorkspaceFrame({ children }: { children: ReactNode }) {
  return <WorkspaceShell primary={children} primaryLabel="Workspace" navigation={<Sidebar label="Workspace" groups={groups} />}
    navigationLabel="Workspace navigation" navigationDrawer={{ title: "Navigation", openLabel: "Open navigation",
      closeLabel: "Close navigation", source: EllipsisHorizontalIcon, content: <Sidebar presentation="drawer" label="Workspace" groups={groups} /> }} />
}
```

### Common (neutral structure only)

```tsx
import { Button, GrammarRoot, Page, SurfaceCard } from "@starci/grammar/common"
import "@starci/grammar/common/styles.css"

export const App = () => (
  <GrammarRoot>
    <Page>
      <SurfaceCard label="Welcome"><Button variant="primary">Start</Button></SurfaceCard>
    </Page>
  </GrammarRoot>
)
```

### Core

```tsx
import { CoreGrammarRoot, Grid, Page, SurfaceCard } from "@starci/grammar/core"
import "@starci/grammar/core/styles.css"
import "@starci/grammar/core/theme.css" // optional: Core's default palette; skip it to use your own

export const ProductSurface = () => (
  <CoreGrammarRoot>
    <Page>
      <Grid
        kind="main-rail"
        primary={<SurfaceCard ariaLabel="Main">…</SurfaceCard>}
        rail={<SurfaceCard ariaLabel="Progress">…</SurfaceCard>}
      />
    </Page>
  </CoreGrammarRoot>
)
```

`STARCI_CORE_DNA` exposes the immutable design values. `STARCI_CORE_SPACING_SCALE` exposes the
4px spacing steps. `STARCI_CORE_TOKEN_NAMES` lists the CSS variables, and
`STARCI_CORE_TOKEN_DEFAULTS` / `STARCI_CORE_DARK_TOKEN_DEFAULTS` hold their exact packaged values.
Core's DNA declares a shadow without a border at top surface depth, and a border without a shadow
at nested depth.

### Offset Pop

```tsx
import { Button, OffsetPopGrammarRoot, SurfaceCard, Toaster } from "@starci/grammar/offset-pop"
import "@starci/grammar/offset-pop/styles.css"
import "@starci/grammar/offset-pop/theme.css" // optional: the pastel default palette; skip it to use your own

export const App = () => (
  <OffsetPopGrammarRoot>
    <SurfaceCard label="Today"><Button variant="primary">Play</Button></SurfaceCard>
    <Toaster label="Notifications" dismissLabel="Dismiss" />
  </OffsetPopGrammarRoot>
)
```

Offset Pop is a playful family and stays product-neutral. Its signature is an ink outline, a hard
offset shadow and a pink decision accent. Text that uses the accent is drawn in a text-safe accent
(`--accent-soft-foreground`). Reduced motion removes every transform. The DNA is
`OFFSET_POP_DNA`, which has the same keys as Core's plus two groups: `offset` (`x`, `y`,
`outlineWidth`, `ink`, `shadowInk`) and `palette` (`pink`, `blush`, `yellow`, `mint`,
`critical`). It also exports `OFFSET_POP_SPACING_SCALE`, `OFFSET_POP_BAND_TOKEN_NAMES`,
`offsetPopGrammar` and `offsetPopRuleConformance`.

Every Common renderer works under the Offset Pop root. Most take the family look from four Common
tokens the family root sets once, so no renderer needs a rule of its own:

| token | Offset Pop value | what follows it |
|---|---|---|
| `--grammar-border-edge` | the 2px ink outline | a code block, a GradedChoice answer and its key, the other party's message |
| `--grammar-shadow-popover` | the hard offset | a popover, the reaction picker, a lifted Board card |
| `--grammar-shadow-lift` | the small hard offset | the pane drawer trigger |
| `--starci-core-surface-radius` | the family card radius | SurfaceCard, Board columns and cards, a framed EmptyNotice |

`components-content.css` covers the renderers that draw their own edge. Board cards wear the outline
and the small offset, and the press collapses it. Progress, ProportionBar, SegmentBar and FunnelChart
tracks get the ink ring, and Meter keeps its own track. Open GradedChoice answers are pressable
stickers. SchemaForm marks, the agent's proposal and ConflictCard sides are outlined. A
`SurfaceCard emphasis="accent"` throws its offset in pink, because it is the chosen card. Every row seam (a
list row, a disclosure item, a note, schema or schedule row, a DataTable row and its mobile list, a description pair, an
upload or media row, an interval row) is one 2px ink line: the family root sets Common's `--grammar-seam-width` to
`--offset-pop-outline-width`, and Core leaves it the 1px hairline. An app sets the `--starci-core-card-radius` hook to change the card radius;
it never restyles a renderer.

## Client-side navigation

Every Grammar root (`GrammarRoot`, `CoreGrammarRoot`, `OffsetPopGrammarRoot`) accepts `navigate(path)` and `useHref(href)` and
mounts react-aria's `RouterProvider`. Pass your router's functions once at the root and every Grammar `Link`, `Button href`,
`Breadcrumbs` item, `ListBox`/`Menu` item `href` `href` navigates inside the app without a reload.

```tsx
import { useHref, useNavigate } from "react-router-dom"
import { CoreGrammarRoot } from "@starci/grammar/core"

export const Root = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate()
  return <CoreGrammarRoot navigate={(path) => navigate(path)} useHref={useHref}>{children}</CoreGrammarRoot>
}
```

Mount the root inside the router. Without `navigate` the links behave as plain anchors.

`Link` takes either its string label as `children`, or structured `media` using `ImageProps` with a required accessible
destination `label`; those forms are mutually exclusive. The media form renders `Image` internally, so its dimensions,
fit, loading and fallback remain Image's. A transparent brand mark uses `plate="none"`, which leaves its whole alpha
shape unclipped. Both forms keep native anchor, root-router, external-tab, disabled and `onFollow` semantics.

```tsx
<Link href="/workspaces" label="Open workspaces" media={{ src: "/brand/logo.png", alt: "", width: 113, height: 40, fit: "contain", plate: "none" }} />
<Link href={originalUrl} kind="external" label={filename} media={{ src: previewUrl, alt: filename, aspect: "auto", fit: "contain" }} />
```

`ListRowData` keeps a string `title`. With `href` its title is a `Link`; optional `onFollow` runs alongside navigation,
for example to close the popover that owns the list. A row without `href` takes no `onFollow`. Commands and menus stay
siblings of that title link; the row itself is not an interactive wrapper. Loading rows render no title link.

`Figure` data may carry `href`, optional `onFollow` and `isDisabled`; the whole figure cell becomes one native destination
through the root router, with its default-tone number treatment preserved. Loading and disabled figures open nothing.
`ItemAction.isPending` uses the Button's action-owned busy spinner and blocks duplicate presses; `isLoading` continues
to mean unresolved-content skeleton geometry.

`ColorSwatch` previews actual color data using the vendor's typed `color`, a required accessible `label` and optional
`isLoading`. Existing `Cluster` and `Text` place the swatch beside its visible name and value. It takes no arbitrary
content, class, style, size or status tone; the vendor owns the color preview and transparency checkerboard.

### MermaidDiagram

`MermaidDiagram` renders Mermaid text (an article's `mermaid` fence) to SVG in the browser. Mermaid is imported on the
first diagram that mounts, initialised with `theme: "base"`, `securityLevel: "strict"` and colours resolved from the
root's semantic tokens (so family, theme and token overrides apply), and re-rendered when the root's theme changes.
`height` (`sm` 16rem, `md` 24rem, `lg` 32rem) is the least canvas box every state keeps; `isLoading` draws that box
with a skeleton and loads nothing. A source Mermaid refuses becomes an error inside the same frame: an `Alert` with
`errorTitle`, then the source as a `FencedCodeBlock`.

The first view is always the whole drawing, contain-fitted (zoom = min(1, room width / width, room height / height)) and centred, clear of the zoom controls row, so no node is cut on any side. A tall drawing grows the canvas first (up to 45rem, 35rem on a phone); a flowchart or state diagram too wide to read across is laid out top-down (always under 480px). A drawing that still opens under zoom 0.85 (caption-role words under 11px) opens whole and small, and the reader zooms in by pinch, double tap or the controls.

Every edge of a flowchart is its own line: two edges never leave or enter a node at one point and never share a stretch, so no junction dot is drawn. Tones (`danger`, `success`, `accent`, `info`) paint a node (`tones`, or `class B danger` in the source), a sequence message (`messageTones`, by its place from 1) or a flowchart edge (`edgeTones`, by its place among the links from 1, or Mermaid's own edge id and class: `A r1@--> R`, then `class r1 info`). `legend` draws a row under the canvas saying what each edge tone means. A node names an icon with Mermaid's own `R@{ icon: "redis" }` (its `[(…)]` shape stays) and `icons` maps the name to what the app draws, one line high before the words.

```tsx
<MermaidDiagram label="Request flow" source={fence.value} errorTitle={t("diagramFailed")} />

<MermaidDiagram
    label="Read and write paths"
    source={`flowchart LR
  A[Web] r1@--> R[(Redis)]
  M[Admin] w1@--> R
  R@{ icon: "redis" }
  class r1 info
  class w1 accent`}
    icons={{ redis: <img src="/logos/redis.svg" alt="" /> }}
    legend={[{ tone: "info", label: "Read path" }, { tone: "accent", label: "Write path" }]}
/>
```

### Fragment

`<Fragment reason="...">` is the escape hatch: a region that renders no element, only its children, like React's Fragment, where any markup, any class name and any library is allowed, because no Grammar component fits. It takes `reason` (required, for the lint and the inventory) and children, and adds no DOM node, paint or inset of its own. A file that also needs React's Fragment imports this one as `import { Fragment as GrammarFragment } from "@starci/grammar"` (the lint follows the alias; React's Fragment and `<>` open no region). The Grammar lint reports nothing inside it; every rule outside it stays. The Grammar draws no graph and imports no graph or animation library (`npm run check:libraries`; motion is the CSS transitions its tokens drive), so an app that needs `@xyflow/react` or `motion` uses it inside a `Fragment` and declares it itself. the fragment inventory script (from `@starci/eslint-grammar-core`) lists every use.

```tsx
<Fragment reason="workflow graph editor"><WorkflowCanvas nodes={nodes} edges={edges} /></Fragment>
```

### Flat table, section head, scroll law, tab chips

- `DataTable` has one flat look and is never a card: the column labels 12 / 500 muted over a `--border` line, hairline (`--separator`) rows, no fill, radius, shadow or outer edge; `footer` takes a `Pagination` with its `summary`. A table stands under its `Section`: `<Section title count filter={…}><DataTable … footer={<Pagination … />} /></Section>`. A selected row is `--default` with a 2px accent bar on its start edge.
- A `Section` head is one row: label (14, 500) and a count chip at the start, at most one `Link variant="head"` (label then the sliding Grammar arrow icon), one `IconButton` or one neutral sm text `Button` at the end. `description` is a caption below the body (12, muted). Lint: `section-head-action`.
- The page header band is sticky; in a workspace page each pane scrolls on its own with its head sticky and no visible scrollbar. `Pane content="cards" | "full"`: only the content of a cards pane is capped at 80rem; chat panes are full.
- Tab counts are 12px chips, grey; pink only with `isAttention`; page tabs hide a 0.

## Family scope and the overlay portal rule

A family paints only inside its root. Each family stylesheet is scoped to
`.grammar-common-root[data-grammar-family="<id>"]` inside its own cascade layer:
`starci-grammar-common` comes first, then `-core` and `-offset-pop`. No family sheet
imports a sibling family's sheet. So two families can share a page, each inside its own root, and
nested roots resolve to the innermost one.

Overlays follow the same rule. `Dialog`, `AlertDialog`, `Drawer`, `Popover`, `DropdownMenu`, and
the list and calendar popovers of `Select`, `ComboBox`, `DatePicker` and `DateRangePicker` portal
into the **nearest** `.grammar-common-root`, not into `document.body`
(`resolveOverlayContainer`, `GRAMMAR_ROOT_SELECTOR`). Because of this, family selectors, tokens,
and the forced-colours mapping still reach the overlay surface. Two things
follow for apps:

- Render overlay triggers inside the family root. An overlay opened from outside every root falls
  back to `document.body` and loses the family styling.
- Mount one `<Toaster>` **inside** the family root, usually as the root's last child. Push toasts
  with `toastQueue.add({ title, tone, action, timeout })`, or give the Toaster its own
  `createToastQueue()`. A Toaster outside the root renders unstyled.

## Tiers and children

`src/core` holds four folders, the ladder: **leaf** (one element or vendor part), **branch** (a leaf plus its own interaction state), **composite** (a fixed arrangement of
leaves and branches) and **frame** (owns a region: tracks, inset, scroll, ground or an overlay). A tier imports nothing above itself, and `data-tier` on the
rendered element is the folder (`tiers.grammar` of `@starci/hfs`; the machine check reports `FE_GRAMMAR_TIER_DIRECTION` and `FE_GRAMMAR_TIER_STAMP`).

`children` belongs to frames. Every other props type carries `NoChildren` (`children?: never`) or, for a leaf's text label, `LabelChild` (`children?: string`), both exported,
so nested JSX under a leaf, branch or composite fails to compile for every caller. A node a component shows has a named prop for its role (`body`, `trigger`, `media`,
`control`, `text`). `Text` alone keeps inline content, and `Freestyle` alone keeps `className`. `starci-grammar/tier-props` in this package's ESLint config refuses
a `children` or `className` that breaks the tier.

## Components

Each group below matches a Storybook group. Run `npm run storybook`: every story renders inside
the family and theme chosen in the toolbar. It shows the default, disabled, invalid, pending and
selected/current states where they apply. Overlay stories open by default.

**Leaves (26).** Avatar, Badge, Button, CalendarDay, ColorSwatch, Divider, GrammarRoot, Heading, Icon,
IconButton, IconTile, Illustration, Image, Kbd, Link, Mascot, Meter,
Progress, ProgressCircle, RelativeTime, Skeleton, Spinner, StateMark, StatusDot, Text, TextAction.

`Mascot` renders generated character art at one size scale: `size` `sm` (96px), `md` (160px, the default) or `lg`
(240px) square, the Common tokens `--grammar-mascot-sm|md|lg`, or `hero`, which fills its host's height up to
`--grammar-mascot-hero-max` (30rem) for a split screen such as a sign-in page. The art is always contained on a
transparent ground with no plate. Below 48rem a square step drops one step (lg to md, md to sm); a hero is absent
below 64rem unless `visibility="always"` keeps it, as the lg box. It is decorative by default (`alt=""` hides it from
assistive technology; a non-empty `alt` names it) and takes the asset-slot props of `Image` and `MediaFrame`
(`assetSlot`, `assetSha256`, `assetPrompt`); the grammar lint requires `assetSlot`
(`starci-grammar/mascot-asset-slot-required`).

```tsx
<Mascot src="/images/mascot/welcome.webp" size="lg" assetSlot="onboarding.welcome" assetSha256={sha} />
```

**Media (Image, Video, Illustration).** Three leaves draw every picture, recording and piece of decorative art; a raw `img`, `video`
or `picture` is refused (`starci-grammar/no-raw-media`, R442). Each names its file by `src` (a resolved URL) or by a `staticsKey` (an asset of the
app's statics, resolved by one `StaticsProvider baseUrl` mounted once; a key is a relative path of plain segments).

- `Image`: `alt` (required; `""` only when decorative), `ratio` (`1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `auto`), `fit` (`cover`, `contain`),
  `renditions` (`{ src | staticsKey, width }` or `{ …, density }`) with `sizes` drawn as `srcset` and `sizes`, `loading` (lazy by default, async
  decoding), `caption` (a `figure`), `zoom` (`{ openLabel, closeLabel }`: a lightbox on the overlay mechanics), `isLoading`. A shimmer stands in the box
  while it loads and a neutral glyph when it fails; the corner is the theme's one radius.
- `Video`: `title`, `sources` (`{ src | staticsKey, type }`, in order of preference; `video/mp4`, `video/webm`, `video/ogg`, HLS
  `application/vnd.apple.mpegurl`, DASH `application/dash+xml`), `poster`, `ratio` (`16:9`, `9:16`, `1:1`), `controls`, `tracks` (WebVTT
  captions or subtitles), `autoPlay` (muted and inline, skipped under reduced motion), `loop`, `loading` (lazy: no stream is requested until the box nears
  the viewport), `labels` (the error and unsupported words), `isLoading`. MP4 and WebM play natively; HLS plays natively where the platform reads it and through
  `hls.js` elsewhere; MPEG-DASH plays through `dash.js`. Both libraries are dependencies of this package, imported dynamically on the first stream that needs
  one, never from a CDN; an app that plays only files ships no player.
- `Illustration`: decorative by default (`alt` empty, `aria-hidden`), `ratio` (the Image ratios, or `fill` for the whole box of its host), `compact` (another
  source and ratio below 48rem, through a `picture` source), `fit`, `loading`, `isLoading`.

```tsx
<StaticsProvider baseUrl="/statics">
  <Image staticsKey="photos/team.webp" alt="The team" ratio="4:3" renditions={[{ staticsKey: "photos/team-640.webp", width: 640 }]} sizes="100vw" caption="Our team" />
  <Video title="Intro" sources={[{ staticsKey: "video/intro.webm", type: "video/webm" }, { staticsKey: "video/intro.mp4", type: "video/mp4" }]} poster={{ staticsKey: "video/intro.jpg" }} />
  <Illustration staticsKey="illustrations/hero/wide.webp" ratio="21:9" compact={{ staticsKey: "illustrations/hero/narrow.webp", ratio: "4:3" }} />
</StaticsProvider>
```

`EmptyNotice` is the one empty state: `scope` is `region` (the default, an empty Section, list, table or no-match) or `page` (a first visit, an empty page, a
paywall, a 404, a 500). Its `media` is `{ icon }` (a glyph on a soft brand-tone circle) or, on `scope="page"` only (the type refuses it elsewhere),
`{ illustration }` (an Illustration at 160px, 120px below 48rem). It takes one primary action and at most one `secondary`.

```tsx
<EmptyNotice scope="page" message="Page not found" description="The address does not exist."
  media={{ illustration: { staticsKey: "illustrations/errors/not-found.webp" } }} actionLabel="Back to the home page" actionHref="/" />
```

**Forms (23).** Checkbox, CheckboxGroup, ComboBox, CopyField, DateField, DatePicker,
DateRangePicker, Field, Fieldset, FileDropzone, Form, Input, NumberField, OtpInput,
PressableField, RadioGroup, Rating, SearchField, Select, Slider, Switch,
Textarea, TimeField. Every Field-contract control takes `label`, `description`, `errorMessage`,
`isRequired`, `isDisabled`, `isReadOnly` and `isInvalid`, and draws HeroUI's field order: label, control,
description, error. `Select`, `ComboBox`, `SearchField` and `Form` also take `isPending`. `OtpInput` names the
code with `label` or an existing label's `labelledBy`.

`CopyField` is a read-only value with its copy action inside the field, at its end, as tall as every single-line
field: `label`, `value`, `description`, `copyLabel`, `copiedLabel`, `copyErrorLabel` (the app's words), `onCopy`,
`isDisabled`, `isLoading`. A long value is truncated in the middle, whole in a Tooltip on hover and focus and whole
for a screen reader. `masked` with `lastFour` draws bullets and the last four characters; its `onCopy` resolves the
clear value (a server reveal may be async) and the field writes it to the clipboard without keeping it. `Grid kind="form"`
lays fields in rows (`columns` 1 or 2, two once its own width holds them) whose controls stand on one line.

**Field rule** (owner, 2026-11-09). Every control spaces its parts the same way: the label (14, medium) stands 8
(`--grammar-inline-gap`) above the control, the help text, error or counter 4 (`--grammar-identity-gap`) under it, and
fields stand 24 (`--grammar-section-gap`) apart, set by the `Form`, the `Grid kind="form"` rows and columns and the
`Fieldset` fields, never by a field (a field has no outer margin). A group's description (RadioGroup, CheckboxGroup,
Fieldset) stands between its label and options, 8 on each side. A `Fieldset`'s legend is its label (8 above the fields) and
its actions stand 24 below the last field. HeroUI's own gaps, `mt-4`, `px-1` and `pt-1` on those parts are overridden. Lint
`field-label` refuses a hand-made `Text` label beside a control: pass `label` and the control draws it on this rule. The
`Forms/FieldRhythm` story shows every control kind in one `Form`.

**Overlays (9).** Alert, AlertDialog, Dialog, Drawer, DropdownMenu, Popover, Toast, Toaster,
Tooltip. Dialog, AlertDialog, Drawer, Popover and DropdownMenu support uncontrolled `defaultOpen`
and controlled `isOpen` / `onOpenChange` through the shared overlay contract.

`DropdownMenuItem` accepts either `iconSource` or `mark`, a `ReactNode` such as a logo; its public
type rejects both together. Grammar renders either in the same decorative leading slot, with the
same alignment and icon-size rule. Keep the visible item label as its accessible name and supply
the mark without visual slot CSS.

`RelativeTime` renders `<time dateTime>` for live relative copy such as "5 minutes ago" and a
countdown such as "in 5 minutes". Pass `dateTime` as a timezone-qualified RFC 3339 string and `locale`
as the active BCP 47 locale. Fractional seconds and numeric offsets such as `+0000` are accepted.
`mode="relative"` is the default. `mode="countdown"` rounds up the remaining seconds, chooses a unit,
then shows its completed count: 25 hours shows "in 1 day", and an expired countdown shows
"in 0 seconds" in English. `format="digital"` shows `m:ss` or `h:mm:ss`; `template` is serializable
copy containing `{time}`, and `expiredLabel` replaces that complete copy after expiry.
`size` (`xs`, `sm`, `md`) and `tone` (`default`, `muted`, `accent`) use Common's text presentation.

```tsx
<RelativeTime dateTime="2026-10-25T09:00:00Z" locale="en" />
<RelativeTime dateTime="2026-10-25T10:00:00+01:00" locale="en" mode="countdown" />
<RelativeTime dateTime="2026-10-25T10:00:00+0000" locale="en" mode="countdown"
  format="digital" template="Offer ends in {time}" expiredLabel="Offer ended" fallback="Loading" />
```

The server and initial hydration render show `fallback`, or the canonical ISO instant when it is
omitted. After hydration, every instance reads the same shared ticker. The first subscriber starts
it and the last unsubscribe stops it; leaves own no clock or refresh interval. Supply translated
`fallback` copy when an ISO instant is unsuitable. Invalid timestamps render the fallback and warn
in development. Time changes are not a live announcement, so a
page of timestamps does not repeatedly interrupt assistive technology. Grammar owns native
`Intl.RelativeTimeFormat` for this element; other application date display follows FE-DATE.

**DropdownMenu entries.** `entries` is a list of items and sections; the app writes data and no markup, no separator, no
className and no size. An item takes `id`, `label`, `description`, `descriptionLines`, `shortcut`, `href`, `isDisabled`, `submenu` and:

- `iconSource`: a glyph component (Tabler outline, the one set). Grammar draws it in HeroUI's leading position at 16 (`Icon` `control`,
  the icon table of contexts/ui/scale.md: the one leading icon beside 14px words), the size HeroUI's own docs example draws (`size-4`).
- `mark`: a decorative node instead of `iconSource`, e.g. an identity mark (`<Avatar size="sm" shape="rounded" isDecorative />`). The public type rejects both props together.
- `tone: "danger"`: HeroUI's `danger` variant, which colours the label and the glyph. Sign out, delete, remove, leave workspace
  and revoke are destructive; the lint rule `starci-grammar/destructive-menu-entry-needs-danger-tone` of `@starci/eslint-grammar-core` refuses such an entry without it.

A section takes `label` and optionally `selection` (`mode: "single" | "multiple"`, `selectedIds`, `onChange`). Between two
adjacent entries, when either is a section, Grammar always inserts HeroUI's own `Separator`: the app cannot forget one. The selection
mark is HeroUI's `Dropdown.ItemIndicator` in its default placement (the check sits at the start of the item, and at the end only for
an item with a submenu).

```tsx
<DropdownMenu
  trigger={<AvatarButton name="Alex Morgan" />}
  placement="bottom end"
  entries={[
    { kind: "section", id: "workspace", label: "Workspace", selection: { mode: "single", selectedIds, onChange },
      items: [{ id: "hakuen", label: "Hakuen", description: "Owner", mark: <Avatar name="Hakuen" size="sm" shape="rounded" isDecorative /> }] },
    { kind: "section", id: "account", items: [{ id: "profile", label: "Profile", description: "Name and photo", iconSource: UserIcon }] },
    { kind: "section", id: "session", items: [{ id: "sign-out", label: "Sign out", tone: "danger", iconSource: ArrowRightStartOnRectangleIcon }] },
  ]}
/>
```

**HeroUI parity.** Grammar is a wrapper of HeroUI, so a wrapper keeps HeroUI's anatomy and defaults. The vendor reference
(`contexts/vendor/` of the StarCi harness) is measured from the installed `@heroui/react` and
`@heroui/styles`; the gate `GRAMMAR_VENDOR_PARITY` fails a wrapper that renders a part HeroUI does not have, omits one it
requires, restyles what the vendor decides, or replaces a vendor default, unless an owner-pinned override declares it. `ListBox`
and `Select` are HeroUI's own list-box items (a `Label`, a `Description`, the item indicator at the end of the row).

**PaneHeader** is the head band of one pane, placed in a `PaneSection align="center"`: `title` (`headingLevel` 1 for the pane that
holds the page's subject, 2 otherwise), `description` (one muted line), `mark`, `status` (one `Badge`), `actions` (icon buttons
and at most one `Button`) and `back` (`{ label, onPress }`, drawn only below 48rem where a phone shows one pane at a time).
It is at least as tall as a touch target so the heads of a grid row share a height, truncates a long title, and takes
`isLoading` (or the band's) to keep its box under a shimmer.

```tsx
<Pane area="head" surface>
  <PaneSection align="center">
    <PaneHeader title="Alex Morgan" headingLevel={1} description="Website chat, 5 min ago" status={<Badge tone="warning">Needs a decision</Badge>}
      actions={<IconButton source={EllipsisHorizontalIcon} label="More" />} back={{ label: "Back to the list", onPress: showList }} />
  </PaneSection>
</Pane>
```

**Data views.** `Board` (`label`, `columns` of `{ id, title, count, items, empty }`), `ScheduleGrid` (`label`, `columns`, `rows`,
`items` placed by `row` and `column`, `cellLabels`, `empty`) each take `isLoading` and `error`. Charts are the ext's: `BarChart`,
`LineChart`, `AreaChart` (activity over time, `series` and `stacked`), `DonutChart` (parts of a whole: `centerFigure`, `centerCaption`,
a legend of value and share, past six parts folded into `otherLabel`, default "Other") and `Sparkline` of `@starci/grammar/core/ext/recharts`.
A PDF document is shown ONLY with `PdfViewer` of `@starci/grammar/core/ext/pdf` (pdfjs-dist, an optional peer, loaded lazily; see `src/core/ext/pdf/README.md`).
A loading view keeps the titles, headings and labels it was given and draws the rest as geometry; the app passes no count.

```tsx
<Board label="Sales pipeline" columns={stages} isLoading={isLoading} error={error} />
<ScheduleGrid label="Appointments" columns={days} rows={hours} items={bookings} empty={<EmptyNotice message="No appointments" />} />
```


**A timeline, a key and a map.** `ScheduleGrid` also draws a plan: an item with `endColumn` is one bar across its columns, with `progress` (0 to 1), `form="milestone"` (a diamond), `after` (arrows from the entries it waits on), `resize` (handles on both ends: drag, or ArrowLeft and ArrowRight on the focused handle, answered once through `onResize(edge, column)`), a row with `isGroup` and children with `parent` fold through `onRowToggle` (the app holds `isCollapsed`), and a column's `todayAt` draws the line for now. A list beside the grid hands entries in: call `startScheduleDrag(event, id)` from the `DragItem` `onDragStart`, and `onDrop(id, row, column, source)` answers with `source` `"outside"`; the keyboard path is to pick the item in the list and press a cell (`onCellPress`). `Legend` is the one-line key of the tones (`items` of `{ id, label, tone, form? }`) and wraps on a phone. `GeoMap` puts `points` (`{ id, lat, lng, count, label? }`) on raster tiles the app serves (`tiles={{ url: "/tiles/vn/{z}/{x}/{y}.png", attribution }`; no key, no vendor script), clusters the crowded ones (press to zoom in), takes `onSelect` for a single point, and lists every point for assistive technology.

```tsx
<ScheduleGrid label="Launch plan" columns={days} rows={rows} onRowToggle={toggleGroup} empty={...}
  items={[{ id: "build", row: "r2", column: "d3", endColumn: "d6", title: "Build", progress: 0.4, after: ["design"], resize: { onResize, startLabel, endLabel } }]} />
<Legend label="Status colours" items={[{ id: "late", label: "Late", tone: "danger" }]} />
<GeoMap label="Stores by area" points={cells} labels={words} tiles={{ url: "/tiles/vn/{z}/{x}/{y}.png", attribution: "© OpenStreetMap" }} empty={...} onSelect={openArea} />
```

**Navigation & Data (15).** Accordion, AvatarGroup, Calendar, DataTable,
DescriptionList, Disclosure, ListBox, MermaidDiagram, MessageStatus, Pagination, Stepper, Tabs, TagGroup, Timeline.

**The one suggestion pattern.** A quick reply, a suggested question or an empty state's shortcut is a `Cluster gap="inline"` of
neutral `Button size="sm"` (every Button size is a pill, so the row reads as suggestions): the only pattern. A Chip, a
`TagGroup` or a row of `Link`s that runs an action or sends its own label is not a suggestion. `<Cluster gap="inline" label="Suggested questions">{questions.map((q) => <Button key={q.id} size="sm" onPress={() => ask(q.text)}>{q.text}</Button>)}</Cluster>`

A `DataTable` row with an `href` is a real link in both layouts. In the table layout the vendor row navigates on a click and on Enter through `GrammarRoot`'s router (one keyboard stop, the table's focus ring), and
the row-header cell's content is also a real `<a>` stretched over the row (out of the tab order), so middle-click, "open in new tab" and copy-link work; a modifier click opens a new tab. At phone width (the list layout, under 768 px) the title is the
anchor, stretched over the whole row, the one tab stop; the focus ring is drawn on the row. A plain click navigates once through the router in both, and `onRowAction` still runs alongside.

`DataTable` `onRowAction(id)` makes every row pressable, to open a drawer: a click or
Enter / Space on the focused row (React Aria's row action, so the row is a focus stop with the table's focus ring), the pointer cursor
and the pressable list row's hover fill (`--surface-secondary`). Buttons, links and editors inside a row keep their own press; the row
title stays plain text, never a Link. `<DataTable label="Invoices" onRowAction={(id) => open(id)} columns={columns} rows={rows} renderCell={renderCell} emptyContent={empty} />`

Channel logos are Avatars: a row of them is an `AvatarGroup` of `kind: "logo"` items (`{ id, name, src, kind: "logo" }`, a
brand logo on a white surface in both themes, fitted inside with a hairline edge), and a lone logo an `Avatar kind="logo"` of the same
`size`. They are sized by `size` alone (`sm` 24 beside text, `md` 40), never by hand.

```tsx
<AvatarGroup label="Agent connections" size="sm" max={3} items={connections.map((c) => ({ id: c.id, name: c.name, src: c.logo, kind: "logo" }))} overflowLabel={(n) => `${n} more`} />
```

`PlainPressable` is exported from `@starci/grammar/common` (outside the registry): `children`, `aria-label` (needed when the content has
no text), `onPress`, `isDisabled`, `shape` (`"rounded"` default, or `"circle"` for the focus ring) and `size="control"`. Wrap your own
content to use it as a `DropdownMenu` or `Popover` trigger: `trigger={<PlainPressable aria-label="Workspace">…</PlainPressable>}`.

`Spotlight` is exported from `@starci/grammar/common` (outside the registry): `<Spotlight isActive onEnd shape isBlock>{target}</Spotlight>`
rings its target for "look here": an accent ring (`--grammar-ring-width`, offset by the same step) with a soft `--accent-soft` pulse
for `--grammar-spotlight-duration` (3s), then it settles (no ring) and calls `onEnd`; set `isActive` true again to point again.
`prefers-reduced-motion: reduce` keeps the static ring for the same time with no pulse. The ring is an outline and a box-shadow, so it
takes no layout space. The frame is an inline-block hugging the target (a block with `isBlock`); `shape` is `"rounded"` (default),
`"pill"` or `"circle"`, matching the target. Do not draw it with outline utilities in the app.
`AvatarButton size="floating"` is the 56px launcher for a floating assistant (elevated shadow); `status={{ tone, label }}` draws a
StatusDot badge on a surface ring at the top end corner (mirrored in RTL), and `label` is the button's accessible description.

`DataTable.getCellInteraction(row, columnId)` optionally supplies `onAction`, `onDragOver`,
`onDragLeave` and `onDrop`. Cells remain semantic
table cells under the existing arrow-key navigation. An actionable cell takes focus itself,
activates once with Enter/Space or a click on its plain content, and leaves nested controls to
their own actions. Native drag callbacks receive the actual inner content-frame event (`HTMLDivElement`); the caller owns
payload validation, accepted targets and effects. Highlighting takes precedence over muted tone.

`DragItem` is a native drag-source frame with `isDisabled`, `onDragStart`, `onDragEnd`,
`isSelected`, `isInvalid`, `isDashed` and an optional `tone` for the leading edge. Its `body`
must include a published control providing the operation without dragging, including selection
and a keyboard-reachable destination when used with cell actions. Selection, invalidity and the
category must also be expressed in accessible content. The frame itself adds no focus stop.

Command `Button` accepts controlled boolean `aria-pressed` for a toggle action and forwards both
`true` and `false` to its native button. Omit it for an ordinary command and keep a toggle's visible
label stable as its state changes, following the [ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).

`Video` takes `src`, accessible `title`, optional `poster`, and an optional nullable `captions` descriptor
(`src`, human-readable `label`, optional BCP 47 `srcLang` when the actual language is known). It keeps
native controls, inline playback and metadata preloading, with one default captions track when supplied.
Supply a genuine WebVTT resource timed to
the rendered media, including relevant non-speech audio; empty tracks and guessed timing do not
satisfy this contract. Null or omission exposes no track and does not claim accessible caption coverage;
the caller owns caption creation, availability and an appropriate alternative for legacy media. Wrap it in `MediaFrame`
to reserve an aspect ratio. The track URL must be same-origin unless the caller supplies
`crossOrigin` (`anonymous` or `use-credentials`) and both resource servers support the corresponding
CORS request; the renderer leaves this unset by default to preserve ordinary media loading.
The [HTML media and track standard](https://html.spec.whatwg.org/multipage/media.html#the-track-element)
defines the native loading and caption behaviour.

`Switch` takes `kind="toggle" | "compact"`. `toggle` (the default) is the standalone, prominent switch: a 72 by 40 track with a 32px thumb, for the theme switch of a bar. `compact` is a 32 by 18 track with a 14px thumb inset 2px, for a setting in a settings row, a list, a table cell or a toolbar; it draws no thumb glyph. Both kinds have the accent track when on, the field ring on keyboard focus, 45% when disabled, and a 150ms thumb travel (none under reduced motion). `size` is kept for compatibility: `size="control"` is `kind="toggle"`, `md` and `lg` are HeroUI's own sizes, and `kind` wins when both are given. `Switch` also takes
`thumbIcon` / `selectedThumbIcon` for a glyph inside the thumb, so a sun/moon theme switch is
`<Switch kind="toggle" label="Dark mode" isLabelHidden thumbIcon={Sun} selectedThumbIcon={Moon} />`.

`Switch kind="toggle"` (`size="control"`) and `Avatar` / `AvatarButton size="control"` share the control height (2.75rem, the
IconButton of a bar), so a language button, a theme switch, a bell and an avatar line up at one height; `Switch
isLabelHidden` keeps its label as the accessible name and draws nothing. `WorkspaceShell viewport="fixed"` is one
viewport tall (`100dvh`) with the header on top and the navigation and primary regions scrolling on their own, so an
app writes no viewport arithmetic; `navigationDrawer` adds the compact-width opener row (the bar's height, an
edge-to-edge divider, a round border icon button) and its left Sidebar drawer. Pass `defaultOpen`
to let the Drawer own its state; no state hook or callback is needed in the layout. The shell
reuses the shared overlay contract, so optional `isOpen` / `onOpenChange` remain available for
coordinated client interactions. The opener is the Drawer's own trigger, which owns activation,
dismissal and focus return.

`AvatarButton` is a circle-only avatar that is a pressable without a button look (no padding, background, border or
shape in any state, no hover effect, a zoom-out on press, a focus ring, and no zoom under
`prefers-reduced-motion`; an account-menu trigger) and `IdentityLockup` a mark beside a title and a muted subtitle with no caret (a workspace
switcher trigger). Both work as the `trigger` of `DropdownMenu` and `Popover`. `IdentityLockup`'s uploaded mark has a transparent box; without an image it uses Avatar's initials. The mark is an uncropped square by default (`markShape="rounded"` opts in to a
corner) and `Avatar` takes `shape="square" | "rounded"`.

Personal avatars are circles. `Avatar`, `AvatarButton` and each `AvatarGroup` member draw two
initials whenever `src` is absent, drawn by DiceBear's Initials style (the potted-plant Sprouts style is gone), generated locally by `@dicebear/core` with the
pinned `@dicebear/styles` Initials style (CC0): nothing is fetched and no name leaves the page; the SVG carries no dicebear.com URL. THE INITIALS
RULE: the first letter of the first word plus the first letter of the last word, uppercased with
its diacritic kept. A Vietnamese name is written family name first and given name last, so `Nguyễn
Văn An` is `NA`, `Đỗ Thị Hoa` is `ĐH` and `Lê Quang Đạt` is `LĐ`; the middle words never count. One
word gives its first two letters (`Nivo` is `NI`), a word with no letter or digit is skipped, and a
name with nothing readable is `?`. Composed and decomposed Unicode give the same letters. The plate
is a solid colour from the style's `backgroundColor` list, which Grammar fills with eight of its theme tones as hex (`--accent`, `--success`, `--warning`, `--danger`
in light and the dark success, warning and danger, `--foreground`); a hash of `seed` (the stable member or agent id, so a rename keeps the colour), else the name, picks
one, and the style draws white or black letters, at least 4.5:1 on every entry. The same seed is always the same colour.
An uploaded `src` overrides the initials, which stay under it while it loads. The round crop and the size ramp are the Avatar's. Images have `alt=""`; the avatar shell carries its name, or `isDecorative`
hides it beside a visible name. `AvatarButton` names the button and keeps its inner avatar
decorative.

`kind="person" | "agent"` defaults to `person` on `Avatar`, `AvatarButton` and `AvatarGroup` items.
Agent names are free text and use the same initials rule. An agent's avatar is initials only, like a person's
(no AI pill on the avatar); `kind="agent"` only names it `Name (AI)` for assistive technology.
The visible "AI" is the small neutral Chip that follows the NAME: `AgentName` (`isAgent`, `agentLabel` default `AI`), placed
by `ListRow` (`isAgent` on the row), the card head (`CardHead.isAgent`), `MessageBubble` (`isAgent` beside `author`) and the
members list (`ListBox` item `isAgent`). An app never places the Chip by hand.

A MARK (`mark={{ icon, color?, ink?, tone? }}`) draws an icon on a round plate instead of initials, for a provider or a channel:
a Grammar token by default (`--accent`; `tone` `accent` or `strong`) or a brand colour the app passes in as `color` (with `ink`
for the icon). `tone="danger"` on an `Avatar` or a group item rings it in the danger token (a broken account), drawn as an
outline in the avatar's own box. Two `Avatar` siblings, or an `Avatar` from `.map()`, are refused by
`starci-grammar/avatar-row-uses-group`: use `AvatarGroup`.
The package requires Node 22 or newer.

```tsx
<Avatar name={user.name} seed={user.id} isDecorative />
<AvatarButton name={user.name} seed={user.id} src={user.avatarUrl} />
<Avatar name="Thao Van Mkt" seed="agent-1" kind="agent" />
<AvatarGroup label="Team" items={members.map(user => ({ id: user.id, name: user.name, seed: user.id }))}
  overflowLabel={count => `${count} more members`} />
```

**Surfaces (14).** EmptyNotice, FencedCodeBlock, HorizontalScrollRegion, Markdown, MarkdownArticle,
MarkdownTableFrame, MediaFrame, Rail, Section, StaticStateRow, SurfaceAccordionCard,
SurfaceCard, VerticalScrollRegion.

A `Section`'s `filter` row holds the `Tabs kind="filter"`, a `SearchField size="sm"` and its `Select`s (each with a muted `prefix`, "Status:"):
the search grows, each select keeps its natural width and its words never wrap; on a narrow row the peers stack.
`<Section title="Orders" filter={<><SearchField … /><Select prefix="Status:" … /></>}>…</Section>`.

**Compositions (11).** Cluster, EntryFrame, Footer, Grid, Page, PaneGrid, PaneSection, Sidebar, Stack, TopBar, WorkspaceShell. Storybook pins settings and data-list content
recipes to each family; the mobile app recipes reuse the fixed App shell with its left navigation drawer.

`EntryFrame` holds a full-height entry task with required `artwork`, `intro`, `identity`, `tools` and `footer` slots,
a named main landmark and form children. It owns the equal desktop split, compact identity on mobile and bounded
centred form; artwork composition stays with the app. `Grid kind="sections"` groups independent named working
regions, `kind="pair"` requires equal `leading` and `trailing` portions of one reading unit, and `kind="featured"`
requires `leading`, `featured` and `trailing` slots for a focus with symmetric support. These kinds take no column,
gap, width or breakpoint props; content relation chooses the kind.

`EntryFrame layout="centred"` drops the context pane: the identity and tools share one bar, the form sits alone in the middle of
the page and the footer closes it; `artwork` and `intro` belong to the default `split` layout only.

`Text size="figure"` is the leading value of a region (FONT-5), such as a plan's price; `Stepper completeMarker="check"` marks a
complete step with a check; `SurfaceCard emphasis="accent"` rings the one card its peers recommend, with the reason in a badge.

A `Figure` may carry `trend` (`"up" | "down" | "flat"`, with `trendSense` `"higher-is-better"` by default, and `trendLabel` for the words):
its meta line starts with a decorative triangle in the success or danger colour (a dash for `flat`) and says the direction in
hidden words. `trendChart` takes a drawn `Sparkline` of `@starci/grammar/core/ext/recharts` under the value and meta (core never imports an ext).

A pressable `ListRow` (`onPress` or `href`), in `Section kind="list"`, ends in a muted chevron
(`chevron-end` glyph, mirrored in RTL); a row with its own `action`, `menu` or `control`, or none of these, draws none.

`Section kind="figures"` is the one strip of key figures, the ribbon, wherever it stands. Supply `title` when it owns a heading or `ariaLabel` when an existing parent owns
that heading. The headless form has no head controls. Media tiles use `TilePoster` (image or localized absence),
plain `facts`, one or up to three badges and typed overflow commands; a whole-card action excludes inner controls.
`IconButton.isPending` has the same native busy and duplicate-activation semantics as Button.
`MessageStatus` belongs in the existing message footer: receipt facts (`sent`, `delivered`, `seen`, with typed readers)
or transport outcomes (`queued`, `sent`, `failed`, `unknown`), with a localized visible label. `MessageBubble` gains no
status props. `MessageBubble actionsPlacement="floating" | "inline"` (default `floating`) places the actions: `inline` is a bare
toolbar in the message row on the reading end of the bubble (no border, fill or shadow), shown on hover and on focus inside the
message, always shown on touch, and unchanged under reduced motion. `MessageBubble measure="standard" | "wide"` (default
`standard`, at most 40rem and 85% of the row) sets how far a bubble reaches; `wide` is 70% of the row for a chat stack
(ramps `--grammar-bubble-measure-standard` and `--grammar-bubble-measure-wide`). `CalendarDay` is the passive date heading of a calendar region: a vendor date-only value, full localized
label and authoritative `isToday`; it owns native time/current-date semantics without selecting a date.

`MessageCard` is an agent's rich message as data: `title` with an optional `chip`, then `body` or `details` (a compact `DescriptionList`), then
`actions` (the `primary` first, an `open` action ending in the arrow last), then a muted xs `meta` line. It renders
`MessageBubble content="card"` and is capped at the bubble measure (`measure="wide"` for the 70% step) with the `avatar` at the start. A `Tabs`
strip that ends a `PaneSection` stands on the band's one full-width separator; an
`EmptyNotice` inside a thread (the `ChatFrame` thread) draws no card surface.

`ChatFrame` is the one chat on any host: `label` (the thread's name), `header` (a `PaneHeader`, and for a customer chat the owner row in the same zone),
the thread as children (`MessageBubble`s and day `Divider`s, oldest first), `footer` (the composer or the decision actions), `scrollRef`, `isLoading` and
`error`. It draws the header, one 1px line, the thread (the only scroller, on `--background`, opening at the newest message and following new ones
while the reader is at the foot), one 1px line and the footer, and fills the height its host gives it. A grid holds it as
`<Pane area="chat" content="chat"><ChatFrame ... /></Pane>` (the pane takes no `footer`, `head`, `surface` or `inset`), a drawer as
`<Drawer bodyInset="none"><ChatFrame ... /></Drawer>` (the sheet's title row and the frame header are one zone), a page as the frame in a box with a height.
An incoming `MessageBubble` and every `MessageCard` are the flat `--surface` with no border and no shadow, an outgoing bubble is `--accent`, and every
bubble passes its `avatar`.

The header of a `Page` heads one page: `breadcrumbs`, `title` (the page's `h1`), `description`, `meta`, `status` chips beside the
heading, a `mark` before it, `actions` at the end of its row (wrapping under it on a phone) and page `tabs`. It is a
surface band whose content sits in the page container of the content's `measure`, so both share their edges, and it ends
in its own full-width separator, with or without tabs; tabs stand on it. `isLoading` keeps every slot's box.

`Page` is a route page and the one way an app draws one: `header` takes the head's slots as data (no element), the
children are the body, and `measure` (`reading`, `product`, `full`) is the one measure of the header content and the
body. The band runs full width; the body sits in the measure and gutter one region step below it (one region step
from the top without a header), its sections a region step apart, and it clips past its content box so nothing in it
reaches across the gutter. `isLoading` passes to the header. Page is the single owner of the page inset: the layout
frames (`WorkspaceShell`, `Grid`, `PaneGrid`) never wrap a page in a measure of their own. `PageHeader`, `PageContainer`, `Breadcrumbs` and `FillViewport` are Page's internals and are not exported.

`Page header.subTabs` is the second tab row (valid only with `tabs`; the type refuses it alone): region tabs of the current
view, inside the white band under the page tabs. The page tabs stand on their own full-width separator, the sub tabs on the
band's bottom border, and both rows start on the content edge. Both are underline tabs, the second and last underline layer;
`subTabs` takes `label`, `items` and `panelId` like `tabs` (the page body is the panel of both unless `panelId` names others).
`header={{ title, tabs: { label, items, ... }, subTabs: { label, items, selectedKey, onSelect } }}`.

**Tabs `end` slot.** `Tabs end={<Button size="sm">Add region</Button>}` (secondary tabs; `ReactNode`, default
none) puts a command at the strip's end, inside the strip frame after the tab list and the fold menu, centred in the strip's
height like a tab. The strip's own line (`own`) or the host's full-width line (`host`: a page header band) runs under the
command to the column's end; never place a Cluster beside the strip for this. The fold fit subtracts the end's width.

`Page chrome="bleed"` is an app surface: no gutter, no block padding, no clip, and the body is the viewport height left below the trail or the band (`minHeight` is the floor on a short window), so a card or a split in it fills the region.

`Page chrome="panes"` is the tabbed app page: the header band (with or without `tabs`) or the breadcrumb trail, then
exactly one `PaneGrid` attached flush to the band's separator, reaching both content edges and the viewport bottom
(less any Grammar bottom chrome): no gap, no block padding, no card, no radius. Page measures the fill box itself
(`minHeight`: `sm`, `md` default, `lg`, `none`, the floor on a short window), with the same measuring hook as
`chrome="bleed"`. The tab line is the only line between tabs and grid.

```tsx
<Page chrome="panes" header={{ title: "Support agent", tabs }}>
  <PaneGrid label="Setup" areas={["chat side"]} columns={["fill", "standard"]}>
    <Pane area="chat" content="chat"><ChatFrame label="Conversation" header={<PaneHeader title="Support agent" />}>{bubbles}</ChatFrame></Pane>
    <Pane area="side" surface><PaneSection gap="section">{settings}</PaneSection></Pane>
  </PaneGrid>
</Page>
```

`PaneGrid` lays out named areas flush with one divider between neighbours; every child is a `Pane` (`null`, `false`
and arrays of Panes are legal; anything else throws `PANE_GRID_CHILD_NOT_PANE` in development). A `Pane` owns its
content inset (`inset="content"`, default, or `"flush"` for a nested PaneGrid or a full-bleed canvas) and takes no
`className`: it never pads itself, it publishes the inset to its descendants so dividers and scrollbars stay full-bleed.
Every side takes the container inset `--grammar-inset` (0.75rem) at every breakpoint, through
`--grammar-pane-inset-inline`, `--grammar-pane-inset-block-start`, `--grammar-pane-inset-block-end-outer` (the grid's
bottom edge) and `--grammar-pane-inset-block-end-divider` (a divider below).
A `collapse="drawer"` pane renders its children in the drawer under the same inset.

`PaneSection` is the one band of a pane: every child of a Pane is a `PaneSection`, one nested `PaneGrid` or, in a `content="chat"` pane, the one `ChatFrame`.
It pads inline by the pane inset; the sections of a pane stack with the row gap between them, the first takes the
block-start inset and the last the block-end inset. Props: `grow` (takes the remaining height), `scroll`
(`{ label, tone?: "surface" | "background", align?: "start" | "center" | "end" }`: its own full-bleed scroll owner
with the inset on its content, so the scrollbar sits on the pane edge), `align` (`start` | `center`), `bleed="inline"`
(the one `HorizontalScrollRegion` in it, such as a chip row, reaches both pane edges and takes the inset as its own
padding and scroll padding), `gap` (`inline` | `row` | `section`) and `as` (`div` | `header` | `footer`). It takes no
`className` or `style`, and outside a Pane it throws `PANE_SECTION_OUTSIDE_PANE`. A content Pane that registers no
PaneSection and no PaneGrid logs `PANE_WITHOUT_SECTION` in development. Boxes align to the content edge; text inside a
box keeps the vendor's own padding. In a Pane, `ListBox` resolves `inset="panel"` and drops the vendor listbox inline
padding so the row box and the selected pill start at the edge, and a `Tabs variant="secondary"` track drops its inline
padding so the first pill does.

**Spacing.** One scale, 0 4 8 12 16 24 32 (`COMMON_SPACING_SCALE`), and every value is a root token named by its role:
gaps `--grammar-identity-gap` (4), `--grammar-inline-gap` (8), `--grammar-row-gap` (12), `--grammar-section-gap` (24)
and `--grammar-region-gap` (32) (`COMMON_GAP_ROLES`); insets `--grammar-inset` (12, every container: pane,
overlay, band), `--grammar-inset-card` (16, a card's own padding; the one place 16 is used), `--grammar-inset-nested` (8, a box inside a card) and `--grammar-inset-open` (24, an empty state or a
drop target); the page gutter `--grammar-page-inset` (12, 24 from 48rem, 32 from 70rem); and the control inline
padding `--grammar-control-padding-inline-{sm,md,lg}` (8, 12, 24) with `--grammar-control-padding-glyph-*` one step
less on a glyph's side. `--grammar-card-padding-inline` and `--grammar-card-padding-block` read `--grammar-inset-card`; rows a card
divides by lines (static, list, accordion) keep the row step (12) on their block sides and the card's 16 inline, and
a stat strip cell in a card takes 16 on every side. `--grammar-overlay-inset` reads `--grammar-inset`. Vendor parts take their step in `src/common/components-spacing.css`. Tabs are the underline
bar everywhere, the first label on the content edge.

**The type scale** (owner, 2026-11-09, final). 14 for all UI text (body, labels, section and card titles, row titles, tabs,
buttons, links, inputs, descriptions, captions, hints, filter-row text, figure labels and meta); 12 only for small names (meta
lines, badges, chips, counts, timestamps, breadcrumb separators); no 13 (`Text size="sm"` equals `md`). Hierarchy comes only
from weight and tone: titles semibold, row and selected names medium (`Text isStrong`), secondary text muted. Two display
sizes: the page title 18 and a big figure value 20 (`Text size="figure"`). Every tab is 14 and 40 high, the selected one
500 over its underline. A `Link` inherits the size around it in the exact primary colour; an external link ends with the
`external` glyph; a row title is never a link when the row opens (lint `row-title-link`). `npm run check:type` pins the
scale; lint `table-cell-type` and `same-line-size` allow only 14 and 12.

**The button-icon rule.** Only the PRIMARY Button (`variant="primary"`, the CTA) carries a leading icon: it shows what it does at
its start (`startGlyph`, e.g. `plus`, `upload`, `send`, `pencil`, or the app's `startContent`). `border` and `danger` Buttons,
suggestion pills and row actions are text only; the Button type refuses a start icon on any other look
(`EmptyNotice actionStartContent` needs the default `primary` action, `Alert` draws `action.icon` on a primary action only). `IconButton` (icon only, named by its label) is unaffected. A Button
that leads somewhere, of any look, ends with Grammar's arrow (`endArrow`; the arrow is not an icon under this rule), which
slides one step toward the reading end on hover and focus and is mirrored right to left. Never both: the types refuse it.
Both glyphs stand one inline step (8) from the label. In Core every Button size, sm included, is a pill (one radius); a row of border sm Buttons is the one
suggestion pattern. An arrow typed in a label or passed through `endContent` is refused
(lint `button-arrow`). `EmptyNotice actionEndArrow` and `ItemAction.endArrow` give the Grammar-drawn actions the arrow.

**The layout law (report or workspace).** A page is one of two frames, declared by `Page chrome` (no extra prop). A REPORT page
(`chrome="standard"`) is the pink well with card surfaces stacked in one vertical column, 24 apart; cards stand side by side only
as siblings of one role and height (figure cells, short equal cards), never a card beside a column of cards (lint
`layout-two-axis`). A WORKSPACE page (`chrome="panes"`, or `bleed` for a full-height chat or editor) is a grid of panes split by
dividers, used when the page has a persistent selection or navigation column; its side panes are white surfaces at full height,
never cards, and the main pane may hold a pink well that follows the report law. One page, one frame type. `Page layout="report" | "workspace"` declares it (a mismatch with `chrome` throws). **The responsive law:** Grammar owns
the breakpoints (desktop from 1280, tablet 768 to 1279, phone below 768); the page inset is 32 / 24 / 12 and the card gap 24 / 12 (the owner asked for 16 on a phone; the spacing scale has no 16 yet) and the
content at most 1280 wide, type stays 14 / 12. A report keeps its figures ribbon in one row on a desktop, 3 columns on a tablet (five cells are 3 + 2) and 2 columns on a phone (an odd last cell spans its row: 2 + 2 + 1), and stacks equal cards below 1280; a
workspace shows the aside as a Drawer on a tablet and one pane at a time on a phone. A graph an app draws itself (inside a Fragment region, with any library) is the app's to adapt to a phone.

**No scrollbars (OVERFLOW-6).** Grammar never shows scrollbars. Every scroll area Grammar draws (pane and `PaneSection scroll`, Drawer and Dialog bodies,
ListBox, the chat thread, the tab strip, DataTable and code overflow, popovers) hides the bar (`scrollbar-width: none`, `::-webkit-scrollbar` none) and
fades its edge where content continues: HeroUI's ScrollShadow where Grammar renders the scroller, and the same fade, driven by the scroll position,
on the CSS scrollers. Wheel, touch and keyboard scrolling are unchanged. An app element with an `overflow-y-auto` / `overflow-auto` class is
refused (lint `no-raw-scroll`); use `VerticalScrollRegion`, `HorizontalScrollRegion` or `PaneSection scroll`. `Drawer bodyInset="none"` runs the body
edge to edge across the sheet (the default `content` keeps the inset).

**Composer, flush left, Sublabel, Link.** A `Textarea` with `onSubmitShortcut` is the chat composer: one line at 40px, growing to 6, with `send` drawing its own 40px Send
Button 12px after the box and `startAction` one icon button inside the box at its start. The page header band is full width with its text flush left at the page inset; the content in the pink well (report page and workspace main pane) is capped at 80rem and centred (MEASURE-8; 0.36.0: only the content of a pane of cards is capped, the grid and side panes span the full width). An Avatar with no image draws DiceBear's Initials style: two letters on a solid Grammar tone. `Sublabel` is the 12 / 500 / muted
group label above a card inside a section. `Link` is HeroUI's own link (primary colour, underline on hover, anchor icon) and inherits its size from the line; lint `link-look`.
A `sm` Button never carries an icon. The second tab layer is `Page header.subTabs` (lint `tabs-in-well`).

**A card is one object.** `SurfaceCard` is a `tile` or a `body` card for one object (a customer, an agent, a plan, a message, an
approval), with an optional `actions` band at its foot: white, a 1px `--border` edge, no shadow, on every ground. A collection is never
in a card: a table, list, set of facts, strip of figures or chart stands flat under a `Section` (its `title`, its `filter` row and one muted
`caption`). Lint `card-is-object` refuses a card around a lone collection, form or placeholder; a `DataTable` has no `surface` prop.

**One look for a list.** A list is `Section kind="list"` of `ListRow`s wherever it stands (the page
canvas, a card body, a drawer or dialog, a pane band, a rail): plain rows on the surface, divided by hairlines, the rows aligned
with the section title, with no frame, fill, radius or shadow. A list is never a card: `SurfaceCard` has no `list` kind, and cards stay for real objects. A hand-made row list (blocks divided by `Divider`) is refused (lint
`surface-in-surface`).

**The proximity law** (owner, 2026-11-09). Inside any container, its children stand at least one step closer than the
container stands to its siblings: identity 4 < inline 8 < row 12 < section 24 < region 32. The defaults hold it:

| Container | Its siblings | Its own children |
| --- | --- | --- |
| `Page` body | - | sections a region step apart (32, the ceiling) |
| `Section` | 32 in the page body | head, filter and body a row step apart (12; 24 before 0.27) |
| `Grid kind="sections" \| "pair" \| "featured"` | 32 in the page body | regions 24 apart |
| `Grid kind="cards"`, `"week"`, `"week-summary"` | 12 in a Section | peer cards 8 apart (`week-summary` was 24) |
| `SurfaceCard` root | 12 in a Section, 8 in a cards Grid | its label 8 above the surface (12 before), 4 in a cards Grid |
| `SurfaceCard` `actions` band | under a hairline, the row step above and below | buttons 8 apart |
| `PaneSection` (and its scroll content) | bands 12 apart in the pane | children 8 apart by default (`gap` default `inline`; `row` before) |
| `Board` column | 12 apart (the tinted ground is its edge) | head and cards 12, cards 8 apart (12 before) |
| `Footer` | - | main and legal 32, brand and directory 24, groups 12, links 8 (24, 32, 24, 8 before) |
| `Stack`, `Cluster` | - | the required `gap` the app names; lint `gap-proximity` refuses a role not below its parent's |

Two exemptions: the region step is the ceiling, so the shell frames that separate regions all take it; and a box with
its own edge (a card's surface, a board column's ground) groups its content by that edge, so its inner gap is compared
with its own children only. A field stack (fields 24 apart, the Field rule) inside a `Form` is the Field rule's rhythm.
`node scripts/audit-gap.mts <url>...` measures the law in a rendered page (`--storage-state`, `--json`, exit 1 on a
violation); it is not wired into `app check`.

An app writes no spacing value; it names the relation of the blocks it places:

- `Stack` (`gap`: `identity` | `inline` | `row` | `section` | `region`, required; `align`; `measure`: `full` |
  `reading` | `form`; `as`): blocks in the block axis.
- `Cluster` (`gap`: `identity` | `inline` | `row` | `section`, the same on both axes; `wrap`, default true; `align`;
  `justify`: `start` | `center` | `end` | `between`): items side by side that wrap, a chip set, a toolbar group. A centred
  set centres each wrapped line without changing its DOM or focus order.
- `Grid` (`kind="cards"` with `columns?: 2 | 3 | 4`, the inline gap on both axes; `kind="form"` draws the form layout;
  `kind="main-rail"` draws a primary region and one rail). `kind="week"` lays out seven dated event regions with the
  inline gap, changing from a single agenda column to seven tracks at a 48rem container width. `kind="week-summary"`
  lays out seven daily summaries with the section gap: one track, four from 40rem, seven from 64rem. Both week kinds
  require a region `label` and seven consecutive day children in reading order, including empty days; a wrong count
  throws `GRID_WEEK_REQUIRES_SEVEN_DAYS` in development. The tracks use the grid's own width, so a narrow pane keeps
  its agenda even on a wide screen. The app supplies day labels, entries and their commands; `Calendar` selects dates.
- `TopBar` takes `subnavigation` with `subnavigationLabel`: a second and last layer under the bar's row.

None takes a `className` or a `style`.

```tsx
<Page measure="reading" header={{ breadcrumbs, title: "Profile", tabs: { label: "Profile", items, selectedKey, onSelect } }}>
  <ProfileForm />
</Page>
```

`COMMON_GRAMMAR_COMPONENTS` is the frozen registry of the published renderers.
`COMMON_FORMS_COMPONENTS`, `COMMON_OVERLAYS_COMPONENTS` and `COMMON_NAVIGATION_COMPONENTS` are the
0.5.0 groups. `defineGrammarFamily` builds a new family over the registry. It may replace
renderers with prop-compatible versions and add extensions whose names don't collide with Common's.

### Surface controls, panel lists and group identity

SurfaceCard, painted SurfaceAccordionCard, Sidebar and the content of Drawer,
Dialog, AlertDialog and Popover supply the nesting context of ANATOMY-2. SurfaceCard always paints
a surface: the top layer is raised and a nested layer is subordinate; never raise both layers.
Each family's DNA owns the paint. SurfaceCard and bounded
SurfaceAccordionCard derive their depth from the parent context. SurfaceAccordionCard defaults to
`frame="bounded"`; `frame="unpainted"` and Rail pass the parent's context through.
A field has ONE look wherever it stands: Input, CopyField, SearchField, Textarea, NumberField, DateField, TimeField,
Select, ComboBox, DatePicker, DateRangePicker, Checkbox, CheckboxGroup, RadioGroup, PressableField and OtpInput draw HeroUI's
`primary` field in these surfaces and outside them alike; the theme gives it its edge (`--field-border`, `--field-border-width`).
There is no field `variant` to pass. Overlay triggers keep their surrounding context.
Tabs are the underline (`secondary`) wherever they stand; the pill (`appearance="primary"`) is chosen by meaning
(a mode switch of two to four options, R380), never by the surface. The FE canon's `FE_NESTED_VARIANT` rejects a field
`variant` written in app code. `FE_GRAMMAR_LAYOUT_ONLY` rejects application paint utilities,
arbitrary paint properties and inline style paint; application CSS carries layout only.

ListBox defaults to `inset="panel"` inside the same context. Its box aligns with the panel's search
field and tabs boxes without negative margins or application padding wrappers (PADDING-0).
Content keeps HeroUI's list inset and item padding, rounded hover/pressed/selected backgrounds,
and selection-indicator space, including inside a scrolling panel. Outside a surface, the vendor list inset stays;
`inset="panel"` also selects the alignment explicitly. Pass flat `items` or named `sections`
(`ListBoxSection`), with unique item ids across the whole list. `FE_LIST_PANEL_PADDING` rejects
horizontal padding wrappers around a list or its section caption within the nearest painted Grammar surface.
Sidebar's expanded and collapsed
rows also retain HeroUI item padding.

A `ListBoxItem` is `label` (a string: the title, accessible name and typeahead text), optional `description`,
`leading` (a centred node in a fixed column before the copy, such as an avatar), `trailing` (after it, such as a count) and
`isDisabled`. Descriptions show one line with an ellipsis by default; `descriptionLines?: 1 | 2 | 3`
selects the visible line limit. The same prop and default apply to `DropdownMenuItem`, `SidebarItem`
and the `ListOption` descriptions used by Select and ComboBox. The packaged stylesheet clamps the
vendor `Description` slot; its full text stays available to assistive technology.
A `ListBoxItem` with `href` is a navigation row: a real anchor (`<a role="option">`) that opens the destination through `GrammarRoot`'s router, in a new tab on a modifier or middle click, with copy-link, Enter on the
focused row and the focus ring; `onAction` runs alongside. An item is either selectable or a link: `href` belongs to a list with `selectionMode="none"` (the default when any item has an `href`) and is ignored in a selecting
list, which draws no link. A Data nav or a mail list is `<ListBox label="Mail" selectionMode="none" items={[{ id: "inbox", label: "Inbox", href: "/mail/inbox" }]} />`.

`ListBoxItem.emphasis="unread"` makes both the label and description strong using the active family's
DNA. Omit it for a read row, which keeps HeroUI's normal label and muted description.
Optional `labelLeading` puts a decorative glyph in the title line itself, inside HeroUI's `Label` before the
text and on its baseline, e.g. a status mark beside an item's name. Both glyph slots are
`aria-hidden` (A11Y-2), so the name stays `label`; pass an `Icon usage="control"` to keep the title line's height.
`ListBox size="sm" | "md" | "lg"` defaults to `md` and reserves a leading column of 2rem, 2.5rem
or 3rem, respectively, so icons, avatars and group grids keep labels in one column. An item's
`size` overrides the list's size.

```tsx
<SurfaceCard ariaLabel="Conversations">
  <Heading level={2}>Conversations</Heading>
  <SearchField label="Find a conversation" />
  <ListBox label="Conversations" sections={[
    { id: "recent", label: "Recent", items: [
      { id: "team", label: "Design team", description: "Sam: The draft is ready", emphasis: "unread" },
    ] },
  ]} />
</SurfaceCard>
```

For a conversation or group identity, use `AvatarGroup layout="grid"` (COLLECTION-3, Zalo style). It is the square of one
Avatar (`sm` 24 or `md` 40) holding small ROUND member avatars set close in a 2 by 2 cluster, not clipped by one big circle:
one member fills it, two stand on the diagonal, three are two over one, four or more are three members and a count cell that
reads the number of members (4, 5, 29). `photo` replaces the cluster with the group's own picture. Each member keeps its initials
on its own colour (or its image) and a ring in the surface colour where the circles touch. `Avatar channel="messenger"` (and
zalo, instagram, ...) adds a small round channel badge on a customer's avatar; `MessageFrame` draws a structured chat frame as one
compact card (title, a status dot only for a real state, field rows, up to three actions) and falls back to its text line for an
unknown kind; `MessageBubble format="markdown"` draws safe Markdown; `ChatFrame empty` centres an empty thread. Members accept
`seed`, `kind`, a `mark` (an icon on a brand-colour circle, for a provider or a channel, mixed freely with people)
`tone="danger"` (a ring for a broken account) and a custom `fallback` for the loading image. `max` is the number of slots,
"+N" included (default 4): up to `max - 1` items show and the last slot is "+N", in both layouts (the grid never exceeds
its 2 by 2); seven providers in a row with `max={6}` show five and "+2". `memberNames(allNames)` is the app's own list of
EVERY name: the group's hover title (and, without `describe`, its accessible name). `overflowLabel` receives the number of
hidden members in both layouts and names the `+N` tile. The group's accessible name is `label`, or,
with `describe(shownNames, hiddenCount)`, the app's own list of the members ("A, B và 3 người khác"):
Grammar writes no sentence. An agent among the members is initials like the others. A group room
shows its members the same way in a `ListBoxItem.leading` (grid group of the row's `size`) and in a `PaneHeader mark`
(both slots take nodes, so no extra prop); the row layout is wider than either slot. A single
person uses Avatar. The default `layout="row"` keeps the overlapping member row and its `+N` tile, the one pattern for people and for provider or channel marks.

## Theming

- **The app owns the theme.** An app sets HeroUI's own tokens in its CSS, on `:root`, `.light` and `.dark`
  (`--accent`, `--accent-foreground`, `--focus`, `--background`, `--surface`, `--surface-secondary`,
  `--foreground`, `--muted`, `--border`, `--separator`, the status colours and their foregrounds,
  `--radius`, `--surface-shadow`, `--scrollbar`, ...), and every part follows, in both families. It writes no grammar
  name. No stylesheet here declares a HeroUI token on the grammar root, so an app's `:root` value is never shadowed;
  HeroUI derives the `*-soft` and `*-hover` tokens from the app's values, and `--info` with its pairs, which HeroUI
  lacks, falls back to `--accent`. A part that paints the accent as text on the page reads `--accent-soft-foreground`.
- **Default palettes.** `@starci/grammar/core/theme.css` and `@starci/grammar/offset-pop/theme.css` are each
  family's default theme as HeroUI tokens (`:root, .light` and `.dark`), in the first layer
  (`starci-grammar-theme`). They are optional: import one after `@heroui/styles` and write your own tokens after it, or
  skip it. Offset Pop's signature is geometry (outline width, the hard offset, radii) and `--offset-pop-shadow-ink`, the
  colour of the offset, which reads `--foreground` when unset. `scripts/prove-theme.mts` renders a test app that sets HeroUI tokens only and checks that every
  part follows, by computed style in a headless Chromium (`npm run prove-theme` after `npm run build`).
- **App-overridable Grammar tokens.** Two defaults live in Grammar's base layer (`src/common/ramps.css`), so an app's brand CSS can
  override them on its root and Grammar's CSS follows; Grammar reads only the token, never a literal value.
  `--starci-core-surface-radius` is the radius of every card surface (SurfaceCard of every kind, Board and its columns, the block
  surfaces): HeroUI's own Card radius, `min(32px, var(--radius-3xl))`, 24px at `--radius: 0.5rem`. `--grammar-content-max` (80rem) is
  the widest the content of a page or a workspace's main column grows; it is centered with the existing inline padding, so a wide
  screen never stretches the blocks (the page background, the header band and the aside stay full width). An app sets HeroUI's
  `--radius` and `--field-radius` and leaves these two alone unless its brand needs another card radius or measure.
- **Theme hooks.** `@starci/grammar/theme-hooks.json` (`src/common/theme-hooks.json`) lists the optional custom properties an app's
  theme layer may set on `:root` and its dark blocks beside HeroUI's tokens: each hook's name, its fallback (the look an app that
  sets none keeps), the part it paints and what it means. The Grammar never declares a hook (a declaration on the grammar root
  would shadow the app's value); every rule reads it with its fallback, which `npm run check:hooks` holds. They cover a card's edge
  on the page ground and a whole-action card's hover and press, the selected table row, the current page and today's schedule
  cell, the Sidebar's selected item (fill, words, weight and a start-edge bar), the underline colour of Tabs, the field focus ring,
  the toggle plates (RadioGroup rows, the Select pill), the destructive entry button's outline, the
  chat faces, the Quote, and the Quote.
- **Spacing.** Every family uses the Common 4px scale (`COMMON_SPACING_SCALE`,
  `COMMON_SPACING_TOKENS`), and Common's `--grammar-*-gap` / `--grammar-page-inset` variables.
- **Dark.** The mode is the app's: `.dark` (or `data-theme="dark"`) on `html`, as HeroUI reads it. The roots take no
  `theme`, because a mode switch inside a root would shadow the app's
  tokens again.
- **Forced colours.** Under `forced-colors: active` each family maps its surfaces, outlines,
  selection and focus onto system colours. Current and selected decisions remain visible through
  an edge or outline, not a fill.
- **Motion.** Under `prefers-reduced-motion: reduce`, Common's component anatomy drops its
  animations, and Offset Pop also removes its press travel and every other transform.
- **Structure.** One banner per page, owned by the app bar: `TopBar`
  in `WorkspaceShell`'s `header` slot makes the shell's wrapper a plain `div`
  (`headerLandmark="slot"`, automatic for it; pass it for an app-owned `<header>`), and
  a `Section` head is never a `<header>`. Surface names (`SurfaceCard`,
  `SurfaceAccordionCard`) default to `h3`; pass `headingLevel` (2-6) so the outline never skips a
  level. A `Section kind="list"`'s collection is the list (`<ul role="list">`), so
  its rows are `<li>`; use `empty` for an empty-state notice. Every scroll owner that holds
  non-focusable content (scroll regions, the Rail body, code and table frames) is a named
  `tabIndex=0` region. A sticky `TopBar` publishes `--starci-core-band-offset`, which a sticky rail reads.
- **States.** `PRESENTATION_STATES` (`neutral`, `informative`, `affirmative`, `cautionary`,
  `negative`, `pending`, `unavailable`) is the render-neutral state vocabulary. Components stamp
  it as `data-grammar-*` hooks for family CSS.

## Package checks

```sh
npm run typecheck
npm test                 # typecheck + build; the package has no spec suites
npm run build-storybook  # static Storybook for the authored component and family stories
npm pack --dry-run
```

## Contributing

`dist/` is build output and is not tracked in git. Every consumer inside this repository reads it:
the `file:` apps link this directory, the brand check reads the exported CSS, and the grammar guard
probe executes the built modules. A merge that changes `src/` does not change `dist/`, so a checkout
can hold an old build that still looks valid.

**Build stamp.** `npm run build` ends with `scripts/build-stamp.mts`, which writes
`dist/.build-stamp.json`: the package version, a digest of the source (everything under `src/`
except stories, test helpers, specs and tests, plus `tsconfig.build.json`, `scripts/copy-css.mts`
and the `exports` and `files` fields of `package.json`), a digest of the built files, and the build
time. The stamp ships in the tarball.

**Freshness check.** The root `npm run check` runs `scripts/checks/check-grammar-dist.mjs`. It fails when
`dist/` is missing, has no stamp, was built from other source or another version, or was edited
after the build. It also compares every `--*` custom property in each family's dist CSS with the
source CSS, so a hand-edited token fails too. The brand check (`scripts/work/brand/brand.mjs`) runs the same test before
it reads a grammar dist, and refuses a dist that fails it. Every refusal ends with the same fix:
`run npm run build in packages/grammar`. A registry install carries no `src/`, so it cannot be
compared. It is reported as `unverifiable` and allowed, but if it carries a stamp, the version and
built-file digest must still match.

**Why there is no `prepare` script.** npm 11.6.2 installs a `file:` dependency as a symlink
(a junction on Windows) to this directory. On every consumer `npm install` or `npm ci` it runs this
package's `prepare` in place, but it does not install this package's devDependencies there. A
`prepare: npm run build` would therefore fail the consumer's install (`tsc` not found) wherever
`packages/grammar/node_modules` is absent. Where it is present, the script would wipe and rebuild
the shared `dist/` on every consumer install. Git dependencies are not a way in either: npm parses
the `#…::path:packages/grammar` suffix, but pacote ignores it, so a git dependency cannot select
this subdirectory. A linking consumer builds on purpose, e.g. through a `prepare` of its own that runs
`npm run grammar:build`. After pulling a grammar change, run `npm run build` here. Publishing is
unaffected: `prepack` runs `typecheck` and `test`, and `test` builds first, so a tarball always
carries a fresh stamp.

**Why `dist/` stays untracked.** Every consumer that reads it can build it, from this directory or
through a script that calls this one. A tracked `dist/` would need a rebuild in every source commit,
would conflict in every merge that touches `src/`, and would make a stale build look authoritative
in git history. The stamp and the check catch what tracking would have hidden.

## Changelog: 0.5.0

A minor release. Common grows from 42 to 95 renderers, and Offset Pop reaches parity with Core.

- **53 new Common renderers.** Core, Heritage and Offset Pop all receive them. They are built on
  HeroUI v3 / React Aria, and each ships Common anatomy CSS and a spec that renders it under bare
  Common, Core and Offset Pop.
  - Forms (19): Field, Fieldset, Form, Textarea, Select, ComboBox, SearchField, NumberField,
    Checkbox, CheckboxGroup, RadioGroup, Switch, Slider, DateField, DatePicker,
    DateRangePicker, TimeField, FileDropzone. They share one Field contract and one
    44px touch floor.
  - Overlays and feedback (14): Dialog, AlertDialog, Drawer (side, and bottom sheet with a handle),
    Popover, DropdownMenu (sections, submenus, checkable items, shortcuts), Toast and Toaster
    (queue, tones, action, pause on hover and focus, persistent live regions), Alert, Spinner,
    Skeleton, ProgressCircle, Meter, Kbd.
  - Navigation, chrome and data (19): Link, Pagination, Stepper, TopBar,
    Footer, Avatar, AvatarGroup, TagGroup, DataTable, DescriptionList, ListBox, Disclosure,
    Accordion, Image, Rating, Timeline, Calendar.
- **Scoped overlay portals.** Overlays portal into the nearest Grammar root, so family styling
  applies to open surfaces (see the portal rule above).
- **Offset Pop at Core parity.**
  - `src/offset-pop/dna.ts` mirrors Core's DNA key for key, plus the `offset` and `palette` groups.
  - A full light, dark, system-dark and forced-colours token set feeds every Common semantic
    variable.
  - Accent text is text-safe: `accentText` is `#b8005f` light and `#ff7ab8` dark. Accent, danger
    and state foregrounds use ink so they pass WCAG AA.
  - Error text mixes the critical colour with ink, reaching at least 5.05:1.
- **Offset Pop component treatment.**
  - `offset-pop/components-{forms,overlays,navigation}.css` adds the ink outline, hard offset
    shadow, pink selection and reduced-motion and forced-colours fallbacks.
  - Interactive rows (ListBox, Select and ComboBox options, selectable DataTable rows) get a
    yellow hover wash, a 2px pink focus ring and a soft-pink selected fill with a pink leading
    edge.
  - Rows are separated by a single seam. Dark-mode selected and current states are fixed.
- **Conformance.** `offsetPopRuleConformance` audits the family's own rules against their CSS
  mechanisms and inherits the rest. The package boundary checks the per-family dist modules,
  checks that no family imports another, and checks that the component CSS is in `dist`.
- **Build.** `scripts/copy-css.mts` copies every `*.css` file in each entry directory.
  `@internationalized/date` is a dev dependency, used for date values in specs and stories.
- **Storybook.** The toolbar switches the family (Common, Core, Heritage, Offset Pop) and the
  theme (light, dark, system). There are stories for all 95 renderers and three page recipes per
  family. The starter boilerplate is removed.
