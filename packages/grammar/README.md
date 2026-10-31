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

The package needs Node.js 22 or newer. Its peer dependencies are React 18+, `@xyflow/react` 12 (for `FlowGraph`) and `@heroui/react`
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

### Button intent

Applications declare `intent` on `Button` and `IconButton`: `commit`, `alternative`, `dismiss`,
`neutral` or `destructive`. A destructive action may supply `step="entry" | "confirm"`; omitted
step means entry. The type permits `step` only for destructive intent. The family DNA's `intent`
mapping derives the variant. Explicit `variant` remains available to Grammar internals and stories.
The [generated button props catalog](docs/button-intent-props.generated.md) lists the published values.

Collection rows supply item placement automatically. Wrap a custom repeated card in
`CollectionItem`, or its action slot in `ItemActions`; both preserve the existing DOM. A repeated
next action resolves to secondary. `ToolbarActions` supplies chrome placement for custom persistent
toolbars without adding markup. Bars and panel headers supply chrome placement; neutral commands
are ghost there, while navbar icon actions stay tertiary. The default decision placement makes a
neutral command outline. Dialogs and drawers restore decision placement inside their surfaces.

Use a `Button` for final destructive confirmation. `AlertDialog` renders dismiss first, focuses it
on entry, then renders its destructive confirm last. The `Primitives/Button intent` stories show
the complete placement mapping in light and dark, including destination, pending and skeleton states.

### App shell

The [app-shell canon](../../contexts/ui/composition.md) owns `FE-APP-SHELL-1` through `FE-APP-SHELL-7`.
The `Compositions/App shell` stories show the fixed shell, grouped sidebar, icon rail and mobile drawer.

- `size="control"` is available on `Button`, `IconButton`, `TextAction`, `PlainPressable`, `IdentityLockup`, `Input` and `SearchField`, alongside `Switch`, `Avatar` and `AvatarButton`.
- `SidebarItem.badge`, `badgeLabel` and `badgeMax` show and announce unread counts in both sidebar presentations. `SidebarGroup.placement="end"` places settings groups after the main groups and pushes them to the bottom.
- The collapsed Sidebar uses Grammar's internal `AnchoredTooltip` on hover and focus. HeroUI Tooltip positions the annotation beside the selected collection item and portals it into the same family DOM scope, preserving HeroUI's collection anatomy. `onAction` runs for every activated destination, including the selected item, so a drawer can close consistently.
- A fixed `WorkspaceShell` frames its `compactHeader` slot as the mobile opener band; pass a client `Drawer` with an ellipsis `IconButton` trigger. The `navigationDrawer` form owns the same band when it supplies the opener.
- `AvatarButton seed` passes the stable identity id to Grammar's shared `Avatar`, which draws local DiceBear initials whenever `src` is absent; an uploaded `src` takes precedence.
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
import { Button, GrammarRoot, PageContainer, SurfaceCard } from "@starci/grammar/common"
import "@starci/grammar/common/styles.css"

export const App = () => (
  <GrammarRoot theme="system">
    <PageContainer>
      <SurfaceCard label="Welcome"><Button intent="commit">Start</Button></SurfaceCard>
    </PageContainer>
  </GrammarRoot>
)
```

### Core

```tsx
import { CoreGrammarRoot, PageContainer, PrimaryRailLayout, SurfaceCard } from "@starci/grammar/core"
import "@starci/grammar/core/styles.css"

export const ProductSurface = () => (
  <CoreGrammarRoot theme="system">
    <PageContainer>
      <PrimaryRailLayout
        primary={<SurfaceCard ariaLabel="Main">…</SurfaceCard>}
        rail={<SurfaceCard ariaLabel="Progress">…</SurfaceCard>}
      />
    </PageContainer>
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

export const App = () => (
  <OffsetPopGrammarRoot theme="system">
    <SurfaceCard label="Today"><Button variant="primary">Play</Button></SurfaceCard>
    <Toaster label="Notifications" dismissLabel="Dismiss" />
  </OffsetPopGrammarRoot>
)
```

Offset Pop is a playful family and stays product-neutral. Its signature is an ink outline, a hard
offset shadow and a pink decision accent. Text that uses the accent is drawn in a text-safe accent
(`--offset-pop-accent-text`). Reduced motion removes every transform. The DNA is
`OFFSET_POP_DNA`, which has the same keys as Core's plus two groups: `offset` (`x`, `y`,
`outlineWidth`, `ink`, `shadowInk`) and `palette` (`pink`, `blush`, `yellow`, `mint`,
`critical`). It also exports `OFFSET_POP_SPACING_SCALE`, `OFFSET_POP_TOKEN_NAMES`,
`OFFSET_POP_TOKEN_DEFAULTS`, `OFFSET_POP_DARK_TOKEN_DEFAULTS`, `OFFSET_POP_BAND_TOKEN_NAMES`,
`offsetPopGrammar` and `offsetPopRuleConformance`.

## Client-side navigation

Every Grammar root (`GrammarRoot`, `CoreGrammarRoot`, `OffsetPopGrammarRoot`) accepts `navigate(path)` and `useHref(href)` and
mounts react-aria's `RouterProvider`. Pass your router's functions once at the root and every Grammar `Link`, `Button href`,
`Breadcrumbs` item, `ListBox`/`Menu` item `href` and `FlowGraph` node `href` navigates inside the app without a reload.

```tsx
import { useHref, useNavigate } from "react-router-dom"
import { CoreGrammarRoot } from "@starci/grammar/core"

export const Root = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate()
  return <CoreGrammarRoot navigate={(path) => navigate(path)} useHref={useHref}>{children}</CoreGrammarRoot>
}
```

Mount the root inside the router. Without `navigate` the links behave as plain anchors.

### FlowGraph layouts

`FlowGraph` places nodes with `layout`: `radial` (the default), `layered` (a DAG in layers) or `manual` (each node's `position`).
`direction="TB" | "LR"` puts the target handle on the entering side and the source handle on the leaving side so edges run along the
layout, and selects `layered` when no layout is given. `headers={[{ label, at }]}` draws a column header above each layer for `LR` and
a lane header beside it for `TB` (`at` is the layer index in `layered`, graph units in `manual`). `height` takes `sm | md | lg`, a number
(pixels) or any CSS length. A node with `href` is a link through the root's router and one keyboard stop.

A node's `shape` is its flowchart outline: `stadium` (the default pill), `rect`, `round`, `diamond` (a decision) or
`circle` (a start or end). An edge's `label` is drawn on a chip at its midpoint and repeated, as "source → target:
label", in the graph's visually hidden edge list.

### MermaidDiagram

`MermaidDiagram` renders Mermaid text (an article's `mermaid` fence) to SVG in the browser. Mermaid is imported on the
first diagram that mounts, initialised with `theme: "base"`, `securityLevel: "strict"` and colours resolved from the
root's semantic tokens (so family, theme and token overrides apply), and re-rendered when the root's theme changes.
`height` (`sm` 16rem, `md` 24rem, `lg` 32rem) is the least canvas box every state keeps; `isSkeleton` draws that box
with a skeleton and loads nothing. A source Mermaid refuses becomes an error inside the same frame: an `Alert` with
`errorTitle`, then the source as a `FencedCodeBlock`.

```tsx
<MermaidDiagram label="Request flow" source={fence.value} errorTitle={t("diagramFailed")} />
```

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
`data-grammar-theme` and the forced-colours mapping still reach the overlay surface. Two things
follow for apps:

- Render overlay triggers inside the family root. An overlay opened from outside every root falls
  back to `document.body` and loses the family styling.
- Mount one `<Toaster>` **inside** the family root, usually as the root's last child. Push toasts
  with `toastQueue.add({ title, tone, action, timeout })`, or give the Toaster its own
  `createToastQueue()`. A Toaster outside the root renders unstyled.

## Components

Each group below matches a Storybook group. Run `npm run storybook`: every story renders inside
the family and theme chosen in the toolbar. It shows the default, disabled, invalid, pending and
selected/current states where they apply. Overlay stories open by default.

**Primitives (29).** Avatar, Badge, Button, CloseButton, ConnectionStatus, Divider, GrammarRoot, Heading, Icon,
IconButton, IconTile, Image, IncludedMark, Kbd, Label, LeadingNumber, Link, Mascot, Meter, PlainPressable,
Progress, ProgressCircle, RankArtwork, RelativeTime, Skeleton, Spinner, StateMark, Text, TextAction.

`Mascot` renders generated character art at one size scale: `size` `sm` (96px), `md` (160px, the default) or `lg`
(240px) square, the Common tokens `--grammar-mascot-sm|md|lg`, or `hero`, which fills its host's height up to
`--grammar-mascot-hero-max` (30rem) for a split screen such as a sign-in page. The art is always contained on a
transparent ground with no plate. Below 48rem a square step drops one step (lg to md, md to sm); a hero is absent
below 64rem unless `visibility="always"` keeps it, as the lg box. It is decorative by default (`alt=""` hides it from
assistive technology; a non-empty `alt` names it) and takes the asset-slot props of `Image` and `MediaFrame`
(`assetSlot`, `assetSha256`, `assetPrompt`); the grammar lint requires `assetSlot`
(`starci-grammar/mascot-asset-slot-required`) and refuses generated art under `/images/` outside `Mascot` or
`MediaFrame` (`starci-grammar/generated-art-in-mascot-or-media-frame`).

```tsx
<Mascot src="/images/mascot/welcome.webp" size="lg" assetSlot="onboarding.welcome" assetSha256={sha} />
```

A mascot also reaches the page through two slots. `SurfaceCard` `treatment="soft"` (the family's `accentSoft` tint
under the default foreground) and `treatment="ink"` (the brand ink band) take decorative `artwork`; each painted
treatment rebinds the surface pair on its ground, so a Stepper, Timeline or Badge inside keeps its contrast.
`EmptyNotice` takes `artwork` (`src`, `alt`, a required `assetSlot`, `assetSha256`, `assetPrompt`) in place of its
glyph and draws it as the `Mascot` at `md`, the mark of a first-run empty state.

```tsx
<SurfaceCard label="Welcome" treatment="soft" artwork={<Mascot src={src} assetSlot="onboarding.welcome" />}>…</SurfaceCard>
<EmptyNotice message="Your workspace is ready." artwork={{ src, assetSlot: "onboarding.empty" }} actionLabel="Add a channel" onAction={add} />
```

**Forms (26).** ButtonGroup, Checkbox, CheckboxGroup, ComboBox, CopyField, DateField, DatePicker,
DateRangePicker, Field, Fieldset, FileDropzone, Form, FormGrid, Input, NumberField, OtpInput,
PressableField, RadioGroup, Rating, SearchField, SegmentedControl, Select, Slider, Switch,
Textarea, TimeField. Every Field-contract control takes `label`, `description`, `errorMessage`,
`isRequired`, `isDisabled`, `isReadOnly` and `isInvalid`, and draws HeroUI's field order: label, control,
description, error. `Select`, `ComboBox`, `SearchField` and `Form` also take `isPending`. `OtpInput` names the
code with `label` or an existing label's `labelledBy`.

`CopyField` is a read-only value with its copy action inside the field, at its end, as tall as every single-line
field: `label`, `value`, `description`, `copyLabel`, `copiedLabel`, `copyErrorLabel` (the app's words), `onCopy`,
`isDisabled`, `isSkeleton`. A long value is truncated in the middle, whole in a Tooltip on hover and focus and whole
for a screen reader. `masked` with `lastFour` draws bullets and the last four characters; its `onCopy` resolves the
clear value (a server reveal may be async) and the field writes it to the clipboard without keeping it. `FormGrid`
lays fields in rows (`columns` 1 or 2, two once its own width holds them) whose controls stand on one line.

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
`Intl.RelativeTimeFormat` for this primitive; other application date display follows FE-DATE.

**DropdownMenu entries.** `entries` is a list of items and sections; the app writes data and no markup, no separator, no
className and no size. An item takes `id`, `label`, `description`, `descriptionLines`, `shortcut`, `href`, `isDisabled`, `submenu` and:

- `iconSource`: a glyph component (the app's Heroicons). Grammar draws it in HeroUI's leading position at the canon icon size,
  20px (`size-5`, `Icon` `leading`; the Heroicons rule R93 / FE-ICON). HeroUI's own docs example draws its sample glyph at
  `size-4`, which is example content and not a component default, so 20px is StarCi's icon rule and not a vendor override.
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

**Navigation & Data (16).** Accordion, AvatarGroup, Breadcrumbs, Calendar, DataTable,
DescriptionList, Disclosure, FlowGraph, ListBox, MermaidDiagram, Pagination, Stepper, Subnav, Tabs, TagGroup, Timeline.

`DataTable.getCellInteraction(row, columnId)` optionally supplies `onAction`, `onDragOver`,
`onDragLeave` and `onDrop`. Cells remain semantic
table cells under the existing arrow-key navigation. An actionable cell takes focus itself,
activates once with Enter/Space or a click on its plain content, and leaves nested controls to
their own actions. Native drag callbacks receive the actual inner content-frame event (`HTMLDivElement`); the caller owns
payload validation, accepted targets and effects. Highlighting takes precedence over muted tone.

`DragItem` is a native drag-source frame with `isDisabled`, `onDragStart`, `onDragEnd`,
`isSelected`, `isInvalid`, `isDashed` and an optional caller-owned `leadingColor`. Its `children`
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
defines the native loading and caption behaviour (reviewed 2026-10-18).

`Switch` takes `size="md" | "lg"` (`lg` is the StarCi 4rem by 2.25rem pill with a 1.75rem round thumb) and
`thumbIcon` / `selectedThumbIcon` for a glyph inside the thumb, so a sun/moon theme switch is
`<Switch size="lg" label="Dark mode" thumbIcon={Sun} selectedThumbIcon={Moon} />`.

`Switch size="control"` and `Avatar` / `AvatarButton size="control"` share the control height (2.75rem, the
IconButton of a bar), so a language button, a theme switch, a bell and an avatar line up at one height; `Switch
isLabelHidden` keeps its label as the accessible name and draws nothing. `WorkspaceShell viewport="fixed"` is one
viewport tall (`100dvh`) with the header on top and the navigation and primary regions scrolling on their own, so an
app writes no viewport arithmetic; `navigationDrawer` adds the compact-width opener row (the bar's height, an
edge-to-edge divider, a round tertiary icon button) and its left Sidebar drawer. Pass `defaultOpen`
to let the Drawer own its state; no state hook or callback is needed in the layout. The shell
reuses the shared overlay contract, so optional `isOpen` / `onOpenChange` remain available for
coordinated client interactions. The opener is the Drawer's own trigger, which owns activation,
dismissal and focus return.

`PlainPressable` is a pressable that does not look like a button: no padding, background, border or
shape in any state, no hover effect, a zoom-out on press, a focus ring, and no zoom under
`prefers-reduced-motion`. `AvatarButton` is a circle-only avatar built on it (an account-menu
trigger) and `IdentityLockup` a mark beside a title and a muted subtitle with no caret (a workspace
switcher trigger). All three work as the `trigger` of `DropdownMenu` and `Popover`. `IdentityLockup`'s uploaded mark has a transparent box; without an image it uses Avatar's local DiceBear initials. The mark is an uncropped square by default (`markShape="rounded"` opts in to a
corner) and `Avatar` takes `shape="square" | "rounded"`.

Personal avatars are circles. `Avatar`, `AvatarButton` and each `AvatarGroup` member render the
bundled DiceBear `initials` style whenever `src` is absent. Initials use the first and last words
of `name`: `Tran Minh Khoa` becomes `TK`, and a single word contributes one letter. Pass the user
or entity id as `seed` for stable colours; otherwise the name determines the colour. Server and
client render the same local data URI, with no network request. The image follows the requested
Avatar shape and keeps contrasting text in light and dark themes. Images have `alt=""`; the
avatar shell carries its name, or `isDecorative` hides it beside a visible name. `AvatarButton`
names the button and keeps its inner avatar decorative. Apps install and import Grammar; its
pinned DiceBear runtime dependencies and avatar drawing stay inside the package.

`kind="person" | "agent"` defaults to `person` on `Avatar`, `AvatarButton` and `AvatarGroup` items.
Agent names are free text and use the same first-and-last-word initials: `Thao Van Mkt` becomes
`TM`. Agents add a bottom-right bot badge through HeroUI's Badge anchor, with a surface-colour
ring and `AI` in the accessible name. The badge is hidden below 32px, including group grid cells;
their initials and accessible identity remain available.
The package requires Node 22 or newer, as does the pinned DiceBear engine.

```tsx
<Avatar name={user.name} seed={user.id} isDecorative />
<AvatarButton name={user.name} seed={user.id} src={user.avatarUrl} />
<Avatar name="Thao Van Mkt" seed="agent-1" kind="agent" />
<AvatarGroup label="Team" items={members.map(user => ({ id: user.id, name: user.name, seed: user.id }))}
  overflowLabel={count => `${count} more members`} />
```

**Surfaces (14).** EmptyNotice, FencedCodeBlock, HorizontalScrollRegion, MarkdownArticle,
MarkdownTableFrame, MediaFrame, Rail, SectionHeader, StaticStateRow, SurfaceAccordionCard,
SurfaceCard, SurfaceCopyGroup, SurfaceListCard, VerticalScrollRegion.

**Compositions (15).** BottomNav, Cluster, Footer, Grid, NavigationFeatureNav, Page, PageContainer, PageHeader,
PaneGrid, PaneSection, PrimaryRailLayout, Sidebar, Stack, TopBar, WorkspaceShell. Storybook pins settings and data-list content
recipes to each family; the mobile app recipes reuse the fixed App shell with its left navigation drawer.

`PageHeader` heads one page: `breadcrumbs`, `title` (the page's `h1`), `description`, `meta`, `status` chips beside the
heading, a `mark` before it, `actions` at the end of its row (wrapping under it on a phone) and page `tabs`. It is a
surface band whose content sits in a `PageContainer` of the content's `measure`, so both share their edges, and it ends
in its own full-width separator, with or without tabs; tabs stand on it. `isSkeleton` keeps every slot's box.

`Page` is a route page and the one way an app draws one: `header` takes PageHeader's props as data (no element), the
children are the body, and `measure` (`reading`, `product`, `full`) is the one measure of the header content and the
body. The band runs full width; the body sits in the measure and gutter one region step below it (one region step
from the top without a header), its sections a region step apart, and it clips past its content box so nothing in it
reaches across the gutter. `isSkeleton` passes to the header. Page is the single owner of the page inset: the layout
frames (`WorkspaceShell`, `PrimaryRailLayout`, `PaneGrid`) never wrap a page in a `PageContainer`.

`Page chrome="panes"` is the tabbed app page: the header band (with or without `tabs`) or the breadcrumb trail, then
exactly one `PaneGrid` attached flush to the band's separator, reaching both content edges and the viewport bottom
(less any Grammar bottom chrome): no gap, no block padding, no card, no radius. Page measures the fill box itself
(`minHeight`: `sm`, `md` default, `lg`, `none`, the floor on a short window), with the same measuring hook as
`FillViewport`. The tab line is the only line between tabs and grid.

```tsx
<Page chrome="panes" header={{ title: "Support agent", tabs }}>
  <PaneGrid label="Setup" areas={["chat side"]} columns={["fill", "standard"]}>
    <Pane area="chat"><PaneSection scroll={{ label: "Conversation", role: "log" }}>{bubbles}</PaneSection></Pane>
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

`PaneSection` is the one band primitive of a pane: every child of a Pane is a `PaneSection` or one nested `PaneGrid`.
It pads inline by the pane inset; the sections of a pane stack with the row gap between them, the first takes the
block-start inset and the last the block-end inset. Props: `grow` (takes the remaining height), `scroll`
(`{ label, role?: "log" | "region", tone?: "surface" | "background", scrollRef? }`: its own full-bleed scroll owner
with the inset on its content, so the scrollbar sits on the pane edge), `align` (`start` | `center`), `bleed="inline"`
(the one `HorizontalScrollRegion` in it, such as a chip row, reaches both pane edges and takes the inset as its own
padding and scroll padding), `gap` (`inline` | `row` | `section`) and `as` (`div` | `header` | `footer`). It takes no
`className` or `style`, and outside a Pane it throws `PANE_SECTION_OUTSIDE_PANE`. A content Pane that registers no
PaneSection and no PaneGrid logs `PANE_WITHOUT_SECTION` in development. Boxes align to the content edge; text inside a
box keeps the vendor's own padding. In a Pane, `ListBox` resolves `inset="panel"` and drops the vendor listbox inline
padding so the row box and the selected pill start at the edge, and a `Tabs variant="secondary"` track drops its inline
padding so the first pill does.

**Spacing.** One scale, 0 4 8 12 24 32 (`COMMON_SPACING_SCALE`), and every value is a root token named by its role:
gaps `--grammar-identity-gap` (4), `--grammar-inline-gap` (8), `--grammar-row-gap` (12), `--grammar-section-gap` (24)
and `--grammar-region-gap` (32) (`COMMON_GAP_ROLES`); insets `--grammar-inset` (12, every container: card, pane,
overlay, band), `--grammar-inset-nested` (8, a box inside a card) and `--grammar-inset-open` (24, an empty state or a
drop target); the page gutter `--grammar-page-inset` (12, 24 from 48rem, 32 from 70rem); and the control inline
padding `--grammar-control-padding-inline-{sm,md,lg}` (8, 12, 24) with `--grammar-control-padding-glyph-*` one step
less on a glyph's side. `--grammar-card-padding-inline`, `--grammar-card-padding-block` and `--grammar-overlay-inset`
read `--grammar-inset`. Vendor parts take their step in `src/common/components-spacing.css`. Tabs are the underline
bar everywhere, the first label on the content edge.

An app writes no spacing value; it names the relation of the blocks it places:

- `Stack` (`gap`: `identity` | `inline` | `row` | `section` | `region`, required; `align`; `measure`: `full` |
  `reading` | `form`; `as`): blocks in the block axis.
- `Cluster` (`gap`: `identity` | `inline` | `row` | `section`, the same on both axes; `wrap`, default true; `align`;
  `justify`): items side by side that wrap, a chip set, a toolbar group.
- `Grid` (`kind="cards"` with `columns?: 2 | 3 | 4`, the section gap on both axes; `kind="form"` renders `FormGrid`;
  `kind="main-rail"` renders `PrimaryRailLayout` with its props).

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

SurfaceCard, SurfaceListCard, painted SurfaceAccordionCard, Sidebar and the content of Drawer,
Dialog, AlertDialog and Popover supply the nesting context of ANATOMY-2. SurfaceCard always paints
a surface: the top layer is raised and a nested layer is subordinate; never raise both layers.
Each family's DNA owns the paint. SurfaceCard and bounded
SurfaceAccordionCard derive their depth from the parent context. SurfaceAccordionCard defaults to
`frame="bounded"`; `frame="unpainted"` and Rail pass the parent's context through.
Omit a field's `variant`: Input, CopyField, SearchField, Textarea, NumberField, DateField, TimeField, Select,
ComboBox, DatePicker, DateRangePicker, Checkbox, CheckboxGroup, RadioGroup, PressableField and OtpInput use `secondary`
inside these surfaces and `primary` outside. Overlay triggers keep their surrounding context.
Tabs also default to `secondary` inside a surface and `primary` on the page background. The FE
canon's `FE_NESTED_VARIANT` rejects static field variants throughout app code and explicit primary
Tabs inside a painted surface. `FE_GRAMMAR_LAYOUT_ONLY` rejects application paint utilities,
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
`ListBoxItem.emphasis="unread"` makes both the label and description strong using the active family's
DNA. Omit it for a read row, which keeps HeroUI's normal label and muted description.
Optional `labelLeading` puts a decorative glyph in the title line itself, inside HeroUI's `Label` before the
text and on its baseline, e.g. a status mark beside an item's name. Both glyph slots are
`aria-hidden` (A11Y-2), so the name stays `label`; pass an `Icon usage="chip"` to keep the title line's height.
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

For a conversation or group identity, use `AvatarGroup layout="grid"` (COLLECTION-3, the Zalo
reference). It is one round Avatar-sized mark at `sm`, `md`, `lg` or `control`: two members split
the circle, three show one above two, and four use a 2 by 2 grid. With five or more
members, three avatars remain and the fourth cell shows the total member count, such as `5` or `30`.
Each cell has a ring in the surface colour. Each member uses Avatar's
uploaded image or bundled DiceBear initials, accepts `seed`, `kind` and a custom uploaded-image `fallback`,
and the count uses the shared avatar renderer. `overflowLabel` receives the number of hidden members
in both layouts and names them accessibly; the grid's visible digits show the total. A single
person uses Avatar. The default `layout="row"` keeps the overlapping member row and its `+N` overflow count.

## Theming

- **Tokens.** Each family writes its DNA as CSS custom properties on its root: `--starci-core-*`
  or `--offset-pop-*`. It feeds those into the Common semantic variables that
  renderers read: `--accent`, `--accent-foreground`, `--focus`, `--background`, `--surface`,
  `--surface-secondary`, `--foreground`, `--muted`, `--border`, `--separator`, the status
  colours and their foregrounds, radii and shadow. Core also publishes a tertiary face under its own
  name, `--starci-surface-tertiary` (with `--starci-surface-tertiary-foreground`), fed by the knob
  `--starci-core-surface-tertiary`; HeroUI's `--surface-tertiary` is left to Common and is never
  re-bound by the family. To adjust a family, override its tokens on the
  root, for example `<CoreGrammarRoot style={{ "--starci-core-accent": "#2f6bff" }}>`. The
  `*_TOKEN_NAMES` / `*_TOKEN_DEFAULTS` exports are the supported list. The DNA generator measures
  their packaged values; callers own their token overrides.
- **Spacing.** Every family uses the Common 4px scale (`COMMON_SPACING_SCALE`,
  `COMMON_SPACING_TOKENS`), and Common's `--grammar-*-gap` / `--grammar-page-inset` variables.
- **Dark.** `theme` on any root takes `"light"`, `"dark"` or `"system"` (the default), which sets
  `data-grammar-theme`. `system` follows `prefers-color-scheme`. The dark palette is scoped to the
  root, so a dark island can sit inside a light page.
- **Forced colours.** Under `forced-colors: active` each family maps its surfaces, outlines,
  selection and focus onto system colours. Current and selected decisions remain visible through
  an edge or outline, not a fill.
- **Motion.** Under `prefers-reduced-motion: reduce`, Common's component anatomy drops its
  animations, and Offset Pop also removes its press travel and every other transform.
- **Structure.** One banner per page, owned by the app bar: `TopBar` / `NavigationFeatureNav`
  in `WorkspaceShell`'s `header` slot makes the shell's wrapper a plain `div`
  (`headerLandmark="slot"`, automatic for those two; pass it for an app-owned `<header>`), and
  `SectionHeader` is never a `<header>`. Surface names (`SurfaceCard`, `SurfaceListCard`,
  `SurfaceAccordionCard`) default to `h3`; pass `headingLevel` (2-6) so the outline never skips a
  level. `SurfaceListCard`'s collection is the list (`<ul>`, or `role="list"` when scrolling), so
  its rows are `<li>`; use `empty` for an empty-state notice. Every scroll owner that holds
  non-focusable content (scroll regions, the Rail body, code and table frames) is a named
  `tabIndex=0` region. A fixed `BottomNav` publishes `--starci-core-bottom-nav-offset`, which the
  outermost page container (or the Footer) and a bottom Toaster read.
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
  - Forms (20): Field, Fieldset, Form, Textarea, Select, ComboBox, SearchField, NumberField,
    Checkbox, CheckboxGroup, RadioGroup, Switch, Slider, SegmentedControl, DateField, DatePicker,
    DateRangePicker, TimeField, FileDropzone, ButtonGroup. They share one Field contract and one
    44px touch floor.
  - Overlays and feedback (14): Dialog, AlertDialog, Drawer (side, and bottom sheet with a handle),
    Popover, DropdownMenu (sections, submenus, checkable items, shortcuts), Toast and Toaster
    (queue, tones, action, pause on hover and focus, persistent live regions), Alert, Spinner,
    Skeleton, ProgressCircle, Meter, CloseButton, Kbd.
  - Navigation, chrome and data (19): Link, Breadcrumbs, Pagination, Stepper, TopBar, BottomNav,
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
- **Core.** Subnav's menu toggle meets a 44px touch floor on coarse pointers and narrow viewports.
- **Build.** `scripts/copy-css.mts` copies every `*.css` file in each entry directory.
  `@internationalized/date` is a dev dependency, used for date values in specs and stories.
- **Storybook.** The toolbar switches the family (Common, Core, Heritage, Offset Pop) and the
  theme (light, dark, system). There are stories for all 95 renderers and three page recipes per
  family. The starter boilerplate is removed.
