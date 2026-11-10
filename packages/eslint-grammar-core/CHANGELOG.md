# Changelog

## 0.37.23 - 2026-11-10

- Changed: released with the Grammar family at 0.37.23 (Select trigger text centred); no rule of this package changed.

## 0.37.22 - 2026-11-10

- Changed: released with the Grammar family at 0.37.22 (Footer links plain); no rule of this package changed.

## 0.37.21 - 2026-11-10

- Changed: released with the Grammar family at 0.37.21 (three narrow-width fixes); no rule of this package changed.

## 0.37.20 - 2026-11-10

- Changed: released with the Grammar family at 0.37.20 (the FlowGraph steps fit); no rule of this package changed.

## 0.37.19 - 2026-11-10

- Changed: released with the Grammar family at 0.37.19 (a DropdownMenu switch entry); no rule of this package changed.

## 0.37.18 - 2026-11-10

- Changed: released with the Grammar family at 0.37.18 (an informative Toast and alert dialog are neutral); no rule of this package changed.

## 0.37.17 - 2026-11-10

- Changed: released with the Grammar family at 0.37.17 (an informative Alert is neutral); no rule of this package changed.

## 0.37.16 - 2026-11-10

- Changed: `tabs-switch-zone` allows a primary `Tabs` pill when it is the value of a row `control` (an object property named `control` in a select item or list row literal, or a JSX attribute `control={...}`, through a fragment, conditional or `&&`); a pill anywhere else outside the card's `switch` header zone is still an error. Tests for both.

## 0.37.15 - 2026-11-10

- Changed: released with the Grammar family at 0.37.15 (code block language label, app bar custom buttons); no rule of this package changed.

## 0.37.14 - 2026-11-10

- Changed: released with the Grammar family at 0.37.14 (Link plain, flat aside lists, stacked panes, article headings); no rule of this package changed.

## 0.37.13 - 2026-11-10

- Changed: released with the Grammar family at 0.37.13 (a select row's `control`); no rule of this package changed.

## 0.37.12 - 2026-11-09

- Changed: released with the Grammar family at 0.37.12 (the body-card menu reserves room only beside the content); no rule of this package changed.

## 0.37.11 - 2026-11-09

- Changed: released with the Grammar family at 0.37.11 (the FlowGraph controls reserve their corner); no rule of this package changed.

## 0.37.10 - 2026-11-09

- Changed: released with the Grammar family at 0.37.10 (a body card takes a menu); no rule of this package changed.

## 0.37.9 - 2026-11-09

- Changed: released with the Grammar family at 0.37.9 (short table columns never wrap); no rule of this package changed.

## 0.37.8 - 2026-11-09

- Changed (owner laws): `single-child-card` no longer refuses a card of list or key-value rows (`kind="list"`, `kind="table"`, `kind="select"`, `ListBox`, `DisclosureList`, `Timeline`, `Section kind="list"`, `DescriptionList`), alone or not; it refuses only a card with no zones around ONE `DataTable` or chart. Specs updated (list cards valid).
- Changed: the `no-raised-surface-in-surface` messages (`why.ts`) now say what the rule has judged since 0.37.5: only a card inside a card is refused; a Pane surface, Dialog, Drawer or Popover hosts cards (the spec has the Dialog case valid). An installed copy older than 0.37.5 still refuses a card in a Dialog: the lane must install 0.37.5 or later.

## 0.37.7 - 2026-11-09
- Changed: the peer `@starci/hfs` is ~6.7.0 and offset-pop peers core 0.37.7.


- Added: rule `starci-grammar/no-nested-label` (LABEL-SUBLABEL-HIERARCHY): a `Section` or `SurfaceCard` with its own Label inside a labelled `Section` or `SurfaceCard` of the same file is an error; the group takes `sublabel`.

## 0.37.6 - 2026-11-09

- Changed: released with the Grammar family at 0.37.6 (a row with an href is pressable whole); no rule of this package changed.

## 0.37.5 - 2026-11-09

- Changed: released with the Grammar family at 0.37.5 (SurfaceCard kind="select"; outline glyph sizing); no rule of this package changed. A `no-loose-card-caption` rule was weighed and not added: a syntactic rule cannot tell a card from an app block that renders one, nor an explanation from a legend.
- Added: rule `rows-in-card` (ROWS-IN-CARD, error): a Grammar `DescriptionList` or `DisclosureList` that no `SurfaceCard`, `Section`, `DataTable` or `Accordion` of the same file encloses is refused (a primitive passed as a JSX attribute value is judged where the receiver draws it). `ListBox` is not read (a navigation list or menu cannot be told from rows of data by syntax).
- Added: `starci-grammar/no-card-lead-description` (CARD-NO-DESCRIPTION): a muted Grammar `Text` written directly above a `SurfaceCard` in the same children list is an error; the line is a row subtitle or the card `note`.

## 0.37.4 - 2026-11-09

- Changed: released with the Grammar family at 0.37.4 (FlowGraph chips, ports and containers; outline icons; EmptyNotice frameless by default); no rule of this package changed.

## 0.37.3 - 2026-11-09

- Changed: released with the Grammar family at 0.37.3 (the head row only when every pane has a head; a pane that holds a grid is not capped); no rule of this package changed.

## 0.37.2 - 2026-11-09

- Changed: released with the Grammar family at 0.37.2 (the shared head row reaches nested grids); no rule of this package changed.

## 0.37.1 - 2026-11-09

- Changed: released with the Grammar family at 0.37.1 (the shared head row only when a pane has a head); no rule of this package changed.

## 0.37.0 - 2026-11-09

- Changed: released with the Grammar family at 0.37.0 (FlowGraph state priority and natural edges, one head row in layout B); no rule of this package changed.

## 0.36.3 - 2026-11-09

- Changed: peer `@starci/hfs ~6.6.0` (hfs 6.6.0: R395 and the managed app gallery slots); no rule of this package changed. `@starci/grammar` stays at 0.36.1.

## 0.36.2 - 2026-11-09

- Changed: released with the Grammar family at 0.36.2 (a Switch has no border); no rule of this package changed.

## 0.36.1 - 2026-11-09

- Changed: released with the Grammar family at 0.36.1 (the status dot is a hollow ring); no rule of this package changed.

## 0.36.0 - 2026-11-09

- Added: `section-head-action` (`FE_SECTION_HEAD_ACTION`, SECTION-HEAD-ACTION, error): a Grammar `Button` in a `Section` head `action` is refused (navigation is a `Link variant="head"`), and so is more than one command
  (`Button`, `Link`, `IconButton`, `TextAction`) in that slot. Doc: `docs/section-head-action.md`.
- Added: `tab-count-chip` (`FE_TAB_COUNT_CHIP`, TAB-COUNT-CHIP, error): a tab item (an object with `id` and `label`) whose label ends in a middle dot and a number, or a template that ends in a middle dot and an expression, is refused;
  the count is the `count` prop, drawn as a chip. Doc: `docs/tab-count-chip.md`.
- Added: `card-one-content` (`FE_CARD_ONE_CONTENT`, CARD-ONE-CONTENT, error): a `SurfaceCard` with more than one content component, or a `figures` header zone above another content, is refused. A card inside a card stays
  `no-raised-surface-in-surface` (R340). Doc: `docs/card-content.md`.
- Added: `no-label-description` (`FE_NO_LABEL_DESCRIPTION`, error): a `Section` `description` (use `caption`) and a labelled `SurfaceCard` `description` (use `note`) are refused.
- Added: `outline-icons-only` (`FE_OUTLINE_ICONS_ONLY`, ICONS-OUTLINE, error): an import of a solid icon set (`@heroicons/react/<size>/solid`, `@starci/heroicons/<size>/solid`) is refused anywhere. Doc: `docs/outline-icons.md`.
- Changed: released with the Grammar family at 0.36.0.

## 0.35.0 - 2026-11-09

- Changed: released with the Grammar family at 0.35.0 (FlowGraph `layout="steps"`); no rule of this package changed.

## 0.34.0 - 2026-11-09

- Added: `tabs-in-well` (`FE_TABS_IN_WELL`, TABS-IN-WELL, error): an underline `Tabs` written in the body of a `Page`, `Pane` or `PaneSection` is refused; the second tab layer is
  `Page header.subTabs`, in the white header band.
- Added: `link-look` (`FE_LINK_LOOK`, LINK-LOOK, error): a `Link` with a `size` prop or a size, underline or decoration class is refused.
- Changed: `button-icon-primary-only` also refuses a start icon on a `size="sm"` Button, the primary included.
- Changed: released with the Grammar family at 0.34.0.

## 0.33.0 - 2026-11-09

- Added: `no-raw-scroll` (`FE_NO_RAW_SCROLL`, NO-RAW-SCROLL, error): an app element whose `className` holds `overflow-auto`, `overflow-y-auto`,
  `overflow-x-auto` or an `overflow-*-scroll` class is refused; NIVO never shows scrollbars, so a scroll area is a Grammar scroller
  (`VerticalScrollRegion`, `HorizontalScrollRegion`) or `PaneSection scroll`. `docs/no-raw-scroll.md`.
- Changed: released with the Grammar family at 0.33.0.
- Added: `button-icon-primary-only` (`FE_BUTTON_ICON_PRIMARY_ONLY`, BUTTON-ARROW case-2, error): only a `Button` whose `intent` is the literal
  `"commit"` (the primary, the CTA) may set `startGlyph` or `startContent`; a neutral, alternative, dismiss or destructive Button, a Button
  with no intent and one with a computed intent are refused. `endArrow` is not an icon under the rule and `IconButton` is not judged. The
  Button type (Grammar 0.33.0) refuses the literal cases as well. `docs/button-arrow.md`.
- Added: `layout-two-axis` (`FE_LAYOUT_TWO_AXIS`, LAYOUT-TWO-AXIS, error): a `Grid` or `Cluster` that puts a `SurfaceCard` beside a `Stack` of `SurfaceCard`s,
  or `SurfaceCard`s of different `kind` side by side, is refused (a report page stacks cards in one direction). `Grid kind="main-rail"` is not judged. `docs/layout-two-axis.md`.
- Changed: released with the Grammar family at 0.33.0.

## 0.32.0 - 2026-11-09

- Versioned with Grammar 0.32.0 (every surface on the page ground is a card); no rule changes.

## 0.31.0 - 2026-11-09

- Changed: released with the Grammar family at 0.31.0 (the final type scale).
- Changed: `same-line-size` treats `sm` and `md` (and an absent size) as the same 14 step; only 14 vs 12 (`xs`) vs display (`figure`) on one line are findings. `table-cell-type` allows only 14 (`md`, `sm`, absent) and 12 (`xs`) Text in a DataTable cell or ListRow; `lg`, `xl`, `figure`, Heading, Label and h1-h6 stay refused. Messages, docs and `why.ts` no longer name 13 or 16.

## 0.30.0 - 2026-11-09

- Changed: released with the Grammar family at 0.30.0 (Button sm takes the pill radius).
- Added: `suggestion-buttons` (`FE_SUGGESTION_BUTTONS`, SUGGESTION-BUTTONS): suggestions and quick replies have one pattern, a `Cluster gap="inline"` of neutral `Button size="sm"` (a pill); a row of Grammar `Link`s with an inline handler that passes its own label (`href` absent or `"#"`), a `ChoiceChips` whose `onValueChange` sends the value instead of keeping it, and a HeroUI `Chip` whose `onPress` passes its own label are refused. `docs/suggestion-buttons.md`.
- Note: `suggestion-chips` was withdrawn before release with SuggestionChips.

## 0.29.0 - 2026-11-09

- Changed: released with the Grammar family at 0.29.0 (its standalone DataTable and zone text defaults changed); the messages of `surface-card-kind` and `surface-in-surface` that named a bare list card now point at `Section kind="list"`.
- Added: `single-child-card` (`FE_SINGLE_CHILD_CARD`, SINGLE-CHILD-CARD): a Grammar `SurfaceCard` with no zones (`headers`, `footers`, `labelEnd`) whose only body child is a `DataTable`, a list (`ListBox`, `ItemList`, `DisclosureList`, `Timeline`, `Section kind="list"`) or a chart (`BarChart`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`), or that is `kind="table"` or `kind="list"`, is refused; the title is a `Section` head and one line under it is `Section caption`. `docs/single-child-card.md`.

## 0.28.0 - 2026-11-09

- Changed: released with the Grammar family at 0.28.0; peers `@starci/hfs ~6.5.0`. The new rules below are errors, with no escape.

- Added: `button-arrow` (`FE_BUTTON_ARROW`, BUTTON-ARROW): a `Button` that leads somewhere takes `endArrow`; an arrow typed in its label (`→ ← ➜ ➔ ⟶ › »`, `->`), an arrow or end-chevron icon passed as `endContent`, and `endArrow` with `startGlyph`/`startContent` are refused. `docs/button-arrow.md`.
- Added: `table-cell-type` (`FE_TABLE_CELL_TYPE`, TABLE-CELL-TYPE): no `Text size="figure"`, `Heading`, `Label` or `h1`-`h6` in a DataTable `renderCell` (or column `editor`) or in the `title`/`description` of a ListRow data object. `docs/table-cell-type.md`.
- Added: `same-line-size` (`FE_SAME_LINE_SIZE`, SAME-LINE-SIZE): the `Text` children of one `Cluster` (or of a `Text` holding runs) share one `size` (absent is `md`); Badge, StatusDot, Chip and TagGroup are exempt, a non-literal size is skipped. `docs/same-line-size.md`.
- Added: `row-title-link` (`FE_ROW_TITLE_LINK`, ROW-TITLE-LINK): a `Link` as the title of a ListRow data object that has `onPress`, `onAction`, `href`, `onFollow` or `chevron`, or as the row-header cell of a DataTable whose rows open (`onRowAction` or row `href`), is refused: the row is the one pressable. `docs/row-title-link.md`.
- Added: `tabs-switch-zone` (`FE_TABS_SWITCH_ZONE`, TABS-SWITCH-ZONE): a pill (`Tabs appearance="primary"`) written in JSX is refused; it is drawn only as the `switch` header zone of a card. `no-primary-tabs-misuse` keeps the item checks.
- Added: `tabs-depth` (`FE_TABS_DEPTH`, TABS-DEPTH): at most two underline `Tabs` layers (the `Page header.tabs` and one region set, nested through the panel a `selectedKey` guards). Every tab is one size, so only the count is judged. `docs/tabs.md` says what each reads.
- Added: `gap-proximity` (`FE_GAP_PROXIMITY`, GAP-PROXIMITY): a Grammar layout element (Stack, Cluster, PaneSection, Section, Grid, Form, Fieldset) nested directly in another (through fragments, `cond && x`, `cond ? x : null` and `.map`) stands at least one gap step closer (identity 4 < inline 8 < row 12 < section 24 < region 32). A SurfaceCard, Drawer and Dialog reset it; a field stack inside a Form or Fieldset and `Grid kind="main-rail"` are exempt. `docs/gap-proximity.md`.
- Added: `field-label` (`FE_FIELD_LABEL`, FIELD-LABEL): a `Text`, `Label`, `label` or `span` standing right before a Grammar form control that has no `label` prop is a hand-made label; use the control's `label` prop. `docs/field-label.md`.
- Added: `surface-in-surface` (`FE_SURFACE_IN_SURFACE`, SURFACE-IN-SURFACE): a hand-made row list (Stack, ul, ol or div whose rows are divided by `Divider`) inside a SurfaceCard, Drawer, Dialog, PaneSection or main-rail rail is refused; use `Section kind="list"` or `SurfaceCard kind="list"`. `docs/surface-in-surface.md`.
- Added: `page-breadcrumbs` (`FE_PAGE_BREADCRUMBS`, PAGE-BREADCRUMBS): the `header` object of a console `Page` (page owner, layout owner or app block, not a boundary or `(auth)` page) states `breadcrumbs`, or `breadcrumbs: "root"` for the root page. `docs/page-breadcrumbs.md`.

## 0.27.2 - 2026-11-09

- Changed: peers `@starci/hfs ~6.5.0`; no lint rule changed.

## 0.27.1 - 2026-11-09

- Changed: its lint family peers `@starci/hfs ~6.4.0`; no lint rule changed.

## 0.27.0 - 2026-11-09

- Changed: released with the Grammar family at 0.27.0 (0.26.0 never reached npm; the family carries it) (its lint family peers `@starci/hfs ~6.3.0`); no lint rule changed.

## 0.25.2 - 2026-11-08

- Fixed: the `@starci/hfs` peer is `~6.2.0`, the range of the hfs the canon pins name, so an app on hfs 6.2 installs with `npm ci`.

## 0.25.1 - 2026-11-07

- A patch of the Grammar family, metadata only: the `@starci/hfs` peer is `~6.1.0` (it was `~6.0.0`), the range of the hfs the canon pins name, so an app on hfs 6.1 installs with `npm ci`.

## 0.25.0 - 2026-11-07

- A minor of the Grammar family: rule sources (`freestyle.ts`, `status-colors.ts`, `surface-depth.ts`, `lib/rule-contract.ts`, `lib/why.ts`) changed their text, so the family moves to 0.25.0 (`contexts/grammars/contributing.md` "Patch or minor").
- Peers `@starci/hfs` ~6.0.0. Comments, rule docs, bundled knowledge and messages cite rules by their ids and carry no ruling history.

## 0.24.0 - 2026-11-06

- Added: `no-button-view-switch` (R380, `FE_GROUPED_CHOICE_CONTROL`): two or more adjacent `Button` or `IconButton` elements, or one in a `.map`, carrying `aria-pressed`, `isSelected` or `isActive` are joined buttons or pills acting as tabs; use `Tabs` in the block's `filter` header zone. `docs/choice-controls.md` says which component switches what.
- Added: `no-primary-tabs-misuse` (R380): `Tabs appearance="primary"` and the `switch` header zone hold two to four fixed options with no `count`, `href` or `isAttention`; a literal that carries one is refused.
- Changed: the `SegmentedControl` replacement names `Tabs appearance="primary"`; the component is removed from `@starci/grammar` 0.24.0.
- Changed: with `@starci/grammar` 0.24.0 (the family shares a minor). `surface-card-kind` (R355) refuses a `Tabs`, `SearchField` or `Divider` inside a `{ kind: "custom" }` zone of a `SurfaceCard` or `Board` `headers` or `footers` array (message `zone`), and its messages and the `no-raised-surface-in-surface` fix name the typed zones instead of the removed `kind="bands"` and the renamed `footer` (now `note`).

## 0.23.2 - 2026-11-06

- Changed: the peer range of `@starci/eslint-canon-fe` follows the canon's new minor (`~9.16.0`, eslint-canon-fe 9.16.0); no rule of this package changed. Grammar stays at 0.23.3 (a lint patch never re-releases it).

## 0.23.1 - 2026-11-05

- Changed: version stamp, with `@starci/grammar` 0.23.1 (the family publishes as one; 0.23.0 of this package never reached npm). The version spec reads the canon-fe peer as its same-minor range.

## 0.23.0 - 2026-11-05

- Changed: with `@starci/grammar` 0.23.0; requires `@starci/eslint-canon-fe` `~9.15.0` and peers `@starci/hfs` `~5.13.0`, whose runtime it reads at run time instead of a bundled copy; `runtime/` keeps only the knowledge it cites.

## 0.22.0 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.22.0; requires `@starci/eslint-canon-fe` 9.14.4. The runtime copies carry the same-minor range of the canon pins, R15 and the canon pins of `@starci/hfs` 5.12.0.

## 0.21.38 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.38; requires `@starci/eslint-canon-fe` 9.14.3. The runtime copy of the canon pins names `@starci/hfs` 5.11.3.

## 0.21.37 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.37; requires `@starci/eslint-canon-fe` 9.14.2. The runtime copy of the canon pins names `@starci/hfs` 5.11.2.

## 0.21.36 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.36; requires `@starci/eslint-canon-fe` 9.14.1. The runtime copy of the canon pins names `@starci/hfs` 5.11.1.

## 0.21.35 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.35; requires `@starci/eslint-canon-fe` 9.14.0. The runtime copies carry the `rulePacks` key of the declaration check, R16, R381 and R382, and the canon pins of `@starci/hfs` 5.11.0.

## 0.21.34 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.34; requires `@starci/eslint-canon-fe` 9.13.16. The runtime copy of the canon pins names `@starci/hfs` 5.10.4.

## 0.21.33 - 2026-11-05

- Changed: version stamp, with `@starci/grammar` 0.21.33; requires `@starci/eslint-canon-fe` 9.13.15. The runtime copy of the canon pins names `@starci/hfs` 5.10.3.
- Added: `starci-grammar/no-grouped-choice-controls` (R380 `FE_GROUPED_CHOICE_CONTROL`): a `ButtonGroup`, `FilterButtonGroup` or `SegmentedControl` in product source is red and the message names the replacement (separate Buttons or a DropdownMenu, `Tabs kind="filter"`, `ChoiceChips` or `RadioGroup`).

## 0.21.32 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.32; requires `@starci/eslint-canon-fe` 9.13.14. The runtime copy of R377 accepts a bounded `removeOnFail`, and the runtime copy of the canon pins names `@starci/hfs` 5.10.2.

## 0.21.31 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.31; requires `@starci/eslint-canon-fe` 9.13.13. The runtime copy of R378 (`HFS_BRANCH_PROFILE_INVALID`) allows a branch pattern that never matches the default branch, and the runtime copy of the canon pins names the Grammar family 0.21.31.

## 0.21.30 - 2026-11-05

- Changed: version stamp only, with `@starci/grammar` 0.21.30; requires `@starci/eslint-canon-fe` 9.13.13. The runtime copy of the canon pins names `@starci/hfs` 5.10.1.

## 0.21.29 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.29; requires `@starci/eslint-canon-fe` 9.13.12. The runtime copies carry the R378 and R379 laws and the canon pins of `@starci/hfs` 5.10.0.

## 0.21.28 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.28; requires `@starci/eslint-canon-fe` 9.13.11. The runtime copy of the canon pins names `@starci/hfs` 5.9.1.

## 0.21.27 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.27; requires `@starci/eslint-canon-fe` 9.13.10. The runtime copies carry the R377 law and the canon pins of `@starci/hfs` 5.9.0.

## 0.21.26 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.26; requires `@starci/eslint-canon-fe` 9.13.9. The runtime copy of the canon pins names `@starci/hfs` 5.8.3.

## 0.21.25 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.25; requires `@starci/eslint-canon-fe` 9.13.8. The runtime copy of the canon pins names `@starci/hfs` 5.8.2.

## 0.21.24 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.24; requires `@starci/eslint-canon-fe` 9.13.7. The runtime copies carry the R273 law and the canon pins of `@starci/hfs` 5.8.1.

## 0.21.23 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.23; requires `@starci/eslint-canon-fe` 9.13.6. The runtime copies carry the module shape of `be.integrations.passport` in the package slot manifest, the R304 law and the canon pins of `@starci/hfs` 5.8.0.

## 0.21.22 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.22; requires `@starci/eslint-canon-fe` 9.13.5. the runtime copy of the canon pins names `@starci/hfs` 5.7.1 and the release-7a versions.

## 0.21.21 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.21; requires `@starci/eslint-canon-fe` 9.13.4. the runtime copies carry the R343, R251, R272 and R376 laws of `@starci/hfs` 5.7.0 and the release-6 canon pins.

## 0.21.20 - 2026-11-04

- Changed: `pane-grid-page` (R348) refuses a `Page chrome="panes"` whose child is not one `PaneGrid` element written there: a wrapper or component that renders the grid, a fragment, a variable, a condition, no child or several, each of which Page throws `PAGE_PANES_CHILD_NOT_PANE_GRID` for at run time; the grid-side "wrapped" finding is this one. Requires `@starci/eslint-canon-fe` 9.13.3. the runtime copies carry `engine/runtime-root.mjs`, which moves an installed copy's legacy state with its owner and mode (`@starci/hfs` 5.6.1), and the release-5 canon pins.

## 0.21.19 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.19; requires `@starci/eslint-canon-fe` 9.13.2. the runtime copies carry `engine/runtime-root.mjs` with the per-user state base of an installed copy (`@starci/hfs` 5.6.0) and the canon pins of release 4 (`@starci/auth` 0.4.0, `@starci/auth-oidc` 0.1.3).

## 0.21.18 - 2026-11-04

- Changed: version stamp only, with `@starci/grammar` 0.21.18; the runtime copies carry the R187 wording of `@starci/hfs` 5.5.1 and the release-3 canon pins; requires `@starci/eslint-canon-fe` 9.13.1.

## 0.21.17 - 2026-11-03

- Changed: version stamp only, with `@starci/grammar` 0.21.17; the runtime copies carry the root-packages view, the R187 and seed laws and the canon pins of this release; requires `@starci/eslint-canon-fe` 9.13.0.
- Changed: the package's slot manifest places any root workspace package `packages/<name>/` in `app.packages` (a block library such as `packages/blocks-core` beside the agent SDK and the module packages), so the root packages config lints it.

## 0.21.16 - 2026-11-03

- Changed: version stamp only, with `@starci/grammar` 0.21.16 (the FlowGraph lanes layout and branch labels); the runtime copy of the canon pins names the Grammar family at 0.21.16, `@starci/auth` 0.2.1, `@starci/auth-oidc` 0.1.1, `@starci/eslint-canon-be` 3.14.1, `@starci/eslint-canon-fe` 9.12.1 and `@starci/hfs` 5.4.0; requires `@starci/eslint-canon-fe` 9.12.1.

## 0.21.15 - 2026-11-03

- Changed: requires `@starci/eslint-canon-fe` 9.12.0; the runtime copies carry the R06 and R295 laws and the `@starci/nest-kit` and `@starci/next-i18n` pins.
- Added: `coreGrammarPackagesConfig`: the family rules over the front-end subpaths of the root workspace packages (`src/workbench/**`, `src/public/**`), the config of `coreGrammarConfig` narrowed by `scopeToPackages` of the universal canon.
- Changed: the runtime copy of the slot manifest carries the slots `app.packages`, `app.module-registry` and `app.packages-lint`.

## 0.21.14 - 2026-11-03

- Changed: requires `@starci/eslint-canon-fe` 9.11.0; the runtime copies of the slot manifest, stack and pins carry the `@starci/auth` rows.

## 0.21.13

- Changed: Require the updated FE canon, carry the rule catalog of @starci/hfs 5.1.0 (R368) and align the Grammar family.
- Changed: `navbar-cluster` (FE-APP-SHELL-3) requires notifications only where the shell has a notification source (a `use...Notification...` call in its file).
- Fixed: `route-page-is-one-page` declares the blocks its page proof reads as cross-file inputs, so a changed block re-judges the route and the page owner.
- Changed: `pane-grid-children` (R345) follows a `const` that holds a Pane.

## 0.21.12

- Changed: Require the updated FE canon, carry the rule texts of @starci/hfs 5.0.8 and align the Grammar family.

## 0.21.11

- Changed: Require the updated FE canon and align the Grammar family.

## 0.21.10

- Changed: Refresh quality-service rule data and require the aligned FE canon release.

## 0.21.9

- Changed: Use the shared source proof for native Page body layouts, require FE canon 9.9.9 and refresh the generated canon pins with the shared Grammar family release.

## 0.21.8

- Changed: Use the shared FE owner-source and connected Page drawing proofs for mounted route frames, require FE 9.9.8, and refresh the declared runtime catalog and pins.

## 0.21.7

- Changed: Bundled canon pins name the builder-provenance BE canon release and its coherent dependency cohort. This package changes no runtime behavior or rule severity.

## 0.21.6

- Changed: Align bundled canon pins and exact sibling requirements with Grammar and its lint families at 0.21.6. Runtime behavior and rule severity are unchanged.

## Unreleased

## 0.21.5 - 2026-11-02

- Changed: requires canon FE 9.9.5 and follows the HFS 5.0.1 canon-pin cohort; the Grammar component runtime stays at 0.21.3.

## 0.21.4 - 2026-11-02

- Changed: requires canon FE 9.9.4 and refreshes bundled pins for HFS 5.0.0; the Grammar component runtime stays at 0.21.3.

## 0.21.3 - 2026-11-02

- Changed: requires canon FE 9.9.3 and follows the coherent Grammar 0.21.3 API/pin cohort.

## 0.21.2 - 2026-11-02

- Changed: bundled pins follow Grammar 0.21.2 with disabled tab items and its coherent canon cohort; existing runtime checks are unchanged.

## 0.21.1 - 2026-11-02

- Changed: synchronized the Grammar 0.21.1 API and canon cohort pins; bundled cross-file checks distinguish semantic week regions from labelled peer-card grids.

- Changed: bundled R356 names `Grid kind="cards"` as the peer-card layout whose repeated tiles take no outside label, matching the existing `no-label-in-grid` rule and the cross-file surface-nesting owner.

## 0.21.0 - 2026-11-02

- Removed: `NavigationFeatureNav` from the surface names and the bundled Core playbook (the component is gone; `TopBar` takes `subnavigation`).
- Changed: the bundled rule catalog words the laws of R348, R351, R352 and R355 for the one card (no SurfaceListCard, SectionHeader or PageHeader).
- Added: `text-inline-only` (R357, `FE_TEXT_BLOCK`), `no-text-heading` (R358, `FE_TEXT_HEADING`) and `one-highlight-per-render` (R359, `FE_ONE_HIGHLIGHT`).
- Removed: `no-off-scale-glyph-size` (subsumed by `no-icon-size-class`), `no-decorative-icon-in-metric-cell` (named a component that does not exist), and `no-hand-rolled-heading` with `no-heading-tag-outside-heading-component` (one rule for headings: `no-raw-structural-element`).
- Changed: the app-shell laws and the pane laws stop naming `NavigationFeatureNav`, `BottomNav`, `FillViewport` and `Region`; the specs run from a worktree (`fixtures/canon-fe-source.mjs` resolves `@starci/eslint-canon-fe` to the sibling source, because `install-links=true` copies the package before its `dist/` is built).
- Fixed: the type declaration of `@starci/eslint-canon-fe/lib/freestyle.mjs`, so `npm test`'s typecheck passes.

- Changed: R323 (`no-hand-rolled-page-header`) reduces to imports: `PageHeader` and `Breadcrumbs` imported from `@starci/grammar` (by name, aliased or through a namespace) are the finding. R325 (`route-page-is-one-page`) refuses `PageHeader` and `PageContainer` the same way (message `part`) and keeps its one-Page reading. R324 (`page-tabs-in-header`) loses its `PageHeader` sibling clause. The bundled catalog carries the new law text.
- Changed: `no-raw-structural-element` names `Section` as the owner of `section`, `header`, `ul`, `ol` and `li`, and `Input`, `Select` and `Textarea` as the owners of `label`, since `Region`, `SectionHeader`, `List`, `ListItem` and `Label` are no longer grammar components. The bundled core playbook states `Text isStrong` in place of `Text weight`.
- eslint-grammar-core: R355 `surface-card-kind`, R366 `no-label-in-grid`; R340 `no-raised-surface-in-surface` now refuses any card in a card, Pane surface or overlay.

## 0.20.2 - 2026-11-01

- Changed: `status-text-uses-soft-foreground` follows the status pair rule. It refuses a solid tone painted as text on a `bg-<tone>-soft` tint of the same element (message `onTint`: use `text-<tone>-soft-foreground`) and the soft foreground with no `bg-<tone>-soft` behind it on its element or on an enclosing element of the file (message `alone`: use `text-<tone>`). A bare `text-<tone>`, which the rule refused before, is no longer a finding. Constants and `classes` entries are judged for the first finding only.
- Changed: with `offset-pop` as the selected Grammar the `alone` finding is not reported (its light theme keeps the soft foreground for a bare mark, the Pastel choice).
- Changed: the bundled rule catalog carries R351 to R354 and the new R61 law text.
- Changed: moves with `@starci/grammar` 0.20.2 (the stat strip's dividers) and requires `@starci/eslint-canon-fe` 9.8.5; the bundled canon pins follow; the status rule changes (below).

## 0.20.1 - 2026-11-01

- Changed: requires `@starci/eslint-canon-fe` 9.8.4; the bundled canon pins follow hfs 4.16.4; no rule changed.

## 0.20.0 - 2026-11-01

- Changed: moves with `@starci/grammar` 0.20.0 (`Quote`) and requires `@starci/eslint-canon-fe` 9.8.3; the bundled canon pins follow; no rule changed.

## 0.19.1 - 2026-11-01

- Changed: requires `@starci/eslint-canon-fe` 9.8.2; the bundled canon pins follow hfs 4.16.2; no rule changed.

## 0.19.0 - 2026-10-31

- Changed: moves with `@starci/grammar` 0.19.0 (FlowGraph `orbit`) and requires `@starci/eslint-canon-fe` 9.8.1; no rule changed.

## 0.18.0 - 2026-10-31

- Changed: moves with `@starci/grammar` 0.18.0 and requires `@starci/eslint-canon-fe` 9.8.0.

## 0.17.0 - 2026-10-31

- Added: the pane laws, `src/pane.ts` (docs/pane.md): R345 `pane-grid-children` (`FE_PANE_GRID_CHILD_NOT_PANE`: a `PaneGrid` child is a literal `Pane`, directly or from a conditional, `&&` or `.map`; a wrapper component, raw element, fragment or variable renders a blank cell), R346 `pane-children` (`FE_PANE_CHILD_NOT_SECTION`: a `Pane` holds `PaneSection`s or one `PaneGrid`, not a raw element or another Grammar component), R347 `no-pane-section-padding` (`FE_PANE_SECTION_PADDING`: no padding or margin utility on the outermost element of a `PaneSection`, same-file component roots and typed imported class constants followed) and R348 `pane-grid-page` (`FE_PANE_GRID_FRAME`: a `PaneGrid` stands in `Page chrome="panes"` or in a `Pane`, never in a `FillViewport`, a card or another page chrome). A Freestyle subtree is exempt. Offset Pop inherits them.
- Changed: requires @starci/eslint-canon-fe 9.7.0 and follows @starci/grammar 0.17.0 (`Pane` owns its content inset, `PaneSection`, `Page chrome="panes"`); the bundled runtime copies follow @starci/hfs 4.15.0 and the canon pins name the cohort hfs 4.15.0, eslint-canon-be 3.11.0, eslint-canon-fe 9.7.0, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.17.0.

## 0.16.6 - 2026-10-31

- Changed: requires @starci/eslint-canon-fe 9.6.7; the bundled runtime copies follow @starci/hfs 4.14.0 (R334 one style) and the canon pins name @starci/ai-router 0.5.0 (many providers behind one virtual key, the persisted key blacklist) and the cohort hfs 4.14.0, eslint-canon-be 3.11.0, eslint-canon-fe 9.6.7, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.6; no rule changed.

## 0.16.5 - 2026-10-31

- Changed: requires @starci/eslint-canon-fe 9.6.5; the bundled runtime copies follow @starci/hfs 4.13.2 (R344 in the catalog) and the canon pins name hfs 4.13.2 and the lint cohort (eslint-canon-be 3.10.0, eslint-canon-fe 9.6.5, eslint-grammar-core and eslint-grammar-offset-pop 0.16.5); no rule changed.

## 0.16.4 - 2026-10-31

- Changed: the bundled canon pins name @starci/hfs 4.13.1 and the lint cohort (eslint-canon-be 3.9.4, eslint-canon-fe 9.6.4, eslint-grammar-core and eslint-grammar-offset-pop 0.16.4); no rule changed. The peer moves to eslint-canon-fe 9.6.4.

## 0.16.3 - 2026-10-31

- Changed: the peer moves to eslint-canon-fe 9.6.3; the bundled canon pins name the 0.16.3 cohort (@starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.3, eslint-canon-fe 9.6.3, eslint-canon-be 3.9.3, stylelint-canon 2.3.0, jest-preset 2.6.0, hfs 4.13.0); ChatWorkspace and PaneLayout are removed with no alias; PaneGrid and Pane are the one generic pane grid: grammar names are generic. The core playbook names PaneGrid in its layout-frame and container lists.
- Added: starci-grammar/freestyle-has-reason (R341, FE_FREESTYLE_REASON_MISSING): a `<Freestyle>` region names a non-empty string-literal `reason`. no-raw-structural-element, no-fractional-step, generated-art-in-mascot-or-media-frame and no-inline-svg-outside-brand-mark-leaf do not report the raw elements inside a Freestyle subtree. Specs: src/freestyle.spec.ts.
- Added: `crossFileInputs` for the lint result cache of `starci app check`: the files each grammar rule reads beyond the linted file.

## 0.16.2 - 2026-10-31

- Changed: the peer moves to eslint-canon-fe 9.6.2; the bundled canon pins name @starci/grammar 0.16.2 (the horizontal Stepper connector line; SurfaceListCard takes its depth from the surface context).
- Added: starci-grammar/no-raised-surface-in-surface (R340, FE_RAISED_SURFACE_IN_SURFACE): a depth="top" forced on a SurfaceListCard that a SurfaceCard, SurfaceListCard or SurfaceAccordionCard of the same file encloses is a finding (BOUNDARY-6, DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE); the Grammar resolves a nested surface's depth from the surface context. Specs: src/surface-depth.spec.ts.

## 0.16.1 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.6.1; the bundled canon pins name @starci/grammar 0.16.1 (accentCorner, Backdrop, the shell filling the viewport).

## 0.16.0 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.6.0; the bundled runtime copies are now generated from the hfs build (TypeScript emitted as .mjs) per runtime/bundle.json, with a drift check in CI; the copies the package keeps as its own are listed there and stay hand-maintained; the bundled canon pins name hfs 4.12.0, eslint-canon-be 3.9.0, eslint-canon-fe 9.6.0, the Grammar family 0.16.0, jest-preset 2.5.3 and test-world 1.3.3. No rule of this package changed.
- Added: starci-grammar/generated-art-in-mascot-or-media-frame (R338, FE_GENERATED_ART_OUTSIDE_FRAME): a static /images/**.webp or .png src outside Mascot or MediaFrame is a finding; starci-grammar/mascot-asset-slot-required (R339, FE_MASCOT_ASSET_SLOT_MISSING): a Mascot names its assetSlot. Specs: src/mascot.spec.ts.

## 0.15.34 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.23; the bundled canon pins name hfs 4.11.22 (app check and lint pass under 20 findings), eslint-canon-be 3.8.21, eslint-canon-fe 9.5.23 and the Grammar family 0.15.34. No rule of this package changed.

## 0.15.33 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.22; the bundled canon pins name hfs 4.11.21 (the one-command urgent release), eslint-canon-be 3.8.20, eslint-canon-fe 9.5.22 and the Grammar family 0.15.33. No rule of this package changed.

## 0.15.32 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.21; the bundled slot manifest carries the `logic` field (passport declares its tokens, password and cookie files) and the object-storage slot's `object-storage.*` names; the bundled `allows.mjs` and manifest shape admit them; the bundled canon pins name hfs 4.11.20, jest-preset 2.5.2, eslint-canon-be 3.8.19, eslint-canon-fe 9.5.21 and the Grammar family 0.15.32. No rule of this package changed.

## 0.15.31 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.20; the bundled canon pins name hfs 4.11.19 (the schedule scanner reads interpolated identifiers and const-named SQL), eslint-canon-be 3.8.18, eslint-canon-fe 9.5.20 and the Grammar family 0.15.31. No rule of this package changed.

## 0.15.30 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.19; the bundled canon pins name hfs 4.11.18 (sealed `.enc.yaml` members pass HFS_STACKS_SHAPE; the deploy schema takes `serverRecipient` and a settings list), eslint-canon-be 3.8.17, eslint-canon-fe 9.5.19 and the Grammar family 0.15.30. No rule of this package changed.

## 0.15.29 - 2026-10-30

- Changed: the peer moves to eslint-canon-fe 9.5.18; the bundled canon pins name ai-router 0.4.0 (mounted keys), hfs 4.11.17, eslint-canon-be 3.8.16, eslint-canon-fe 9.5.18 and the Grammar family 0.15.29. No rule of this package changed.

## 0.15.28 - 2026-10-30

- Changed: the bundled `rules.yaml` states R260 with the configured-audience binding of an OIDC verifier. No rule of this package changed.
- Changed: the peer moves to eslint-canon-fe 9.5.17; the bundled canon pins name hfs 4.11.16, eslint-canon-be 3.8.15, eslint-canon-fe 9.5.17, the Grammar family 0.15.28 and test-world 1.3.2. No rule of this package changed.

## 0.15.27 - 2026-10-29

- Changed: the peer moves to eslint-canon-fe 9.5.16; the bundled canon pins name hfs 4.11.15, eslint-canon-be 3.8.14, eslint-canon-fe 9.5.16, the Grammar family 0.15.27 and jest-preset 2.5.1; the bundled `rules.yaml` states R80 and R263 with the `claimRow` claim of the `EntityInbox`. No rule of this package changed.

## 0.15.26 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.14, eslint-canon-be 3.8.13, eslint-canon-fe 9.5.15 and the Grammar family 0.15.26. No rule changed.

## 0.15.25 - 2026-10-29

- Changed: the peer moves to the 0.15.25 cohort (eslint-canon-fe 9.5.14); the bundled canon pins name hfs 4.11.13, eslint-canon-be 3.8.12, eslint-canon-fe 9.5.14 and the Grammar family 0.15.25. No rule changed.

## 0.15.24 - 2026-10-29

- Changed: the peer moves to the 0.15.24 cohort (eslint-canon-fe 9.5.13); the bundled canon pins name hfs 4.11.12, eslint-canon-be 3.8.11, eslint-canon-fe 9.5.13 and the Grammar family 0.15.24. No rule changed.

## 0.15.23 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.11, eslint-canon-be 3.8.10, eslint-canon-fe 9.5.12 and the Grammar family 0.15.23.; it depends on eslint-canon-fe 9.5.12. No rule changed.

## 0.15.22 - 2026-10-29

- Changed: the peer moves to the 0.15.22 cohort (eslint-canon-fe 9.5.11); the bundled canon pins name hfs 4.11.10, eslint-canon-be 3.8.9, eslint-canon-fe 9.5.11 and the Grammar family 0.15.22. No rule changed.

## 0.15.21 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.9, eslint-canon-be 3.8.8, eslint-canon-fe 9.5.10 and the Grammar family 0.15.21; it depends on eslint-canon-fe 9.5.10. No rule changed.

## 0.15.20 - 2026-10-29

- Changed: the bundled canon pins name hfs 4.11.8, eslint-canon-be 3.8.7, eslint-canon-fe 9.5.9 and the Grammar family 0.15.20; it depends on eslint-canon-fe 9.5.9. No rule changed.

## 0.15.19 - 2026-10-29

- Changed: the peer moves to the 0.15.19 cohort (eslint-canon-fe 9.5.8); the bundled canon pins name hfs 4.11.7, eslint-canon-be 3.8.6, eslint-canon-fe 9.5.8 and the Grammar family 0.15.19. No rule changed.

## 0.15.18 - 2026-10-29

- Changed: the peer moves to the 0.15.18 cohort (eslint-canon-fe 9.5.7); the bundled canon pins name hfs 4.11.6, @starci/test-world 1.3.1, eslint-canon-be 3.8.5, eslint-canon-fe 9.5.7 and the Grammar family 0.15.18, and pin `undici` 6.29.0 (owner `platform/http`). No rule changed.

## 0.15.17 - 2026-10-29

- Changed: the peer moves to the 0.15.17 cohort (eslint-canon-fe 9.5.6); the bundled canon pins name hfs 4.11.5, eslint-canon-be 3.8.4, eslint-canon-fe 9.5.6 and the Grammar family 0.15.17. No rule changed.

## 0.15.16 - 2026-10-29

- Changed: the peer moves to the 0.15.16 cohort (eslint-canon-fe 9.5.5); the bundled canon pins name @starci/test-world 1.3.0 (HTTPS fakes over the run's ephemeral fake CA), hfs 4.11.4, eslint-canon-be 3.8.3, eslint-canon-fe 9.5.5 and the Grammar family 0.15.16. No rule changed.

## 0.15.15 - 2026-10-29

- Changed: the peer moves to the 0.15.15 cohort (eslint-canon-fe 9.5.4); the bundled slot manifest 3.13.0 admits `pgmq` in `ruleParams.db.extensions` (the lite event bus), retires `ruleParams.db.queueOutbox` and `sides.be.queueOutbox` with the pg_cron half of R258, lists `public.event_bus_send`, `public.event_bus_read`, `public.event_bus_archive`, `public.event_bus_bury`, `public.event_bus_dead_letters` and `public.event_bus_requeue` in place of `public.event_bus_write` in `ruleParams.be.dbFunctions`, and moves slot `app.db.image` to `.starcistacks/images/db/Dockerfile` (admitted by the lite `app.starcistacks` allows); the bundled rule catalog keeps R258 `DB_PGMQ_DECLARED` as the event-bus law, retires `DB_CRON_OWNED` and adds R336 `BE_EVENT_BUS_LITE_SHAPE`; the bundled canon pins name hfs 4.11.3, eslint-canon-be 3.8.2, eslint-canon-fe 9.5.4 and the Grammar family 0.15.15. No rule changed.

## 0.15.14 - 2026-10-29

- Changed: the peer moves to the 0.15.14 cohort (eslint-canon-fe 9.5.3); the bundled slot manifest 3.12.0 lists the canon's database functions of R334 schema-qualified (`public.job_claim`, `public.job_tick_claim`) beside the pg built-ins it names bare (`gen_random_uuid` joins them), and its shape (`rule-params-shape.mjs`, `declaration-shape.mjs`) with the manifest check of `slots.mjs` refuses in hfs.json `sides.be.dbFunctions` a `pg_catalog` name and any bare name that is not a built-in the canon lists; the manifest bump is minor although that refusal is stricter, since R334 is new on manifest major 3 and its one app (nivo-lite) lists only names it admits (its one bare name, `gen_random_uuid`, is now a canon built-in); the bundled rule catalog's R334 and R68 laws name `platform/database/database.client.ts` as the one composer of the call statement; the bundled canon pins name hfs 4.11.2, eslint-canon-be 3.8.1, eslint-canon-fe 9.5.3 and the Grammar family 0.15.14. No rule changed.
- Changed: the bundled canon pins also carry the hfs 4.11.1 re-pin of db baseline --squash (R213 transaction control in migrations, extensions schema in the bootstrap), which bumped no eslint package.

## 0.15.13 - 2026-10-29

- Changed: the peer moves to the 0.15.13 cohort (eslint-canon-fe 9.5.2); the bundled slot manifest 3.11.0 adds the managed lite slot `app.db.image` (`db/Dockerfile`), narrows `ruleParams.db.extensions` to what the official postgres image plus pgvector carries (pgcrypto, pg_trgm, vector, uuid-ossp, unaccent, btree_gist; no pgmq, pg_cron, pg_net or supabase_vault) and gives `@nestjs/schedule` and `cron` one owner, `platform/jobs`, in `infraOwners`; the bundled rule catalog adds R335 `BE_JOBS_SCHEDULER_OWNER` and its R250 and R276 laws name the platform/jobs tick and the db image; the bundled canon pins name hfs 4.11.0, eslint-canon-be 3.8.0, eslint-canon-fe 9.5.2 and the Grammar family 0.15.13 and pin `@nestjs/schedule` 6.1.3 (CommonJS on the Nest 11 line) and `cron` 4.4.0. No rule changed.

## 0.15.12 - 2026-10-29

- Changed: the peer moves to the 0.15.12 cohort (eslint-canon-fe 9.5.1); the bundled slot manifest 3.10.0 adds the lite slot `be.platform.database.entities`, the entity registry (slot fields `role: entity-registry` and `importedBy`, validated by the manifest shape); the bundled canon pins name hfs 4.10.1, eslint-canon-be 3.7.1, eslint-canon-fe 9.5.1 and the Grammar family 0.15.12. No rule changed.
- Changed: the bundled rule catalog's R26 and R30 laws name the entity registry. No rule changed.

## 0.15.11 - 2026-10-29

- Changed: the peer moves to the 0.15.11 cohort; the bundled slot manifest 3.9.0 replaces the lite `app.supabase*` slots with `app.db` (`db/migrations`, `db/migrations/archive`, `db/seed.sql`, the managed `db/bootstrap.sql`), `be.integrations.supabase` with `be.integrations.passport` and `be.integrations.object-storage`, removes `fe.route.callback`, sets lite `schemaAuthority: sql`, gives lite TypeORM entities in `be.persistence`, adds `ruleParams.be.dbFunctions`, and moves the S3 SDKs to `integrations/object-storage` and the identity libraries to `integrations/passport` in `infraOwners` (`@supabase/*`, `minio` and `bcrypt` nowhere); the bundled rule catalog retires R216, R217, R219, R254 and R287 and adds R328-R334; the bundled canon pins name hfs 4.10.0, eslint-canon-be 3.7.0, eslint-canon-fe 9.5.0 and the Grammar family 0.15.11, pin `@nestjs/passport` 11.0.5 (CommonJS on the Nest 11 line), `passport` 0.7.0, `passport-google-oauth20` 2.0.0, `passport-local` 1.0.0, `bcryptjs` 3.0.3 and their types (tokens are signed and verified with `jose`; `@nestjs/jwt` stays allowed in `integrations/passport` but unpinned), and drop `@supabase/ssr`, `@supabase/supabase-js` and the `supabase` CLI. No rule changed.

## 0.15.10 - 2026-10-29

- Changed: `@starci/eslint-canon-fe` 9.4.9 is the peer dependency; the bundled slot manifest gives the model libraries their owners in `ruleParams.be.infraOwners` (`@starci/ai-router` to `integrations/ai-gateway`, `@langchain/*` to `integrations/ai`; `openai`, `langchain`, `@langchain/langgraph`, `@langchain/community` and the provider SDKs nowhere) and lists R326 and R327 on `be.integrations`; the bundled rule catalog carries R326 and R327; the bundled canon pins name hfs 4.9.11, eslint-canon-be 3.6.8, eslint-canon-fe 9.4.9, the Grammar family 0.15.10 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), and pin `@langchain/core` 1.3.1 and `@langchain/openai` 1.8.0. No rule changed.

## 0.15.9 - 2026-10-29

- Changed: `@starci/eslint-canon-fe` 9.4.8 is the peer dependency; the bundled canon pins name hfs 4.9.10, eslint-canon-be 3.6.7, eslint-canon-fe 9.4.8, eslint-grammar-core 0.15.9 and eslint-grammar-offset-pop 0.15.9. No rule changed.

## 0.15.8 - 2026-10-29

- Changed: `starci-grammar/route-page-is-one-page` (R325): a route segment `layout` whose owner (`fe.feature`, kind `layouts`), its pure half or its one root block draws a `Page` whose `header` carries `tabs` is the one `Page` of every route under it. The rule finds the route `page` files that mount a page owner, walks up through the `layout` files of their segments and resolves each layout's owner one level deep. A page owner every route of which is so framed is not judged `missing`; one that draws a `Page` (or a root block that draws one) under such a layout is `twice`, and the message names the layout. A layout whose `Page` carries no `tabs` frames no segment.
- Changed: R325 also judges layout owners (`fe.feature`, kind `layouts`): a `Page` they draw has nothing beside it (`sibling`; a `PageHeader` block beside the segment's `Page` belongs in its `header`), no `Page` inside another (`twice`), and no bare `PageHeader` or `PageContainer` (`part`). A layout owner that draws no `Page` is never `missing`.
- Changed: `@starci/eslint-canon-fe` 9.4.7 is the peer dependency; versioned together with Grammar 0.15.8; the bundled canon pins name the Grammar family 0.15.8 (grammar, eslint-grammar-core, eslint-grammar-offset-pop), eslint-canon-fe 9.4.7 and eslint-canon-be 3.6.6.
- Spec: `src/page.spec.ts`, `src/page-owners.spec.ts` (layout cases on the project fixture); docs: `docs/page.md`.

## 0.15.7 - 2026-10-29

- Changed: `starci-grammar/route-page-is-one-page` (R325): a route draws exactly one `Page`, drawn by the page owner, its pure half (`./component`), or the one connected block (`fe.components`, kind `blocks`) the owner renders as its root, read one level deep (the block's connected half and its own pure half). A server page owner whose header needs client data renders that block and passes the page body as its children. An element that draws the `Page` with an element sibling stays `sibling`; a `Page` (or a block that draws one) inside another is the new finding `twice`.
- Changed: R325 does not judge a page owner as `missing` when every route `page` file that imports it lies under the route group `(auth)` with its own `layout`: that layout draws the auth frame, the page frame of its sign-in, sign-up, password and callback pages. A page owner that draws no JSX (it only calls `redirect()` or `notFound()`, or returns null) stays unjudged. Workbench pages get no exemption.
- Changed: `@starci/eslint-canon-fe` 9.4.6 is the peer dependency; versioned together with Grammar 0.15.7; the bundled canon pins name the Grammar family 0.15.7 (grammar, eslint-grammar-core, eslint-grammar-offset-pop) and eslint-canon-fe 9.4.6.
- Spec: `src/page.spec.ts`, `src/page-owners.spec.ts` (new, cross-file); docs: `docs/page.md`.

## 0.15.6 - 2026-10-28

- Changed: `starci-grammar/route-page-is-one-page` (R325) also refuses a page owner file that draws JSX but no `Page` and draws through no pure half of its own (an element imported from `./component`), with the message `missing` on its first element. The segment boundary owners of FE-BOUNDARY-1 (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`) are not judged for it; a file that draws a bare `PageHeader` or `PageContainer` is reported once, as `part`. Spec: `src/page.spec.ts`; docs: `docs/page.md`.
- Changed: the R324 message names link tabs (items with `href`) as the other form of `header.tabs`.
- Changed: versioned together with Grammar 0.15.6; the bundled canon pins name the Grammar family 0.15.6 and hfs 4.9.8.

## 0.15.5 - 2026-10-28

- Changed: versioned together with Grammar 0.15.5 (the family equality spec); `@starci/eslint-canon-fe` 9.4.5 is the peer dependency; the bundled canon pins name the Grammar family 0.15.5. No lint rule changed.
- Changed: the bundled rule catalog states R225 with the app pre-push hook's dependency push gate (`starci deps check`). No lint rule changed.

## 0.15.4 - 2026-10-28

- Added: `starci-grammar/page-tabs-in-header` (R324, `FE_PAGE_TABS_OUTSIDE_HEADER`): a `Tabs` that is the first element child of a `Page`, or the next element sibling of a `PageHeader`, is a page tab bar outside the band; pass it as `header.tabs`.
- Added: `starci-grammar/route-page-is-one-page` (R325, `FE_ROUTE_PAGE_OUTSIDE_PAGE`): a page owner (`fe.feature`, kind `pages`) draws one `Page` with no element sibling and no `PageHeader` or `PageContainer` of its own. Spec: `src/page.spec.ts`; docs: `docs/page.md`.
- Changed: versioned together with Grammar 0.15.4; `@starci/eslint-canon-fe` 9.4.4 is the peer dependency; the bundled rule catalog carries R324 and R325, and the bundled canon pins follow release G (Grammar family 0.15.4, hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4, ai-router 0.3.0).

## 0.15.3 - 2026-10-28

- Added: `starci-grammar/no-hand-rolled-page-header` (R323, `FE_PAGE_HEADER_HAND_ROLLED`): a `Breadcrumbs` followed by a `SectionHeader` among one parent's element children is a page head composed by hand; compose Grammar 0.15.3's `PageHeader`. Spec: `src/page-header.spec.ts`; docs: `docs/page-header.md`.
- Changed: versioned together with Grammar 0.15.3; `@starci/eslint-canon-fe` 9.4.3 is the peer dependency; the bundled rule catalog carries R323, and the bundled canon pins follow release F (Grammar family 0.15.3, hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3, ai-router 0.3.0).

## 0.15.2 - 2026-10-28

- Changed: versioned together with Grammar 0.15.2; `@starci/eslint-canon-fe` 9.4.2 is the peer dependency, and the bundled canon pins follow release E (Grammar family 0.15.2, hfs 4.9.3, canon-fe 9.4.2, canon-be 3.6.2, ai-router 0.3.0) and pin no `starci-harness`. No rule changed.

## 0.15.1 - 2026-10-28

- Changed: versioned together with Grammar 0.15.1; `@starci/eslint-canon-fe` 9.4.1 is the peer dependency, and the bundled canon pins follow release D (Grammar family 0.15.1, hfs 4.9.2, canon-fe 9.4.1, canon-be 3.6.1, starci-harness 1.1.0-alpha.2), so an app installs the released versions without pin drift. No rule changed.

## 0.15.0 - 2026-10-28

- Changed: versioned together with Grammar 0.15.0; `@starci/eslint-canon-fe` 9.4.0 is the peer dependency, and the bundled canon pins follow release C (Grammar family 0.15.0, hfs 4.9.1, canon-fe 9.4.0, canon-be 3.6.0, jest-preset 2.4.1, `@starci/ai-router` 0.2.1), so an app installs the released versions without pin drift.
- Changed: the source is TypeScript in `src/`, built to `dist/` (`npm run build`; `prepack` builds); the package ships `dist/`, `runtime/` and `docs/` and no hand-written JavaScript or `index.d.ts` (the build emits the declarations, with the same public types). No rule or behaviour changed; the exports and specifiers (`.` and the default plugin) are unchanged.
- Changed: the specs are `src/*.spec.ts`, typechecked first by `npm test`.
- Fixed: the built declarations name `.js`, not the `.ts` sources (`tsc` keeps a relative `.ts` specifier in a `.d.ts`, which a consumer tsc cannot read).

## 0.14.0 - 2026-10-27

- Changed: versioned together with Grammar 0.14.0; the bundled canon pins name the 0.14.0 Grammar family.
- Added: `starci-grammar/chip-label-starts-uppercase` (R322 `FE_CHIP_LABEL_CASE`): a literal `StatusDot` or `Badge` label starts with an uppercase letter, Vietnamese included; the fix uppercases it in place.
- Changed: `@starci/eslint-canon-fe` 9.3.0 is the peer dependency; the bundled canon pins name `starci-harness` 1.1.0-alpha.1 (`source: cli/package.json`) in place of the retired `@starci/cli`, the one command line a product installs for `starci app`, and follow hfs 4.9.0, canon-fe 9.3.0 and canon-be 3.5.0. One rule law changes (above).

## 0.13.0 - 2026-10-27

- Changed: `@starci/eslint-canon-fe` is a peer dependency (9.2.0), installed by the app beside this package, instead of a nested dependency.
- Changed: the package lives in github.com/starci183/starci-harness under `packages/` and publishes from there; its bundled `runtime/` is committed source, edited in place (no generator, no `prepack`/`pretest` hook).
- Changed: there are exactly two Grammar families, `core` and `offset-pop`. This package is renamed from
  `@starci/eslint-grammar-starci` to `@starci/eslint-grammar-core`, and its factory from `starciGrammarConfig` to
  `coreGrammarConfig`, which loads for `sides.fe.grammar: core`.
- Removed: the ids `starci` and `starci-core` are not families and have no alias; an app that names them is refused.
  Migrate: `sides.fe.grammar: core`, depend on `@starci/eslint-grammar-core`, call `coreGrammarConfig`.

## 0.12.14 - 2026-10-27

- Changed: versioned together with Grammar 0.12.14; bundled canon pins moved.

## 0.12.13 - 2026-10-26

- Changed: versioned together with Grammar 0.12.13 (control height 40, shared scroll carets).

## 0.12.12 - 2026-10-26

- Changed: versioned with Grammar 0.12.12 (the family equality spec); the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 0.12.11 - 2026-10-26

- Changed: versioned with the other lint families; depends on the exact front-end canon 9.1.7; the alpha.31.1 round folded into alpha.31; the bundled canon pins and runtime copies follow the final package versions. No rule changes.

## 0.12.10 - 2026-10-26

- Changed: versioned with Grammar 0.12.10; depends on the exact canon-fe 9.1.6; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.9 - 2026-10-26

- Changed: versioned with Grammar 0.12.9; depends on the exact canon-fe 9.1.5; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.8 - 2026-10-26

- Changed: versioned with Grammar 0.12.8; depends on the exact canon-fe 9.1.4; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.7 - 2026-10-26

- Changed: versioned with Grammar 0.12.7; depends on the exact canon-fe 9.1.3; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.6 - 2026-10-26

- Changed: versioned with Grammar 0.12.6; depends on @starci/eslint-canon-fe 9.1.2; the bundled runtime copies follow the new sources. No rule changes.

## 0.12.5 - 2026-10-26

- Changed: versioned with Grammar 0.12.5; depends on @starci/eslint-canon-fe 9.1.1; the bundled canon pins follow the new package pins. No rule changes.

## 0.12.4 - 2026-10-26

- Changed: versioned with Grammar 0.12.4; no rule changes beyond the version pin.

## 0.12.3 - 2026-10-26

- Added: the StarCi Grammar lint package, released with Grammar 0.12.3. Concrete family laws move from the universal FE canon with their rule IDs and behavioral specs, including the Grammar 0.12.3 lane's `no-icon-size-class` and `destructive-menu-entry-needs-danger-tone` in their latest form. The R318 surface composition rules stay in the universal canon.
- Added: the `starciGrammarConfig` flat-config factory, complete error-level recommendations, ownership citations and a generated runtime closure.
- Shared: generic lint readers are imported from `@starci/eslint-canon-fe` 9.0.0.
