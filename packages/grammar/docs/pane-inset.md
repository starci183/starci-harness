# Pane inset: one padding system for everything placed in a PaneGrid

Status: implemented in grammar 0.17.0. Owner's words (2026-10-31): "trò thiết kế hệ thống padding đồng nhất cho grammar chứ
mỗi nơi 1 padding trò thấy k" and, for the agent page, "sao trang lan agent có gap 1 khoảng trên vậy??? … phải dính vào
chứ". This document decides the model, the API, the migration, the enforcement, and ends with three ready-to-paste
work-package briefs (A grammar, B lint + contexts, C nivo-lite).

## 1. The defect, measured

Today `Pane` only divides space ("the pane imposes no padding, layout or structure", PaneGrid source and
`contexts/ui/components/pane-grid.md` Owner split), so every block hand-picks an inset in a `classNames.ts`, and each
Grammar control adds its own vendor outer padding on top. Measured on nivo-lite (`http://localhost:3100`, built-in
browser, `getBoundingClientRect`, numbers are px from the pane's content-box start, after the 1px divider):

**Office `/chat`, desktop (viewport 1082, list pane 320 wide)**

| band | first box | text / glyph inside |
|---|---|---|
| list head "Trò chuyện" (`LIST_HEAD_CLASS_NAME px-4`) | — | 16 |
| search field (`SEARCH_CLASS_NAME px-4`) | 16 (right 16) | icon 28, input text 44 |
| filter tabs (`TABS_CLASS_NAME px-4`, `Tabs variant="secondary"`) | track 16, first tab pill **20** | text 36; the track overflows the pane by 44 px (scrollWidth 348 vs 288): the 4th tab is clipped |
| conversation list (`BODY_CLASS_NAME px-4` + vendor listbox `p-1`) | listbox 16, selected pill **20** (right 20, radius 16) | avatar 28, title 80 |
| head band (`HEAD_BAND_CLASS_NAME px-4`) | avatar 16 | — |
| thread (`BAND_CLASS_NAME px-3 sm:px-6`) | bubbles **24** (12 below 640 px) | — |
| composer (`COMPOSER_BODY_CLASS_NAME px-4`) | chip 16, `@` button 16, textarea 64, "Gửi" ends 16 | `@` glyph 26, hint text 16 |

**Office `/chat`, phone (375)**: list head 16; tabs track 16, first pill 20, text 36, track ends 11 from the right edge;
selected pill 20, avatar 28, title 80. Composer and thread follow the same classes (16 and 12).

**Second Brain `/brain` "Hồ sơ", desktop (1082) and phone (375)**

| band | first box | text |
|---|---|---|
| meter (`METER_CLASS_NAME p-4`) | 16 | label 16 |
| category ListBox (no wrapper, vendor `p-1`) | selected pill **4** (right 4) | label 12 |
| main pane (`MAIN_PANE_CLASS_NAME p-4 sm:p-6`) | heading 24, card 24 (16 on phone) | — |
| page tabs → grid | tab line ends at y 217, grid starts at y 241: a **24 px gap** (the bleed Page's `row-gap: var(--grammar-region-gap)`) | |
| phone layout | the `list` pane (row `auto`, scroll) takes 486 px and the `main` pane gets **1 px**: the dossiers are unreachable | |

**Agent `/agents/chatbot/<id>` "Thiết lập" (786)**: tab line ends at y 212, the frame starts at y 236 (24 px gap); the
frame is a joined `SurfaceCard` (radius 24, inner 16) with a page bottom inset of 24, holding a hand-built split
(`AgentInstanceFrame` FRAME/RAIL_COLUMN/SEPARATOR_VERTICAL, then `AgentSetupPage` SPLIT/CHAT_COLUMN/SIDE_COLUMN with
vertical `Divider`s) around a `PaneGrid` (AgentSetupChat). Rail head `px-4`, rail list `p-2`, rail foot `p-4`, chat head
`px-4`, composer `px-4`, side alert `p-4`.

So one screen shows five first-box edges (4, 12, 16, 20, 24) and the outer frame of a tabbed app page is a floating card
24 px under its tabs. Every value is individually defensible; together they read as "each place has its own padding".

## 2. The model

1. **The Pane owns its content inset.** `Pane` gets `inset: "content" | "flush"` (default `content`). It never pads
   itself; it publishes its edge to its descendants as CSS custom properties (`--starci-core-pane-inset-inline`,
   `--starci-core-pane-inset-block-start`, `--starci-core-pane-inset-block-end`) and a React context, so dividers,
   scroll owners and scrollbars stay full-bleed (presentation laws 4 and 5).
2. **Values, by side contact (law 3).** Inline: `--grammar-pane-inset`, PADDING-4 (1rem in core; a family may set its
   own step), on both sides of every pane, at every breakpoint. Block start: PADDING-3 (0.75rem), since a pane's top
   always faces a divider or the page band's separator. Block end: PADDING-4 when the pane touches the grid's bottom
   edge (an outer edge), PADDING-3 when it faces a divider; the grid layout already knows the edges per breakpoint and
   gains `blockEnd`. `flush` sets all three to 0 (a nested PaneGrid, a full-bleed canvas).
3. **`PaneSection` is the one band primitive.** Every child of a Pane is a `PaneSection` or one nested `PaneGrid`.
   A section pads inline by the pane inset; the sections of a pane stack in a flex column with `--grammar-row-gap`
   between them (law 1: gap owns sibling distance), the first takes the block-start inset, the last the block-end inset.
   Props: `grow` (takes the remaining height), `scroll` (its own scroll owner with `label`, `role`, `tone`, `scrollRef`;
   the scroller is full-bleed and its content carries the inset, so the scrollbar sits on the pane edge), `align`
   (`start` | `center`, for a head band centred in a shared grid row), `bleed` (`inline`: for one horizontal scroller,
   a chip row, which then reaches both pane edges and takes the inset as its own scroll padding), `gap` (`inline` |
   `row` | `section` between its own children), `as` (`div` | `header` | `footer`). No `className`, no `style`.
4. **Every box aligns to the content edge; text inside a box keeps the vendor's own padding.** This is ruling
   `panel-list-box-edge` made universal: the search field box, the first tab pill, the selected list row, the meter,
   the first chip, the `@` button and the hint line all start at 16; the title inside a row (80 after its avatar) or the
   input text (44 after its icon) are the box's own anatomy and are not aligned to anything outside the box.
5. **Grammar components read the pane edge, apps pass nothing.** In a pane: `ListBox` resolves `inset="panel"` (today
   only on a surface pane) and drops the vendor listbox padding, so the row box (and the selection pill) is exactly the
   content edge; an unpainted tab track (`Tabs variant="secondary"`) drops its inline track padding so the first pill
   is the edge; `HorizontalScrollRegion` in a `bleed="inline"` section takes the inset as `padding-inline` and
   `scroll-padding-inline`; `VerticalScrollRegion` inside a section adds no inset of its own. `SearchField`, `Meter`,
   `SegmentedControl`, `Textarea`, `Button` already have no outer padding and need nothing.
6. **Drawers reuse it.** `collapse="drawer"` renders the pane's children inside the drawer under the same inset
   provider (drawer = `content`, block end outer), and the drawer header's inline padding is the same pane inset, so the
   heading and the sections share one edge.
7. **Scroll and focus.** A `scroll` pane (or `scroll` section) keeps the scroller full-bleed with its `-2px` focus
   outline; content sits 12–16 px in, so the ring never touches content (PADDING-1 focus clearance is met). A
   `bleed="inline"` horizontal row takes PADDING-1 block padding inside its scroller so a chip's focus ring is not cut by
   the horizontal overflow clip.
8. **Phone (law 7).** The pane inset does not step: 1rem at base, medium and wide. At phone width the page gutter is
   also 1rem, so page header, page tabs and pane content share x = 16. Separator-facing block sides never step.
9. **The tabbed app page attaches flush.** `Page chrome="panes"` is the canonical "page header + tabs + full-bleed
   PaneGrid" frame: the header band (with or without `tabs`, or the trail alone), then exactly one `PaneGrid` attached
   to the band's separator with no gap, reaching both content edges and the viewport bottom (Page measures the height
   itself, as `FillViewport` with `bottomInset="none"` does today, and accounts for Grammar bottom chrome), no card, no
   radius, no margin. The tab line is the only line between tabs and grid; the grid's dividers run its full height. A
   routed sub-page (a tab body) renders its own `PaneGrid` inside a `flush` Pane of the frame's grid.
10. **PaneGrid refuses what it would drop.** A non-`Pane` child (a wrapper component, a fragment) throws
    `PANE_GRID_CHILD_NOT_PANE` in development and is refused by lint, instead of silently rendering a blank pane.

### Why a section primitive and a Pane prop (both)

The `inset` prop alone cannot tell which children are bands: a pane holding a search bar, a tab row and a scrolling
list needs three bands with one gap between them and the list scrolling alone, and a CSS rule on "every child of a
pane" would also pad a divider or a nested grid. A `PaneSection` alone, without the pane owning the value, would let
two panes of one grid choose different steps. So the pane owns the value and the edge facts (outer or divider, per
breakpoint), and the section is the only thing that consumes them.

### Selection highlight: inset pill, not full-bleed

The selected row is a pill whose box starts at the content edge (16) and keeps the vendor radius and item padding. This
matches ruling `panel-list-box-edge` ("content keeps the vendor item padding and radius ... with no negative-margin
bleed"), the Office conversation card as drawn today, and every other pill box in the pane (search, tabs, chips), so one
edge serves all of them. A full-bleed row (fill to the pane edge, text at 16) was rejected: it needs the vendor radius
and padding removed (a parity change), its fill would touch the divider on one side and not the other, and the text
would align to a different x than every boxed control above it.

## 3. API (grammar, package `@starci/grammar`)

```ts
// PaneGrid/index.tsx
export type PaneInset = "content" | "flush"
type PaneBaseProps = {
    readonly area: string
    readonly surface?: boolean
    /** `content` (default): the pane publishes the Grammar pane inset to its PaneSections. `flush`: zero inset, for a nested PaneGrid or a full-bleed canvas. */
    readonly inset?: PaneInset
    /** PaneSection elements, or one PaneGrid. */
    readonly children?: ReactNode
    // className is removed: a pane takes no app class.
}

// PaneSection/index.tsx (composition tier, exported from common, core and offset-pop)
export type PaneSectionProps = {
    readonly children: ReactNode
    /** Takes the remaining block size of the pane (min-height 0). */
    readonly grow?: boolean
    /** Its own vertical scroll owner (OVERFLOW-4/5) with the inset inside the scroller. Implies grow. */
    readonly scroll?: {
        readonly label: string
        readonly role?: "log" | "region"
        readonly tone?: "surface" | "background"
        readonly scrollRef?: Ref<HTMLDivElement>
    }
    /** Head band centred in a shared grid row. Default `start`. */
    readonly align?: "start" | "center"
    /** `inline`: the one horizontal scroller in it reaches both pane edges and takes the inset as scroll padding. */
    readonly bleed?: "inline"
    /** Gap between its own children. Default `row`. */
    readonly gap?: "inline" | "row" | "section"
    readonly as?: "div" | "header" | "footer"
}

// Page/index.tsx
export type PagePanesProps = PageCommonProps & {
    readonly chrome: "panes"
    readonly header?: PageHeaderContent | PageTrailContent
    /** Floor height, as FillViewport's (default md). */
    readonly minHeight?: FillViewportMinHeight
    /** Exactly one PaneGrid. */
    readonly children: ReactElement<PaneGridProps>
}
```

CSS (common/styles.css, PaneGrid block): `--grammar-pane-inset` on the root token block (core: `1rem`; offset-pop
reads the same unless it sets its own step); `.starci-core-pane` sets the three `--starci-core-pane-inset-*` from its
`data-grammar-pane-inset` and the per-breakpoint `--starci-core-pane-be-*` (outer vs divider) in the existing container
queries; `.starci-core-pane-stack` (flex column, `gap: var(--grammar-row-gap)`, `min-height: 0`, `flex: 1`);
`.starci-core-pane-section` pads inline, first/last child take block start/end; the scroll variant moves the padding
into its scroller; `.starci-core-list-box[data-grammar-list-inset="panel"]` loses the vendor `padding-inline`;
`.starci-core-page[data-grammar-page-chrome="panes"]` has `gap: 0`, no block padding, and its body is the measured
fill box. Data-contract stamps: Pane `PADDING-4 PADDING-3` (content) or `PADDING-0` (flush); PaneSection
`PADDING-4 GAP-3`; Page panes `LAYOUT-1 BOUNDARY-1 GAP-0`.

## 4. Migration (nivo-lite; every block that hand-pads inside a pane or hand-builds one)

| file | classNames that disappear | becomes |
|---|---|---|
| `blocks/OfficeMessenger` | `LIST_HEAD_CLASS_NAME`, `CONVERSATION_CLASS_NAME`, `TASKS_CLASS_NAME`; `Page chrome="bleed"` + `FillViewport` | `Page chrome="panes"`; each Pane's content is `PaneSection`s; the thread pane holds one `PaneSection scroll` |
| `composites/OfficeConversations` | `HEAD_CLASS_NAME`, `SEARCH_CLASS_NAME`, `TABS_CLASS_NAME`, `BODY_CLASS_NAME` (the `NavLandmark` wrapper padding) | returns three `PaneSection`s: search, filter, list (`grow`); `TRAILING`/`INDICATOR` stay (row anatomy) |
| `composites/OfficeHeader` | `HEAD_BAND_CLASS_NAME` padding (`px-4 py-3`) | `PaneSection align="center"`; inner flex classes stay |
| `composites/OfficeThread` | `SCROLL_CLASS_NAME`, `BAND_CLASS_NAME` padding (`px-3 sm:px-6`), `BODY_CLASS_NAME` `py-4`, `TYPING_CLASS_NAME` `px-12` | `PaneSection scroll={{ role: "log", tone: "background", scrollRef }}`; the `max-w-4xl` measure stays; the typing row indents by its own avatar width through the bubble anatomy, not `px-12` |
| `composites/OfficeComposer` | `COMPOSER_BODY_CLASS_NAME` padding, `CHIPS_CLASS_NAME` `pb-1` | chips: `PaneSection bleed="inline"`; row + hint: `PaneSection` |
| `composites/OfficeInfoPanel` | `HEAD_CLASS_NAME` padding, `BODY_CLASS_NAME` `p-4` | head `PaneSection align="center"`; body `PaneSection gap="section"` (in the docked pane and the drawer alike) |
| `composites/OfficeTasks` (via `TASKS_CLASS_NAME`) | `p-4 sm:p-6`; `ROW_CLASS_NAME` `px-4 py-4` is row anatomy inside a list and stays only if it is not a band | `PaneSection scroll` |
| `blocks/BrainDossiers` | `METER_CLASS_NAME`, `MAIN_PANE_CLASS_NAME` padding (`p-4 sm:p-6`) | meter `PaneSection`, ListBox `PaneSection grow`; main `PaneSection gap="section"`; phone: `list` pane `collapse="drawer"` below medium (fixes the 1 px main pane) |
| `blocks/BrainPageFrame` + `features/pages/BrainPage` | `BLEED_PANEL_CLASS_NAME` wrapper; the dossiers tab's `Page chrome="bleed"` | `Page chrome="panes"` for the dossiers tab; the tabpanel role moves onto the PaneGrid section (`role`/`id` props, or the header tabs' panel id) |
| `blocks/AgentSetupChat` | `CHAT_BAND`, `COMPOSER`, `THREAD`, `THREAD_BAND`, `SENDING` padding | `PaneSection`s |
| `blocks/AgentInstanceFrame` | `FRAME`, `RAIL_COLUMN`, `SEPARATOR`, `SEPARATOR_VERTICAL`, `MAIN`, `BODY` (and `has-[[data-bleed]]`), the joined `SurfaceCard`, `FillViewport bottomInset="page"` | `Page chrome="panes"` + `PaneGrid` areas `rail main` (rail `compact`/`standard`, `collapse="drawer"` below medium); main Pane `flush` hosting the routed tab |
| `blocks/AgentInstanceRail` | `RAIL_HEAD px-4 py-3`, `RAIL_LIST p-2`, `RAIL_FOOT p-4` | three `PaneSection`s (list `scroll`) |
| `features/pages/AgentSetupPage` | `SPLIT`, `CHAT_COLUMN`, `SEPARATOR_HORIZONTAL`, `SEPARATOR_VERTICAL`, `SIDE_COLUMN`, `data-bleed`, both `Divider`s | one `PaneGrid` (chat head / conversation / composer + side), the AgentSetupChat panes merged into it |
| `blocks/AgentSetupSide` | `ALERT p-4` | `PaneSection` |
| `blocks/AgentChat` + `composites/AgentChat{Header,RailHead,Thread,Composer}` | `FRAME_CLASS_NAME`, `LIST_COLUMN*`, `MAIN_CLASS_NAME`, `LIST_SCROLL p-2`, `CHANNEL_BAR px-3`, header `px-3 py-3`, rail head `p-3`, thread `p-4`, composer `px-4 pt-3 pb-4`; joined `SurfaceCard` | `Page chrome="panes"` (trail header) + `PaneGrid` (`rail` drawer below medium) + sections |
| `composites/ChatbotInboxPanel` + `ChatbotConversationList`, `ChatbotThreadView`, `ChatbotSidePanel` | `INBOX_CLASS_NAME`, `*_PANE_*`, joined `SurfaceCard`s (one nested), `HEAD px-4 py-3`, `SEARCH px-3`, `FILTERS px-3`, `LIST_BODY px-2`, `THREAD_BAND px-4`, `SIDE_SECTION p-4`, `CENTER p-6` | nested `PaneGrid` (list / thread / side drawer) inside the frame's flush main pane |

Concurrent work: another agent is committing the Second Brain fix (flush divider under the tabs, the CategoryPane
wrapper that PaneGrid dropped); lane C starts from that commit. WP-C of the dossier review will add a third `detail`
pane to BrainDossiers: with this model it is one more `<Pane area="detail" ...>` of `PaneSection`s (`areas.wide`
`["list main detail"]`, `collapse="drawer"` below wide) and needs no inset decision.

Versions (base `pkg/claude-no-raw-sql`: grammar and lint family 0.16.6, eslint-canon-fe 9.6.6, hfs 4.14.0): grammar
**0.17.0** (new API, `Pane.className` removed), eslint-grammar-core and eslint-grammar-offset-pop **0.17.0** (they move
with the Grammar), eslint-canon-fe **9.7.0**, hfs **4.15.0** (canon pins), and the cli prerelease that ships the
contexts. If the base has moved when a lane starts, each is the next minor above what the base holds.

## 5. Enforcement

Grammar (runtime, lane A): `PaneGrid` throws `PANE_GRID_CHILD_NOT_PANE` in development for a child that is not a
`Pane` element (null, false and `.map` arrays of Panes stay legal); `Pane` (content inset) logs
`PANE_WITHOUT_SECTION` in development when it renders no `PaneSection` and no `PaneGrid`; `PaneSection` outside a Pane
throws `PANE_SECTION_OUTSIDE_PANE`. The types already refuse `className` on Pane and PaneSection.

Lint (lane B), each a new HFS rule id in `contexts/hfs/rules.yaml` (the next free ids at the time of writing):

| rule | package | refuses |
|---|---|---|
| `pane-grid-children` | eslint-grammar-core | a JSX child of `PaneGrid` that is not a literal `<Pane>` (directly, in `cond ? <Pane/> : null`, `cond && <Pane/>`, or a `.map` returning `<Pane/>`): a component element, fragment or variable is `FE_PANE_GRID_CHILD_NOT_PANE` (the CategoryPane blank pane) |
| `pane-children` | eslint-grammar-core | a raw DOM element, or a Grammar component that is not `PaneSection`/`PaneGrid`, as a direct child of `Pane` (`FE_PANE_CHILD_NOT_SECTION`); a project component is allowed and judged in its own file |
| `no-pane-section-padding` | eslint-grammar-core | a padding or margin utility (`p-*`, `px-*`, `py-*`, `ps/pe/pt/pb-*`, `m-*`, `mx/my/ms/me/mt/mb-*`, arbitrary padding/margin) on the outermost element(s) rendered inside a `PaneSection`, or on a component's root when that component is returned as a PaneSection child in the same file (`FE_PANE_SECTION_PADDING`) |
| `pane-grid-page` | eslint-grammar-core | a `PaneGrid` that is neither the child of `Page chrome="panes"` nor inside a `Pane` (`FE_PANE_GRID_FRAME`): no `FillViewport` + PaneGrid, no PaneGrid in a card |
| `no-hand-built-panes` | eslint-canon-fe (surface rules) | a `Divider orientation="vertical"` used as a column seam (a sibling of block columns in a raw flex row, or inside a `SurfaceCard composition="joined"`) (`FE_HAND_BUILT_PANES`: use PaneGrid) |
| `no-list-panel-padding` (updated) | eslint-canon-fe | `Pane` and `PaneSection` join `SURFACES`, so wrapper padding around a `ListBox` in a pane is caught in-file |

Contexts (lane B): `ui/components/pane-grid.md` (Job, Variants `inset` and PaneSection, Owner split: the Grammar owns
the inset; a new `pane-grid.choose.page` row: a tabbed app page is `Page chrome="panes"`), `ui/presentation.md` law 3
and law 4 cite PaneSection as the flush-band API, `ui/composition.md` LAYOUT-1 and FE-APP-SHELL-7, `ui/components/page-header.md`
(tabs over a panes body attach flush), `ui/components/list-table.md` (row box at the pane content edge),
`grammars/contract.md`/`contract.yaml` (PaneGrid role: inset, PaneSection, Page chrome `panes`), `vendor/wrappers.yaml`
if the ListBox padding override is a wrapper change, `decisions/rulings.yaml`: replace `pane-grid` (drop "what goes in a
cell is the app's business" for the inset) and add `pane-inset` and `page-panes-frame` with the owner's words.

## 6. Critique and what was rejected

- **Rejected: Pane pads its own box.** Simplest, but a divider, a nested grid, a scroller's scrollbar and a full-bleed
  chip row would all be inset, breaking laws 4 and 5 and putting the scrollbar 16 px inside the pane.
- **Rejected: a CSS rule on every child of a pane** (`.starci-core-pane > *`). It pads things that must not be padded
  and gives no place for the gap between bands or the scroll band.
- **Rejected: full-bleed selection rows.** See section 2: it fights the vendor anatomy and ruling `panel-list-box-edge`.
- **Rejected: aligning text instead of boxes.** Aligning the search text, tab text and row title to one x would need
  per-component negative offsets and breaks the moment a leading glyph or avatar size changes.
- **Rejected: a fluid pane inset following the page gutter** (`clamp(1rem, 3vw, 2rem)`). It is not a scale step, two
  panes of one grid would read different values at a container-query boundary, and at wide widths the header content
  is centred in its measure anyway. Cost accepted: at wide widths the page header text (gutter up to 32) and the first
  pane's content (16) do not share an x; they do at phone width.
- **Rejected: stepping the pane inset at `wide`** (16 to 24). Panes are dense app surfaces; a reading pane that wants
  air caps its measure (MEASURE-4) instead.
- **Trade-off: `PaneSection` everywhere is more markup**, and a project component inside a Pane can only be judged in
  its own file (lint `pane-children` allows it; `no-pane-section-padding` follows same-file roots only). The runtime
  `PANE_WITHOUT_SECTION` warning and the stories' play functions (run by CI) cover the gap.
- **Trade-off: `Page chrome="panes"` takes over FillViewport's measuring** (one shared hook, two owners of a fill box).
  Kept, because the alternative (apps
  composing `Page` + `FillViewport` + `PaneGrid` and choosing `bottomInset`) is exactly the free choice that produced
  the 24 px gaps.
- **Noticed, not decided here:** Office filters a collection with `Tabs`; `segmented-control.choose.role` says a
  filter is a selectable `TagGroup`, and the tab track overflows a 320 px pane today. Lane C reports it; it does not
  change it.

## 7. Work-package briefs

The three briefs below are disjoint by path: A writes only `packages/grammar/**`; B writes `packages/eslint-*/**`,
`packages/hfs/**`, `contexts/**`, `cli/**` version/changelog only; C writes only `D:/starci-lanes/nivo-lite/fe/**` and
the nivo package files a pin move touches. A and B run in parallel; B takes A's version numbers and rebases onto A's
branch before its pins step; C starts after the owner has pushed and CI has published A and B. Every brief repeats the
hard rules so it can be pasted alone.

### Brief A: grammar components, tokens and stories

```text
You are a worker on the StarCi harness (D:/.claude). Implement the Pane inset system in @starci/grammar exactly as
designed in packages/grammar/docs/pane-inset.md on branch pkg/claude-pane-inset. Read that document whole first;
sections 2, 3 and "Grammar (runtime)" of section 5 are your spec. Then read D:/.claude/AGENTS.md,
contexts/README.md (row "change a canon package"), contexts/harness/rules.md, contexts/authority/branch.md and
packages.md ("Grammar edits are content only"), packages/README.md, packages/grammar/README.md, CONTRIBUTING.md, and the
current source of src/core/composition/PaneGrid (index.tsx, layout.ts), src/core/composition/Page,
src/core/composite/FillViewport, src/core/composite/VerticalScrollRegion, src/core/composite/HorizontalScrollRegion,
src/core/branch/ListBox, src/core/branch/Tabs, src/core/surfaceContext.tsx, src/common/styles.css (PaneGrid, Page and
fill-viewport blocks) and src/common/components-list-panel.css.

Branch: git -C D:/.claude worktree add .claude/worktrees/pkg-claude-pane-grammar -b pkg/claude-pane-grammar pkg/claude-pane-inset
Install only inside that worktree's packages/grammar (node <node dir>/node_modules/npm/bin/npm-cli.js ci; never
npm.cmd, never a junction or symlink to another node_modules).

Paths you may write: packages/grammar/** of your worktree, nothing else (lane B owns packages/eslint-*, packages/hfs,
contexts/ and cli/; lane C owns nivo-lite).

Do:
1. PaneGrid/layout.ts: per area and breakpoint add blockEnd "outer" | "divider" (outer when the area touches the grid's
   last row). PaneGrid/index.tsx: Pane gets inset?: "content" | "flush" (default "content") and loses className; it
   writes data-grammar-pane-inset and --starci-core-pane-be-{base,medium,wide}, and provides an internal pane context
   (not exported from the public entries) carrying the inset and a section registration. In development
   (process.env.NODE_ENV !== "production") PaneGrid throws Error("PANE_GRID_CHILD_NOT_PANE: <type>") for any child
   left after Children.toArray that is not a Pane element (null, false and arrays of Panes stay legal); production keeps
   filtering. A content-inset Pane logs console.error("PANE_WITHOUT_SECTION: <area>") in development when no
   PaneSection or PaneGrid registered after mount.
2. New src/core/composition/PaneSection/index.tsx with exactly the props of section 3 (grow, scroll {label, role,
   tone, scrollRef}, align, bleed "inline", gap, as; no className, no style). It throws PANE_SECTION_OUTSIDE_PANE
   outside a Pane. The scroll variant is a full-bleed VerticalScrollRegion (isScrollable, aria-label, role, tone, ref)
   with the inset on an inner content element. Export PaneSection and PaneSectionProps from the core, common and
   offset-pop entries and wire registry.tsx, renderers.ts and conformance the way PaneGrid is wired.
3. PaneDrawer renders the pane's children under the same inset provider (content inset, block end outer); the drawer
   header's inline padding is the pane inset.
4. Page: chrome="panes" (PagePanesProps of section 3): the header band or the trail, then exactly one PaneGrid in a
   measured fill box flush under the band's separator: gap 0, no block padding, no radius, reaching the viewport bottom
   minus Grammar bottom chrome, with the minHeight floor. Factor FillViewport's measuring into one shared hook used by
   both; do not copy it.
5. CSS (src/common/styles.css, components-list-panel.css): root token --grammar-pane-inset: 1rem (the scale's 1rem
   step; offset-pop inherits it); the --starci-core-pane-inset-* variables from data-grammar-pane-inset and the
   container-queried --starci-core-pane-be; .starci-core-pane-stack (flex column, gap var(--grammar-row-gap),
   min-height 0, flex 1); .starci-core-pane-section (padding-inline from the pane, first child block start, last child
   block end; the scroll variant moves the padding inside its scroller; align center; the gap variants); bleed="inline"
   (the section pads 0 inline, its HorizontalScrollRegion takes padding-inline and scroll-padding-inline equal to the
   inset and 0.25rem block padding for focus rings); the panel ListBox drops the vendor listbox inline padding so the
   row box and the selected pill start at the content edge; an unpainted Tabs track (variant secondary) inside a
   PaneSection drops its inline track padding; page chrome "panes". ListBox resolves inset "panel" inside any Pane, not
   only under SurfaceNesting. Tokens and the existing scale only: no arbitrary values, no new !important.
6. data-contract stamps: Pane "PADDING-4 PADDING-3" (content) or "PADDING-0" (flush); PaneSection "PADDING-4 GAP-3";
   Page panes "LAYOUT-1 BOUNDARY-1 GAP-0".
7. Stories (src/stories/Compositions.stories.tsx, both families as the PaneGrid stories already are): move every
   PaneGrid story to PaneSection; add PaneInset (an Office-like grid: list head; a list pane with SearchField,
   secondary Tabs and a ListBox with a selected row; a thread scroll section with ChatBubbles; a composer with a chip
   row in bleed="inline", an IconButton, a Textarea, a Button and a hint Text; an info pane that becomes a drawer) and
   PagePanes (Page chrome="panes" with header tabs over a two-pane grid). Write play functions asserting, at 1200 and
   375 px, that each band's first box left minus its pane's content-box left is 16, the selected option box is at 16,
   the grid top equals the tab separator bottom, and the grid bottom equals the viewport bottom. Do not run Storybook
   or the plays locally: CI runs them (contexts/authority/packages.md).
8. packages/grammar/README.md (PaneGrid, PaneSection, Page chrome), CHANGELOG.md entry, version 0.17.0 in package.json
   and package-lock.json (the next minor above the base if the base moved; tell lane B the number). In
   docs/pane-inset.md change only the Status line, to "implemented in grammar <version>", when all of section 3 shipped.

Check (tier 1): in packages/grammar its npm test (typecheck + build, the Grammar's proof), then from D:/.claude
node cli/dist/main.js check loosening and node cli/dist/main.js check secrets. All green.

Hard rules: no eslint-disable, no ts-ignore or ts-expect-error, no `as` casts (only `as const`), no --no-verify, no
|| true, no skipped tests, no widened allowlist: change the code, not the gate. Never open *.enc*, secrets.env or any
*.env file. Never start or stop the local api (18787) or web (3100). Never create node_modules junctions or symlinks;
before removing any worktree, unlink any junction inside it first (rmdir on the link itself, never a recursive delete
through it). Never stash, reset or check out in a dirty tree; work only in your worktree. No push, no publish.
Commit on pkg/claude-pane-grammar, subject "grammar 0.17.0: Pane owns its content inset, PaneSection, Page chrome
panes", a body listing the API, and the trailer exactly: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

Report: commit hash and version; the shipped API with any deviation from section 3 and why; the CSS variables and
tokens added; the gate output lines.
```

### Brief B: lints, contexts, ruling and version moves

```text
You are a worker on the StarCi harness (D:/.claude). Enforce and document the Pane inset system designed in
packages/grammar/docs/pane-inset.md on branch pkg/claude-pane-inset. Read that document whole first; section 4
("Versions"), section 5 and section 6 are your spec. Lane A (branch pkg/claude-pane-grammar) implements the grammar
in parallel; never edit packages/grammar/**. Then read D:/.claude/AGENTS.md, contexts/README.md (rows "change a canon
package" and "edit the harness itself", and "House rules for editing contexts"), contexts/harness/rules.md,
contexts/authority/branch.md and packages.md, packages/README.md, CONTRIBUTING.md (CONTRIB-2, -4, -5, -6, -7, -20), the
READMEs of packages/eslint-grammar-core, eslint-grammar-offset-pop, eslint-canon-fe and hfs,
eslint-grammar-core/src/freestyle.ts and surface-depth.ts (rule shape, exemptFreestyle, why text, owners),
eslint-canon-fe/src/surface-rules.ts (no-list-panel-padding, divider-full-bleed), contexts/hfs/rules.yaml (the shape
of R340-R344), contexts/decisions/rulings.yaml (header comment, pane-grid, panel-list-box-edge, joined-multi-pane) and
contexts/decisions/open-ui.md.

Branch: git -C D:/.claude worktree add .claude/worktrees/pkg-claude-pane-lint -b pkg/claude-pane-lint pkg/claude-pane-inset
Install only inside the worktree's package folders you test (node npm-cli.js ci; never npm.cmd, never a junction).

Paths you may write: packages/eslint-grammar-core/**, packages/eslint-grammar-offset-pop/**, packages/eslint-canon-fe/**,
packages/hfs/**, the bundled runtime copies in the other canon packages that hfs's bundles script rewrites,
contexts/**, and cli/package.json + cli/CHANGELOG.md only if CONTRIBUTING says the contexts change ships in a cli
prerelease.

Do:
1. eslint-grammar-core: rules pane-grid-children (FE_PANE_GRID_CHILD_NOT_PANE), pane-children
   (FE_PANE_CHILD_NOT_SECTION), no-pane-section-padding (FE_PANE_SECTION_PADDING) and pane-grid-page
   (FE_PANE_GRID_FRAME), exactly as the section 5 table says, each with node:test specs whose invalid cases are the
   real nivo shapes (a <CategoryPane/> wrapper as a PaneGrid child; a <div className="shrink-0 px-4 pt-3 pb-2"> around
   a SearchField inside a Pane; FillViewport wrapping a PaneGrid; a PaneGrid inside a SurfaceCard) and whose valid
   cases include cond ? <Pane/> : null, cond && <Pane/>, items.map(() => <Pane/>), a PaneGrid inside a Pane and a
   Freestyle subtree. Owners, why text, recommended config and index exports as the existing rules do; confirm
   eslint-grammar-offset-pop inherits them (its inheritance spec).
2. eslint-canon-fe surface-rules.ts: new no-hand-built-panes (FE_HAND_BUILT_PANES: a vertical Divider used as a
   column seam in a raw flex row or inside SurfaceCard composition="joined"; the AgentInstanceFrame, AgentSetupPage,
   AgentChat and ChatbotInboxPanel shapes of nivo-lite are its invalid specs), and Pane + PaneSection join SURFACES for
   no-list-panel-padding; specs; src/lib/config.ts list.
3. contexts/hfs/rules.yaml: one entry per new rule with the next free R ids (check main and every pkg/claude-* branch
   for ids already taken, e.g. git -C D:/.claude log --all -S"id: R345" --oneline), law, failureCodes, enforcers.
4. Contexts, rewritten where each concept lives (CONTRIB-6; present tense; cite code owners, never ruling ids or dates
   inside rules): ui/components/pane-grid.md (Job; Variants: inset and PaneSection; Owner split: the Grammar owns the
   inset; a new choice row pane-grid.choose.page: a tabbed app page whose body is panes is Page chrome="panes", never a
   card around panes), ui/presentation.md laws 3 and 4 (PaneSection is the flush-band API; boxes align to the pane
   content edge, text inside a box keeps the vendor padding), ui/composition.md LAYOUT-1 and FE-APP-SHELL-7,
   ui/components/page-header.md (tabs over a panes body attach flush), ui/components/list-table.md (row box at the pane
   content edge), grammars/contract.md and contract.yaml (PaneGrid role: inset, PaneSection, Page chrome panes),
   vendor/wrappers.yaml if the ListBox padding override needs it. decisions/rulings.yaml: replace the pane-grid entry
   (the inset is now the Grammar's; keep its words); add pane-inset (date 2026-10-31, status live, words: "trò thiết kế
   hệ thống padding đồng nhất cho grammar chứ mỗi nơi 1 padding trò thấy k"; ruling: a Pane owns its content inset and
   every band in it is a PaneSection whose boxes align to that edge; owner: the grammar files and the new lint rules)
   and page-panes-frame (date 2026-10-31, status live, words: "sao trang lan agent có gap 1 khoảng trên vậy??? … phải
   dính vào chứ"; ruling: a tabbed app page's PaneGrid attaches flush under the tab line, full width and to the bottom,
   with no card, radius or gap: Page chrome="panes"). The agent's own detail choices (inset pill over full-bleed
   selection, no step at wide, the inset not following the page gutter) go to decisions/open-ui.md as rows with the
   alternative and the reason. Regenerate what the contexts verbs regenerate (node cli/dist/main.js explain contexts:
   anatomy, index, section indexes) and leave them clean.
5. Versions, after lane A has committed: git rebase pkg/claude-pane-grammar; then eslint-grammar-core and
   eslint-grammar-offset-pop 0.17.0 (they move with the Grammar), eslint-canon-fe 9.7.0, hfs 4.15.0 (each the next minor
   above the base if it moved), CHANGELOG entries, contexts/stack/pins.yaml and every canon-pins copy naming
   @starci/grammar 0.17.0 and the new cohort; then in packages/hfs run its bundles script (node npm-cli.js run bundles)
   and leave bundles:check clean.

Check: npm test in each package you changed (its specs, CONTRIB-2), including the hfs canon-pins spec; then from
D:/.claude node cli/dist/main.js check loosening, check secrets and the contexts anatomy dry run. All green.

Hard rules: no eslint-disable, no ts-ignore or ts-expect-error, no `as` casts (only `as const`), no --no-verify, no
|| true, no skipped tests, no widened allowlist: change the code, not the gate. Never open *.enc*, secrets.env or any
*.env file. Never start or stop the local api (18787) or web (3100). Never create node_modules junctions or symlinks;
before removing any worktree, unlink any junction inside it first (rmdir on the link itself, never a recursive delete
through it). Never stash, reset or check out in a dirty tree; work only in your worktree. No push, no publish.
Commits on pkg/claude-pane-lint (lints + specs; contexts + rulings; versions + pins + bundles), each with the trailer
exactly: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

Report: commit hashes; the R ids and failure codes taken; the versions; the open-ui.md rows; the gate output lines.
```

### Brief C: nivo-lite migration with browser verification

```text
You are a worker in the nivo-lite app (D:/starci-lanes/nivo-lite, front end fe/apps/web/src). Move every PaneGrid
screen and every hand-built multi-pane frame onto the Grammar's pane inset system, designed in
D:/.claude/packages/grammar/docs/pane-inset.md (read it whole; section 4 is your file list, section 1 the numbers you
must change). Then read D:/.claude/AGENTS.md, D:/.claude/contexts/README.md (row "author app code or UI"),
contexts/harness/rules.md, contexts/ui/components/pane-grid.md, contexts/ui/presentation.md (Space), the app's
hfs.json, and the README of the @starci/grammar version you install.

Preconditions, checked first; stop and report if one fails:
- npm serves @starci/grammar 0.17.0 and the matching hfs and lint cohort (npm view @starci/grammar@0.17.0 version, and
  the harness's deps check verb: node D:/.claude/cli/dist/main.js explain deps). Never link a local build.
- The other agent's Second Brain fix is committed: git -C D:/starci-lanes/nivo-lite status --short shows none of the
  files you will touch as modified (BrainDossiers, OfficeMessenger and OfficeThread were dirty when this was written).
  Never touch a file that holds someone else's uncommitted changes.

Do:
1. Move the pins the way commit ed70df9a9 did (the new hfs canon pins and the harness's app sync verb; find it with
   explain): only the @starci package lines and the lockfile entries they move.
2. Office (/chat): OfficeMessenger to Page chrome="panes" with no FillViewport; OfficeConversations returns three
   PaneSections (search; filter; list grow); OfficeHeader, OfficeInfoPanel (docked and in the drawer), OfficeThread
   (PaneSection scroll with role "log", tone "background" and scrollRef; keep the max-w-4xl measure and
   stick-to-bottom), OfficeComposer (chips in bleed="inline"; the field row and the hint as a section) and OfficeTasks.
   Delete every className the section 4 table lists for them; keep only row anatomy and measure classes.
3. Second Brain (/brain, "Hồ sơ"): the dossiers tab uses Page chrome="panes" so the grid attaches to the tab line
   (today a 24 px gap); BrainDossiers' meter, list and main become PaneSections (METER_CLASS_NAME and the
   MAIN_PANE_CLASS_NAME padding go); below medium the list pane is collapse="drawer" (today the main pane is 1 px tall
   on a phone). Keep every Pane a literal child of PaneGrid. Leave room for WP-C's third detail pane; do not add it.
4. Agent instance (/agents/chatbot/<id>, tabs Thiết lập / Bàn làm việc / Cài đặt): AgentInstanceFrame becomes
   Page chrome="panes" with the header tabs over a PaneGrid "rail main" (the rail a drawer below medium): no
   SurfaceCard, no FillViewport, no hand-built SEPARATOR*; the main Pane is inset="flush" and hosts the routed tab.
   AgentSetupPage becomes one PaneGrid (chat head, conversation, composer, side) into which AgentSetupChat's panes
   merge; AgentInstanceRail and AgentSetupSide become PaneSections. A tab without panes (settings and the like) renders
   a PaneSection scroll in the flush main pane or its own one-pane PaneGrid.
5. AgentChat (+ AgentChatHeader, AgentChatRailHead, AgentChatThread, AgentChatComposer) and ChatbotInboxPanel (+
   ChatbotConversationList, ChatbotThreadView, ChatbotSidePanel): the joined SurfaceCard splits become PaneGrids of
   PaneSections, as the section 4 table says.
6. Search the app for any other PaneGrid, FillViewport, joined SurfaceCard or vertical Divider column seam and treat it
   the same; list each in the report.
7. Do not change the Office filter Tabs to another control; report that its track overflows a 320 px pane.

Verify in the built-in browser pane (the app at http://localhost:3100 is already running with a signed-in session; open
your own tab, never start or stop the server) at desktop width and at the mobile preset (375 px), on /chat (the list,
an open conversation, the info drawer), /brain (Hồ sơ) and /agents/chatbot/<id> (each tab). With
getBoundingClientRect: every band's first box minus its pane's content-box left is 16 (search box, first tab pill,
selected row pill, meter, first chip, @ button, hint, bubbles, rail and side sections); the PaneGrid top equals the page
tab line bottom; the grid reaches both content edges and the viewport bottom; every pane is taller than 0 on a phone;
nothing overflows horizontally except the chip row's own scroller. Put before/after numbers in the report. Reset the
viewport to desktop when done.

Checks: the app's typecheck and lint of the files you touched only (tier 1), with the new rules (pane-grid-children,
pane-children, no-pane-section-padding, pane-grid-page, no-hand-built-panes) green on them.

Hard rules: no eslint-disable, no ts-ignore or ts-expect-error, no `as` casts (only `as const`), no --no-verify, no
|| true, no skipped tests, no widened allowlist: change the code, not the gate. Never open *.enc*, secrets.env or any
*.env file (.starcistacks holds several; judge by name). Never start or stop the local api (18787) or web (3100).
Never create node_modules junctions or symlinks; before removing any worktree, unlink any junction inside it first.
Never stash, reset, check out or clean: the working tree holds other people's uncommitted work. Commit only your own
files, through a temporary index:
  export GIT_INDEX_FILE="$(mktemp -u)"; git read-tree HEAD; git add -- <your files>; git commit -m "<message>"; unset GIT_INDEX_FILE; git reset -q -- <your files>
one commit per screen family ("fe(web): Office panes take the Grammar pane inset", ...), each with the trailer
exactly: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
No push.

Report: commit hashes with their files; the measured numbers per screen at both widths, before and after; every block
migrated and every className deleted; anything left, with the file and why.
```

