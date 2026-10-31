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
  "no-raised-surface-in-surface": {
    code: "FE_RAISED_SURFACE_IN_SURFACE",
    en: "A Grammar surface in `<file>` forces `depth=\"top\"` inside another surface, raising a surface inside a surface (BOUNDARY-6).",
    fix: "Drop `depth`: a nested surface is subordinate (outlined, BOUNDARY-5) and the Grammar resolves it from the surface context.",
  },
  "no-shell-bottom-tabs": {
    code: "FE_APP_SHELL_BOTTOM_TABS",
    en: "Bottom tab navigation replaces the required mobile sidebar drawer.",
    fix: "Use WorkspaceShell navigationDrawer and Sidebar presentation=\"drawer\".",
  },
  "status-text-uses-soft-foreground": {
    code: "FE_STYLE_TOKEN_ONLY",
    en: "`<file>` paints text or an icon with a solid status tone (`<what>`, e.g. `text-success`). A solid tone is a background colour; used as a text colour it reads below 4.5:1 on the page background.",
    fix: "Switch to the soft pair: `text-<tone>-soft-foreground` (with `bg-<tone>-soft` when it sits on a light surface); a solid tone is used only with `bg-<tone>` and `text-<tone>-foreground`.",
  },
}
