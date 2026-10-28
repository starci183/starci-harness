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
    fix: "Pass the tabs as Page header.tabs (or PageHeader tabs): { label, items, selectedKey, onSelect }.",
  },
  "route-page-is-one-page": {
    code: "FE_ROUTE_PAGE_OUTSIDE_PAGE",
    en: "The page owner `<file>` draws something beside its Page, or a bare PageHeader or PageContainer.",
    fix: "Draw one Page: the band as its header, everything else in its body, the measure as its measure.",
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
