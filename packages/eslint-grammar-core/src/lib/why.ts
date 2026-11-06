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
  "no-primary-tabs-misuse": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "Primary `Tabs` (or a `switch` header zone) in `<file>` hold a count, an href, an attention mark, one item or more than four items.",
    fix: "Primary tabs switch a mode or period of the same data among two to four short, fixed options. Views, filters with counts and destinations are the secondary (underline) `Tabs`.",
  },
  "no-button-view-switch": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "Buttons carrying `aria-pressed`, `isSelected` or `isActive` stand side by side in `<file>`: joined buttons or pills acting as tabs.",
    fix: "Switching between views or periods of one block is `Tabs` (the primary underline) in the block's `filter` header zone of its card; choosing a form value is `ChoiceChips` or `RadioGroup`; a `Button` holds a command, never a selection state.",
  },
  "no-grouped-choice-controls": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "A ButtonGroup, FilterButtonGroup or SegmentedControl in `<file>` draws a group of attached buttons, which the Grammar no longer has.",
    fix: "Use the component of the meaning: Tabs (kind filter for a list) to switch a view or filter, ChoiceChips or RadioGroup to choose a form value, separate Buttons or a DropdownMenu for actions.",
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
    en: "A page head in `<file>` imports PageHeader or Breadcrumbs from the Grammar, so the head is composed by hand.",
    fix: "Pass the head to Page `header` (title, breadcrumbs and the slots it needs: description, meta, status, mark, actions, tabs).",
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
    en: "A `PaneGrid` in `<file>` is drawn in a card or a page chrome other than `panes`, or a `Page chrome=\"panes\"` there holds something other than one written `PaneGrid` element (a wrapper, a component that renders the grid, a fragment, a variable).",
    fix: "Write the `<PaneGrid>` element as the one child of `<Page chrome=\"panes\">` (or as the one child of a `Pane`, nested), pass the panes into it, and drop the card or wrapper around it.",
  },
  "route-page-is-one-page": {
    code: "FE_ROUTE_PAGE_OUTSIDE_PAGE",
    en: "The page or layout owner `<file>` draws something beside its Page, a Page inside another (or inside the Page its tabbed segment's layout draws), a bare PageHeader or PageContainer, or no Page at all (itself, through its pure half, or through the one connected block it renders as its root).",
    fix: "Draw one Page: the band as its header, everything else in its body, the measure as its measure. When client data builds the header, render as the root the one connected block that draws the Page and pass the body as its children. Under a segment layout whose Page carries header.tabs, a page draws its body only; that layout's Page has nothing beside it, its head in its header. A page mounted only under the (auth) route group is framed by that group's layout.",
  },
  "text-inline-only": {
    code: "FE_TEXT_BLOCK",
    en: "A block component inside `Text` in `<file>`.",
    fix: "Close the Text and place the block beside it, or use the component that owns that layout.",
  },
  "no-text-heading": {
    code: "FE_TEXT_HEADING",
    en: "A strong `Text` in `<file>` only titles the blocks that follow it.",
    fix: "Give the group a Section title, a card label or Heading; they own the level and the spacing.",
  },
  "one-highlight-per-render": {
    code: "FE_ONE_HIGHLIGHT",
    en: "A second `isHighlight` in one render of `<file>`.",
    fix: "Keep the highlight on the one thing that matters now and give the other its plain state.",
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
    fix: "Give the content to the host's own body, or use a kind of the outer card (`list`, `figures`) or its typed `headers` and `footers` zones for what needs its own faces.",
  },
  "no-shell-bottom-tabs": {
    code: "FE_APP_SHELL_BOTTOM_TABS",
    en: "Bottom tab navigation replaces the required mobile sidebar drawer.",
    fix: "Use WorkspaceShell navigationDrawer and Sidebar presentation=\"drawer\".",
  },
  "surface-card-kind": {
    code: "FE_SURFACE_CARD_KIND",
    en: "A `body` SurfaceCard in `<file>` holds a hand-built list, a Divider, a SectionHeader or Heading as a second title, or a `custom` zone holds a Tabs, SearchField or Divider.",
    fix: "Rows are `kind=\"list\"`, key figures `kind=\"figures\"`, bands divided by seams the typed `headers` and `footers` zones (`filter`, `search`, `toolbar`, `figures`, `more`, `paging`); the card's title is its `label`.",
  },
  "status-text-uses-soft-foreground": {
    code: "FE_STYLE_TOKEN_ONLY",
    en: "`<file>` colours status content against the owner's pair rule (`<what>`): content on a `bg-<tone>-soft` tint paints with the solid tone (e.g. `bg-success-soft text-success`), or a mark with no tint behind it paints with the soft foreground (e.g. `text-success-soft-foreground` alone).",
    fix: "Content on a background of the tone takes the pair: `bg-<tone>-soft` with `text-<tone>-soft-foreground`. A mark that stands alone, with no background of the tone, takes the tone itself: `text-<tone>`. A solid fill takes `bg-<tone>` with `text-<tone>-foreground`.",
  },
}
