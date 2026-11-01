/** Failure-code guidance for the selected Grammar family contract. */
/** One failure code with its explanation and the way to fix it. */
export interface WhyEntry {
  readonly code: string
  readonly en: string
  readonly fix: string
}

export const why: Record<string, WhyEntry> = {
  "app-shell-frame": {
    code: "FE_APP_SHELL_FRAME",
    en: "The app frame must use Grammar WorkspaceShell with its fixed viewport.",
    fix: "Compose WorkspaceShell viewport=\"fixed\" and supply its header, navigation and primary slots.",
  },
  "chip-label-starts-uppercase": {
    code: "FE_CHIP_LABEL_CASE",
    en: "A StatusDot or Badge label in `<file>` starts with a lowercase letter.",
    fix: "Start the label with an uppercase letter (`Running`, not `running`); the rule fixes a literal label in place.",
  },
  "generated-art-in-mascot-or-media-frame": {
    code: "FE_GENERATED_ART_OUTSIDE_FRAME",
    en: "Generated art (a `.webp` or `.png` under `/images/`) in `<file>` is drawn outside Grammar's `Mascot` and `MediaFrame`, so it takes whatever box the page gives it.",
    fix: "Render a character with `<Mascot src size assetSlot />` (sm, md, lg or hero), or frame a scene or illustration in `<MediaFrame assetSlot>`.",
  },
  "mascot-asset-slot-required": {
    code: "FE_MASCOT_ASSET_SLOT_MISSING",
    en: "A `Mascot` in `<file>` names no `assetSlot`, so nothing ties the art it draws to the asset workflow's request.",
    fix: "Pass `assetSlot` (the slot id of the request) and `assetSha256` once the file is delivered.",
  },
  "navbar-cluster": {
    code: "FE_NAVBAR_CLUSTER",
    en: "Navbar action component kinds or order differ from the app-shell canon.",
    fix: "Compose Language IconButton, theme Switch, notification IconButton and account AvatarButton in that order.",
  },
  "navbar-control-size": {
    code: "FE_NAVBAR_CONTROL_SIZE",
    en: "A navbar control does not use Grammar's shared control height.",
    fix: "Set size=\"control\" on every visible bar control.",
  },
  "no-navbar-create": {
    code: "FE_NAVBAR_CREATE",
    en: "A create action is composed into the global navbar.",
    fix: "Move the create action to the page that owns it.",
  },
  "no-raw-structural-element": {
    code: "FE_NATIVE_FORM_CONTROL",
    en: "Raw `<tag>` in `<file>`. Page structure and text are composed from grammar components, not hand-written HTML.",
    fix: "Replace it with the matching grammar component (`Heading`, `Text`, `SurfaceCard`, ...); if grammar lacks it, add it to grammar or the ui package instead of drawing it in place.",
  },
  "no-hand-rolled-page-header": {
    code: "FE_PAGE_HEADER_HAND_ROLLED",
    en: "A page head in `<file>` is a Breadcrumbs trail and a SectionHeader composed by hand.",
    fix: "Compose Grammar PageHeader with breadcrumbs, title and the slots the head needs (description, meta, status, mark, actions, tabs).",
  },
  "page-tabs-in-header": {
    code: "FE_PAGE_TABS_OUTSIDE_HEADER",
    en: "A page tab bar in `<file>` is a Tabs at the top of the Page body or right after a PageHeader, outside the header band.",
    fix: "Pass the tabs as Page header.tabs (or PageHeader tabs): { label, items, selectedKey, onSelect }, or link tabs whose items carry an href each.",
  },
  "pane-children": {
    code: "FE_PANE_CHILD_NOT_SECTION",
    en: "A raw element or a Grammar component other than PaneSection and PaneGrid is placed straight in a `Pane` in `<file>`, skipping the inset the pane publishes.",
    fix: "Wrap it in a `<PaneSection>` (grow, scroll, align or bleed as the band needs), or make the pane's one child a nested `<PaneGrid>`.",
  },
  "pane-grid-children": {
    code: "FE_PANE_GRID_CHILD_NOT_PANE",
    en: "A child of `PaneGrid` in `<file>` is not a `Pane` element (a wrapper component, a fragment or a variable), so its cell renders blank.",
    fix: "Write `<Pane area=\"...\">` as the child (directly, or from `cond ? <Pane/> : null`, `cond && <Pane/>` or a `.map`), and move the wrapper's content into the Pane's PaneSections.",
  },
  "pane-grid-page": {
    code: "FE_PANE_GRID_FRAME",
    en: "A `PaneGrid` in `<file>` is drawn in a FillViewport, a card or a page chrome other than `panes`, or is wrapped inside `Page chrome=\"panes\"`.",
    fix: "Make the grid the one child of `<Page chrome=\"panes\">` (or the one child of a `Pane`, nested) and drop the FillViewport or card around it.",
  },
  "route-page-is-one-page": {
    code: "FE_ROUTE_PAGE_OUTSIDE_PAGE",
    en: "The page or layout owner `<file>` draws something beside its Page, a Page inside another (or inside the Page its tabbed segment's layout draws), a bare PageHeader or PageContainer, or no Page at all (itself, through its pure half, or through the one connected block it renders as its root).",
    fix: "Draw one Page: the band as its header, everything else in its body, the measure as its measure. When client data builds the header, render as the root the one connected block that draws the Page and pass the body as its children. Under a segment layout whose Page carries header.tabs, a page draws its body only; that layout's Page has nothing beside it, its head in its header. A page mounted only under the (auth) route group is framed by that group's layout.",
  },
  "freestyle-has-reason": {
    code: "FE_FREESTYLE_REASON_MISSING",
    en: "A `<Freestyle>` region in `<file>` has no non-empty string `reason`.",
    fix: "Say why no Grammar component fits: `<Freestyle reason=\"sign-in brand art\">`. If a Grammar component fits, compose it instead.",
  },
  "no-pane-section-padding": {
    code: "FE_PANE_SECTION_PADDING",
    en: "The outermost element a `PaneSection` renders in `<file>` carries a padding or margin utility, a second inset beside the one the pane publishes.",
    fix: "Remove the utility: PaneSection pads inline by the pane inset and spaces its own children by `gap`; use `bleed=\"inline\"` for a scroller that reaches the pane edges.",
  },
  "no-label-in-grid": {
    code: "FE_LABEL_IN_GRID",
    en: "A `SurfaceCard` with a `label` is repeated in a `Grid kind=\"cards\"` in `<file>`: the label sits outside the material, so the grid reads as headings over boxes.",
    fix: "A peer you recognise and open is a tile: `<SurfaceCard kind=\"tile\" name mark description badge action />`, named inside beside its mark. Comparing a fact across peers is one `kind=\"list\"` card.",
  },
  "no-raised-surface-in-surface": {
    code: "FE_RAISED_SURFACE_IN_SURFACE",
    en: "A `SurfaceCard` in `<file>` stands inside another SurfaceCard, a Pane surface, or a Dialog, Drawer, AlertDialog or Popover: a surface never stands inside a surface.",
    fix: "Give the content to the host's own body, or use a kind of the outer card (`bands`, `list`, `figures`) for what needs its own faces.",
  },
  "no-shell-bottom-tabs": {
    code: "FE_APP_SHELL_BOTTOM_TABS",
    en: "Bottom tab navigation replaces the required mobile sidebar drawer.",
    fix: "Use WorkspaceShell navigationDrawer and Sidebar presentation=\"drawer\".",
  },
  "surface-card-kind": {
    code: "FE_SURFACE_CARD_KIND",
    en: "A `body` SurfaceCard in `<file>` holds a hand-built list, a Divider, a SectionHeader or Heading as a second title.",
    fix: "Rows are `kind=\"list\"`, key figures `kind=\"figures\"`, faces divided by seams `kind=\"bands\"`; the card's title is its `label`.",
  },
  "status-text-uses-soft-foreground": {
    code: "FE_STYLE_TOKEN_ONLY",
    en: "`<file>` colours status content against the owner's pair rule (`<what>`): content on a `bg-<tone>-soft` tint paints with the solid tone (e.g. `bg-success-soft text-success`), or a mark with no tint behind it paints with the soft foreground (e.g. `text-success-soft-foreground` alone).",
    fix: "Content on a background of the tone takes the pair: `bg-<tone>-soft` with `text-<tone>-soft-foreground`. A mark that stands alone, with no background of the tone, takes the tone itself: `text-<tone>`. A solid fill takes `bg-<tone>` with `text-<tone>-foreground`.",
  },
}
