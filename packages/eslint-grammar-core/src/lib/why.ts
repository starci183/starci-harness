/** Failure-code guidance for the selected Grammar family contract. */
/** One failure code with its explanation and the way to fix it. */
export interface WhyEntry {
  readonly code: string
  readonly en: string
  readonly fix: string
}

export const why: Record<string, WhyEntry> = {
  "tabs-switch-zone": {
    code: "FE_TABS_SWITCH_ZONE",
    en: "A pill (`Tabs appearance=\"primary\"`) is written in JSX in `<file>`, outside the `action` of a `Section` and not the value of a row `control`.",
    fix: "A mode or period switch of one block is the `action` of its Section: `<Section title action={<Tabs appearance=\"primary\" label items selectedKey onSelect />} />` with two to four short options. A row-level mode choice goes in the row's `control`. Views of a page are page tabs (`Page header.tabs`); views or filters inside a region are underline `Tabs`.",
  },
  "tabs-depth": {
    code: "FE_TABS_DEPTH",
    en: "Underline `Tabs` in `<file>` stack past two layers.",
    fix: "A page has the page tabs (`Page header.tabs`) and at most one region set in a tab's panel. Fold a third level into a pill in a `Section action`, a `Section filter` row, a list, or a drawer.",
  },
  "tabs-in-well": {
    code: "FE_TABS_IN_WELL",
    en: "An underline `Tabs` in `<file>` is written in the body of a `Page`, `Pane` or `PaneSection`: on the pink well or in a pane.",
    fix: "The second tab layer sits in the white header band under the page tabs: `Page header={{ tabs, subTabs }}`, on its own full-width separator and flush with the band's left inset. Or, to narrow a list or a region, pass `Tabs kind=\"filter\"` in the `filter` row of its `Section`.",
  },
  "rows-in-card": {
    code: "FE_ROWS_IN_CARD",
    en: "A `DescriptionList` or `DisclosureList` in `<file>` stands with no `Section` or `SurfaceCard` around it.",
    fix: "Key-value and disclosure rows stand flat in a `Section` (`<Section title ...><DescriptionList isDivided items={...} /></Section>`) or, as the facts of ONE object, in the body of that object's `SurfaceCard`; a plain list of rows is `Section kind=\"list\"`, flat.",
  },
  "no-card-lead-description": {
    code: "FE_NO_CARD_LEAD_DESCRIPTION",
    en: "A muted `Text` in `<file>` stands directly above a `SurfaceCard` as its description.",
    fix: "A card has no description. Put the line in the row subtitle (a `ListRow` subtitle of a `Section kind=\"list\"`, or an option `description` of a `RadioGroup`), or, when it explains the card's data (a legend, a source, a period), in the card `note`.",
  },
  "no-nested-label": {
    code: "FE_NO_NESTED_LABEL",
    en: "A `Section` or `SurfaceCard` in `<file>` has its own Label inside a labelled `Section` or `SurfaceCard`.",
    fix: "A section has ONE Label. A group inside it is named by a Sublabel: use `sublabel=\"...\"` instead of `title` / `label` (Grammar draws it 12 / 500 muted, 8px above the card, groups 24px apart).",
  },
  "section-head-action": {
    code: "FE_SECTION_HEAD_ACTION",
    en: "The `Section` head `action` in `<file>` holds a Button that is not a neutral small text Button, or more than one command.",
    fix: "A section's head is one row: the label and an optional count chip at the start, at most ONE thing at the end: a `Link variant=\"head\"` (the label then an arrow that slides on hover), an info `IconButton`, or a text `Button intent=\"neutral\" size=\"sm\"` (no icon, never the commit).",
  },
  "card-one-content": {
    code: "FE_CARD_ONE_CONTENT",
    en: "A `SurfaceCard` in `<file>` holds more than one content (a list, facts, a table, a graph, a form).",
    fix: "A card is ONE object. A second list, table, form or graph is not part of it: put each flat in its own `Section` (a ribbon is `Section kind=\"figures\"`); items of the same kind stay in one list.",
  },
  "no-label-description": {
    code: "FE_NO_LABEL_DESCRIPTION",
    en: "A `Section` or a labelled `SurfaceCard` in `<file>` has a `description` under its label.",
    fix: "A label has no description under it. A section's line is its `caption`; a card's line is its `note`: both stand under the card or list, muted 12.",
  },
  "outline-icons-only": {
    code: "FE_OUTLINE_ICONS_ONLY",
    en: "`<file>` imports a solid icon set (`@heroicons/react/<size>/solid`).",
    fix: "Icons are OUTLINE only: import the same name from `@heroicons/react/24/outline`. A standalone mark of a row, card, empty state or graph step sits in an `IconTile`; an icon inline with text is a plain outline icon, and a status is a tone-coloured outline icon with no tile.",
  },
  "link-look": {
    code: "FE_LINK_LOOK",
    en: "A `Link` in `<file>` sets a `size` or a size, underline or decoration class.",
    fix: "A Link is HeroUI's own link: the primary colour, the underline on hover only, the anchor icon at the end, and the size of the line it stands in (14 in a body, 12 in meta). Remove the prop or class; wrap the link in a `Text` of the size you want.",
  },
  "no-primary-tabs-misuse": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "Primary `Tabs` (a `Section action` or a row `control`) in `<file>` hold a count, an href, an attention mark, one item or more than four items.",
    fix: "Primary tabs switch a mode or period of the same data among two to four short, fixed options. Views, filters with counts and destinations are the secondary (underline) `Tabs`.",
  },
  "no-button-view-switch": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "Buttons carrying `aria-pressed`, `isSelected` or `isActive` stand side by side in `<file>`: joined buttons or pills acting as tabs.",
    fix: "Switching between views or periods of one block is `Tabs` (the primary underline) in the `filter` row of the block's `Section`, or a pill (`Tabs appearance=\"primary\"`) in its `action`; choosing a form value is `ChoiceChips` or `RadioGroup`; a `Button` holds a command, never a selection state.",
  },
  "no-grouped-choice-controls": {
    code: "FE_GROUPED_CHOICE_CONTROL",
    en: "A ButtonGroup, FilterButtonGroup or SegmentedControl in `<file>` draws a group of attached buttons, which the Grammar no longer has.",
    fix: "Use the component of the meaning: Tabs (kind filter for a list) to switch a view or filter, ChoiceButtons, ChoiceChips or RadioGroup to choose a form value, separate Buttons or a DropdownMenu for actions.",
  },
  "field-label": {
    code: "FE_FIELD_LABEL",
    en: "A Text, Label, label or span in `<file>` stands right before a Grammar form control that has no `label` prop: a hand-made field label.",
    fix: "Give the control its `label` prop. The Field contract spaces label to control 8 and control to help 4; field to field 24 is set by the Form or the field stack.",
  },
  "gap-proximity": {
    code: "FE_GAP_PROXIMITY",
    en: "A Grammar layout element in `<file>` (Stack, Cluster, PaneSection, Section, Grid, Form, Fieldset) stands directly inside another whose gap role is not wider: the child's gap is not at least one step closer than its container's.",
    fix: "Step the child down one role (region -> section -> row -> inline -> identity), or step the parent up. Section is always row and Grid and Form fix their own role: do not nest them where the parent is as close. A field stack of controls inside a Form or Fieldset is exempt.",
  },
  "mascot-asset-slot-required": {
    code: "FE_MASCOT_ASSET_SLOT_MISSING",
    en: "A `Mascot` in `<file>` names no `assetSlot`, so nothing ties the art it draws to the asset workflow's request.",
    fix: "Pass `assetSlot` (the slot id of the request) and `assetSha256` once the file is delivered.",
  },
  "no-raw-media": {
    code: "FE_RAW_MEDIA_ELEMENT",
    en: "A raw `<img>`, `<video>` or `<picture>` in `<file>`: it reserves no ratio, loads at once and carries none of the Grammar's alt, rendition, caption, track or stream contract.",
    fix: "Use `Image` (a picture with content: `alt` is required, `ratio`, `renditions` and `sizes`, `caption`, `zoom`), `Illustration` (decorative art: `compact` for art direction) or `Video` (`sources` of MP4, WebM, HLS or DASH, `poster`, `tracks`); a `staticsKey` names an asset of the app's statics.",
  },
  "navbar-control-size": {
    code: "FE_NAVBAR_CONTROL_SIZE",
    en: "A navbar control does not use Grammar's shared control height.",
    fix: "Give every visible bar control the shared height: Button and IconButton at md (the default), Switch kind=\"toggle\" (never compact), the other controls size=\"control\".",
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
  "page-breadcrumbs": {
    code: "FE_PAGE_BREADCRUMBS",
    en: "The `Page` header of a console page in `<file>` states no `breadcrumbs`.",
    fix: "Add `breadcrumbs: { label, items }` to the header, or `breadcrumbs: \"root\"` on the root page of the console (it draws no trail).",
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
    fix: "A peer you recognise and open is a tile: `<SurfaceCard kind=\"tile\" name mark description badge action />`, named inside beside its mark. Comparing a fact across peers is one `Section kind=\"list\"` or a `Section` holding a `DataTable`.",
  },
  "no-raised-surface-in-surface": {
    code: "FE_RAISED_SURFACE_IN_SURFACE",
    en: "A `SurfaceCard` in `<file>` stands inside another SurfaceCard: a card never stands inside a card (a Pane surface, Dialog, Drawer or Popover hosts cards, bordered, since 0.37.5).",
    fix: "Give the content to the outer card's own body; a list, a table or figures inside it stand flat in a `Section` (`Section kind=\"list\"`, `Section kind=\"figures\"`).",
  },
  "surface-in-surface": {
    code: "FE_SURFACE_IN_SURFACE",
    en: "A hand-made row list (a Stack, ul, ol or div whose rows are divided by `Divider`) in `<file>` stands inside a SurfaceCard, Drawer, Dialog, PaneSection or main-rail rail.",
    fix: "Use `<Section kind=\"list\">` with `ListRow` rows: the Grammar draws one list wherever it stands, flat rows divided by hairlines and aligned with the title (a card around a lone list is refused by `card-is-object`).",
  },
  "card-is-object": {
    code: "FE_CARD_IS_OBJECT",
    en: "A `SurfaceCard` in `<file>` holds only a collection, a form or a placeholder (a `DataTable`, a `Section`, a `DescriptionList`, a `DisclosureList`, a `Form` or a lone field, an `EmptyNotice`, `Markdown`, a chart): a card is one object.",
    fix: "Drop the card and stand the content flat: a table is `<Section title ...><DataTable .../></Section>`, a list `Section kind=\"list\"`, facts `<Section title ...><DescriptionList isDivided items={...} /></Section>`, disclosures `<Section title ...><DisclosureList .../></Section>`, a form or field `<Section title ...><Form .../></Section>`, an empty state an `EmptyNotice` on its own, markdown or a chart a `Section`. A card keeps an object's name and facts beside a control; a sign-in form with no page around it keeps `measure=\"formCompact\"`.",
  },
  "surface-card-kind": {
    code: "FE_SURFACE_CARD_KIND",
    en: "A `body` SurfaceCard in `<file>` holds a hand-built list, a Divider, or a SectionHeader or Heading as a second title.",
    fix: "Rows are a `Section kind=\"list\"` (never a card), key figures `Section kind=\"figures\"`, a band of commands at the card's foot is `actions`, a filter or search row the `filter` of a `Section`; the card's title is its `label`, a second subject its own `Section`.",
  },
  "button-arrow": {
    code: "FE_BUTTON_ARROW",
    en: "A Button in `<file>` types an arrow in its label, passes an arrow icon as `endContent`, or sets `endArrow` together with `startGlyph` or `startContent`.",
    fix: "A Button that leads somewhere takes `endArrow` (the Grammar arrow slides on hover and is mirrored in RTL); one that does something takes `startGlyph`; never both.",
  },
  "layout-two-axis": {
    code: "FE_LAYOUT_TWO_AXIS",
    en: "A Grid or Cluster in `<file>` puts a SurfaceCard beside a Stack of SurfaceCards, or two SurfaceCards of different kinds side by side.",
    fix: "A report page stacks its cards in one vertical column (24 apart); side by side is only for sibling cards of one role and height. A page with a persistent selection column or a full-height chat or editor is a workspace: `Page chrome=\"panes\"`, whose side panes are white surfaces, never cards.",
  },
  "no-raw-scroll": {
    code: "FE_NO_RAW_SCROLL",
    en: "An element in `<file>` makes its own scroll area with an `overflow-auto`, `overflow-y-auto` or `overflow-scroll` class.",
    fix: "Grammar never shows scrollbars. Use the Grammar scroller (`VerticalScrollRegion`, `HorizontalScrollRegion`) or `PaneSection scroll`: they fade the edge where content continues, hide the bar and keep wheel and keyboard scrolling.",
  },
  "no-raw-type-size": {
    code: "FE_RAW_TYPE_SIZE",
    en: "`<file>` sets a type size of its own: a Tailwind text-size utility (`text-sm`, `text-[13px]`), a `fontSize` or a CSS `font-size`.",
    fix: "Type is a Grammar role (owner 2026-11-21): use `<Text role=\"label.item\">` or the class of the role, `starci-type-<role>` with dots as dashes (`starci-type-label-item`). The roles: figure, title.page, title.section, label.item, body, label.field, label.group, caption, badge, code.",
  },
  "table-cell-type": {
    code: "FE_TABLE_CELL_TYPE",
    en: "A DataTable cell or ListRow title/description in `<file>` draws a Text above 14 (`size=\"lg\"`, `\"xl\"`, `\"figure\"`), a Heading, a Label or an h1-h6.",
    fix: "The primary of a row or cell is 14 / 500 (`<Text isStrong>`), the secondary the same 14 muted (`<Text tone=\"muted\">`), and a small name (meta, count, timestamp) is 12 (`<Text size=\"xs\" tone=\"muted\">`).",
  },
  "same-line-size": {
    code: "FE_SAME_LINE_SIZE",
    en: "The Text children of one Cluster line in `<file>` have different sizes.",
    fix: "One line, one size: give every Text of the line the same step: 14 (md, sm), 12 (xs) or display (figure); sm and md are the same 14. A Badge or chip may stay as it is.",
  },
  "row-title-link": {
    code: "FE_ROW_TITLE_LINK",
    en: "A Link is the title of a row in `<file>` that already opens (onPress, onAction, href, chevron, or a DataTable with onRowAction or row hrefs).",
    fix: "The row is the one pressable: write the title as plain text (`<Text isStrong>`) and keep the destination on the row.",
  },
}
