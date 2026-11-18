# Changelog

## 0.46.2 - 2026-11-18 - ScheduleGrid timeline, Legend, GeoMap and the table, alert, board and empty-state additions

Every change below is additive (new optional props, new components, new DNA laws), so a patch (contexts/grammars/contributing.md "Patch or minor").

- Added (`ScheduleGrid`, spans): an entry crosses columns. `ScheduleItem.endColumn` makes one bar in the row from `column` to `endColumn` (a table cell with a colspan; overlapping bars of one row take their own lines under one row heading). `progress` (0 to 1) fills the bar from its start; `form: "milestone"` draws a diamond and its words in one column; `after` (ids) draws an arrow from the end of each predecessor to the start of the entry; `resize: { onResize(edge, column), startLabel, endLabel }` puts handles on both ends, moved by a pointer drag (called once, on release, with the column under the pointer) or by ArrowLeft and ArrowRight on the focused handle; an end cannot pass the other. The grid keeps no state: apply `onResize` and pass the new entry.
- Added (`ScheduleGrid`, rows and columns): `ScheduleRow.isGroup`, `isCollapsed` and `parent` with the grid prop `onRowToggle(rowId, isCollapsed)`: a group row's label is a button (`aria-expanded`) that folds the rows under it; children are indented; the state is the app's. `ScheduleColumn.todayAt` (0 to 1) draws the line for now at that share of the column, in place of the tint of today's cells (`isCurrent` still marks and announces the heading).
- Added (`ScheduleGrid`, a drag from outside): `startScheduleDrag(event, itemId)` (call it from a `DragItem` `onDragStart`) and `SCHEDULE_DRAG_TYPE`; `onDrop(itemId, row, column, source)` now has a fourth argument, `"grid"` or `"outside"`. The grid takes only a drag that is its own or carries `SCHEDULE_DRAG_TYPE`, never a text selection. The keyboard path is unchanged and documented: pick the item in the list, then press a cell (`onCellPress`).
- Phone: below 48rem of the grid's width the table is still an agenda; a span cell names the columns it covers (`Mon 2 – Wed 4`), the arrows and the line for now are not drawn, pointer handles step aside (the keyboard handles stay), and on a touch screen the handles show only on the picked entry, as wide as a touch target.
- Added (`Legend`, composite): a one-line key. Props: `label` (required), `items` (`{ id, label, tone, form?: "bar" | "milestone" }`), `isLoading?`. Tones are the five the entries take; the mark is the tone's `x-soft` ground with `x` as its edge; the row wraps when narrow; it draws nothing with no items and takes no press.
- Added (`GeoMap`, branch): points on a map. Props: `label`, `points` (`{ id, lat, lng, count, label? }`), `labels` (`zoomIn`, `zoomOut`, `showAll`, `list`, `point(point)`, `cluster(places, total)`), `tiles?` (`{ url, attribution, maxZoom? }`), `empty`, `height?`, `defaultView?`, `onSelect?`, `isLoading?`, `error?`. The ground is raster tiles at an address the app serves (`/tiles/vn/{z}/{x}/{y}.png`, or a PMTiles archive the app serves as tile images); the grammar holds no key, loads no vendor script and adds no dependency (the projection, the tile layout and the clustering are about 200 lines in `GeoMap/projection.ts`). Pan and zoom: drag, the buttons, arrow, plus, minus and Home keys, double click, pinch, Ctrl or Command with the wheel. Crowded points merge (a 64 px grid) into a cluster whose count is the sum; pressing it zooms to the points inside. A single point is a button with `onSelect`, a mark without. Assistive technology reads a group named `label` and a list of every point, densest first. Named `GeoMap` (not `Map`) so it never shadows the global.
- Added (DNA, role `data-views`): `DNA-COMMON-LEGEND-ONE-MARK-SIZE`, `DNA-COMMON-SCHEDULE-SPAN-STARTS-IN-ITS-CELL`, `DNA-COMMON-SCHEDULE-SPAN-ENDS-IN-ITS-CELL`.
- Stories: `Navigation & Data/Schedule timeline` (ScheduleTimelineSpans, ScheduleTimelineGroups, ScheduleTimelineResize, ScheduleDropFromList), `Navigation & Data/Legend` (LegendTones, LegendWraps, LegendStates), `Navigation & Data/Geo map` (GeoMapClusters, GeoMapSelect, GeoMapControls, GeoMapGroundAndList, GeoMapStates, GeoMapDrag), each with a play function at 1440 and 390.
- Contexts: `ui/components/data-views.md` choose rows `timeline`, `key` and `map` and the schedule row; `ui/situations.md` rows; `grammars/contract.yaml` renderers, slots and laws; `project/index.md` sizes.
- Added (`DataTable`): `totals` row (sticky over the footer), `groundTone` per row, and long-press selection on the phone list.
- Added (`Alert`): a `form` slot and `secondaryAction`.
- Added (`BoardColumn`): `canDrop` with `onRefuse`.
- Added (`EmptyNotice`): `steps` and `isAllClear`.
- Added (`Tabs`): `kind="filter"` with `shape="pill"`, the one primary pill look.
- Added (`Popover`): `size` `sm`, `md` or `lg`.
- Stories: AlertForm, BoardRefusal, EmptyState, FilterPills, PopoverWidth and TableTotalsGroundSelect, each with a play function at 1440 and 390. Contexts: `ui/components` dialog-drawer, empty-state, list-table, tabs and toast-alert.
- Fixed (Offset Pop, `Alert`): a `secondaryAction` ("Reject") is no longer painted with the pink decision fill; only the banner's last Button, the decision, is (law `DNA-COMMON-ONE-ACCENT-FILL`).
- Fixed (stories): AlertForm is one anatomy per story (a view holds one commit) and the second EmptyState steps notice takes the neutral action; the story probes that added and removed an element inside `waitFor` (ListRowDiff, TabLinesAndLayout, StatusTones, NavigationData, FlowGraphStyleC) read it through `quietProbe`, a shadow-root probe that is no DOM mutation, which froze the browser of `starci dna check` when an assertion failed. The stories and doc comments that said 0.47.0 say 0.46.2.
- Storybook: the toolbar global `grammarPalette` (`neutral`, the default and the render proof's, or `family`, the family's own `theme.css`), which `starci dna check` asks for.

## 0.46.1 - 2026-11-18 - IntervalChart and FunnelChart

- Added (`IntervalChart`, composite): ranges on one scale. Props: `label` (required), `rows`, `empty` (required), `format?: (value: number) => string`, `isLoading?`, `error?`. A row is `{ label, low, high, point, tone?, isReference?, valueLabel? }`; `label` is unique per chart (it is the key) and the reference row says so in its own words. `tone` is `accent`, `success`, `warning`, `danger` or `neutral`: the range takes the tone's soft fill, the point takes the tone itself; the reference row is neutral and the others take the accent when `tone` is left out. The first `isReference` row draws one dashed line through every row at its point. The value is real text at the row's end (`valueLabel`, or `point (low - high)` through `format`); the two scale ends (rounded out to a round step, kept at zero when the data starts above it) are text under the plots.
- Phone: below 33rem of chart width (a container query, not the viewport) each row stacks, label and value over the plot.
- States: `isLoading` keeps the labels given (three skeleton rows when none) and draws the ranges and values as geometry; precedence loading, error, then empty.
- Added (DNA): `DNA-COMMON-INTERVAL-CHART-ONE-SCALE` (plots of one width), `DNA-COMMON-INTERVAL-CHART-REFERENCE-ONE-LINE` (the reference line at one place in every row), `DNA-COMMON-INTERVAL-CHART-STACKS-NARROW` (at 375 the label is above the plot), role `data-views`.
- Stories: `Navigation & Data/Interval chart` (IntervalChartReference, IntervalChartStacks, IntervalChartNoReference, IntervalChartStates), each with a play function at 1440 and 390.
- Contexts: `contexts/ui/components/data-views.md` choose row `ranges`; `contexts/ui/situations.md` row; `contexts/grammars/contract.yaml` renderer, slots and the three DNA laws.
- Added (`FunnelChart`, composite): ordered stages on one scale. Props: `label` (required), `stages`, `empty` (required), `format?: (value: number) => string`, `isLoading?`, `error?`. A stage is `{ label, count, value?, tone?, stepLabel? }`; `label` is unique per chart (it is the key). The bar is the count's share of the largest stage, all bars from one inline edge, the count as real text inside the bar in the tone's soft pair (`x-soft` with `x-soft-foreground`; `neutral` is `default`); `tone` defaults to `accent` and is the app's reading. `value` is a string the app has written, shown at the stage's end.
- Between two bars: a neutral chip with the share of the stage before that came through (`62.9 %`, `–` after a stage of zero) and the drop-off count (`-460`, in the danger colour; `+20` when a stage gained). `stepLabel` replaces the drop-off words. Stages are never sorted by the chart.
- Phone: below 33rem of chart width (a container query, not the viewport) each stage stacks: chip, then label and value, then the bar.
- States: `isLoading` keeps the labels given (four skeleton rows when none) and draws the bars, chips and values as geometry at the same height as the ready chart; precedence loading, error, then empty.
- Added (DNA, role `data-views`): `DNA-COMMON-FUNNEL-CHART-ONE-SCALE` (tracks of one width), `DNA-COMMON-FUNNEL-CHART-ONE-START` (bars start at one inline edge), `DNA-COMMON-FUNNEL-CHART-STACKS-NARROW` (at 375 the label is above the bar).
- Stories: `Navigation & Data/Funnel chart` (FunnelChartSteps, FunnelChartStacks, FunnelChartEdges, FunnelChartStates), each with a play function at 1440 and 390.
- Contexts: `ui/components/data-views.md` choose row `funnel`; `ui/situations.md` row; `grammars/contract.yaml` renderer, slots and the three laws; `project/index.md` regenerated.

## 0.46.0 - 2026-11-18 - The media family, one empty state, the shell chrome

- A minor (the release gate): `Image` loses `aspect`, `fallback` and `srcSet` for `ratio`, a built-in neutral error plate and `renditions`; `Video` loses `src` and `captions` for `sources` and `tracks`; `EmptyNotice` loses `iconSource` and `artwork` for `scope` and `media`; the DNA law `DNA-COMMON-EMPTY-ONE-ACTION` is renamed `DNA-COMMON-EMPTY-ACTIONS`; `eslint-grammar-core` adds a rule.
- Added (`Image`): `ratio` (`1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `auto`), `renditions` (`{ src | staticsKey, width }` or `{ …, density }`) and `sizes` drawn as `srcset` and `sizes`, `caption` (a `figure` with a `figcaption`), `zoom` (`{ openLabel, closeLabel }`, a lightbox on the Grammar overlay mechanics with focus return), `isLoading`, a shimmer while the file loads and a neutral glyph on the plate when it fails (the `alt` is kept as the name). `alt` stays required by type. Lazy and async-decoded by default.
- Removed (`Image`): `aspect` (`square`, `landscape`, `portrait`, `wide`, `auto`; now `ratio`, `1:1`, `4:3`, `3:4`, `16:9`, `auto`), `fallback` (the plate is the one error look), `srcSet` (now `renditions`). `ImageAspect` is removed; `ImageRatio`, `ImageRendition`, `ImageZoom`, `ImageFacts`, `MediaSourceRef` are added. `TilePoster.aspect` keeps `square`, `landscape` and `portrait` and the tile maps them to a ratio.
- Added (`Video`): `sources` (`{ src | staticsKey, type }`, in order of preference, auto-picked by type and browser capability), MP4 and WebM natively, HLS natively where the platform reads it and through `hls.js` elsewhere, MPEG-DASH through `dash.js`; `poster`, `ratio` (`16:9`, `9:16`, `1:1`), `controls`, `tracks` (WebVTT captions or subtitles), `autoPlay` (muted and inline, skipped under reduced motion), `loop`, `loading` (lazy by default: no stream is requested until the box is within 200px of the viewport), `labels`, `isLoading`; states idle, loading, ready, error and unsupported. `pickVideoSource` and `playbackOf` are exported (the pure choice).
- Added (dependencies): `hls.js` 1.7.4 (Apache-2.0) and `dashjs` 5.3.0 (BSD-3-Clause), exact, in `dependencies` and imported only by dynamic `import()` on the first stream that needs one; an app that plays only files ships neither chunk to its readers. No CDN at runtime.
- Added (`Illustration`): decorative art (alt empty, `aria-hidden` by default), `ratio` (the Image ratios and `fill`), `compact` (another source and ratio below 48rem through a `picture` source), `fit`, `loading`, `isLoading`.
- Added (statics): `StaticsProvider baseUrl` resolves the `staticsKey` of `Image`, `Video` (sources, poster, tracks) and `Illustration`; `staticsUrl` and `isStaticsKey` are exported. A key is a relative path of plain segments (no scheme, query, `..` or empty segment). A plain `src` stays for a resolved URL. An unresolved key draws the error state, and a development `console.error` `STATICS_KEY_UNRESOLVED`.
- Changed (`EmptyNotice`, the one empty state): `scope` (`region`, the default, or `page`), `media` (`{ icon }`, drawn on a soft brand-tone circle (the accent soft pair), or, on `scope="page"` only and held by the type, `{ illustration }` at 160px, 120px below 48rem), and `secondary` (one secondary action beside the primary). A page-scope notice fills 70% of the viewport height and centres its stack, and its primary is a `md` button (a link when it only leads home). Removed: `iconSource` (now `media.icon`) and `artwork` (the Mascot mark; the Mascot stays a standalone element).
- Changed (DNA): `DNA-COMMON-EMPTY-ONE-ACTION` is `DNA-COMMON-EMPTY-ACTIONS` (at most two actions, one primary and one secondary).
- Tokens: `--grammar-illustration-state` (10rem) and `--grammar-illustration-state-compact` (7.5rem). No theme hook.
- Stories: new `Media/Image, Video and Illustration` (ImageRatios, ImageRenditionsAndCaption, ImageStates, ImageZoom, MediaStaticsKey, VideoNative, VideoLazy, VideoAutoPlay, VideoSourcePick, VideoStreamLoadsPlayer, VideoStates, IllustrationHero, IllustrationStates) and `Media/Empty state` (RegionState, PageState, PageStateWithoutArt, NotFoundPage, ServerErrorPage), each with a play function that proves its state at 1440 and 390 (`npm run prove-plays`). Local fixtures in `src/stories/media` (a two-second WebM, WebVTT captions, SVG pictures), made by `scripts/make-media-fixtures.mts`; the HLS and DASH fixtures are deliberately unplayable manifests that prove the library loads and the failure ends in the in-place notice.
- Scripts: `npm run prove-plays [title]` runs the play functions of the built Storybook at 1440 and 390 in a real browser; `serve-static` serves `.webm`, `.mp4`, `.vtt`, `.mpd` and `.m3u8`.
- Migration:
  - `<Image aspect="landscape" />` becomes `<Image ratio="4:3" />`; `square` is `1:1`, `portrait` is `3:4`, `wide` is `16:9`. `fallback={…}` is deleted (the plate is the error look). `srcSet="a 1x, b 2x"` becomes `renditions={[{ src: "a", density: 1 }, { src: "b", density: 2 }]}`.
  - `<Video src title poster captions />` becomes `<Video title sources={[{ src, type: "video/mp4" }]} poster={{ src: poster }} tracks={[{ src: captions.src, srcLang, label }]} />`.
  - `<EmptyNotice iconSource={G} />` becomes `<EmptyNotice media={{ icon: G }} />`; `<EmptyNotice artwork={{ src, assetSlot }} />` becomes `<EmptyNotice scope="page" media={{ illustration: { src, assetSlot } }} />`.

### Shell chrome: BottomNav, CommandPalette, a tone on navigation counts, an unread row, the NIVO shell gaps

Four additions the owner approved on 2026-11-18, each proved by NIVO's console shell canvas (repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/`). Rule 1 evidence, with file and line:

| Addition | Evidence |
| --- | --- |
| `CommandPalette` (G1) | `GRAMMAR-GAPS.md:9`; `pages/01-shell-app.html:202` (the bar's search and its `Ctrl K`), `:224` (grouped results, keys footer, full screen at 390), `:226` ("cần Grammar: ô tìm chung dạng command palette"); `briefs/01-shell-app.md:7` |
| `SidebarItem.badgeTone` (G2) | `GRAMMAR-GAPS.md:10`; `pages/01-shell-app.html:236-238` (red count for work waiting, grey chip for information, "như `isAttention` của `Tabs`") |
| `ListRowData.emphasis: "unread"` (G3) | `GRAMMAR-GAPS.md:11`; `pages/05-notifications-panel.html:57`, `pages/06-notifications-list.html:42` |
| `BottomNav` | `pages/01-shell-app.html:248-251` (five places and the count chips), `:343` (the "Thêm" sheet), `:385`; `pages/01-shell-app.html:214` and `briefs/01-shell-app.md:7` (the lane records the conflict with FE-APP-SHELL-4 on purpose); `GRAMMAR-GAPS.md:29` (the sheet is `Drawer placement="bottom"`) |

- Additive: no export, prop or DNA law id is removed or renamed; `eslint-grammar-offset-pop` carries the family version only; a MINOR by the lint change below. No theme hook is added.
- Added (`BottomNav`, frame, `@starci/grammar/common`): the compact width's bar of places for `WorkspaceShell` `compactNavigation`. Props `items: BottomNavItem[]` (`id`, `label`, `source`, `badge`, `badgeLabel`, `badgeMax`, `badgeTone`, `href`), `selectedKey`, `more?: BottomNavMore` (`label`, `source`, `closeLabel`, `items: SidebarItem[]`, the same count fields) and `onAction(id)`. Two to five places, the "more" place included (a development error otherwise; `BOTTOM_NAV_MAX_PLACES`). A place is a link (`href`, through the app root's router) or a command; the current one carries `aria-current="page"`; the "more" place opens a bottom `Drawer` holding a `Sidebar presentation="drawer"`. The shell's `<nav aria-label>` is the landmark (the bar draws a list). Equal shares, glyph over a one-line 12 name, the control height with the hit area stretched to the bar's 48, `env(safe-area-inset-bottom)` kept, drawn below 48rem only (the slot's rule).
- Added (`CommandPalette`, frame; `useCommandPaletteShortcut`): a `Dialog` (`lg`, standing at the top of the page, the screen below 40rem) holding a `SearchField` and a sectioned `ListBox` joined by React Aria's `Autocomplete` (virtual focus: the caret stays in the field, arrows, Home, End, Enter, Escape). Props `label`, `closeLabel`, `query`, `onQueryChange`, `placeholder`, `clearLabel`, `groups: CommandPaletteGroup[]` (items `id`, `label`, `hint`, `source`, `shortcut` as a `Kbd`, `href`, `isDisabled`), `onAction(id)`, `empty`, `isLoading`, `error`, `footer`, and `isOpen`/`defaultOpen`/`onOpenChange`. The palette never filters. `useCommandPaletteShortcut(onTrigger)` registers Ctrl K and Command K on the window.
- Added (`SidebarItem.badgeTone`: `NavigationBadgeTone` = `neutral | accent | success | warning | danger`; `SidebarItem.href`): a count's tint is `x-soft` with `x-soft-foreground` (neutral `default` with `default-foreground`), layered over the surface so the icon rail's count never shows its glyph through the tint. `href` makes an item a real anchor (the item already rendered one when the vendor was given a link).
- Changed (`Sidebar` count, default, VISIBLE): the count was one solid accent plate; it is now the neutral tint unless `badgeTone` is set. An app whose counts mean work waiting for the person sets `badgeTone`. (The rail's pinned position and the ring over the glyph are unchanged.)
- Added (`ListRowData.emphasis: "unread"`, `ListRowData.unreadLabel`): a `Section kind="list"` item, a `ListRow` and a `Board` item draw the title in the strong weight with an accent dot after it on the title line (the row's box does not change; a link or press title keeps the weight). `unreadLabel` is the word read before the title. `ListBox` items keep their `emphasis: "unread"` (weight on the label and the description).
- Changed (DNA, `contexts/grammars/contract.yaml`): `DNA-COMMON-NO-BOTTOM-TABS` keeps its id and now says "no bottom bar of places outside `WorkspaceShell` `compactNavigation`" (it counted every `BottomNav` at 375). New laws `DNA-COMMON-NAV-BADGE-TONE`, `DNA-COMMON-LIST-ROW-UNREAD`, `DNA-COMMON-COMMAND-PALETTE-ONE-FIELD`; new contract role `command-palette`; `shell` lists `BottomNav`.
- Changed (`eslint-grammar-core`, a MINOR with the media lane; `no-shell-bottom-tabs`, R316 `FE_APP_SHELL_BOTTOM_TABS`, `src/app-shell.ts`): a Grammar `BottomNav` passes only as the `compactNavigation` of a `WorkspaceShell` (inline, through a `const`, or through an import alias); a hand-made bottom tab bar (now also a local component named `BottomNav`), any other `compactNavigation` and a `BottomNav` anywhere else are refused. Spec: six valid and five invalid cases added. FE-APP-SHELL-4 (`contexts/ui/composition.md`, the `app-shell.yaml` and `rules.yaml` R316 copies in `eslint-grammar-core` and `hfs`, both playbooks, `contract.md`, `contexts/hfs`, the lint `why` text and the failure-code title) is amended the same way (owner decision 2026-11-18).
- Stories (each with a play test, run at 1440 and 390): `Compositions/Bottom nav (0.46.0)` (`Phone`, `MoreSheet`, `Links`, `Wide`), `Overlays/Command palette (0.46.0)` (`Results`, `Keyboard`, `EscapeCloses`, `NoMatch`, `Loading`, `Failed`, `Phone`, `Wide`, `OpenedByAControl`), `Navigation/Sidebar count tone (0.46.0)` (`Expanded`, `IconRail`, `InADrawer`), `Surfaces/Unread row (0.46.0)` (`Rows`, `ReadAloud`, `Loading`). Docs: new `ui/components/bottom-nav.md`, `command-palette.md`, `sidebar.md`; `list-table.md` (Unread row), `dialog-drawer.md` and the components README routing.
- Also changed (hfs, two files outside the Grammar): `BottomNav` leaves `packages/hfs/runtime/modules/kernel/removed-vocabulary.yaml` (the anatomy gate refused the docs naming it) and `BottomNav`, `BottomNavItem`, `BottomNavProps` leave the `page-navigation` codemod's removed list (`codemod/page-navigation.mts`, its spec updated). These ride the hfs release, not the Grammar patch.
- Verified: `packages/grammar` `npm test` (typecheck, loading, client, tones, type roles, avatar, hooks, lint 0 errors, build); `eslint-grammar-core` 181/181 and `eslint-grammar-offset-pop` 6/6; hfs `page-navigation-codemod` spec 11/11; `contexts anatomy` and `check shape` green; `dna check` on the new stories: `DNA-COMMON-NAV-BADGE-TONE` (12), `-LIST-ROW-UNREAD` (16), `-COMMAND-PALETTE-ONE-FIELD` (76) green; all 4 story files play-tested at 1440 and 390 in Chromium (30 runs, all pass). Render-proof baselines (`proof/baselines`, Linux image only) are not taken for the new stories.
- Added (NIVO shell gaps, evidence `nivoos-lite` `.starcistacks/canvas/pages/01-shell-app.html`): `Avatar` `tone` `solid` (`--accent` with `--accent-foreground`) and `strong` (`--foreground` with `--background`), type `AvatarTone` (`:9`, `:20`, `:24`); `AvatarButton` forwards `fallbackMark` and `tone` (`AvatarButton/index.tsx`); `IdentityLockup` `markTone` `solid` (`:9`); `Sidebar` `collapsePlacement` `top | bottom` (`bottom`: a labelled collapse row at the foot of the rail, `collapseLabel` its words; the collapsed rail's expand icon at the same foot; `:208`, `:264`); `TopBar` `density` `adaptive` (64 from 48rem, 52 below, the shell opener band follows; no law fixes the bar height, `DNA-COMMON-BAR-ONE-HEIGHT` measures the 40px controls; `:71`, `:186`, `:216`); `Meter` `labelTone` `muted` (12 regular, label and value muted; `:208`). Not added: a Button start mark (the switcher is `DropdownMenu` with an `IdentityLockup` trigger; no caret and no 24px tile on the lockup). Story `Navigation/Shell gaps (0.46.0)`.

## 0.45.1 - 2026-11-18 - A Popover that sizes itself, a tone on a row's edge

- A patch (the release gate counts a removed or renamed export or prop member; this adds a type and two optional fields and removes none). `eslint-grammar-core` and `eslint-grammar-offset-pop` carry the family version only. No theme hook is added.
- Changed (`Popover`, default): the panel is 26rem wide, or the viewport less 2rem (`width: min(26rem, 100vw - 2rem)`). Before it had a 20rem cap and no floor, so a panel of rows (a leading mark, copy, an action, a time) collapsed to one word per line. The width is definite because a row list is a size container with no intrinsic width, so a content-sized panel only shrank to its floor. No prop: an app sets no width, and the one look holds for every panel (a filter form, a notification list, a shortcut note). `FilterButtonGroup`'s popover is the same part and follows. Story `Overlays/Popover width (0.45.1)` (`Panel`, `Short`; play tests measure the width at 1440 and 390).
- Added (`RowEdgeTone`, type, `@starci/grammar/common`): `"accent" | "success" | "warning" | "danger"`.
- Added (`ListRowData.edgeTone`, so a `Section kind="list"` item, a `ListRow` and a `Board` item): the row draws a 2px bar on its start edge in the theme token of the tone (`--accent`, `--success`, `--warning`, `--danger`), the bar a selected table row draws. An inset shadow, so the content never moves, and kept under hover. It wins over `verdict` (which stays: success and danger only, for a row that reports an outcome).
- Added (`DataTableRow.edgeTone`): the same bar on a table row (on its first cell) and on its phone list row. A selected row draws the accent bar over it.
- Stories: new `Surfaces/Row edge tone (0.45.1)` `Rows` (list rows and table rows; its play test reads the 2px inset edge and the absent edge of a plain row at 1440 and 390).

## 0.45.0 - 2026-11-17 - A card is one object

- A minor (the release gate): kinds, props, exported types, theme hooks and DNA laws removed; `eslint-grammar-core` adds two rules and deletes one. A card is ONE object (a customer, an agent, a provider, a plan, a message, an approval), a dialog or an overlay; a collection (a table, a list, facts, figures, disclosures, a choice) is never in a card: it stands flat in a `Section`.
- Removed (`SurfaceCard` kinds): `table`, `details`, `figures`, `accordion` and `select`, with their renderers (`TableRows.tsx`, `AccordionRows.tsx`, `SelectRows.tsx`, `accordionClassNames.ts`) and their CSS. `SurfaceCardProps` is `BodyCard | TileCard`: `kind` is `"body"` (the default) or `"tile"`.
- Removed (`SurfaceCard` props): `headers` and `footers` (the typed zones `filter`, `search`, `toolbar`, `switch`, `figures`, `custom`, `more`, `paging`; `Zones.tsx` and the zone CSS), `count`, `isAttention`, `treatment` (`surface`, `soft`, `ink`), `artwork`, `motif` (the orbit), `accentCorner`, `isHighlight` (the accent sweep) and `measure="form"` (`measure` is `content`, `narrow` or `formCompact`). `CardHead` loses `count` and `isAttention`.
- Removed (exported types, `@starci/grammar/common` and `/core`): `AccordionData`, `AccordionRowData`, `FilterFields`, `FooterZone`, `HeaderZone`, `SearchFields`, `SearchZoneFields`, `SelectData`, `SelectItemData`, `SelectZoneField`, `TableColumnData`, `TableData`, `TableGroupData`, `TableRowData`, `SurfaceCardMotif`, `SurfaceCardTreatment`. `AccentCorner` stays (from `core/accentCorner.ts`; `MediaFrame accentCorner` is unchanged).
- Added (`SurfaceCard` body): `actions?: ReactNode`, the one band of commands at the foot of an object card, under a `--separator` hairline, the row step above and below, the card padding on its sides. `Tabs`, `SearchField` and `Divider` in it throw in development (`useRefuseInCardActions`).
- Changed (`SurfaceCard` look, default): white, a 1px `--border` edge, the card radius and no shadow, on every ground (the page, a pane, a drawer, a dialog); the per-host edge and shadow rules are gone. A whole-action card fills `--surface-secondary` on hover and focus and `--default` while pressed. `emphasis="accent"` is a 1px accent edge with the accent ring (`--grammar-ring-width`).
- Removed (`DataTable`): the `surface` prop (`card`, `frame`, `none`). One flat look: the column labels 12 / 500 muted over a 1px `--border` line, a `--separator` hairline under every row, no fill, radius, shadow or outer edge; the first and last words stand on the content edge and a hovered or selected row's fill reaches one row step past them. The `footer` (the pager) stands a row step under the last row with no line of its own. A group heading row is 12 / 600 muted over a `--border` line, no fill.
- Changed (`DataTable` selected row): grey (`--default`) with a 2px accent bar on its start edge, as the sidebar marks its item; the words keep their colour. The phone list (`phone="list"`) marks its selected row the same way (`data-grammar-selected` on the list row).
- Removed (`Section kind="figures"`): the `ribbon` prop. The strip is always the ribbon, wherever it stands (the page, a pane, a drawer): `--border` hairlines on its top and bottom edges and between cells, open ends, no fill or radius. The pane placement (one bordered row) is gone; `FigureCells` lives in `frame/Section/`.
- Changed (`Board`): `headers` (card zones) becomes `filter?: ReactNode`, the same flat filter row a `Section` draws. An item card draws the 1px `--border` edge and no shadow.
- Changed (`Pagination`): the current page is `--default`, `--default-hover` under the pointer and while pressed.
- Removed (theme hooks): `--starci-core-card-border`, `--starci-core-card-hover`, `--starci-core-card-active`, `--starci-core-table-selected`, `--starci-core-table-selected-foreground` and `--starci-core-pagination-current`. Their values are the defaults now; `common/theme-hooks.json` lists 35 hooks. A brand.css that sets them drops the lines (stylelint-canon 2.9.6 refuses them).
- Removed (internal tokens): `--starci-core-zone-seam`, `--starci-core-table-radius`, `--starci-core-table-body-radius`, `--starci-core-strip-cell-inset`, `--grammar-loop-orbit`, `--grammar-ink-band-pivot`.
- Removed (DNA law): `DNA-COMMON-FIGURES-PANE-ROW` (the pane placement it measured is gone). The contract also drops `DNA-COMMON-ONE-HIGHLIGHT`, `DNA-COMMON-SOFT-GROUND`, `DNA-COMMON-TREATMENT-TEXT-CONTRAST`, `DNA-COMMON-ROW-EDGE-PADDING` and `DNA-COMMON-ROW-CONTROL-CENTRE`, whose subjects are removed.
- Removed (Offset Pop): the card accent-corner rules, the zone seam widths and the ink band. The family card keeps its outline and its hard shadow.
- Lint (eslint-grammar-core 0.45.0): new `card-is-object` (a body card whose only content is a table, a list, facts, disclosures, a form or field, an empty notice, markdown or a chart), which replaces `single-child-card`; new `data-table-surface` (autofix removes `surface`); `rows-in-card` admits a `DescriptionList` or `DisclosureList` in a `Section` or an object card's body.
- Migration:
  - `<SurfaceCard kind="table" label fact columns rows empty />` becomes `<Section title fact><DataTable label columns rows renderCell emptyContent footer={<Pagination … />} /></Section>`; `TableColumnData` becomes `DataTableColumn` (`numeric` → `isNumeric`), `TableRowData` your own row type read by `renderCell`.
  - `kind="details"` becomes `Section` + `DescriptionList isDivided`; facts of one object stay a `DescriptionList` in that object's body card.
  - `kind="figures"` becomes `Section kind="figures"` (`label` → `title`, or `ariaLabel`); `Section kind="figures" ribbon` drops `ribbon`.
  - `kind="accordion"` becomes `Section` + `DisclosureList`; `kind="select"` becomes `RadioGroup` or `CheckboxGroup` (options with `description`), or `Section kind="list"` rows with a `control`.
  - Zones: `filter`, `search`, `toolbar` go in `Section filter`; `switch` is the `Section action`; a `figures` zone is its own `Section kind="figures"` above; `paging` is `DataTable footer`; `more` is a head `Link` in `Section action`; a `custom` header goes in the body; a `custom` footer is `actions`.
  - `count` and `isAttention` go to the `Section`; `treatment`, `artwork`, `motif`, `isHighlight` and `accentCorner` have no replacement; `measure="form"` becomes `Section` + `Form`.
  - `DataTable surface=…` is deleted (lint `data-table-surface` fixes it); `Board headers` becomes `Board filter`.
- Stories: new `Surfaces/White ground` (`ObjectCard`, `SectionFilterTable`, `FiguresRibbon`, `SelectedRow`); `CardZones` is `SectionFilterTable`, `TableFrame` is `TableFlat`, `SurfaceCardSearchRows` is `SectionSearchFilters`, `ZoneSeamKeyValuePaneHead` is `KeyValuePaneHead`, `SurfaceCardSelect` is deleted; every story on a removed API is migrated.
- Scripts: `check:type` pins the card edge (1px `--border`), the flat table (no fill, radius, edge or shadow; header `--border`, rows `--separator`), the selected row and the ribbon, and refuses a `--surface-shadow` on a card or a table.

## 0.44.0 - 2026-11-17 - A readable off track, a narrow filter row that keeps its pickers

- A minor by the release gate: `eslint-grammar-core` changes two rules (`navbar-control-size`, `tabs-in-well`). The Grammar's own API is unchanged.
- Changed (`Switch`, both kinds, off): the default off track `--starci-core-switch-track-off` is the foreground at 28% over the surface (was 16%, about neutral-300, which a compact 32x18 track on #fff barely showed); on white it stands between neutral-300 and neutral-400. Still no border by default (owner 0.36.2): the hairline stays the opt-in `--starci-core-switch-track-off-border`. Theme hook fallback text updated in `theme-hooks.json`. Story `Controls/Switch row` `OffTrackOnWhite` (and at 390): its play test measures the fill on #fff and the absent border.
- Changed (`Section` `filter` row, below 48rem of its own width): the tabs and the search each take a full line; a `compact` or `pill` `Select` keeps its content width and shares a wrapping line with the next one (before, every peer took the full width, so a compact picker stood as a 358px bar at 390); a `field` `Select` still takes a full line. The loading skeleton no longer turns into a column, so it wraps the same way. Story `Surfaces/Section filter row (0.43.1)`: the toolbar's selects are `compact`; new `FieldSelects`; the play tests measure the narrow step for both looks.

## 0.43.1 - 2026-11-17 - The reason on touch, one filter row

- A patch (the release gate counts a removed or renamed export or prop member; this adds one union member and removes none). `eslint-grammar-core` and `eslint-grammar-offset-pop` carry the family version only.
- Changed (`Button` `disabledReason`, default): where no pointer can hover (`(hover: none)`, `(pointer: coarse)`: a touch phone), the reason stands as a muted helper line under the button (the field-description style: muted, xs, snug, an identity step below), since the tooltip never opens there. Where a pointer can hover, nothing changes: the tooltip on hover and keyboard focus. The reason is ONE element in both modes (`.starci-core-button-reason`, `aria-hidden`), inside the disabled trigger, and both the trigger and the button point `aria-describedby` at it, so a screen reader hears it once (before: a `hidden` span beside the trigger). A media query, not a prop. A row of buttons that centres its peers (`Cluster align="center"`, the overlay footer, Alert actions, the page and pane header actions, the pinned action bar) keeps them on one top edge while a line hangs under one. `DNA-COMMON-DISABLED-REASON` law text names both modes; its measure is unchanged. Story `Controls/Button disabled reason on touch (0.43.1)`.
- Fixed (`Section` `filter`, `kind="list"` and `kind="region"` alike): the filter row is ONE flat wrapping row in the order given, the controls on one bottom edge. `Tabs kind="filter"` hug their labels, the `SearchField` grows into what is left (never under 12rem), each `Select` keeps its own width without wrapping its words. Before, the search and each select took the vendor's full width, so at 1440 they stacked under the tabs. Below 48rem of the row's own width (a container query) the peers stack, each the full width. The loading skeleton around the peers lays them out the same way.
- Added (`Section`, type): a headless region, `ariaLabel` in place of `title` (with `filter` and `children`), as `kind="list"` and `kind="figures"` already allow: the page title already names a catalog, so the region draws no heading of its own. `title` and `ariaLabel` stay exclusive.
- Story `Surfaces/Section filter row (0.43.1)`: `Region`, `List`, `Headless`, `RegionLoading`; their play tests measure one row at 1440 and the stack at 390.

## 0.43.0 - 2026-11-17 - One look for a list

- A minor (the release gate): an API removal and a new lint rule. Owner ruling 2026-11-17, "one look": a list is ONE thing, `Section kind="list"` of `ListRow`s, plain rows on the surface divided by hairlines, the row content aligned with the section title, with no frame, fill, radius or shadow. That is the default look, not a theme setting. Cards stay for real objects (the other `SurfaceCard` kinds), dialogs and floating layers. Law `DNA-COMMON-LIST-ONE-LOOK` replaces `DNA-COMMON-LIST-ON-WHITE-BORDERED`. Stories: `Surfaces/Surface elevation` `WellAndAside`, `Surfaces` `Section kind list`, `Surfaces/White theme (0.41.0)` `Defaults`.
- Removed (`SurfaceCard`): the `list` kind, its renderer (`SurfaceCard/ListRows.tsx`) and the exported types `ListData` and `Collection`. `SurfaceCardProps` no longer takes `kind="list"` with `items`, `empty` and `layout`; the compiler refuses it, and lint `starci-grammar/surface-card-list` (eslint-grammar-core 0.43.0) names the fix.
- Removed (theme hooks): `--starci-core-list-frame`, `--starci-core-list-frame-border`, `--starci-core-list-radius` and `--starci-core-list-inset` (0.41.0). The flat list they drew is now the only look, so nothing reads them; `common/theme-hooks.json` lists 41 hooks. A brand.css that sets them should drop the lines (stylelint-canon 2.9.4 no longer admits them).
- Changed (`Section kind="list"`, default): flat everywhere. No frame, fill, radius, edge or shadow on the page ground or inside a card, pane, drawer, dialog or popover (before: a frame on the ground with the card shadow, a 1px separator edge inside a surface). Rows keep the row rhythm (12) on their block sides and no inline inset, so their content starts on the title's edge; hairlines divide them. The list is the rows' size container (`starci-core-surface`), so a row lays out by the list's width (leading, copy and actions on one line from 28rem; key-value columns) as it did in a card; a Board column of items is one too.
- Added (`Section kind="list"`, prop): `layout` (`"rows"`, the default, `"keyValue"`, `"suggestions"`), moved from the list card with its CSS unchanged. The rows are a `<ul role="list" data-grammar-list>` (or `<ol>` when ordered), so the value-row and layout rules apply as they did in the card.
- Changed (`Board`): an item stays a card (a real object) but no longer through `SurfaceCard kind="list"`: each column is a `<ul>` of `ListRow`s and the Board draws the card face on each row (surface ground, card radius, `--starci-core-card-border`, `--surface-shadow`, the card padding). Drag, keyboard move and press are unchanged.
- Changed (`MessageCard` reply suggestions): `Section kind="list" layout="suggestions"` in `body`, flat in the card (`DNA-COMMON-CARD-SUGGESTIONS`), not a bordered list card. `ChoiceChips` was not taken: a reply can be a long sentence, and the law keeps one wrapping row per reply with its chevron.
- Removed (Offset Pop): the family rule that rounded and clipped `[data-grammar-list]` to the card's inner radius (it served the list card).
- Migration: `<SurfaceCard kind="list" label=… labelEnd=… items empty layout />` becomes `<Section kind="list" title=… action=… items empty layout />`; `ariaLabel` stays; a card `note` becomes the list's `caption`; `height="fill"` becomes `fill`. A list card with `headers` or `footers` zones: a filter or search goes in the list's `filter`; zones that group other content with the rows (figures over the rows, a `more` or `paging` footer) stay on a body `SurfaceCard` that holds the `Section kind="list"` in its body. A card whose only child is a `Section kind="list"` is refused by `single-child-card`.
- Scripts: `check:type` pins `.starci-core-section-list` to `--starci-core-row-inset: var(--grammar-row-gap) 0` and refuses any border, radius, fill or shadow on it; the list frame checks are gone.

## 0.42.0 - 2026-11-17 - White-theme reshoot fixes

- A minor (the release gate): the FlowGraph canvas exports `STEPS_OPEN_ZOOM`, `STEPS_OPEN_FIT_MIN` and `STEPS_NARROW_WIDTH` are removed with the old opening rule; no prop added, no lint rule changed. `eslint-grammar-core` and `eslint-grammar-offset-pop` carry the family version only. Story: `Surfaces/White theme fixes (0.42.0)` (`src/stories/WhiteThemeFixes.stories.tsx`), `Defaults` and `White`.
- Changed (`FlowGraph layout="steps"`, DNA-COMMON-FLOW-OPEN-ZOOM rewritten): a steps graph opens fitted to its pane. One that fits at zoom 1 opens at 1 (never magnified); a wider one is scaled down until its last column is in view, at any pane width, no longer held at zoom 1 at its entry node when its fit was under 0.95, which cut off the right columns at 1440 and 1920. The fit never goes below the readable floor 0.8 (DNA-COMMON-FLOW-READABLE-FLOOR): a graph that would need less opens at 0.8 at its entry node and pans. Pan and zoom are unchanged after the fit (`FlowGraph/canvas.tsx` `Refit`).
- Fixed (`FlowGraph layout="steps"`, edge routing): a rerouted edge keeps clear of its OWN source and target cards too (`STEPS_END_CLEARANCE`, 6px), not only of the cards between. A back edge to the entry node whose channel crossed a card was rerouted by a path that ignored its two ends, so it climbed out through its source card and dropped through the entry card; it now goes round both. A back edge whose middle runs cross its own cards is rerouted the same way (`steps.ts` `stepsAvoidRoute`, `routeAroundBoxes`; `stepsView.tsx` `useObstacles`).
- Fixed (`Select appearance="pill"` and `"compact"`): a pill sizes to its value, never under 8rem nor over 20rem (nor its row), a longer value cut with an ellipsis; the vendor `fullWidth` stretched it to the row, so a pill in a `Cluster` stood full width. The `field` appearance keeps filling its column.
- Added (theme hook): `--starci-core-grid-section-divider` (a border, default `0`: none, the look before), a hairline between the two columns of `Grid kind="sections"` at 80rem and up, in the middle of their gap; never before the row-start column, never in the one-column grid (under 80rem, 390 included). `common/theme-hooks.json`: 45 hooks.
- Fixed (`Button`, `IconButton`, default): a disabled button is neutral whatever its intent, step or variant: a neutral fill (the foreground at 6% over the surface) and neutral words (40%) at full opacity, no hover or press change; ghost and outline keep no fill, an edged destructive entry drops its danger edge. The vendor only dimmed it to `--disabled-opacity`, so a disabled primary read as a pink accent wash and a disabled destructive as a pale red. Pending and loading keep their look; `disabledReason` is unchanged.
- Fixed (`DataTable`): a cell that holds buttons keeps them on one line and its column sizes to them; a `Cluster` of two buttons in a `fit` column wrapped the second under the first.

## 0.41.0 - 2026-11-17 - White-theme fixes

- A minor only because of one new optional prop (`Section filter` on `kind="region"`); no lint rule changed, nothing removed. `eslint-grammar-core` and `eslint-grammar-offset-pop` carry the family version only. Story: `Surfaces/White theme (0.41.0)` (`src/stories/WhiteTheme.stories.tsx`), `Defaults` and `White`.
- Added (theme hook): `--starci-core-card-radius` (default the new ramp `--grammar-radius-card`, `min(32px, var(--radius-3xl))`, 24 at `--radius` 0.5rem). `--starci-core-surface-radius` reads it (`common/ramps.css`); that token is declared on the grammar root, so an app's `:root` value of it never reached the cards. Every card surface and, by default, the list frame follow it.
- Added (theme hooks, `Section kind="list"`): `--starci-core-list-frame` (fill, default `var(--surface)`), `--starci-core-list-frame-border` (edge, default 0 on the page ground and the 1px separator inside a surface), `--starci-core-list-radius` (default the card radius) and `--starci-core-list-inset` (the rows' inline inset, default `var(--grammar-inset)`). A white theme sets `transparent`, `0`, `0`, `0`: the list stands flat with its hairline row dividers and the row content starts on the section title's edge. The framed default is unchanged: its rows sit 12 inside the frame, whose edge is the one that lines up with the title.
- Added (theme hook) and changed (default): `--starci-core-track`, the empty track of every measure (`Progress` bar and steps, `Meter` bar and segments, `ProgressCircle`, `ProportionBar`), by default the foreground at 10% over the surface (about neutral-200 on white), no longer `--default` (which a white theme sets to the surface, so an empty bar vanished) or a 10 to 12% transparent mix. One step lighter than the Switch's off track (16%), which keeps its own hook: a control and a measure differ. A stepped `Progress` track is transparent so its gaps read as gaps. `common/theme-hooks.json`: 44 hooks.
- Fixed (`Link`, default): an inline link is underlined at rest (COLOR-3: a destination in body copy is identifiable at rest), a hairline in its own colour at 40%, `--grammar-link-underline-offset` (0.2em, `ramps.css`) below the text, full colour on hover and press. `head` keeps the hover underline; `plain`, media, current, disabled and footer links draw none.
- Fixed (`Page` / `PageHeader`, MEASURE-8 rewritten): the header band's content takes the page measure, capped and centred like the body, so on a screen wider than 80rem the title and the body share one start edge (before, the band's content stayed at the page inset while the body centred). The band's ground stays full width; `chrome="panes"` keeps the full measure.
- Added (`Section`, prop): `filter` on `kind="region"`, the toolbar (`Tabs kind="filter"`, a `SearchField`, its `Select`s) that narrows everything the section holds, drawn as the same flat row as a list section's filter, between the head and the children. A catalog of several lists under one toolbar no longer borrows a rowless `SurfaceCard kind="list"` for its zones, which drew the toolbar as a card. The first filter tab label of any section filter row stands on the section's edge, as in a card zone.

## 0.40.2 - 2026-11-17

- Fixed (Switch, both kinds): the off track has its own theme hook `--starci-core-switch-track-off`, by default the foreground at 16% over the surface (about neutral-300 on white), no longer `--default`. A white theme sets `--default` to the surface (ghost hover shares it), so the off track of a `compact` switch vanished on a white card. The on track stays the accent.
- Added (theme hook): `--starci-core-switch-track-off-border` (default 0), a hairline on the off track drawn as an inset outline, so the track keeps its 72x40 or 32x18 box and the focus ring. `common/theme-hooks.json` lists both (38 hooks).

## 0.40.1 - 2026-11-17 - Switch kinds: toggle and compact

- A patch: a new optional prop and renderer CSS only, no lint rule of an `eslint-grammar-*` package, nothing removed, no default changed (contexts/grammars/contributing.md "Patch or minor"); the canon pins' `~0.40.0` admits it. `eslint-grammar-core` and `eslint-grammar-offset-pop` carry the family version only.
- Added (owner ruling 2026-11-17, "add a second kind of Switch: the first is the 40px one of the light/dark toggle, the second is a small one that replaces the oversized switch of an inline setting"): `Switch kind="toggle" | "compact"` (`SwitchKind`, `src/core/leaf/Switch/index.tsx`). `toggle` is today's switch and stays the default (track 72x40, thumb 32). `compact` is a 32x18 track with a 14px thumb inset 2px, for a setting in a settings or list row, a table cell or a toolbar; it is Grammar's own geometry (HeroUI's `sm` is 2rem x 1rem, `md` 2.5rem x 1.25rem, `lg` 3rem x 1.5rem, `@heroui/styles/dist/components/switch.css:151-165`, none 18px tall), keyed on `data-grammar-switch-kind`.
- Both kinds: the accent track when on (as a checked Checkbox), the keyboard ring on the track is `--starci-core-field-ring` (default `--focus`), disabled at 45% (`--grammar-opacity-faded`), thumb travel 150ms (`--grammar-switch-travel`) and none under `prefers-reduced-motion`. The last three change the toggle's disabled opacity and travel time slightly (the vendor used its disabled opacity and 300ms).
- Compact draws no thumb glyph (a 14px thumb is too small for one): `thumbIcon` and `selectedThumbIcon` are ignored on it.
- `size` is kept: `size="control"` is `kind="toggle"`, `md` and `lg` stay HeroUI's sizes. When `kind` is given it wins and `size` is ignored. A Switch with neither renders as before.
- Not done: no lint rule asks for `compact` inside a row or list (no rule of `eslint-grammar-core` reads a Switch's ancestors in its style); the guidance is in the docs and held by review.
- Stories: `Controls/Switch row` `TwoKinds` and `TwoKindsAt390` assert the rendered track and thumb (toggle 72x40 thumb 32, compact 32x18 thumb 14 inset 2, no glyph), `CompactSettingsRows` and `CompactSettingsRowsAt390` the labelled row and the 45% disabled opacity.
- Docs: README (Switch), `contexts/ui/components/field.md` (SWITCH-KIND).

## 0.40.0 - 2026-11-17 - One field look, a flat table, the ribbon and the theme hooks

- A minor, not a patch: exports and a prop are removed (below), a DNA law is replaced and the default of `DataTable surface` changes what an app that passes none shows; the canon pins' range moves to `~0.40.0`.
- Removed (owner ruling 2026-11-17, "one look for a field, and for every element like it"): the surface-dependent field variant. A field has ONE look wherever it stands (the page, a card, a `Pane surface`, a `Dialog`, a `Drawer`, a `Popover`, a bar): HeroUI's `primary` field, its edge set by the theme's field tokens (`--field-border`, `--field-border-width`, `--field-border-focus`). Deleted, not tokenized:
  - `useFieldVariant` (`src/core/surfaceContext.tsx`): no host switches a field any more;
  - the exports `FieldVariant` and `fieldVariantAttributes` (`src/core/leaf/Field/index.tsx`, `src/common/renderers-forms.ts`) and the `data-grammar-variant` stamp on every field;
  - the secondary branch of Input (and its InputGroup), Textarea, Select, ComboBox, SearchField (which was always `secondary`), NumberField, DateField and TimeField (`DateFieldBox` loses its `variant` prop), DatePicker, DateRangePicker, OtpInput, CopyField, Checkbox, CheckboxGroup, RadioGroup and PressableField;
  - `src/common/components-surface-controls.css` (PressableField's secondary plate), the stylesheet that existed only for it;
  - the law `DNA-COMMON-FIELD-BY-LAYER`, replaced by `DNA-COMMON-FIELD-ONE-LOOK` (no vendor `*--secondary` field class is drawn anywhere); the stories `Compositions/App shell layers` assert the same.
- Kept, deliberately (they carry meaning, not a contrast against a tinted surface):
  - `Tabs` underline vs pill (`src/core/branch/Tabs/index.tsx:81`, `:122`): chosen by what the tabs do (views and filters vs a mode switch of two to four options, R380), never by the surface;
  - `Select appearance` `field | pill | compact` (`src/core/branch/Select/index.tsx:46`): shape and size of a picker (a page-head pill, a toolbar step), not a surface twin; its fill reads the plate hook below;
  - `RadioGroup appearance` `plain | rows` (`src/core/composite/RadioGroup/index.tsx:28`): a layout (one option per row with its description);
  - `DataTable surface` `card | frame | none` (`src/core/branch/DataTable/index.tsx:140`): structure (who draws the container), with `none` the default below;
  - `PaneSection scroll.tone` `surface | background` (`src/core/frame/PaneSection/index.tsx:19`): which ground a scroll band stands on, not a field contrast;
  - `MediaFrame treatment` `framed | plain` (`src/core/leaf/MediaFrame/index.tsx:15`): a frame or none around media;
  - structural context reads that change no fill: FlowGraph unframed inside a surface (`src/core/branch/FlowGraph/index.tsx:388`), EmptyNotice words-only inside a card (`src/core/composite/EmptyNotice/index.tsx:93`), ListBox panel inset in a surface (`src/core/branch/ListBox/index.tsx:146`), ErrorView band vs notice (`src/core/loadingState.tsx:57`);
  - intents, tones, sizes and the selected, disabled and current states of every part. No chip, filter button, icon tile, avatar fallback or button swaps its fill by the surface it stands on (audited: no such rule or prop exists).
- Changed (owner 2026-11-17, superseding the table card of 0.37.8): `DataTable surface` defaults to `none`. A table is a collection, not an object: it sits flat on whatever holds it, hairline rows under a muted heading, no fill, radius, shadow or edge; `card` keeps the white card for an app that asks for it. A flat table is flat at phone width too: its list has no fill and no radius (`.starci-core-data-table[data-grammar-table-surface="none"] .starci-core-data-table-list`).
- Added: `Section kind="figures" ribbon` (and `FigureCells ribbon`): the figures strip as a ribbon, a hairline (`--separator`) on its top and bottom edges only, the same dividers between cells running the full cell height, open ends, no radius, no fill (`data-grammar-figures-placement="ribbon"`, wins over the card and pane placements; the five-cell wrap law holds).
- Added: the theme hooks, `src/common/theme-hooks.json` (exported as `@starci/grammar/theme-hooks.json`): optional custom properties an app's theme layer sets beside HeroUI's tokens. The Grammar declares none; each rule reads it with a fallback equal to the look before, so an app that sets none draws what it drew (the field ring keeps the vendor ring; `scripts/check-theme-hooks.mts` holds both sides, run by `npm test`). The hooks: `--starci-core-card-border` (an edge for a card on the page ground, apart from the list frame and the table `--surface-shadow` also paints), `--starci-core-card-hover`, `--starci-core-card-active` (a whole-action card's fills, default the accent soft pair and the 14% accent mix), `--starci-core-table-selected`, `--starci-core-table-selected-foreground` (a selected row), `--starci-core-pagination-current` (the current page), `--starci-core-schedule-current` (today's cell), `--starci-core-sidebar-selected`, `-selected-foreground`, `-selected-weight`, `-weight`, `-bar-width` (default 0: no bar), `-bar`, `-selected-start-radius` (the selected item and its start-edge bar, drawn by `::before` so the focus ring stays), `--starci-core-tabs-indicator` (the underline colour, `secondary` tabs and `kind="filter"`), `--starci-core-field-ring`, `--starci-core-field-ring-width` (every field's focus ring, apart from `--focus`, the keyboard ring of buttons and links), `--starci-core-plate`, `-plate-border`, `-plate-selected`, `-plate-selected-foreground`, `-plate-selected-border` (ChoiceChips, FilterButtonGroup, RadioGroup rows; the Select pill and compact take the fill), `--starci-core-button-danger-soft`, `-button-danger-soft-border` (the destructive entry button as an outline), `--starci-core-bubble-incoming`, `-incoming-foreground`, `-incoming-border`, `-outgoing`, `-outgoing-foreground`, `-outgoing-border`, `--starci-core-message-card`, `-message-card-border` (the chat faces; the in-thread `border: 0 !important` now reads the incoming and card border hooks), `--starci-core-quote`, `--starci-core-quote-edge` (a Quote's fill and a start rule), `--starci-core-flow-selected` (a selected FlowGraph step's ground) and the existing `--grammar-choice-ring`.
- Fixed: forced colours keep the 1px system edge on the reader's own bubble now that its rule sets an edge of its own.
- Not done, by judgement: `dismiss` stays the vendor `tertiary` plate (a ghost would change every app on Core, `core/dna.ts`); a checked Checkbox, Radio and Switch stays the accent (owner).
- Docs: README "Surface controls" and "Theming", `contexts/ui/components/text-field.md`, `contexts/ui/presentation.md`, `contexts/vendor/heroui.md`, `contexts/vendor/parity.yaml`, `contexts/ui/components/list-table.md`, `contexts/ui/components/card.md`, `contexts/ui/composition.md`, `contexts/grammars/contract.yaml`.

## 0.39.4 - 2026-11-17 - Row links, ListBox link items, FlowGraph minimap and edge routing

- A patch: new optional props and renderer fixes only, no lint rule of an `eslint-grammar-*` package, nothing removed (contexts/grammars/contributing.md "Patch or minor"); the canon pins' `~0.39.3` admits it.
- Fixed: a `DataTable` row with `href` at phone width (the list layout, under 768 px) drew a pressable-looking row with no link and no navigation. The title is now a real anchor stretched over the whole row (the app's router navigates a plain click, a modifier or middle click opens a new tab, Enter on the focused anchor follows it, the focus ring is drawn on the row); `onRowAction` still runs on the same click.
- Changed: in the table layout the row-header cell's content is also a real `<a>` stretched over the vendor row (out of the tab order; the row stays the one keyboard stop and navigates through `GrammarRoot`'s router), so middle-click, "open in new tab" and copy-link work. A row without `href` is unchanged.
- Added: `ListBoxItem.href`: a navigation item is a real anchor (`<a role="option">`) with router navigation, new-tab on modifier or middle click, Enter and the focus ring; `onAction` runs alongside. An item is either selectable or a link: `href` applies in a `selectionMode="none"` list (the default when any item has an `href`) and is ignored in a selecting list.
- Added: `FlowGraph` `minimap` and `minimapLabel`: an overview map (one muted block per measured card, the part in view cut out of a veil, press or drag to centre the canvas), in the surface and separator tokens, hidden under 48rem and while the graph is not interactive. Off by default.
- Changed: a `steps` edge whose route would cross a card other than its two ends (a join that skips layers, a loop back to an earlier step) is routed round the cards by an orthogonal shortest path with the fewest turns, `STEPS_AVOID_CLEARANCE` clear of each card (`stepsAvoidRoute`, `routeAroundBoxes`, `segmentCrossesBox`, `routeCrossesBoxes` in `steps.ts`). An edge that crosses nothing is drawn exactly as before. A back edge's label sits on the longest run of its route.
- Stories: `Surfaces/Row links (0.39.4)` (`DataTableRowIsALink` at 1920 and 390: the anchors, the router call, Enter; `ListBoxItemIsALink`; `ListBoxSelectionStaysSeparate`) and `Flow graph edge routing and minimap (0.39.4)` (`JoinAndLoopAcross`, `JoinAndLoopDown`: every edge's path sampled, none inside another card; `Minimap`).

## 0.39.3 - 2026-11-14

- Changed: follows @starci/hfs 6.13.0 (peer line): version stamp only, with the Grammar family 0.39.3. No component changes.

## 0.39.2 - 2026-11-14

- Changed: version stamp only, with the Grammar family 0.39.2 (cut with `@starci/hfs` 6.12.0); the components are those of 0.39.1 below. No component changes.

## 0.39.1 - 2026-11-14 - FlowGraph steps: decision diamond, loop frame with exits, fallback road

- A patch: new optional fields only, no lint rule of an `eslint-grammar-*` package, no prop or law id removed (contexts/grammars/contributing.md "Patch or minor"); the canon pins' `~0.39.0` admits it.
- Added (`DNA-COMMON-FLOW-DIAMOND`): a `steps` node with `shape: "diamond"` (any kind but `end`, never a loop card) draws as a decision diamond one card wide and 88 tall (`--grammar-flow-diamond-height`, `STEPS_DIAMOND_HEIGHT`), the card's one border as its outline (selected: 2px in the status colour with the soft tint; dashed when `isPlaceholder`), its `label` (the question) inside at 14 medium in at most two lines. Its ports (its `outputs`, or the labels of its labelled edges) are drawn as words (12 medium, muted; danger on an error port) beside the vertex each branch leaves: the layout gives a branch the side vertex facing its target (LR: top / bottom; TB: left / right) and routes it across out of the vertex, then along into the target with one rounded turn (`stepsSideRoute`); a branch whose target stands straight ahead leaves the end vertex. Across (LR) the layout keeps half a diamond more between a diamond's branches, and a diamond with one branch ahead widens the gap after its layer for the word. Before, `steps` ignored `shape` and drew a rectangle. The tile, line, tag, chips and agent are not drawn in a diamond; they stay in its accessible name.
- Added (`DNA-COMMON-FLOW-LOOP-FRAME`): `container.kind: "loop"` (default `group`, today's solid box): a dashed muted frame with no fill round its body, the header `label` and a muted 12 `description`; `container.note`, a muted 12 line inside its bottom; `container.exits: [{ id, label }]`, the ways out, as pills ON its end edge (LR: stacked on the right edge, one width, starting 12 inside it; TB: side by side centred on the bottom edge; the FlowGraph's edge-label pill at the medium weight, 20 tall, `--grammar-flow-exit-height`), each the source of the edges `{ source: <frame id>, sourcePort: <exit id> }`, which run their own branch lanes. The layer of a frame holds its pills; the frame grows so its exits fit (a body as tall as the stack, a frame as wide as the row).
- Added: `edge.isFallback` (`steps`): the road taken when the awaited thing does not happen (a timeout, an else), a forward edge drawn dashed (5 4) and routed as a forward edge, its label pill dashed. `isPlaceholder` keeps its meaning.
- Added: `FlowGraphLegendItem.kind` takes `"loop"` (new type `FlowGraphLegendKind`; a dashed muted swatch with no fill) and an item may carry `shape: "diamond"` (its swatch turned on its corner).
- Changed: `DNA-COMMON-FLOW-SELECTED` measures the boxed cards (`:not([data-grammar-flow-diamond])`); a diamond's one border is its outline, `DNA-COMMON-FLOW-DIAMOND`.
- Layout API: `StepsLayout` gains `exits`, `diamondSides`, `portSides`; `steps.ts` exports `isDiamond`, `isLoopFrame`, `stepsSideRoute` and the `STEPS_DIAMOND_*`, `STEPS_EXIT_*`, `STEPS_NOTE_ROW` measures.
- Stories: `Flow graph decision and loop (0.39.1)`: `Diamond` (LR and TB, the fallback road, the legend), `LoopFrame4` and `LoopFrame13` (a body of 4 and of 13 cards, 6 of them diamonds, in the 1160 map well of a 1440 page: nothing overlaps, zoom 0.8 or more), `LoopFrameDown` (TB), `LoopFrameDark`.
- Docs: `contexts/ui/components/diagram.md` (workflow and decision rows), `contexts/grammars/contract.yaml` (diagram slots, the two laws).

## 0.39.0 - 2026-11-13

- A minor, not a patch: the default labels below change what an app that passes none shows.
- Changed: the default labels of `MessageBubble` reactions (`DEFAULT_REACTION_LABELS`) and the default `resetLabel` of `FlowGraph` are English; an app in another language passes its own. Stories, JSDoc, CSS comments and the README use neutral English copy; the story file `NivoCanvas.stories.tsx` is `CanvasParts.stories.tsx`.
- Changed: cut with `@starci/hfs` 6.10.0: the family releases together; no component, token or stylesheet changes beyond the labels above.

## 0.38.2 - 2026-11-13

- Changed: version stamp only, cut with `@starci/hfs` 6.9.0 (the project extension folder, PROJECT-LINT-3): the family releases together; no component, token or stylesheet changes.

## 0.38.1 - 2026-11-12

- Fixed: three spacing values stood off the scale (0 4 8 12 24 32, 16 only as `--grammar-inset-card`) and failed `starci/spacing-scale` over the Grammar stylesheets (`@starci/stylelint-canon` `src/spacing-scale.spec.ts`). Each now reads the token of its role, and no drawn size moves: a row of a `DataTable` drawn as a list under 768 (`.starci-core-data-table-list-row`, since 0.37.3) takes `var(--grammar-row-gap) var(--grammar-card-padding-inline)` (was `0.75rem 1rem`; 12 to its separators, 16 to the card's edges, ROW-EDGE-PADDING), its group band (`.starci-core-data-table-list-group`) `0.5rem var(--grammar-card-padding-inline)` (was `0.5rem 1rem`), and `--grammar-button-icon-padding` reads `var(--grammar-inset-card)` (was `1rem`, since 0.37.5): a Button with a glyph keeps HeroUI's 16 on md and lg, read from the one token that carries the step.
- Changed (the package's own lint, not shipped): `starci-grammar/spacing-scale` (`scripts/lint/stylelint-plugin.mts`) judges 16 as the canon does, a step only as the value of `--grammar-inset-card`, so `npm test` here refuses what `@starci/stylelint-canon`'s spec refuses; it admitted 16 anywhere, which is how the three values passed this package's gates.
- Docs: `contexts/ui/presentation.md` "The scale" and the Button row of its padding table state the glyph Button's measure (12 / 16 / 16 on both sides); the comment of `src/common/spacing.ts` and of the control padding tokens say the same.
- Contract: `DNA-COMMON-LIST-ON-WHITE-BORDERED` and `DNA-COMMON-ROW-EDGE-PADDING` stand under `mustKeep.common` of `contexts/grammars/contract.yaml`, where their ids and their CSS (`src/common/styles.css`) place them; under `mustKeep.core` the DNA loader refused the whole contract (`DNA_CONTRACT_INVALID`). No id changed.

## 0.38.0 - 2026-11-12

- Changed: the content of 0.37.3-0.37.38 on the hfs 6.8 line, released as a minor: since 0.37.2, the version npm serves, the family adds and changes lint rules of `@starci/eslint-grammar-core` (`message-surfaces`, `no-card-lead-description`, `no-nested-label`, `rows-in-card`, `section-head-action`, `single-child-card`, `surface-depth`, `tabs`), which is a minor's change (`RELEASE_GRAMMAR_MINOR_REQUIRED`, contexts/grammars/contributing.md "Patch or minor"); the canon pins' range moves to `~0.38.0`. `@starci/eslint-grammar-core` peers `@starci/hfs ~6.8.0` (0.37.38 peers `~6.7.0`, so no hfs 6.8 app could install it). No component, law or lint rule changed against 0.37.38.

## 0.37.38 - 2026-11-12 - Meter and Progress: a foreground fill that spends no accent

- Added: `Meter tone="foreground"` (new exported type `MeterTone = PresentationState | "foreground"`) and `Progress tone="foreground"`: the fill is HeroUI's `--foreground` text colour on the default track, plain, segmented and step bars alike, so a usage quota stands beside a view's one commit without a second accent mass (ACCENT-6, the red budget). The vendor colour is HeroUI's `default` variant and the Common rule writes `--meter-fill` / `--progress-bar-fill` as `--foreground` (`!important`: consumers import the sheet on either side of `@heroui/styles`). Offset Pop paints it with the ink. Dark mode follows the token.
- Fixed: an `AlertDialog` (or `Dialog`) opened from a control inside a `PaneGrid` pane's drawer (`collapse="drawer"`) rendered BEHIND the sheet: the pane drawer kept HeroUI's `--z-index-overlay` (100000) while the Grammar's own overlay backdrop was pinned at `z-index: 50`, so on a phone the confirmation could be neither seen nor answered. `.starci-core-overlay-backdrop` now sits on `--z-index-overlay` and the toaster on `--z-index-toast` (was 60): every modal-level overlay shares one level and the one opened last paints on top, as HeroUI lays them out. Story `Alert dialog over a drawer (0.37.38)` `DrawerAt390`, `PaneDrawerAt390`; `contexts/ui/components/dialog-drawer.md` States.
- Unchanged: `tone="neutral"` (and `pending`) keep the accent fill, a measurement fill by ACCENT-4; no existing tone's colour moved. Role `meter` / `progressbar` and the `aria-value*` are unchanged.
- Docs: `contexts/ui/composition.md` ACCENT-4, `contexts/ui/components/toast-alert.md`.
- Proof: `prove-theme` probes `meter foreground fill` and `progress foreground fill` (`--foreground`) in both families, both modes and every scenario.
- Stories: `Meter foreground fill (0.37.38)` `Light`, `Dark` (40, 92, 100 %, a segmented count, a Progress bar, neutral beside it); `Leaves` `Meter` tones.
- Version: 0.37.37 is taken by the open branch `pkg/claude-annex-companion` (its renumber); this release is 0.37.38, cut on 0.37.36.

## 0.37.36 - 2026-11-11 - List row: value, badges and end action on one line; Alert stacked action stays inside the banner

- Fixed (`DNA-COMMON-ROW-ACTION-END`): a `rows` list row with a `value` gets a grid track of its own between the copy and the end group (the row carries `data-grammar-value="true"`), so value, `badges` and an end `action` stand on one line, centred against the copy, with the row padding to the edge. The row templates counted no value track, so the command was auto-placed onto a second line. A key-value list keeps its two-column rule.
- Fixed: `Alert`'s content takes its own height (`block-size: auto`). In a banner whose height is definite (a Stack in a height-bound Page well) HeroUI's h-full filled the whole box with the first line and the stacked action (under 30rem) landed below the banner.
- Docs: `ListRowData.value` comment (`surfaceCardData.ts`), `contexts/ui/components/list-table.md` (key-value rows).
- Stories: `Row value and Alert stack (0.37.36)` `ValueBadgeAndEndAction`, `ValueBadgeAndEndActionAt390`, `AlertStackedActionAt390`, `AlertActionAt1440`.

## 0.37.35 - 2026-11-11 - FlowGraph: one selected border, 176 cards, branch lanes; suggestions chevron at 390

- Changed (owner-approved drawing `graph-selected`, law `DNA-COMMON-FLOW-SELECTED`): a selected `steps` card has ONE border, 2px, in its status colour (done `--success`, failed `--danger`, waiting `--warning`, running `--accent`, skipped and not reached `--muted`; a graph with no run status the `--foreground`) and a soft tint of that colour (8% over `--surface`) as its ground. The accent selection outline is gone and the run path's 1px box-shadow ring is gone: never a second ring (a selected done step drew a green border plus a red ring). An unselected card keeps one 1px border, in a run its status colour (waiting is now amber, not the path green). Keyboard focus shows only on `:focus-visible`: a 2px dashed outline in the card's status colour, 3px off the card (no `--focus` ring on a card); a mouse click adds nothing. New card properties `--starci-flow-border-width`, `--starci-flow-edge`, `--starci-flow-select` (internal).
- Changed (`DNA-COMMON-FLOW-CARD-SIZE`): a step card is 176 x 64 (`--grammar-flow-card-width` 11rem, `STEPS_CARD_WIDTH` 176; was 200), title 14 wrapping to at most two lines (then an ellipsis and a tooltip; the card grows by the second line only), its line 12 on ONE line with an ellipsis and a tooltip. Across (`LR`) the end pill stands 40 after its source (it took a whole card's width before), and the cards of a column take their own heights, 40 apart (`STEPS_CROSS_GAP_LR`), instead of the tallest card's row plus 80. The steps fit margin is 12 (was 16): the linear Sales map (five cards and its end pill) opens fitted at zoom 0.957 in the 1160px workflow map well; six cards in a line (Kế toán) need about 0.90 there and open at zoom 1 and pan (the 0.95 opening rule is unchanged).
- Fixed (`DNA-COMMON-FLOW-BRANCH-LANES`, the long vertical line of the Lễ tân map): every edge out of a port runs its own lane (16px out of the card, each next 10 further; climbing branches nearest, upper port first, then descending ones, lower port first), turns once into it and once into its target, and never runs past the higher or lower of its port and its target; a layer gap widens to hold its lanes. Before, all four branches shared one trunk and the tallest-card row spacing threw the hand-off cards far above and below the frame, so the shared vertical ran the full frame height. `StepsLayout.trunks` (edge id → lane distance); the edge dot carries `data-grammar-flow-lane`.
- Fixed (`DNA-COMMON-CARD-SUGGESTIONS`): `SurfaceCard kind="list" layout="suggestions"` rows are a grid at every width, so the chevron stays at the end of the row, vertically centred, and the text wraps beside it (at 390 the chevron wrapped under the text).
- Docs: `contexts/ui/components/diagram.md` (176 cards, branch lanes, selected and keyboard focus with the reasoning), `contract.yaml` laws `DNA-COMMON-FLOW-SELECTED`, `DNA-COMMON-FLOW-BRANCH-LANES`, `DNA-COMMON-FLOW-CARD-SIZE` (176), `DNA-COMMON-FLOW-OPEN-ZOOM`, `DNA-COMMON-CARD-SUGGESTIONS`; `message-bubble.md`.
- Stories: `Flow graph selected (0.37.35)` `RunSelectedDone`, `RunSelectedFailed`, `RunSelectedWaiting`, `MapSelectedForeground`, `KeyboardFocusSameColour`, `BranchLanesNoOvershoot`, `SuggestionsChevron390`; `Flow graph readability (0.37.33)` `LinearFiveFits` now carries the end pill and checks 176 cards.

## 0.37.34 - 2026-11-11 - Markdown: highlighted code is the app's slot

- Added: `Markdown renderCode?: (code: MarkdownCode) => ReactNode` and the exported type `MarkdownCode = { readonly language: string | null; readonly value: string }`. The slot draws only the code body of a fence (syntax highlighting supplied by the app); the `FencedCodeBlock` frame, its language label (hidden for a one-line command) and its Copy action stay Grammar's, and Copy always writes the original `value`. No slot, or a slot that returns `null`/`false` (a highlighter still loading), draws the plain `<pre><code>`. A `mermaid` fence never goes through the slot. Grammar adds no dependency and no CSS: the app returns its markup inside the existing `data-grammar-fenced-code-highlight="true"` wrapper, which scrolls inline (OVERFLOW-4).
- Docs: `contexts/ui/components/text.md` "Highlighted code is the app's slot".
- Stories: `Surfaces/Markdown` `HighlightedCodeSlot` (frame and label kept, one-line command unlabelled, inline scroll, Copy writes the raw value, mermaid bypasses the slot) and `CodeSlotFallback` (a `null` slot keeps the plain block).

## 0.37.33 - 2026-11-11 - the chat frame is background anywhere; FlowGraph reads at zoom 1

- Added (owner-approved drawing `chat-frame-anywhere`, law `DNA-COMMON-CHAT-FRAME`): `Pane content="chat"` (`PaneContent` gains `"chat"`). On any page a chat is one frame: its head band, its thread and its composer `footer` are `--background` whatever it stands on (a white pane, the aside, a `Drawer`, a `Dialog`, a `Popover`); the rest of the page keeps its own rule (the room list, an aside's other panes and the page header band stay white). `surface` is ignored on a chat frame; a pane whose own stack holds a `PaneSection scroll role="log"` is drawn as a frame without the word, and an overlay that holds a thread is the frame as a whole (its own head included). The 1px lines between head, thread and footer stay. A chat frame is a new surface host `chat`: a card in it is bordered with no shadow, and a field in it (the composer) is the white PRIMARY field even inside a drawer (`useFieldVariant`). Inside a chat frame a message is always flat: the 0.37.31 1px edge for a bubble on white never applies there.
- Fixed (`DNA-COMMON-CHAT-FRAME-SCROLL`, the /chat thread never scrolled): in a chat frame the thread is the only scroller between the fixed head and the fixed composer footer. The pane body above a footer was the scroller (its stack grew with the messages, `flex: 1 0 auto`), so a thread's `scroll.scrollRef` had nothing to scroll; the body is now bounded and never scrolls and the thread takes the rest. A `role: "log"` band opens at its newest message and follows new ones while the reader is at the foot (`PaneSection`, no app code).
- Changed (owner-approved drawing `graph-state`, FlowGraph `steps`): a step card is 200 x 64 at zoom 1 (`--grammar-flow-card-width` 12.5rem, new `--grammar-flow-card-height` 4rem; title 14, line 12; ports add rows under the body), law `DNA-COMMON-FLOW-CARD-SIZE`. Across (`LR`) the gap between layers is 40 (was 112), wider only where an edge out of the layer needs it: a label pill on a forward edge with no port (112, or the pill), back-edge channels and the pill beside them (`lrLayerGaps`). Orthogonal routing, the 10px bends and the shared trunk are unchanged; `TB` keeps 64.
- Fixed (`DNA-COMMON-FLOW-EDGE-DOT-ON-EDGE`): the round dot an edge starts with sat wholly outside its source card (the 6px anchor handle put the edge start 6px past the edge). Every handle of a step card is now a point on the card's edge (no size, no transform), so the dot is centred ON the edge, half on the card and half out, and the edges stand above the nodes (edge `zIndex` 2) so the dot is drawn over the card.
- Changed (`DNA-COMMON-FLOW-OPEN-ZOOM`): a steps graph opens readable: fitted when the fit is zoom 0.95 or more (never past 1; a linear 5-step graph fits the 1160px workflow map well at a 1440 page, about 0.97), otherwise at zoom 1 at its entry node with panning; a canvas 480px wide or less opens at 0.8 the same way. The least zoom stays 0.8. The zoom controls column takes room at the start edge only where the graph would stand beside it.
- Added: `FlowGraph height="fill"`: the frame takes the rest of the page height under the graph's top (what its scroll owner shows, less what follows the graph: a legend, a caption), at least 360px, instead of hugging the graph; re-measured on resize.
- Docs: `contexts/ui/components/chip.md` and `situations.md` say when to use which Badge (owner "Dùng sẵn có"; no new variant, no size prop): `Badge tone isDot` is the live status of something that runs (an agent, a connection, a run: running, paused, error); `Badge tone` without `isDot` is a result or a qualifying label (a grade, a mode, a default).
- Stories: `Navigation & Data/Chat frame (0.37.33)` (`ChatPage`, `InboxThread`, `AgentChatTab`, `AssistantDrawer`: play checks on the frame, head and footer fills, the white list and aside, the white composer field, flat messages, and that only the thread scrolls and opens at the newest message); `Flow graph readability (0.37.33)` (`LinearFiveFits`, `BranchedOpensAtOne`: dot centre x on the card edge, 200 x 64 cards with 14/12 text, the 40 gap, the opening zoom, the filled frame).

## 0.37.32 - 2026-11-11 - Markdown: course content drawn from a markdown string

- Added: `Markdown` (frame tier, exported from Common and every family entry): `<Markdown source measure? ariaLabel? labels? isExternal? />` parses `source` (CommonMark + GFM: tables, task lists, strikethrough, autolinks, footnotes) to a syntax tree with `mdast-util-from-markdown` 2.1.0, `mdast-util-gfm` 3.1.0 and `micromark-extension-gfm` 3.0.0 (exact pins, new dependencies) and maps each node to Grammar parts inside `MarkdownArticle`: `h1`-`h4` as `h2`-`h4`, paragraphs as `Text`, inline code as `Code`, links as `Link` (inline variant; an external destination opens in a new context and ends in the anchor icon), lists with nested and read-only task items, blockquote, rule, GFM tables in `MarkdownTableFrame`, fences in `FencedCodeBlock` with a Copy action (neutral `Button size="sm"`, result announced politely), `mermaid` fences in `MermaidDiagram`, an image-only paragraph as a `MediaFrame` captioned with the alt. No HTML string is built or injected: raw HTML is shown as the text typed (comments dropped); a link or image whose scheme is not http(s), mailto, tel (links) or relative is shown as its words. `labels` carries every word the body speaks (English defaults); `isExternal` overrides the default external test (absolute or protocol-relative http(s)).
- Stories: `Surfaces/Markdown` (EveryNode, Links, CodeWithCopy, VietnameseLesson, MermaidFence, NoRawHtml, Compact) with play checks.

## 0.37.31 - 2026-11-11 - the chat surfaces: pink thread, flat white messages, accent own; card replies as one bordered list; no band above the composer

- Changed (owner-approved drawing `chat-surfaces`, law `DNA-COMMON-CHAT-SURFACES`, every chat: team chat, agent chat, inbox thread, assistant): a chat thread (`PaneSection scroll={{ role: "log" }}`) is always the page tone `--background`; `tone` is ignored with `role: "log"` (an app's `tone: "surface"` no longer paints it white). A thread meets the head line above and the composer's line below edge to edge (the pane stack that holds a thread has no row gap).
- Changed: a message of someone else (`MessageBubble` incoming, every `MessageCard`) is the FLAT surface: `--surface` with `--surface-foreground`, no border, no shadow (it was lifted with a 1px separator border and the card shadow). Outside a thread, on a white surface (a drawer, a white pane, a card), it wears the 1px `--separator` edge so it does not vanish, still no shadow (SURFACE-ELEVATION). Own messages stay `--accent` / `--accent-foreground` (`DNA-COMMON-CHAT-INCOMING-FLAT`, `DNA-COMMON-CHAT-OUTGOING-ACCENT`). A surface nested in a bubble body (a SurfaceCard list in a MessageCard) is bordered with no shadow wherever the bubble stands.
- Added: `SurfaceCard kind="list" layout="suggestions"` (`ListData.layout` gains `"suggestions"`): the replies a message card offers, one bordered list, a row per reply whose plain text is 14 regular, wrapping, never truncated, the whole row the one button (`onPress` sends it), a trailing chevron. Law `DNA-COMMON-CARD-SUGGESTIONS`. The pills by the composer stay `Button size="sm"`.
- Fixed (the empty white band above the chat composer, ~68px): a pane `footer` slot's stack was matched as a head-row spacer by the shared head row (0.37.0) and padded by `--grammar-pane-head-size`. The footer stack is never a spacer now, and a `PaneSection rule="start"` first in the footer draws no second line under the footer's hairline (`DNA-COMMON-PANE-FOOTER-NO-BAND`).
- Stories: `Navigation & Data/Chat surfaces (0.37.31)` (`ChatPane`: the workspace page with the pink thread, flat incoming bubble and stop card, the card's suggestion list, the accent own message, the composer footer with no band, play checks on every fill token, border, shadow and the footer offset; `BubblesOnWhite`: the 1px edge in a drawer).

## 0.37.30 - 2026-11-10 - a MessageCard's content fills the card; Button `width="wrap"` for long suggestion pills

- Fixed (the /chat stop card): a `MessageCard`'s content column fills the card (`.starci-core-message-card` stretches its children; it was `align-items: flex-start`), so a nested bordered list (`SurfaceCard kind="list"`), a composer or a `DescriptionList` in the body spans the card's inner width. The head, the actions row and the meta line keep their items at the reading edge, so existing cards look the same.
- Added: `Button width="wrap"` (`ButtonWidth` gains `"wrap"`): content width capped at the container. A short label is exactly `content`; a label longer than its container wraps inside the pill (same pill radius and inline padding, the text at the reading edge, `overflow-wrap: anywhere`) and the box grows from its size step (sm 32px floor), so a long suggestion never spills out of its row. `content` (the default) is unchanged. Law `DNA-COMMON-CONTROL-FILL` covers `wrap` (step as floor); the fixed-height laws exclude it.
- Stories: `Navigation & Data/Message card fill` (`NestedListAndComposer`: a stop card with a bordered key/value list, suggestion pills and a composer filling the card; `LongSuggestionsNarrow`: short and long pills in an 18rem column).

## 0.37.29 - 2026-11-10 - readable floor 0.8; a row control centred with its checkbox and text; loading diff rows keep the gutter; top-aligned graph layers

- Changed (owner "Nâng 0.8"): the readable floor of a contained FlowGraph fit is zoom 0.8 (`CONTAIN_MIN_ZOOM`, was 0.6): a 12px label stays about 10px. A wide graph on a desktop pane now pans too; the canvas still grows to its cap and the first view shows the entry node. Law `DNA-COMMON-FLOW-READABLE-FLOOR`.
- Fixed (owner "căn center cho control và checkbox + text", ROW-CONTROL-CENTRE): in a select row with a `control`, the checkbox and its text block are one group, and the group and the control are vertically centred on each other (they were ~10px apart: the checkbox and title sat at the row's top). The row padding and the 40px phone touch target hold; a row without a control keeps its top alignment; a list row already centred its copy and control. Law `DNA-COMMON-ROW-CONTROL-CENTRE` (measure `center-y`, a new DNA metric in the harness CLI).
- Fixed: a loading diff row (`diff` with `isLoading`) keeps the gutter column (the mark's box, its glyph hidden) and a changed row's change line, so it is the loaded row's box.
- Fixed (FlowGraph, top-down): a layer's cards share one top line. The layout centres a layer on one line from estimated heights; a card that drew taller than its estimate (a wrapped title) stood 1.5-2px off its neighbours. A top-down step is drawn from its top edge now (origin [0.5, 0], the layer's tallest estimate converts the centre once); `positions` and drags stay centres.
- Test: the loop card's 1.5px outline check follows the screen (Chromium snaps a border to whole device pixels: 1px on a 1x screen, 1.5px on a 2x one); not a Grammar bug.
- Stories: `Surfaces/Row edge padding` `RowControlCentre` (the Quyền rows, title-only and with a subtitle, a Switch, a plain row, list rows); `Surfaces/List row diff` `LoadingSameBox`; the fit and style C stories assert zoom >= 0.8.

## 0.37.28 - 2026-11-10 - version diff rows in a list

- Added (owner drawing "So sánh phiên bản", GitHub-style): `ListRowData.diff` (`"added" | "removed" | "changed"`), `change?: { from, to }` and `diffLabel?`. A diff row draws a monospace gutter mark at its start (`+`, `−`, `~`) in its tone's ink, on the title's line; its ground is the tone's soft pair (success, danger, warning); a removed title is struck through; a changed row's "from → to" is the 12 muted line under the title. The glyph is `aria-hidden` and the label (`diffLabel`, default "Added", "Removed", "Changed") is read before the title, so the meaning is never colour alone. Works in `SurfaceCard kind="list"` and `Section kind="list"`; the row padding holds (p-4 edges, p-3 separators). Law `DNA-COMMON-LIST-ROW-DIFF`; contexts `list-table.md`.
- Stories: `Surfaces/List row diff` (`VersionDiff`: Bản 3 so với Bản 2, all three kinds and a plain row in a SurfaceCard, the rights and tools in a Section).

## 0.37.27 - 2026-11-10 - FlowGraph steps style C: left to right, orthogonal edges, a start dot, the run path green

- Changed (owner drawing C, "C trò yêu"): a `layout="steps"` graph reads LEFT → RIGHT by default (`direction="TB"` keeps the top-down map); a branching step fans its children down the page, in port order. Across, a condition's ports stack as rows under the body, each label at the start and its edge leaving the card's end edge at the row's middle.
- Changed: forward edges are ORTHOGONAL ONLY (`stepsForwardRoute`): out of the source to a trunk 24px along, across, then into the target, a 10px rounded corner at every turn; siblings out of one source share the trunk; a source facing the target's entering side runs straight in (no small jog between cards of different heights). Never a diagonal or a curve.
- Changed: every steps edge STARTS with a round dot (owner "bắt đầu có chấm tròn"): a white disc ringed in the edge's colour, r 4, drawn by the edge on its source's port or anchor, single straight edges and back edges included; the handles draw no dot of their own. The arrowhead is a small solid triangle in the edge's colour (owner "mũi tên giữ thế"). Edges stand above the cards (zIndex 1) so the dot is whole.
- Changed: the ground of a steps graph is the dotted canvas by default (`background` default `dots` for steps), on the page and inside a Drawer; cards stay white with a 1px border.
- Changed (STATE PRIORITY, run overlay): the path a run took is green: a taken edge, its dot and its arrowhead in the success tone, a card the run reached (done, running, waiting) a 2px success border, a failed card a danger border, a card it did not reach faded. A step's corner tag is opaque (the tint over the surface), so a green edge never shows through its word.
- Kept: the 0.37.26 fit (zoom >= 0.6, the canvas grows up to the cap, the first view at the entry node, pan, controls inside) now holds for both directions; the entry node is the leftmost across.
- Stories: `Flow graph style C` (`LeTanBranching`, `LeTanRun`, `LeTanInDrawer`: LR, dotted ground, every run axis-aligned, one start dot per edge, a four-way fan at one x, the green path); the 0.37.4/0.37.5 steps stories pin `direction="TB"` (they assert top-down geometry), `PortsArrowheadsAndTag` asserts the new marks, `AgentLine` measures layout size; the run overlay story asserts the green path. Contexts `diagram.md`.

## 0.37.26 - 2026-11-10 - a contained FlowGraph keeps a readable zoom; the controls stay inside

- Fixed (FlowGraph fit): a contained fit (every `steps` graph, any `fit="contain"`) has a readable floor, zoom 0.6 (`CONTAIN_MIN_ZOOM`). The Lễ tân graph (one node branching four ways) fell to zoom 0.168 at 390 and 0.278 in the versions-diff drawer; it now holds 0.6, the canvas grows to the graph up to the `height` cap (`lg` 512px when none), the first view shows the entry node (centred when the graph's edges allow), and the reader pans by drag, even when `isInteractive` is false. The canvas `minZoom` of a contained graph is the floor, so the fit button never shrinks below it. The figure writes `data-grammar-flow-floored` while held.
- Fixed (CONTROLS-INSIDE): the canvas is never shorter than the zoom controls column plus its margins (at 390 the column was about 130px in a 120px canvas and poked out).
- Stories: `Flow graph fit` `WideBranchingNarrow` and `InDrawer` assert the floor (zoom >= 0.6, entry node on screen, controls inside); `WideBranchingInPane` contains at a wide pane and floors at a narrow one; new `ShortGraphControlsInside`. Contexts `diagram.md`.

## 0.37.25 - 2026-11-10 - row padding follows what a side touches; a neutral Button in the section head

- Fixed (ROW-EDGE-PADDING, owner): the padding of a row follows what its side touches. A side on the card's edge is p-4 (`--grammar-card-padding-block`, 16): the first row's top (no header zone above) and the last row's bottom (no footer zone below), a single-row card both; a side on a separator is p-3 (`--grammar-row-gap`, 12). Applies to select, list, details and table rows, controls included. The select row's control slot had a FIXED `block-size` (0.37.13), so a Tabs pill taller than the title line overflowed into the row padding and touched the separator; it is `min-block-size` plus `padding-block` now and the row grows around the control. Table body cells are p-3 (were about 8), the last row of a card table p-4 below. The left and right edges are p-4 too: a select row and its control slot (were the 12px inset) and the first and last column of a card table (were 12). Header and footer zones follow it too: a first header zone p-4 to the card's top, a last footer zone p-4 to its bottom, a switch zone p-3 to its divider (was the 8px inline step). Law `DNA-COMMON-ROW-EDGE-PADDING`; `SurfaceCard` writes `data-grammar-surface-headed` and `-footed` on its body for it.
- Added: a `Section` head `action` takes a text `Button intent="neutral" size="sm"` with no icon ("Gắn thêm provider" at the end of "Provider đã gắn  2"), beside the head `Link` and the info `IconButton`; still ONE action per head, centred on the label's line, drawn as the neutral sm pill it is everywhere (outline). Lint `section-head-action` (eslint-grammar-core 0.37.25) accepts exactly that and refuses a commit/primary Button, another size, an icon Button (`startGlyph`, `startContent`, `endContent`, `icon`) and a second command; contexts `list-table.md` and the lint docs updated.
- Stories: `Surfaces/Row edge padding` (`RowEdgePadding`, `SingleRowAndHeaded`), `Surfaces/Section head action` (`NeutralButtonAtTheEnd`).

## 0.37.24 - 2026-11-10 - the flat aside list is reverted

- Reverted (owner 2026-11-10, "ok trò"): the 0.37.14 FLAT-ASIDE-LIST. SURFACE-ELEVATION wins: a `Section kind="list"` or `SurfaceCard kind="list"` in a white `Pane surface` aside is a bordered rounded frame again (1px separator, the card radius, no shadow), its rows divided full width and keeping the card's inline padding. The flat-aside CSS block is removed; `contexts/ui/components/card.md` no longer says a list in a white pane is never a card.
- Added: law `DNA-COMMON-LIST-ON-WHITE-BORDERED` (border 1px `--separator`, no shadow, on the aside list). Story `Surfaces/Surface elevation` `WellAndAside` now asserts the border, the radius, no shadow and the inset rows.

## 0.37.23 - 2026-11-10 - Select trigger text is centred (search-zone filters)

- Fixed: the filter select of a `SurfaceCard` search zone (`filters: [{ prefix, options, ... }]`) rode its text at the top of the pill, so "Kích hoạt: Tất cả" sat lower than the search field's text line and looked misaligned. The vendor trigger stretched its prefix and value spans (`align-items: normal`); the Select trigger now centres them (`align-items: center`), so the prefix and the value stand on one baseline in the middle of the pill. The pill and the search field are both the compact 32px step (asserted). Applies to every Select.
- Story `SearchFiltersAligned`: one filter and two filters, wide and phone, asserting equal height with the field and a centred prefix and value.

## 0.37.22 - 2026-11-10 - Footer links are plain

- Fixed: the `Footer` directory links (`groups[].links`) drew in the accent red. They are `Link variant="plain"` now (the foreground colour, no icon), as the red budget says for a standalone navigation link; `aria-current` and the external hint are unchanged. Story `Footer` notes it; `contexts/ui/presentation.md` records it.

## 0.37.21 - 2026-11-10 - three narrow-width fixes from starci-next

- Fixed: at 390 a `SurfaceCard` label that carried a count chip or a fact collapsed to height 0 (the narrow rule turned the fixed-height label row into a column and squeezed the label). The row now stacks only when it holds an end action (`labelEnd`), with `block-size: auto`; a label with a count or a fact stays one row at any width, the label truncates and the chip or fact follows it.
- Fixed: `Progress` as a `ListRowData.control` collapsed to a dot. A progress in a row control is 7rem wide (`--grammar-row-progress-width`), shrinks to 3rem in a narrow row, never wider than the row.
- Fixed (regression of 0.37.14): a `PaneGrid` holding a `Pane scroll` never entered the stacked grow mode, so below 48rem its rows were equal shares of the viewport and the aside showed a blank band under its content (650px on `projects/detail`). Only a chat thread (a scrolling `PaneSection`) or a pane footer keep the bounded height now; a `Pane scroll` stacked grows with its content and the page scrolls once, the panes one after another.
- Stories `Narrow fixes (0.37.21)`: `LabelWithCountAt390`, `ProgressAsRowControl`, `StackedPanesNoGap`.

## 0.37.20 - 2026-11-10 - FlowGraph steps: the fit contains every node

- Fixed: a top-down `steps` graph wider than its pane at the 0.75 floor started at the trigger and panned, so the first and last columns were clipped and the leftmost node sat under the zoom controls. The steps fit now always CONTAINS the graph: it fits the pane width less the controls' strip, never magnifies, and centres the graph in the room left. The zoom floor is the canvas `minZoom`, now 0.1 (was 0.2). Applies to `fit="readable"` (default) and `fit="contain"` alike.
- Fixed: the canvas height of a steps graph follows the graph at that scale (it grows or shrinks to it), so a graph in a Drawer or any narrow owner no longer stands in a tall empty box. Under `fit="contain"` a named (`sm` 16rem, `md` 24rem, `lg` 32rem) or numeric `height` is the most tall it grows (the graph shrinks to fit it). A four-wide branching graph in a 372px Drawer is contained but small by nature: give it more width, `direction="LR"`, or let the reader zoom.
- Stories `Flow graph fit (0.37.20)`: `WideBranchingInPane`, `WideBranchingNarrow` (390), `InDrawer`, each asserting every node inside the canvas and clear of the controls.

## 0.37.19 - 2026-11-10 - DropdownMenu switch entry

- Added: `DropdownMenuSwitch`, a third `DropdownMenuEntry`: `{ kind: "switch", id, label, description?, descriptionLines?, iconSource?, isSelected, isDisabled?, onChange(isSelected) }`. The row is a `menuitemcheckbox` (one-item multiple-selection group under the hood, `aria-checked` from `isSelected`) with a Switch drawn at its end as the row's own mark (inert, not announced twice); the whole row toggles it by press, Enter or Space, and the menu stays open (`shouldCloseOnSelect` false, so Enter, Space and press all keep it open). No check indicator. It is not reported by `DropdownMenu.onAction`.
- Story `DropdownMenuSwitch` (account menu with "Show the assistant"); `contexts/ui/components/menu.md` records the entry.

## 0.37.18 - 2026-11-10 - an informative Toast and alert dialog are neutral

- Changed: `Toast tone="informative"` (mark `--muted`) and the `AlertDialog` informative variant (icon tile `--default-soft` with `--default-soft-foreground`) are neutral like the Alert, no longer the accent pair. An app that writes `--informative`, `--informative-soft`, `--informative-soft-foreground` keeps its own. Offset Pop follows (toast and dialog mark `--muted`). A `Meter` informative fill stays the accent. The action Button inside an informative Alert stays the `commit`.
- Changed: `Grid kind="form" columns={2}` switches to two columns at a 31rem container width (was 32rem): a form in `Stack measure="reading"` inside a card measures 511px and missed 32rem by under a pixel. `Stack measure="form"` (30rem) is still one column.
- Added: laws `DNA-COMMON-TOAST-TONE-INFORMATIVE`, `DNA-COMMON-ALERTDIALOG-TONE-INFORMATIVE`; `contexts/ui/components/toast-alert.md` updated.
- Stories: Toast adds `unavailable`; new `AlertDialogNeutral` (all dialog tones now drawn).

## 0.37.17 - 2026-11-10 - the red budget: an informative Alert is neutral

- Changed: `Alert tone="informative"` (the default tone) is NEUTRAL: the HeroUI default soft pair (`--default-soft`, `--default-soft-foreground`) with the glyph in `--muted`, no longer the accent pink/red pair that read as an error. An app that writes `--informative-soft` and `--informative-soft-foreground` still paints its own pair. `accent` (the brand "new" band), `negative`, `cautionary` and `affirmative` keep their colours. Offset Pop inherits the Common pair. Law `DNA-COMMON-ALERT-TONE-PAIR-INFORMATIVE` now measures `--default-soft`.
- Changed: contexts record the red budget (`composition.md` ACCENT-5 and ACCENT-6, `components/text.md` Link, `components/button.md`, `components/toast-alert.md`): primary red is the one main CTA of a view and links in prose; a standalone secondary or navigation link is `Link variant="plain"`. No lint: whether a link is prose or standalone is judgement, and `single-commit-per-render` already refuses two commits.
- Stories: Alert shows every tone (informative, accent, affirmative, cautionary, negative, neutral, pending, unavailable); new `LinkVariants` (inline in prose, head, plain); the Grammar entry pages write their standalone links (Sign out, Forgot password, legal footer) as `variant="plain"`.

## 0.37.16 - 2026-11-10 - a primary Tabs pill is allowed as a row control

- Changed: story `SelectWithControl` writes the primary Tabs directly as the row `control` (lint `tabs-switch-zone` now allows it there). No component change.

## 0.37.15 - 2026-11-10 - code block language label; app bar custom buttons

- Added: `FencedCodeBlock showLanguage` (default `true`; `false` hides the header's language label) and the label is hidden by itself for a one-line `code` (a command to copy); the copy `action` stays. Story `FencedCodeLanguageLabel`.
- Added: `TopBar customButtons` (`{ id, glyph, label, badge?, onPress | href }`): round outline `IconButton`s in the end cluster before the app's fixed cluster, an attention dot with `badge`; at phone width only the first stays and `useTopBarOverflowEntries()` gives the rest as account-menu entries. New glyph `bell`. Story `TopBarCustomButtons`. `brand` stays required; the WorkspaceShell layout is unchanged.

## 0.37.14 - 2026-11-10 - Grammar keeps four owner laws it broke

- Fixed (internal navigation never shows ↗): `Link` draws the anchor icon `↗` only for `kind="external"` (an internal inline link keeps the accent colour and has none); a new `variant="plain"` is a destination with no colour, underline or icon. A `ListRow` with an `href` uses it: a navigation row, whole row pressable, title in the text colour, trailing chevron, real `<a href>` kept (LIST-ROW-NAVIGATION). Stories `InternalHrefHasNoArrow`, `LinkArrowOnlyWhenExternal`.
- Fixed (flat aside list, FLAT-ASIDE-LIST): `Section kind="list"` and `SurfaceCard kind="list"` inside a `Pane surface` draw flat: no border, radius, shadow or card ground, rows on the pane's edge with full-width dividers. Derived from the surface the Pane declares (no prop). Story `SurfaceElevation/WellAndAside` now asserts it.
- Fixed (stacked panes, PANE-GRID-STACKED): below 48rem of the grid's own width the grid, its tracks and its panes grow with their content (rows auto, panes stop clipping and scrolling, the page fill is a floor), so the page scrolls once and the aside is the first block of the well, never overlapped. The grid writes `data-grammar-pane-stacked="grow"` (a grid holding a chat thread or a pane footer keeps its bounded height). Story `Surfaces/Pane grid stacked`.
- Fixed (article headings, ARTICLE-HEADINGS-14): `MarkdownArticle` h2 to h4 are 14 (bold, semibold, semibold muted) instead of 20/18/16. Story `Markdown headings`.

## 0.37.13 - 2026-11-10 - a select row takes a control at its end

- Added: `SelectItemData.control?: ReactNode` (the name of `ListRowData.control`) on `SurfaceCard kind="select"` (owner: "the last cell is JSX, put in it what you like: check, switch, tab"). The slot sits at the row's end centred on the title line; the copy wraps before it. It is a sibling of the row's checkbox label, so presses, clicks and keys inside it never toggle the row (events are stopped at the slot) and it is outside the row's hit target and accessible name; a disabled row dims it and blocks it (`inert`). Content is Grammar components only (a primary `Tabs` pill "Tự động | Hỏi", a `Switch`, a `Badge`). Story `SelectWithControl`.

## 0.37.12 - 2026-11-09 - the body-card menu reserves room only beside the content

- Fixed (0.37.10): the end padding a `SurfaceCard kind="body"` with a `menu` reserves for the ⋯ also narrowed its footer zones, so the full-width divider above a footer stopped about 50px short of the right edge. The room is now reserved only on the content the ⋯ sits beside (an unzoned card pads its content; a zoned card narrows only its padded main); `headers` and `footers` zones and their dividers stay full width. Story `BodyCardAgent` has a footer zone and asserts the zone spans the card.

## 0.37.11 - 2026-11-09 - the FlowGraph controls reserve their corner

- Fixed: the zoom controls (bottom-left) overlapped a node near the bottom-left corner of a graph. A graph with controls now fits its view with a 56px strip at the start edge left empty (`CONTROLS_INSET`: the control column plus the panel margin), in every fit path (`fitView` padding, the steps fit, the anchored start), so no node is drawn under the controls. Story `ControlsReserveCorner` asserts the controls' rect meets no node.

## 0.37.10 - 2026-11-09 - a body card takes a menu

- Added: `SurfaceCard kind="body"` (the default kind) accepts `menu` (the card's ⋯ actions) with or without a `wholeAction`, as the tile does since 0.37.8: the trigger stands at the top end above the whole-card link (z-index 2 over 1) and never follows it, the card stays one whole link, and a keyboard user reaches both (two tab stops). For the agent cards whose coloured chip lines (a role chip, channel chips, a red "chưa cấp quyền") a tile cannot hold. Story `BodyCardAgent` (Surfaces/Whole-card action with menu).

## 0.37.9 - 2026-11-09 - short columns never wrap

- Fixed (owner law): a table of four columns or fewer let its cells and headings wrap (`white-space: normal`), so "Đã thanh toán" broke over three lines. Every column that is not the one fill column is now `fit` (nowrap, as wide as its content), whether or not another column sets a width; the fill column truncates by default (one line, an ellipsis, the whole text in the tooltip) unless it says `truncate={false}`. Story `FourColumnsNeverWrap` (a 4-column table at a 1440 and a 1024 container).

## 0.37.8 - 2026-11-09 - a table looks like a list card

- Changed (owner, replaces the 0.36.0 HeroUI grey frame): `DataTable` and `SurfaceCard kind="table"` have no grey frame, no grey side gutters and no grey header strip. A table is a white card like a list card: the column labels are 12px muted on the white, rows are divided by 1px full-width lines (also under the labels), the footer (summary and Pagination) sits under the last row behind a full-width zone-seam line, and the card zones are divided by the same seams. The standalone `DataTable` card takes the shadow on the pink well and a 1px border on a white surface; `surface="frame"` is the same face without radius, shadow or edge for a host that is the card; the phone list fallback and the column sizing API are unchanged. `DataTable fill` still grows the body and sticks the footer to the bottom. A group heading row keeps its secondary tint. Story `TableLooksLikeAList`; contexts (list-table, card, composition) and the `check:type` pin updated.
- Added: `FlowGraph islands="stack" | "wrap"` (`layout="steps"`, default `wrap`): the disconnected islands fill rows left to right by the measured canvas width (a ResizeObserver, 1200 until measured), then start the next row, 48 apart on both axes; an island wider than the canvas stands alone in its row; a connected chain stays one island. `stack` keeps the 0.37.4 single column. Stories `IslandsWrap` (six islands and a chain of five: 835px tall against 2095 stacked) and `IslandsStackKept`.
- Changed (owner): a `SurfaceCard kind="tile"` with a `wholeAction` may carry a `menu` (the card's ⋯): the type no longer makes them exclusive (`action` stays exclusive). The menu trigger stands above the whole-card link (z-index) as its own tab stop and never follows the card link. Story `Surfaces/Whole-card action with menu` (the agent card: Mở, Thêm agent cùng vai trò, Tạm dừng, Gỡ).
- Fixed (owner): a section head count of 0 is drawn again, as a grey "0" chip right after the label (the 0.37.3 hide-0 is reverted: only PAGE tabs hide 0). Story `Surfaces/Section count zero`.
- Fixed: a side Drawer is full width under 768 (inset-inline 0, width 100%, no max width or margin), so no strip of the page shows beside it at 390 (the workflow param drawer). Story `Overlays/Drawer on a phone`.

## 0.37.7 - 2026-11-09 - Label and Sublabel hierarchy

- Added (owner, LABEL-SUBLABEL-HIERARCHY): `Section sublabel` and `SurfaceCard sublabel` name a group nested in a labelled section with a Sublabel (12 / 500 muted) set 8px above the card; they are mutually exclusive with `title` / `label` in the types. Sibling groups stand 8px apart, like their Sublabel to the card (24px only between top-level Label sections).
- Changed: the Label of a `SurfaceCard` stands 12px (`--grammar-row-gap`) above its card, as a `Section` head already did (it was 8px; the cards Grid took 4px). Story `Surfaces/Label hierarchy` measures 12 / 8 / 24.
- Rule `starci-grammar/no-nested-label` in eslint-grammar-core flags a labelled Section or SurfaceCard nested in a labelled one of the same file.

## 0.37.6 - 2026-11-09 - a row with an href is pressable whole

- Fixed (LIST-ROW-NAVIGATION): `SurfaceCard kind="list"` rows already pressed as a whole row with a trailing chevron by `onPress`; a row with `href` only linked its title. An `href` row now stretches its title Link over the whole row, with the hover tint and the chevron, as an `onPress` row does. Story `Surfaces/List row navigation`; the rule is in contexts/ui/components/card.md.

## 0.37.5 - 2026-11-09 - SurfaceCard kind="select"

- Changed (owner): a Button with an icon (a primary's start icon, `endArrow`) takes HeroUI v3's own measures, read from `@heroui/styles` button.css: padding-inline px-3 (sm) and px-4 (md, lg) on BOTH sides (the glyph side was one step less: 8 on md, so the icon sat about 8px tight), gap 8, the icon 20px on a phone and 16px from 640px (16px on sm) with the vendor's -2px inline margin. HeroUI draws no 24px icon; 16/20 is its scale. Tokens `--grammar-control-padding-glyph-*` become `--grammar-button-icon-padding(-sm)`. Story `Controls/Button icon sizes` asserts the numbers.
- Added (owner): `SurfaceCard kind="select"`, the one choice list. Props `selectionMode: "single" | "multiple"`, `items: { id, title, subtitle?, isDisabled? }[]`, `value` (`string | null` for single, `string[]` for multiple), `onChange`, `ariaLabel`/`label`.
  Every row is a HeroUI Checkbox with a title (14, weight 500) and a subtitle (12, muted, drawn only under a title); the whole row is the hit target with a hover tint; 1px dividers span the full card width. `single` has the same checkbox look and
  unchecks the others (the checked row is replaced, not unchecked); ARIA is a `role="group"` of real checkboxes. Story `Surfaces/Select card`; types `SelectData` and `SelectItemData` are exported.
- Fixed (urgent): the outline glyphs of 0.37.4 handed to a vendor slot (the Select chevron, the search icon, the number steppers, the alert marks) had no size, so a chevron stretched to its slot (a giant grey X over a search row in a card header). `inlineGlyph` now gives every glyph the Icon usage box (16px at `chip`) and a 16px width and height floor. Story `Surfaces/Glyph sizing` (Select, SearchField and NumberField in a card header) asserts every svg is at most 24px.
- Added: story `Surfaces/Status tones` (the five tones side by side); the play proves a success Badge reads `--success-soft` and `--success-soft-foreground` exactly. Core maps `success` to the HeroUI success tokens and nothing else; a product that paints success lime has overridden `--success` in its own brand sheet.
- Changed (owner, FlowGraph `layout="steps"`): a port and an edge anchor are a SOLID round dot of 6px in the edge colour (no ring; the danger port stays danger); an edge that leaves a plain step shows the same dot at the card's end edge. The arrowhead is a CLOSED chevron about 8px with a rounded stroke perimeter, filled in the edge's colour, in user space so it stays crisp at any zoom. The corner tag chip is 18px high (1px more padding above and below the 16px line), 12px text. Story `PortsArrowheadsAndTag` (Flow graph steps) holds the sizes.
- Verified (owner: rows on white with no bordered card): the card edge is automatic. A list card on the pink well draws the shadow and no border; the same list in a white aside, pane, drawer, dialog or popover draws a 1px border and no shadow (SURFACE-ELEVATION, `Section kind="list"` and its `.starci-core-section-list`; a `SurfaceCard` inside a `Pane surface` is refused in development by the existing surface-in-surface law, so a white pane's rows are a `Section kind="list"`). Story `Surfaces/Surface elevation` asserts both grounds. No raw row primitive is un-exported: `DescriptionList`, `DisclosureList` and `ListBox` stay in `common` (the lane uses them in dozens of files); the new lint rule `rows-in-card` is the guard.
- Fixed (top priority, layout B): the PaneGrid did not own the height chain. A pane that holds a nested PaneGrid (an app tab pane of a chat room and an aside) was treated as a scrolling pane whose stack was `flex: 1 0 auto`, so the stack grew to the height of the whole thread: the tab pane scrolled as one block, the thread slid under the band and the room head and composer went off-screen. A pane that holds a PaneGrid now clips, its stack and the nested grid are bounded by it (`flex: 1 1 0`, `min-height: 0`), so only the thread, a list or a pane body scrolls and the page, the band, the heads and the composer never move. In a fixed workspace shell the page fill minimum (`minHeight`) no longer forces the shell to scroll. Story `ChatTab` (60 messages, a long aside list) asserts it.
- Changed: PaneGrid track `standard` (the aside) is clamp(320px, 26%, 420px) of the grid; new track `list` is clamp(280px, 24%, 360px).
- Added: FLOWGRAPH EDITOR (`steps`, stories `Flow graph editor (0.37.5)`): `background="dots"` draws xyflow's own dot Background (18px step, 1.2px dots, the muted token); `isEditable` turns on dragging the blocks (edges re-route live), `positions` (the saved centre of each moved node, a loop card's children too) overrides the auto layout for those ids, `onPositionsChange(positions)` fires on drag end with the full moved map, and an outline "Sắp xếp lại" reset control (`resetLabel`) joins the zoom group and returns `{}`; `FlowGraphNode.agent?: { name, avatar? }` draws a 16px avatar (the sprout without `avatar`) and the agent name (12px muted) under the title, and the card height estimate counts the line. New types `FlowGraphAgent`, `FlowGraphPositions` (also exported from `common`).
- Changed (owner, blocking): a `SurfaceCard` inside a `Pane surface`, a `Drawer`, a `Dialog` or a `Popover` is no longer refused. A white ground hosts cards: on it a card draws a 1px border and no shadow (SURFACE-ELEVATION, automatic from context), on the pink well a shadow and no border. Only a card inside a card still throws in development; lint R340 (`no-raised-surface-in-surface`) and the whole-program R356 (`surface-nesting`: `card-in-pane` and `card-in-overlay` removed) now judge card-in-card only. Story `Surfaces/Pane footer and white-ground cards` (CardOnWhiteGround, TableHeaderSeams).
- Added: `Pane footer`: a band fixed at the pane's bottom edge (a chat composer, an action bar); the pane body above it is the one scroll region (no visible scrollbar) and the footer never moves. Story `PaneFooter`; `NestedRowsHeightChain` proves the height chain through nested grids given `rows`, `inset="flush"` and `content`.
- Added: `SurfaceCard measure="narrow"` (30rem, start-aligned, token `--starci-core-narrow-measure`) for an order card in a chat bubble; `measure` is now a prop of every card kind (it was `body` only). Story `NarrowMeasure`.
- Fixed: the seam between SurfaceCard header zones (search, filters, body) was `--separator`, which measured 233,227,227 on the 243,238,238 table frame, nearly invisible. It is now the foreground at 14% over whatever ground it stands on (`--starci-core-zone-seam`), readable on the white card and the grey frame. Story `ZoneSeamContrast` asserts a channel distance of at least 20 on both.
- Added: `SurfaceCard kind="list" layout="keyValue"` with `ListRowData.value`: the key (`title`) is muted at the start, the value is normal text at the end (two columns from 28rem, the key at most 40%; under 22rem the value wraps under the key). Story `KeyValueRows`.
- Added: `Pane head={{ title, description?, onClose?, closeLabel? }}`, a sticky one-row head (title, muted sublabel, small close icon button) for an aside or detail pane, rendered as the first band of the stack so the head-row mode and the head height token apply; a pane with a head draws no scroll-shadow fade over it. Story `PaneHeadSlot`.
- Fixed: table columns collapsed to ONE CHARACTER PER LINE (the Knowledge table at 1440, the numeric `Tổng` column on the grey frame). A fitting table (4 columns or fewer) set `overflow-wrap: anywhere` on every cell, which makes a cell's min-content one character; it is now `break-word`. A numeric column fits its content whatever the other columns say (it was `fit` only when no column set a width), `fit` and numeric columns keep `min-inline-size: min-content`, and a cell holding a Badge, Chip or StatusDot never wraps. Story `ColumnsNeverCollapse` asserts, at 1100, 800 and 600px, that no fit or numeric cell is narrower than its text on one line or wraps.
- Changed (owner, breaking type): a `SurfaceCard` head has NO description. `CardHead.description` and the `starci-core-surface-description` line are removed; a line that explains the card's data is `note`, a line that explains a row is its subtitle (CARD-NO-DESCRIPTION).
- Changed (owner, breaking type): a `Switch` with a visible label MUST carry `description` (a union on `isLabelHidden`: only the bare control may go without). Stories updated (SWITCH-LABEL-DESCRIPTION).
- Contexts: the card owner laws (no card description, flat fields on the well, cards only for collections or distinct groups, row titles are nouns, select is the only choice list, white lists are bordered cards, header zones divided by full-width dividers) are in `contexts/ui/components/card.md`, the Switch law in `field.md`, each with an anchor id.

## 0.37.4 - 2026-11-09 - outline icons everywhere, EmptyNotice frameless by default

- Changed (owner): every icon Grammar draws itself is OUTLINE. The search field icon, the Select chevron, the number-field steppers (plus and minus), the tab and region scroll arrows, the Alert status marks (info, success, warning, danger) and the FlowGraph / BubbleMap zoom controls
  (zoom in, zoom out, fit) were the vendors' filled glyphs; they are now stroked marks of the closed glyph vocabulary (new glyphs `chevron-down`, `chevron-start`, `minus`, `info`, `success`, `warning`, `danger`; `inlineGlyph(name)` hands one to a vendor slot). The three-dot `more` glyph stays dots.
- Changed (owner): `EmptyNotice` is frameless by default (`frame="frameless"`); the card frame is opt-in (`frame="card"`). Inside a card it was already words only.
- Added (FlowGraph `steps`, the workflow editor's cards): `FlowGraphNode.chips` (`{ label, tone?: "accent" | "neutral" }`, up to 3 under the title then one "+N" pill; accent the pink soft pair, neutral the grey one, 12px); `FlowGraphNode.outputs` on every kind (an action, ask or wait may carry ports; an edge with no `sourcePort` still leaves the bottom middle) and `FlowGraphPort.tone: "danger"` for an error output (its word, dot and edges in danger); `FlowGraphNode.container` (`{ label, chips?, childIds }`), a loop card with a 1.5px primary outline and a header line, its children laid out inside as a graph of their own (edges to and from its id meet its edges); and `layout="steps"` accepts a disconnected graph (islands stacked down the page, left edges aligned), a fan-out from one node, and several entry nodes feeding one step (the roots stand side by side centred over it). Stories `Flow graph steps (0.37.4)`: `Chips`, `OutputsOnAction`, `Container`, `Islands`, `FanOutAndTwoTriggers`.

## 0.37.3 - 2026-11-09 - the head row only when every pane has a head; a pane that holds a grid is not capped

- Fixed: a tab pane (`content="cards"` by default) that holds a nested PaneGrid was capped at 80rem and centred, so on a wide screen the chat pane and its aside sat in the middle with pink bands on both sides. The cap (MEASURE-8) now applies only to the content of a pane that holds
  cards, never to a pane that holds a grid.
- Changed (owner): the shared head row and its continuous divider exist ONLY when every pane at that grid level has a head. When only some panes have heads there is no spacer and no continuous divider: each head stands alone at `--grammar-pane-head-size` with its own bottom border, and
  headless panes start at the top (no empty white bar above an aside without a head). Stories `AsideHeadOnly` and `NestedGrids` hold it; `ThreePaneWorkspace` is all heads, aligned.
- Added: TABLE COLUMN SIZING (`DataTable`, `SurfaceCard kind="table"` `TableData`). Per column `width: "fill" | "fit" | number(px)` (`fill` takes the rest with `minWidth` and `truncate`: one line, an ellipsis, the full text in a tooltip; `fit` is as wide as its content and never wraps),
  `minWidth`, `truncate`, `hideBelow: "tablet" | "desktop"` (the column leaves the table under 768 / 1280); `align` and `numeric` as before. Default when no column says: the first text column fills, numeric columns fit. Table props `resizable` (draggable
  columns by HeroUI's column resizing, remembered per `id` (default `label`) in localStorage, read and written in try/catch), and `phone: "list" | "table"` (under 768 a table of three or more columns defaults to a list: the first column the title, the others one muted line, no horizontal scroll).
  Story `TableColumnSizing`.
- Fixed: the workspace cap (MEASURE-8) was a DESCENDANT selector (`.pane[cards] .pane-stack`), so a tab pane's cap also capped every nested pane (the chat room sat in a 1280px column in the middle); it is now a child combinator, and a pane that holds a PaneGrid is never capped.
- Changed (owner): a navigation `Link variant="head"` ends in the outline arrow-right ICON (16px, currentColor, slides on hover), not the typed arrow; Button `endArrow` is the same icon.
- Changed (owner): the section head (Section and SurfaceCard label row) is ONE nowrap row of a fixed minimum height (the label truncates first); the count chip sits right after the label (SurfaceCard no longer pushes it to the far end); a count of 0 is not drawn on a section head.
- Changed: `Grid kind="cards"` stretches its cards to equal height and uses the card gap (12 phone, 24 from 48rem).
- Added: `Grid kind="cards"` takes `gap` (`card` default, the card gap 12 on a phone and 24 from 48rem; `inline` 8) and `align` (`stretch` default; `start`); the `pair` and `featured` slots stretch to the row height and what they hold fills the slot.
- Added: `Section fill` (a cell of a stretched grid): the section fills the height its host gives it and its body takes what the head and caption leave, so `SurfaceCard height="fill"` and `DataTable fill` fill it. A Section without it keeps its own height.
- Added: `DataTable fill`: the white body grows to the frame's foot and the footer sticks to the bottom. Story `EqualHeightRow`.
- Changed: the section head is a FIXED height row (`--grammar-section-head-size`, 2rem; was a touch-size minimum), so the 20px label row and the 32px info `IconButton` both fit and no head differs in height.

## 0.37.37 - 2026-11-11

- Changed: the family moves with `@starci/eslint-grammar-core`, which peers `@starci/hfs ~6.8.0`; no component changed.

## 0.37.2 - 2026-11-09 - the shared head row reaches nested grids

- Fixed: the shared head row of a workspace page (0.37.0) only reached the panes of the page's own grid, so an app that nests grids (a tab pane holding a grid of a main and an aside, whose main holds a list and a thread) got no continuous
  line: the list kept its own divider, a pane with no head had none, the aside's head had none. The row is now the top of the page's outer PaneGrid and reaches every pane that stands at the top of it at any depth; a head is the first
  band of a pane's stack that is not under another band, a pane that holds a PaneGrid is neither a head nor a spacer, and a leaf pane with no head (a thread with no conversation open) keeps the row. A page with no head anywhere still has no row.
  Story `NestedGrids` holds it.

## 0.37.1 - 2026-11-09 - the shared head row exists only when a pane has a head

- Fixed (regression of 0.37.0): a workspace grid in which NO pane has a head drew the shared head row anyway (a blank band of about 137px under the page sub-tabs on every agent workbench page, a divider through the content). The row and its divider
  exist only when at least one pane of the grid has a head; a grid with no head is as before 0.37.0. When only some panes have heads, the headless ones keep the row height for alignment and nothing is drawn above the page band.
  Stories `AsideHeadOnly` and `NoHeads` (Compositions/App shell workspace) hold both cases.

## 0.37.0 - 2026-11-09 - state priority and natural edges in FlowGraph, one head row in layout B

- Changed (default): FLOWGRAPH STATE PRIORITY (owner; `layout="steps"` run overlay). The card border is always the neutral card border, whatever the run status: the coloured status ring is gone. The run status is shown only by the
  small outline status icon and its word on the card's top-start edge (check-circle success, spinner running, x-circle danger, clock waiting, minus-circle skipped; the word comes from `statusLabels`). A skipped node is faded. A selected
  node has exactly one 2px primary outline and no other ring. The wait kind keeps its dashed border only in the design view (no run status shown). A taken edge is a solid strong-text line (was the accent), an untaken edge a dashed
  light-neutral line, a back edge stays dashed with its pill.
- Changed (default): NATURAL EDGES. Steps edges are smooth curves of 1.5px; the arrowhead is a thin open chevron of about 6px with a 1.5px stroke (was a filled 16px triangle); a back edge turns with 12px corners (was 8). Edges meet the middle of the
  card's top or bottom edge and a condition's edges leave its port dot.
- Changed (default): ONE HEAD ROW IN LAYOUT B. In a workspace page (`layout="workspace"`) the panes of the top grid share one head row: every pane head is the same height (`--grammar-pane-head-size`), white, with no divider of its own, and the grid
  draws ONE continuous divider under the row across all panes, crossing the vertical pane dividers. A pane with no head keeps the row (white above the line, its content starts below it). A pane head is ALWAYS white: the aside head no longer draws
  the canvas (pink) colour inside the white aside. A nested PaneGrid keeps its own heads.
- Added: stories `Compositions/App shell workspace` (the top bar, the sidebar and a three-pane workspace page in a fixed shell) and a run overlay with a selected done card and a wait card.
- Released with the Grammar family at 0.37.0 (`eslint-grammar-core`, `eslint-grammar-offset-pop`: no rule changed).

## 0.36.2 - 2026-11-09 - a Switch has no border

- Fixed (regression of 0.36.0): the sticky page band no longer leaves a ~64px strip above it. Its offset was the top bar's height (`top: --starci-core-band-height`) even in a fixed shell, where the bar is outside the scroller, so the band was pushed
  down 64px at scroll 0 and overlapped the first section. The band is `top: 0` and takes the bar's height only when the document scrolls under a sticky bar (no fixed shell).
- Changed (default): `Section fact` is the same 12px grey chip as `count` (it drew "Label · fact" text, which is banned); use `count` for numbers.
- Added: `Grid kind="cards" columns={5}` and `columns="balanced"`: the cap follows the number of cards so the last row is never one orphan (5 or 6 cards cap at 3, 7 or 8 at 4, up to 4 at their own count). Export `balancedColumns`.
- Added: `EmptyNotice actionHref`: a navigation action drawn as a `Link variant="head"` ("Về tổng quan →") instead of a Button; `actionLabel` is its label. A command (`onAction`) stays a Button.
- Changed (types): `FileButton source` is optional when `text` is given: the text form is a neutral `sm` Button with the word alone and no start icon (the button-icon law: an icon only on a primary md or lg Button, never on sm);
  the glyph-only form still requires `source`.
- Changed (default): FlowGraph `layout="steps"` fits its pane (0.36.2). A top-down graph fits the pane width with a 16px margin on first render; if the cards would fall below 0.75 it holds 0.75, starts at the trigger (the
  topmost card, centred when it can be) and the reader pans. The canvas height follows the graph at that scale, so no empty band stands above it. A condition's ports size to their label and never wrap: past 16 characters a label is
  cut with an ellipsis and a tooltip (`title`) reads it in full, and the cards of the graph widen (one width, up to 360) when the ports need it (`StepsLayout.cardWidth`, `stepsCardWidth`). The default kind tones (event accent,
  action success, condition warning, ask danger, wait neutral, end success) apply unless `kindTones` declares one; an entry left undefined no longer wipes a default.
- Changed (default): A SWITCH HAS NO BORDER (owner). Every Grammar `Switch`, the header light/dark theme toggle (`size="control"`) and form switches alike, takes HeroUI's native look: a light grey track (`--default`) with no outline, hairline or
  ring (the 1.5px inset border of the off track is removed), the primary colour (the accent) when on, and a white thumb (`--surface`) with the soft card shadow in both states. The vendor focus ring stays for keyboard focus
  (`:focus-visible`) only. No API change.

## 0.36.1 - 2026-11-09 - the status dot is a hollow ring

- Changed (default): `StatusDot`, the dot of `Badge isDot` and the avatar presence mark are a HOLLOW RING (owner, ICONS-OUTLINE): 8px (`--starci-core-status-dot-size: 0.5rem`, was 6px) with a 1.5px stroke (`--grammar-stroke-fine`) in the tone
  colour and a transparent centre, so it reads next to 12px badge text. No filled status dot remains. The echo ring of a live dot is unchanged. `prove-theme` now holds the ring's `border-top-color`. No API change.
- Changed: the FlowGraph run-overlay status icons are 20px (were 12px) outline glyphs on the card ground (no tint) so they read at the card corner.
- Released with the 0.36.0 content (the family is unchanged otherwise); `eslint-grammar-core` and `eslint-grammar-offset-pop` 0.36.1 change no rule.

## 0.36.0 - 2026-11-09 - HeroUI table look, the one-row section head, the scroll law, the pane measure, tab count chips

- Changed (default): THE TABLE IS HEROUI v3's NATIVE LOOK (owner). A standalone `DataTable` (`surface="card"`, the default) is the card itself: the vendor's primary root, a grey frame
  (`--surface-secondary`) at the new table radius (`--starci-core-table-radius`, 16) with the soft card shadow and NO border, the heading row on the grey (12, weight 500, muted), thin grey
  gutters either side of a WHITE rounded body (`--starci-core-table-body-radius`, 12) whose rows are divided by hairlines. The wrapper card (`starci-core-data-table-card`, white, a
  1px separator edge) and its `data-grammar-table-card` attribute are removed: no border and no double wrap. Column `align` / `isNumeric` keep right-aligning numbers.
- Added: `DataTable footer` (a `ReactNode` slot): drawn inside the grey frame under the white body; pass a `Pagination` with its `summary` ("1-4 trong 8 ket qua") and the summary stands at the
  start and the pages at the end. Hidden while the table loads or fails.
- Added: `DataTable surface="frame"`: the same grey frame and white body with no radius, shadow or edge of its own, for a host that is the card. `surface="none"` keeps the plain hairline rows.
- Changed (default): `SurfaceCard kind="table"` is the grey frame too (no border, the table drawn as `surface="frame"`); its `paging` footer zone stands in the grey with no seam, the summary at the start. API unchanged.
- Changed (default): a table's heading row is 12 (it was 14); cells stay 14.
- Changed (default): A SECTION HEAD IS ONE ROW (owner). At the start the label (14, weight 500; it was 18 / 600 for h2 only in the title scale) and an optional count chip (12, a pill on `--default`; it was a muted "(n)"); at the end
  at most ONE thing: a navigation `Link variant="head"` or an info `IconButton`. `align-items` is centred. `description` is no longer drawn under the label: it is drawn as a caption (12, muted) BELOW the section's body,
  before `caption` when both are given (the prop keeps its name). `caption` is 12 now (it was 14). `fact` and `meta` still draw (deprecated: a head holds one thing at its end).
- Added: `Link variant="inline" | "head"` (type `LinkVariant`). `head` ends in an arrow `\→` that slides about 3px toward the end on hover and focus (`--grammar-link-arrow-travel`, mirrored in RTL, still under reduced motion); the
  hover underline and the inherited size are the Link's own. `inline` (default) keeps the anchor icon.
- Changed (default): THE SCROLL LAW. The sidebar and the page header band (breadcrumbs, title, tabs, sub-tabs) never scroll away: `Page`'s band and trail are sticky at the top of whatever scrolls
  (`top: --starci-core-band-height`). Layout A (report): the pink well scrolls as one block under the band. Layout B (`chrome="panes"` / `"bleed"`): the page does not scroll (the fill box clips); each
  pane scrolls on its own with no scrollbar and its head (a header band or a PaneHeader band) sticky, and a pane holding a scroll band (a chat thread, `PaneSection scroll`) keeps its head and composer fixed
  while only the thread scrolls.
- Changed (default): MEASURE-8 CORRECTED. The 80rem cap no longer caps the pane stack of every canvas pane: the grid and its side panes span the full width (the aside is flush to the end edge) and only the CONTENT of a pane
  that holds cards is capped and centred inside that pane.
- Added: `Pane content="cards" | "full"` (type `PaneContent`). `cards` (the default for a pane on the canvas): content capped at `--grammar-content-max` and centred in the pane. `full`: never capped (the default for a pane
  on the surface). A pane that holds a chat thread (`PaneSection scroll role="log"`) or a `FlowGraph` is full unless it says `content="cards"`. `data-grammar-pane-content` exposes it.
- Changed (default): a list in the white side pane (the aside) is a bordered list with no shadow, and so is a table frame there; the section-head rules apply in it unchanged.
- Changed (default): TAB COUNTS ARE CHIPS (owner). The chip is 12 and grey always, selected or not ("All 5" no longer renders pink); it is pink (the accent soft pair) only for `isAttention`, work waiting for the owner
  (it was the warning pair). Page tabs (layers 1 and 2, the `views` kind) hide the chip when `count` is 0; filter tabs keep a grey 0.
- Changed (default): ONE CONTENT PER CARD, SURFACE ELEVATION FROM CONTEXT (owner). A `SurfaceCard` holds one content (a list, an input group, a table, a graph or a figures ribbon, with its own tab, search or pagination zones or a form
  footer); several groups are several cards with a `Sublabel` above each. A card on the pink well has the card shadow and NO border (it had both); a surface on a white surface (a `Pane surface`, the aside, a `Drawer`, `Dialog`
  or `Popover`) has the 1px separator border and no shadow. The same holds for the bordered list frame (`Section kind="list"`) and a framed `EmptyNotice`. Automatic from context: an app never chooses.
- Changed (default): a `FlowGraph` inside a surface draws no frame of its own (`data-grammar-flow-framed="false"`: no edge, radius or ground) and no legend. New export `FlowGraphLegend` (`items`, `kindTones?`): the legend stands
  under the card as chips, `<SurfaceCard note={<FlowGraphLegend items={...} />}>`. On the page the FlowGraph is framed and draws its own legend as before.
- Changed (default): ICONS ARE OUTLINE ONLY (owner). Grammar's own icons import from `@heroicons/react/24/outline` (no 16/20 solid anywhere). A STATUS is a tone-coloured outline icon with no tile: the FlowGraph run overlay
  draws outline check-circle (success), x-circle (danger), a spinning arrow (running, off under reduced motion), clock (warning) and minus-circle (skipped) at the card's corner with no disc, no ring and no fill; the
  Stepper markers and the accordion step marks are outline rings in their tone (complete success, current accent, error danger, paused warning dashed, upcoming a hairline ring) instead of filled discs. An icon that stands alone
  as the mark of a row, card, empty state or graph step keeps the icon tile (a soft-tone square holding an outline icon: `ListRow` leading, `EmptyNotice`, FlowGraph kinds); an icon inline with text is plain. `StatusDot` became a hollow ring in 0.36.1. Apps: replace any solid icon import with the outline name.
- Added: `count` and `isAttention` on the head of `SurfaceCard` (`CardHead`) and `isAttention` on `Section`: the 12px count chip stands right after the label (grey, pink only with `isAttention`) and coexists with `labelEnd`
  (one head `Link variant="head"` or `IconButton`) at the end, so a head shows label + chip on the left and one Link on the right. `fact` still draws beside them.
- Lint: `eslint-grammar-core` 0.36.0 adds `outline-icons-only`, `card-one-content`, `no-label-description`, `section-head-action` (`FE_SECTION_HEAD_ACTION`: a Button in a Section head `action`, or more than one command, is an error) and `tab-count-chip` (`FE_TAB_COUNT_CHIP`: a tab
  label ending in a middle dot and a number is an error).
- Migration for apps: (1) a `Section action={<Button>}` becomes `action={<Link variant="head" href>}` (navigation) or an `IconButton` (info); keep one. (2) `Section description` now reads under the body: shorten it to a caption; no
  call changes. (3) A table wrapped in a bordered card by the app: drop the wrapper, the table is the card. (4) Paginated tables: pass `footer={<Pagination summary=... />}` instead of a Pagination under the table. (5) A `Pane` that
  holds a chat, a graph or an editor needs nothing (full by default); a canvas pane of cards needs nothing; set `content="full"` for an editor on the canvas. (6) Tab labels "All \· 5" become `{ label: "All", count: 5 }`; add
  `isAttention` only for the owner's waiting work. (7) Counts of 0 on page tabs disappear. (8) A card with a list and a details list becomes two cards with a `Sublabel` each; a `Section description` becomes `caption` and a card label `description` becomes `note` (both are lint errors); a FlowGraph legend in a card moves to `note={<FlowGraphLegend />}`. (9) Drop any app CSS that gave a card a border or a shadow: the Grammar decides from context.

## 0.35.0 - 2026-11-09 - FlowGraph steps: the owner-approved card map

- Added: `FlowGraph layout="steps"`, the card map of a workflow (owner, 2026-11-09). Top-down by default, `direction="LR"` runs across; the canvas is the
  well (`--background`) with no grid, as tall as the graph (`height` overrides), never magnified; a graph wider than its pane at the 12px floor pans.
  A step is a white card (`--surface`, `--border`, 196 wide, 14 corners at `--radius` 0.5rem) with a 32 icon tile (9 corners) in its kind's soft pair,
  the title 14 medium and one muted 12 line, an optional corner `tag` pill (12). Padding is 8 / 12: the drawing's 10 is off the spacing scale.
- Added: node `kind` takes the steps kinds `event | action | condition | ask | wait | end` (`FlowGraphStepKind`; the lanes kinds are `FlowGraphLanesKind`
  and map on: trigger → event, execute → action, output → end). Tones: Core's palette is HeroUI's, which has no purple, teal or coral, so
  event → accent, action → success, condition → warning, ask → danger, wait → neutral (dashed card), end → success (`STEP_KIND_TONES`); an app
  that declares its own tones passes `kindTones={{ event: "violet", ... }}`. A node `tone` still overrides its kind.
- Added: node `icon` (`IconSource | ReactNode`; the kind's glyph when left out), `tag`, `outputs` (`FlowGraphPort[]`, a condition's named ports
  along its bottom, split by hairlines, each with a port dot; left out, the labels of its outgoing edges) and `status` (`FlowGraphRunStatus`).
- Added: edge `sourcePort` (the port it leaves; a branch label lives on the port, not the line), `variant: "forward" | "back" | "return"` (a back
  edge is dashed and routed round the cards through the gap under its source's layer; several into one card nest without crossing; its
  `label` is a pill) and `isTaken` (the run overlay: taken solid in the accent, the rest neutral, dashed and faded).
- Added: the run overlay: a status ring and corner badge per card (done success, running accent, waiting warning, failed danger), a skipped
  card faded (`--grammar-opacity-faded`, 0.45). `statusLabels` gives the status words of the accessible names (English by default).
- Added: `onNodePress(id)` (click, Enter or Space; `onSelect` unchanged), the accent outline on the selected card, `legend` (`FlowGraphLegendItem[]`,
  a row of kinds under the canvas), and `stepsLayout` / `STEP_KIND_TONES` exports.
- Added: ramps `--grammar-flow-card-width`, `--grammar-flow-card-radius`, `--grammar-flow-tile-size`, `--grammar-flow-tile-radius`,
  `--grammar-flow-port-dot`, `--grammar-flow-status-size`, `--grammar-flow-status-glyph`, `--grammar-flow-swatch-size`, `--grammar-opacity-faded`.
- Kept: `layout="lanes"` and every other layout draw as before; no caller changes. Migration to the card map: `layout="lanes"` → `layout="steps"`;
  kinds map on as above; a condition's labelled edges become its ports with no change (or pass `outputs` + `sourcePort`); a run canvas moves its
  per-status `tone` to node `status` and its `isPlaceholder` untaken edges to `isTaken: false`; `headers` are not drawn in `steps`.

## 0.34.0 - 2026-11-09 - sm Button without icon, chat composer, flush-left page, Sublabel, Link look

- Changed (types): a `sm` Button never carries an icon, not even the primary (owner, 2026-11-09): the primary variant of the Button type takes
  `size` `md` or `lg` only. `Alert` and `EmptyNotice` draw an iconed primary action at `md`. Lint `button-icon-primary-only` also refuses `size="sm"`.
- Added: THE CHAT COMPOSER. A `Textarea` with `onSubmitShortcut` starts at 2 lines (4rem, about 64px), grows with its text up to 6 lines, then scrolls with no bar;
  `Textarea send={{ label, onPress, isDisabled?, isPending? }}` draws the send button inside the box at its bottom end. Constants `COMPOSER_MIN_ROWS`, `COMPOSER_MAX_ROWS`.
- Changed (default): BAND LEFT, WELL CENTRED (MEASURE-8). The page header band is full width and its text starts at the page inset, flush left (the band's `PageContainer` is
  never capped or centred); the content in the pink well is capped at `--grammar-content-max` (80rem) and centred. The page body keeps its centred measure.
- Added: `Sublabel` (leaf, `children: string`, `id?`): the group label above a card inside a section, 12, weight 500, muted.
- Changed (default): `Link` is HeroUI v3's own link: the primary colour, the underline on hover only, the anchor icon (`Link.Icon`) at the end of a text label, and
  no size. The `size` prop, the `LinkSize` type and the `externalIcon` prop are removed; the type size and leading are inherited from the line (14 in a body, 12 in
  meta). `.grammar-common-root` sets the base type to the UI step (14), so a Link outside any sized text no longer renders 16.
- Documented: the second tab layer is `Page header.subTabs`, in the white header band, on its own full-width separator, flush with the band's left inset. Lint `tabs-in-well`.
- Added: `EmptyNotice frame="frameless"`; `Select appearance="compact"` (32 pill); `PaneDrawerOpener` (`pane`, `icon`, `label`), the drawer opener for any place in a PaneGrid;
  the Stepper's horizontal labels are cut with an ellipsis instead of wrapping; the generated avatar initials are set at 40% of the mark so two capitals stay inside the circle.
- Lint: `eslint-grammar-core` 0.34.0 adds `tabs-in-well` (`FE_TABS_IN_WELL`) and `link-look` (`FE_LINK_LOOK`), and extends `button-icon-primary-only` to `size="sm"`.
- Changed (default): in a workspace page the main pane (the one on the canvas) caps its content at `--grammar-content-max` (80rem), centred in the well; the ground fills the whole well, side panes and the header band are not capped. `check:type` pins it.
- Changed (default): NO IMAGE MEANS SPROUTS. An `Avatar` (and every avatar of an `AvatarGroup`) with no `src` draws a DiceBear Sprouts image seeded by `seed` (else `name`),
  for a person, an agent, a product or a shop alike: drawn locally with `@dicebear/styles/sprouts.json` (already in 10.4.0), cached per seed, the same seed always the same image,
  clipped by the avatar's shape. New `Avatar fallbackMark="sprout" | "initials"` (default `sprout`; `initials` is the explicit opt-in), `AvatarSproutImage`, `avatarSproutUri`.
  `check:avatar` pins it. The group's `+n` count mark keeps its letters.
- Changed (types): `ListRowData.description` accepts a `ReactNode`; a node is drawn at 12, muted, directly under the name at the identity gap (`data-grammar-description-rich`).
- Added: rule id `MEASURE-8`.

## 0.33.0 - 2026-11-09 - no scrollbars; layout and responsive laws; only the primary Button carries an icon

- Changed (default): NIVO NEVER SHOWS SCROLLBARS (owner, 2026-11-09, OVERFLOW-6). The family root no longer hands the scrollbar to the app's
  `--scrollbar*` tokens: every scroller under `.grammar-common-root` hides its bar (`scrollbar-width: none`, `::-webkit-scrollbar` none), which
  covers the ScrollShadow hosts (PaneGrid panes, `PaneSection scroll`, the Drawer pane, the chat thread, the tab strip, Board, ScheduleGrid) whose
  hidden bar the old rule had overridden. Wheel, touch and keyboard scrolling are unchanged.
- Added: the edge fade on the scrollers that are not ScrollShadow hosts (overlay body, popover, DataTable scroll, code block, markdown table, rail
  body, sidebar list, terminal log, filter list, mention list, breadcrumbs, top bar, scrolling nav): a CSS mask whose end sizes follow the scroll position
  (scroll-driven animation; no fade where nothing overflows, none on the edge already reached; right to left mirrored).
- Added: `Drawer bodyInset="content" | "none"` (default `content`). `none` runs the body edge to edge across the sheet (and to the bottom edge when no
  footer follows), so a chat well fills the drawer; `data-grammar-body-inset="none"`.
- Fixed: `VerticalScrollRegion tone="background"` no longer paints its tone under its own edge mask (white bands at the top and bottom of a chat thread): the
  mask is off there and two sticky overlays in the tone fade only the content into it. The public API is unchanged.
- Added: rule id `OVERFLOW-6` (contexts/ui/presentation.md).
- Lint: `eslint-grammar-core` 0.33.0 adds `no-raw-scroll` (`FE_NO_RAW_SCROLL`, error).
- Changed (types): THE BUTTON-ICON RULE (owner, 2026-11-09). `startGlyph` and `startContent` are allowed only on the primary Button
  (`intent="commit"`, the CTA); the Button type is a discriminated union on `intent`, so a neutral, alternative, dismiss or destructive
  Button, or one with no intent, no longer compiles with a start icon. Suggestion pills and row actions are text only. The arrow is not an
  icon under this rule: any intent may set `endArrow` (still never together with a start icon). `IconButton` is unaffected.
- Changed: `EmptyNotice` takes `actionStartContent` only with the default `commit` action (`actionIntent: "neutral"` is text only);
  `Alert` draws `action.icon` on its primary (informative, `commit`) action only; `FileButton` with a `text` label is text only (its
  icon-only form is the `IconButton`).
- Changed: the stories and the app-guide template no longer give a neutral or alternative Button a start icon.
- Lint: `eslint-grammar-core` 0.33.0 adds `button-icon-primary-only` (`FE_BUTTON_ICON_PRIMARY_ONLY`, error).
- Added: `Page layout: "report" | "workspace"` (the frame type; derived from `chrome` when omitted, `PAGE_LAYOUT_CHROME_MISMATCH` when it
  disagrees), `data-grammar-page-layout`, and the story `Compositions/Page layouts`.
- Changed (default): THE RESPONSIVE LAW (owner, 2026-11-09). The page inset steps 32 / 24 / 16 at the 1280 / 768 breakpoints (the desktop
  step moved from 1120 to 1280; the phone step stays 12 because the spacing scale 0 4 8 12 24 32 has no 16: the owner asked for 16, a scale step to add);
  `--grammar-card-gap` is 24, 12 on a phone (same reason). The tiers of every page piece
  (figures, equal cards, DataTable, tabs, workspace aside and panes, sidebar, pinned action, FlowGraph) are in `contexts/ui/composition.md`
  RESPONSIVE-5; `check:type` pins the insets.
- Changed (default): the figures ribbon of five cells (`SurfaceCard kind="figures"`, a figures zone, in a card or a pane) answers its own
  width: two columns below 30rem with an odd last cell across its row (2 + 2 + 1), three columns from 30rem (3 + 2, two balanced rows),
  one row from 52rem. The cell keeps its label (14 muted, at most two lines, wrapping between words), value (20) and meta (now 12).
  Lines stay the edge lines of the grid (vertical between a row's cells, horizontal between rows, none doubled). Story `FiguresRibbonFive`
  (390 / 700 / 1000); `check:type` pins the rules.
- Documented: THE LAYOUT LAW (owner, 2026-11-09). A page is a report (`Page chrome="standard"`: the pink well, cards stacked in one vertical
  column 8 apart, side by side only for sibling cards of one role and height) or a workspace (`chrome="panes"` / `"bleed"`: panes split
  by dividers, side panes white surfaces at full height, never cards, a pink well allowed in the main pane). `Page chrome` is the
  declaration, so no new prop; one frame type per page. Lint `layout-two-axis` (`eslint-grammar-core` 0.33.0) refuses a card beside a
  column of cards and unequal cards in a row.

## 0.32.1 - 2026-11-09

- Fixed: MessageCard (a composite) no longer imports the Cluster frame, which the tier law refuses (FE_GRAMMAR_TIER_DIRECTION); its actions stand in its own wrapping row (`starci-core-message-card-actions`, a labelled group at the inline gap).

## 0.32.0 - 2026-11-09 - every surface on the page ground is a card; Messenger bubbles; reactions

- Changed (default): THE CARD LAW (owner, 2026-11-09). `SurfaceCard` of every kind (and the form panels) draws a 1px `--separator`
  border at the card radius with the card shadow (`--surface-shadow`); the standalone `DataTable` card, the `Section kind="list"`
  frame and a framed `EmptyNotice` on the page ground draw the same edge and now the same shadow. A surface nested in a card,
  pane, drawer, dialog or popover keeps the border and drops the shadow, so nothing is doubled. CSS only, no prop. Offset Pop keeps its
  ink outline. `check:type` pins the border, the shadow and the nested rule.
- Changed (default): a standalone DataTable sits in a card and keeps HeroUI's native look: the whole table is wrapped in
  `.starci-core-data-table-card` (white, card radius, 1px separator border, card shadow) and the table is HeroUI's `primary` variant
  inside it (the grey wrapper with the header row, the rows on a white rounded body). This reverts the 0.29 flat single frame. `surface="none"`
  (full-bleed in a `SurfaceCard`) is unchanged; a card wrapper nested in a surface drops its shadow. The `single-child-card` lint and docs
  now say the lone table is drawn as its own card.
- Added: `MessageBubble groupPosition: "single" | "first" | "middle" | "last"` (also on `MessageCard`): Messenger grouping. A lone bubble is
  fully rounded (18); where two bubbles of one sender touch the corner is squared (4): first squares the bottom corner on the sender's side,
  middle both, last the top. Logical corners, so RTL mirrors. The avatar sits beside the last bubble (bottom-aligned), earlier bubbles keep an
  avatar-width spacer, and the author line shows on single and first only. Outgoing bubbles mirror it on the end side and keep the brand fill.
- Changed (default): an incoming bubble and a MessageCard are lifted like a card (1px separator border and the card shadow).
- Added: reactions (the app persists): `MessageBubble` and `MessageCard` take `reactions: { emoji, count, mine: boolean | number }[]`, `onReact(emoji)`,
  `onReply()`, `onShare()` and `reactionLabels` (Vietnamese by default). The hover or long-press toolbar (`role="toolbar"`, labelled, arrow keys,
  Home and End; the six emoji, reply, share; a hovered emoji scales up), the pill on the bubble's bottom corner (end corner of an incoming
  bubble, start corner of an outgoing one; up to three emoji and the total; pressing it adds one more of the viewer's top reaction, so a person
  may tap many times; accessible name such as "❤️ 5, bạn đã thả 2") and the burst (a floating emoji, about 1s, transform and opacity only, none
  under `prefers-reduced-motion`, several taps spawn several). Stories `BubbleGrouping`, `Reactions`; `check:type` pins the corners and the parts.
- Changed (default): the composer band (a `PaneSection as="footer"` or `rule="start"`) puts the row gap (12) between its divider and the first row
  and between its rows.
- Fixed: a ListBox row shows no focus ring after a mouse press (selection is the fill alone); the ring shows on keyboard focus only.
- Fixed: the head band separator (0.31.0) now applies when the scroll band is any later sibling of the head, not only the next one
  (a team chat head followed by other bands).

## 0.31.0 - 2026-11-09 - the final type scale; chat parts; spotlight

- Changed (values): THE FINAL TYPE SCALE (owner, 2026-11-09; it replaces the 0.28 type roles). 14 for all UI text: body,
  labels, section and card titles (16 before), row titles, tabs (13 before), buttons, links (the Section action too), inputs,
  descriptions, captions, hints, zone text (13 before) and the figure labels and meta. 12 only for small names (meta lines,
  badges, chips, counts, timestamps, breadcrumb separators). No 13 anywhere: `--grammar-text-sm` and `Text size="sm"` are 14
  (`sm` stays as a name and equals `md`). Hierarchy by weight and tone only: titles semibold (page, section and card
  titles, Heading levels 1-3; the card or section `h3` label was 16 / 500, now 14 / 600), row and selected names 500,
  secondary text muted. Display sizes: the page title 18 and a big figure value 20 (`Text size="figure"` and the figures
  value, 30 before); `titleScale="title"`, `Heading scale="title" | "display"` and Markdown headings keep their display
  scale. Every tab is 14 and 40 high (filter tabs were 32) with one selected weight, 500 over the underline (page tabs
  were 600). A DataTable header is 14 / 500 muted (12 before). `TextAction size="md"` is 14 (16 before). `check:type`
  pins it: no 0.8125rem, `--grammar-text-sm` at 14, every tab rule at 14.
- Changed (default): a `Tabs` strip that ends a `PaneSection` (its last child; not the pill switch) is hosted by the band: the band's
  bottom edge is the one full-width `--separator` line (through the pane inset), the strip's own short line is not drawn, no padding
  stands under it, and the pane drawn next to a band that ends its pane loses its block-start border, so the line is never doubled.
  CSS on the band (`:has`), no new prop.
- Changed (default): the head band of a chat or list pane (a `PaneSection as="header"`, or one holding a `PaneHeader`, standing above a
  `scroll` band) ends in one full-width `--separator` line, its block-end padding equal to its block-start inset.
- Added: `MessageCard` (composite): an agent's rich message as data, `{ author?, avatar?, title, chip?, body? | details?: DescriptionListItem[],
  actions?: { id, label, kind?: "primary" | "neutral" | "open", onPress? | href? }[], meta?, measure?, id? }`. Order: title and chip, body or a
  compact key/value list, the actions row (primary first, an `open` action with the end arrow last), the meta line at xs muted. It renders
  `MessageBubble content="card"`, so it is capped at the bubble measure (`standard`, or `wide` 70%) with the avatar at the start.
  `MessageBubble content="text" | "card"` (default `text`): the body is a structured card on the surface card face. Stories
  `Navigation & Data/Chat parts/MessageCards`, `PaneTabsLine`, `ChatPaneHeadLine`, `EmptyNoticeInThread`.
- Changed (default): an `EmptyNotice` inside a thread (a `PaneSection scroll role="log"` band, or a content stack holding `MessageBubble`s)
  draws no card surface: no fill, border, radius or shadow. Detected by context in CSS, no prop.
- Added: `Spotlight` (`@starci/grammar/common`, outside the registry): `<Spotlight isActive onEnd shape isBlock>{target}</Spotlight>`,
  the Grammar "look here" in place of outline utilities in an app. An accent ring plus a soft `--accent-soft` pulse for the new ramp
  step `--grammar-spotlight-duration` (3s), then no ring and `onEnd`; reduced motion keeps a static ring for the same time. It takes no
  layout space; `shape` is `rounded | pill | circle`. Story `Navigation & Data/Spotlight/SpotlightStates`.
- Added: `AvatarButton size="floating"` (56px, new ramp step `--grammar-avatar-floating-size`, overlay shadow) and `status={{ tone, label }}`:
  a StatusDot badge at the top end corner on a surface ring, its `label` the button's accessible description. Story
  `Navigation & Data/Spotlight/AvatarButtonFloating`.

## 0.30.0 - 2026-11-09 - one Button radius; Sparkline, BarChart value axis, figure trend, row chevron

- Changed (values): one Button radius in Core: every size, sm included, is a pill (`--starci-core-pill-radius`, HeroUI's
  full radius). Before, the vendor corner followed the app's `--radius`, so `Button size="sm"` drew about 12px while md read
  as a pill. A row of neutral sm Buttons is the one suggestion pattern (below).
- Withdrawn before release: `SuggestionChips` (and its ramp step `--grammar-chip-height`). The owner keeps ONE suggestion
  pattern: a quick reply, a suggested question or an empty state's shortcut is a `Cluster` of neutral `Button size="sm"`,
  a pill like every Button. Lint `suggestion-buttons` refuses a Chip, ChoiceChips, TagGroup or Link row used that way.
- Added: `Sparkline` (composite, `@starci/grammar/common`): a tiny inline line chart, 96 x 32 (new ramp steps `--grammar-sparkline-width`
  and `--grammar-sparkline-height`), one accent stroke (the fine stroke step), a soft fill under it, no axis. Props `label` (required;
  the line is `role="img"` with this name), `values` (oldest first; fewer than two draw a flat muted baseline), `isLoading` (a
  skeleton of the same box). Story `Navigation & Data/Data views/SparklineStates`.
- Added: `BarChart valueAxis={{ format }}`: three ticks (the largest value, its half and 0, through `format`) at the start of the
  plot with light separator grid lines behind the bars; decorative (the list of values stays the accessible content). And
  `BarChart highlightLast`: the last bar in the accent, the others in `--accent-soft`. Both default off, as before.
- Added: `Figure.trend` (`up | down | flat`), `trendSense` (`higher-is-better` default | `lower-is-better`) and `trendLabel`: the
  meta line starts with a decorative triangle (up/down) or dash (flat) in the success or danger colour, the text stays muted, and
  the direction is also said in words (visually hidden, default "Up", "Down", "No change"; `trendLabel` replaces them).
- Added: `Figure.trendLine` (`readonly number[]`) and `trendLineLabel`: a Sparkline under the figure's value and meta, at the
  start of the cell.
- Added: glyph `chevron-end` in `GLYPH_NAMES` (mirrored in RTL).
- Changed (default): a pressable row (`ListRow` / `Section kind="list"` / `SurfaceCard kind="list"` with `onPress` or `href`) now
  ends in a muted `chevron-end`, decorative, after its fact and badges. A row with its own `action`, `menu` or `control`, and a
  row that is not pressable, draw none. Loading rows keep the chevron's space. Story `Surfaces/PressableRowChevron`.

## 0.29.0 - 2026-11-09 - the single-child card; zone text at sm

- Changed: the single-child-card law (owner, 2026-11-09). A table, list or chart standing alone IS the surface, never a card
  around it. A standalone `DataTable` (`surface="card"`, the default) draws ONE frame: a 1px separator edge, the card
  radius, the surface ground, clipped, its heading row inside it (muted, a hairline under it); before, it drew the vendor's
  grey band with an inner white rounded body, three layers inside a card. Inside a card it stays full bleed
  (`surface="none"`). Every `Section kind="list"` draws the same one frame wherever it stands (on the page ground too).
  Lint `single-child-card` refuses a SurfaceCard around a lone table, list or chart without zones.
- Added: `Section caption`: one muted sm line under the section's body (a lone table's period or source). Story
  `Navigation & Data/Lone table in section`.
- Changed: a card or board zone speaks at sm 13: every `Text` in a header or footer zone (a selection bar's count, a
  filter caption, a toolbar note, a hint) takes the sm step, whatever size it names; a figures zone keeps its steps.

## 0.28.0 - 2026-11-09 - the owner laws: proximity, surface in surface, the Field rule, type roles, links and buttons, tabs

- Added: `MessageBubble actionsPlacement="floating" | "inline"` (default `floating`): `inline` draws the actions as a bare
  hover and focus-within toolbar in the message row, on the reading end of the bubble, with no border, fill or shadow.
- Added: `MessageBubble measure="standard" | "wide"` (default `standard`, unchanged `min(40rem, 85%)`): `wide` lets a bubble
  reach 70% of its row. New ramp steps `--grammar-bubble-measure-standard` and `--grammar-bubble-measure-wide`.
- Added: group rooms: stories and docs for an `AvatarGroup layout="grid"` as `ListBoxItem.leading` (sized to the row) and as
  `PaneHeader mark` (`Pane header/GroupRoomHead`, `PanelList/GroupRoomRows`); no prop change, both slots already take nodes.

- Changed (values): THE FIELD RULE (owner, 2026-11-09), one spacing contract for every control: label to control 8 (was
  4 on Select and every root that kept the vendor gap, 4 on ChoiceChips, 8 on the rest, and up to 24 to the first option
  of a Checkbox or Radio group through the vendor's `mt-4`), control to help, error or counter 4 (was 8, and a vendor 4 on Select), field to
  field 24 (was 12 in `Form`, `Grid kind="form"` rows and columns, and `Fieldset` fields, which also took the vendor's
  `space-y-4` on top). The label weight is medium 500 (was semibold). A `Fieldset` legend stands 8 above its fields and
  its actions 24 below them (was 12 and 12 plus the vendor's 4). The error text loses the vendor's 4px inline padding. A
  choice (Checkbox, Radio, Switch) puts its label 8 from the control (was 12 in the vendor radio row) and its help 4.
  Rhythm story: `Forms/FieldRhythm`.
- Changed (values): the proximity law (owner, 2026-11-09): inside any container its children stand at least one step
  closer than the container stands to its siblings. `Section` spaces its head, filter and body by the row step (12, was
  24; contract GAP-3), so a Section in the page body (32) holds its blocks at 12. `PaneSection gap` defaults to `inline`
  (8, was `row`): bands stand 12 apart, their children 8; `gap="row"` and `"section"` stay for a band alone in its pane.
  The `SurfaceCard` root puts its label 8 above the surface (was 12), 4 in a cards Grid. `Grid kind="week-summary"`
  spaces its day cards 8 (was 24), like a cards grid; the cards and week grids now claim GAP-2. A Board column's cards
  stand 8 apart (was 12). The Footer steps down 32 / 24 / 12 / 8 (main and legal, brand and directory, groups, links;
  was 24 / 32 / 24 / 8). Stack and Cluster keep a required `gap`; zones (seam-divided) and the region Grids (24 in the
  page body's 32) already held the law. Each decision is recorded beside its rule in `common/styles.css`.
- Added: `LogoStack` (composite): the connections an agent uses as round 20px logos with no plate (`items` with `src` or
  `iconSource`, `max` default 3, a "+N" pill, a muted `caption`, `label`). Static, or one plain pressable with `onPress` or
  `isTrigger` (a `DropdownMenu` trigger). New ramp step `--grammar-logo-stack-size`. `PlainPressable` is now exported from
  `@starci/grammar/common` so an app can wrap its own content as a menu or popover trigger.
- Added: `Tabs end` (secondary tabs, `ReactNode`): a command at the strip's end, inside the strip frame after the tabs,
  centred in the strip's height, so the strip's line (own or the host's) spans the full column under it.
- Added: `PageHeader subTabs` (through `Page header.subTabs`, valid only with `tabs`): the second underline row of region
  tabs in the white band, under the page tabs, on its own full-width separator, the first label on the content edge.
- Added: `SurfaceCard` search header zone `filters` (`SelectZoneField[]`): trailing `Select`s share the search's row, the search grows,
  each select keeps its natural width with nowrap words, and they wrap below the search on a narrow card.
- Added: `SurfaceCard` head `description`: one muted sm line under the label, 4 below it.
- Added: pressable table rows: `SurfaceCard kind="table"` takes `onRowAction(id)` (DataTable already had it); a pressable row takes the
  pointer cursor and the `--surface-secondary` hover fill (`data-grammar-table-row-pressable`), and row commands stay separate presses.
- Changed (values): the type roles (owner, 2026-11-09): one role, one size; one line, one size. `Text` `md` is the body,
  14 / 400 (was 16), `sm` the secondary, 13 (was 14), `xs` 12; `isStrong` is 500 (was 600). The page title is xl 18 / 500
  (was 20 / 600), a section title lg 16 / 500 (was 600), a card label lg 16 / 500 (was 14 / 600). A ListRow primary is
  md 14 / 500 (was 600), its description sm 13 (was 14), its meta xs 12 (was 14). A DataTable header is xs 12 / 500
  muted, a cell md 14 / 400, the row-header cell 500; narrow-mode secondary lines sm 13. Every tab is sm 13: page, region
  and filter tabs and the pill (page tabs took the vendor's 14). Section and page descriptions are sm 13. The Section
  `action` slot sets the head's body step (md 14), so a Link there matches it. `scripts/check-type-roles.mts`
  (`check:type`, in `npm test`) pins these rules to their tokens. The live case: a DataTable title cell drawn with
  `<Text isStrong>` was 16 / 600 against 14 cells; it is 14 / 500 now, with no app change.
- Changed: `Link size` (`inherit` default, `sm`, `md`): an inline link takes the size of the text around it. An external
  text link ends with Grammar's new `external` glyph unless the app passes `externalIcon`.
- Changed (types): the button-icon rule. A Button does something (`startGlyph` / `startContent`) or leads somewhere
  (`endArrow`), never both: `ButtonIcons` refuses the pair at compile time. Both glyphs take the inline gap (8) and the
  control's glyph padding. Lint `button-arrow` refuses an arrow typed in a label or passed through `endContent`.
- Added: glyphs `plus`, `upload` and `external` in `GLYPH_NAMES` (`startGlyph="plus"` on a create action).
- Added: `EmptyNotice actionEndArrow` and `ItemAction.endArrow` (row and tile actions): a Grammar-drawn action that leads
  somewhere ends with the arrow.
- Changed: the surface-in-surface law (owner, 2026-11-09): a `Section kind="list"` inside a surface (a card body, a
  drawer or dialog, a pane band, a rail or aside) is a nested surface: a 1px separator edge, the card radius, clipped, so
  no row seam runs past the container edge; its rows keep 12 inline. Automatic, no prop. A `ListBox` in a pane is not a
  row list of this kind and is unchanged.
- Added: `PageHeader breadcrumbs="root"` (through `Page header`): the root page of a console states that it has no trail
  by design; it draws nothing. Lint `page-breadcrumbs` asks every console page for a trail or `"root"`.
- Added: `scripts/audit-gap.mts` (`npm run audit:gap -- <url>...`): a Playwright audit of the proximity law in a
  rendered page, each container whose gap is not below its spacing ancestor's, with selectors and values.

## 0.27.0 - 2026-11-09 - entry, pricing and step marks (0.26.0 never reached npm; this release carries it)

- Changed (values): a card holds its content 16 in, not 12. The spacing scale gains 16 as the card's own step
  (`--grammar-inset-card`, `COMMON_SPACING_SCALE[4]`); `--grammar-card-padding-inline`/`-block` read it, so a body card, a
  tile and a zone sit 16 from the card edge. Rows a card divides by lines (static, list, accordion) take
  `--starci-core-row-inset: 12 16`: the row rhythm stays on the block sides, so every row keeps one height and its hover
  still reaches the card edge, and the text lines up with the body. A stat strip cell in a card takes 16 on every side
  (8 in a pane), a table in a card puts its outer columns on 16, and a card zone's first filter tab label stands on 16.
  Panes, overlays, bands and the page gutter keep 12. Only the card is wider, so no app changes.
- Added: `EmptyNotice actionIntent` (`commit` default, or `neutral`): an empty notice in a secondary place (a rail, a side card)
  takes the outlined button, so it never adds a second primary beside the page header's. Story `Data views/Empty notice action intent`.
- Added: `AlertDialog isConfirmDisabled`: the confirm stays disabled until a gate in the body is met (type the name of what is
  deleted), so a destructive confirm with a typed gate keeps the alert dialog's warning mark and dismiss rules.
- Added: `DataTableColumn isLabelHidden`: an action or ⋯ column keeps its heading for assistive technology without drawing it.
- Added: `Drawer leading`: a mark (avatar, logo) before the drawer title, as a bottom sheet about one item shows it.
- Added: `Button endArrow`: a label that leads somewhere ends with Grammar's `arrow-end` glyph, which slides one step toward the reading
  end on hover and focus (still under reduced motion, mirrored right to left). An icon of what the action is stays at the start.
- Fixed: a Button's glyph and label stand one inline step (8px) apart on every size.
- Changed: an `EmptyNotice` always wears a mark: without an `iconSource` (and no artwork) it shows Grammar's new `empty` tray glyph, so an
  empty region never reads as bare words.
- Fixed: the Switch thumb has no ring (its surface shadow drew an edge); the control-size Switch thumb sits one identity step in from each edge in both states (the vendor margin was computed for
  its own size, so the on thumb touched the end edge); the Button gap wins over the vendor's unlayered rule.
- Fixed: a Switch is a capsule on every theme: its track and thumb take the pill radius, so an app radius never squares them.
- Fixed: a tile foot with no figure and no badge no longer renders an empty first item, so its action stands on the card's
  inline edge instead of one inline gap (8) in.

- Added: `Text size="figure"`, the leading value of a region (FONT-5): a price, a total, a count read first, at the figures cell's
  size and weight with tabular figures. Story `Surfaces/Pricing cards`.
- Added: `Stepper completeMarker="check"` (markers kind): a complete step shows a check instead of its number, chosen by a
  declarative prop so a server component can set it (`renderMarker` is a function and cannot cross that boundary).
- Added: `EntryFrame layout="centred"`: no context pane, the identity and tools share one bar, the form sits alone in the middle
  of the page with the footer below; `artwork` and `intro` are refused in this layout by the types. `split` stays the default.
  Story `Frames/EntryFrame/Centred`.
- Added: `SurfaceCard emphasis="accent"` on the plain surface: the one card a set of peers recommends (the popular plan of a
  pricing grid) keeps its ground and depth and takes an accent ring inside its edge; the reason stays in words (a badge).
- Added: `SurfaceCard kind="details"`: term/value rows (a real `<dl>`, DescriptionList) that touch the card's edge like list rows,
  each inset by the card padding and divided by a full-width seam (the order of a purchase, a record's summary). Before, a
  DescriptionList in a body card drew its seams inside the card padding.
- Changed: `Switch` defaults to `size="control"`: a 40px track with a round thumb that may carry a glyph, so a switch matches the
  control height of the buttons beside it. `md` and `lg` (HeroUI's own sizes) stay for a dense cell.
- Fixed: a `WorkspaceShell` primary that holds a `Page` is no longer capped at `--grammar-content-max`: the Page owns the measure,
  so its white header band runs the column's full width (it ended at 80rem on a wide window) while its content keeps the measure.
- Fixed: a `WorkspaceShell` with no navigation whose page has a header band drops the region gap under its bar, so the band sits
  right under the bar instead of leaving a strip of page ground between two white bars.
- Changed: `Switch` states: off, the track takes the default fill with a fine edge; in both states the thumb is the light surface
  raised by the surface shadow; on, a thumb glyph takes the accent.
- Added: `Drawer width="wide"` (32rem) for a guided task whose steps are labelled across the top (a connection wizard); `standard`
  (24rem) stays the default.
- Changed: released with the Grammar family at 0.26.0 (its lint family peers `@starci/hfs ~6.3.0`).

## 0.25.2 - 2026-11-08

- Changed: released with the Grammar family at 0.25.2 (its lint family peers `@starci/hfs ~6.2.0`); no component changed.

## 0.25.1 - 2026-11-07

- A patch with eslint-grammar-core and eslint-grammar-offset-pop, which keep one version with it: the `@starci/hfs` peer of the lint packages is `~6.1.0`. No component, prop or token changed; the canon pins' range is `~0.25.1`.

## 0.25.0 - 2026-11-07

- A minor with eslint-grammar-core and eslint-grammar-offset-pop: the family moves together because the lint rules of eslint-grammar-core changed text (`contexts/grammars/contributing.md` "Patch or minor"); the canon pins raise the range to `~0.25.0`.
- Comments, stories and the README cite rules by their ids and carry no ruling history; no component, prop or token changed.

## 0.24.1 - 2026-11-07 - card radius, content maximum, the switch row inside the card

- Changed (reverses the 0.23.3 surface radius): the card radius is HeroUI's own Card radius, `--starci-core-surface-radius: min(32px, var(--radius-3xl))` (24px at `--radius: 0.5rem`; it was `--radius`), declared in Grammar's base layer (`ramps.css`) as an app-overridable default: an app's brand CSS may set it on its root, and Grammar reads only the token, never a literal. It is the radius of every SurfaceCard kind, the Board columns and the Board header strip, the highlight and the page-level EmptyNotice card. Inner pieces keep `--radius` or lower, fields `--field-radius`, chips and avatars full. Core's DNA default (`STARCI_CORE_DNA.geometry.surfaceRadius`) follows. Offset Pop keeps its own `--offset-pop-surface-radius`. Story `SurfaceRadiusToken` overrides the token in a scoped wrapper and measures every card kind and the board column following it.
- Added: `--grammar-content-max` (80rem, a ramp): the content of a page (`--starci-core-page-measure` now reads it) and the primary column of `WorkspaceShell` take `max-inline-size: var(--grammar-content-max)` and `margin-inline: auto`, with their existing inline padding; the page background, the header band and the aside rail stay full width, and a phone is unchanged (the maximum only bites on a wide screen). Stories `ContentMax1920`, `ContentMax1920WithAside`, `ContentMax2560`, `ContentMax2560WithAside` measure that the content is no wider than the maximum and centered in its column.
- Fixed: the `switch` header zone now draws INSIDE the card, as its first header row: an optional `title` (muted) at the leading edge, the primary tabs at the trailing edge, the zone's one line under it; the card label stays above on the well. (0.24.0 drew it in the label row, outside the surface.) New `SwitchFields.title`.
- Fixed: the group rows of a `kind="table"` card (and `DataTable groups`) show `--surface-secondary`: the table's own `surface="none"` cell rule (transparent) out-ranked the group tint; the group cell rule now out-ranks it. The ledger stories measure the computed background against the token.
- Documented: the two app-overridable tokens in the README "Theming".
- Fixed: `PaneGrid` dropped, in production, every `Pane` built in a React Server Component (the child's type reaches the client as a lazy client reference, not the `Pane` function, so `isPane` was false and the grid drew empty; development threw the unhelpful "component"). A lazy that resolves to `Pane` is now a pane (a pending one suspends as React reads any lazy), and any child that is not a pane now throws `PANE_GRID_CHILD_NOT_PANE` in production too, never a silent empty grid; for a client reference that is not a `Pane` the message says: a Pane built in a server component, mark the module that builds the PaneGrid children "use client". Stories `PaneGridServerBuiltPane` and `PaneGridServerBuiltPaneRefused`.

## 0.24.0 - 2026-11-06 - card zones, one line under tabs

- BREAKING (minor, 0.24.0): `SurfaceCard kind="bands"` is removed with no alias, and so are `SurfaceCardProps` `bands`, the `Band` type and the band class `starci-core-surface-band`. Express it as typed `headers` plus a body: a `figures` header zone over a list or a body; a `{ kind: "custom" }` header zone for free copy or a picture (the old `media` band, which drew edge to edge, is a padded custom zone). Migrate: `kind="bands" bands={[figures, list]}` becomes `kind="list" headers={[{ kind: "figures", items }]} items empty`.
- BREAKING: `SurfaceCard footer` (the muted note UNDER the card) is renamed `note`, with no alias; the hook `starci-core-surface-footer` is `starci-core-surface-note`. `footers` is the new zone prop below the body.
- Added: every `SurfaceCard` kind takes `headers?: readonly HeaderZone[]` and `footers?: readonly FooterZone[]`, drawn above and below the body in array order (the first header sits right under the label). The shell pads the zones and draws ONE divider between neighbouring zones and between a zone and the body; a `Divider` inside a zone is refused. Zones are typed, and the only free zone is `{ kind: "custom", children }`, padded and seamed by Grammar, which may not hold `Tabs`, `SearchField` or `Divider` (a development refusal, and the lint rule `surface-card-kind`).
  - `HeaderZone`: `{ kind: "filter", label, items, selectedKey, onSelect, moreLabel?, overflowLabel? }`, `{ kind: "search", label, value, onChange, placeholder?, clearLabel? }`, `{ kind: "toolbar", filter, search }` (the filter tabs at the leading edge, a compact small `SearchField` at the trailing edge in one row; below 36rem of the card the extra tabs fold into "More" and the search is a search `IconButton` that opens its own row), `{ kind: "figures", items }`, `{ kind: "custom", children }`.
  - `FooterZone`: `{ kind: "more", label, press }`, `{ kind: "more", label, href }`, `{ kind: "paging", page, pageCount, onPage, labels }`, `{ kind: "custom", children }`.
  - Loading, error and empty draw in the body; the zones keep their geometry while loading (`LoadingScope`). Types `HeaderZone`, `FooterZone`, `FilterFields`, `SearchFields` are exported.
- Added: `Board headers` takes the same `HeaderZone`s, drawn in one white `--surface` strip above the columns on the well (the strip is the board's only added surface); an error replaces the columns, not the strip.
- Added: the glyph `search` in `GLYPH_NAMES` (the magnifier, for `IconButton glyph="search"`).
- Changed (ALL tabs, `views` and `filter`): there is exactly ONE line under a tab strip, and the selected underline (2px) lies on it with its bottom edge on the line's bottom edge. A standalone strip owns the line (`--separator` on its bottom edge, the indicator at `-1px`; `data-grammar-tabs-line="own"`). Inside a card `filter` or `toolbar` zone the zone's divider IS the line and the strip draws none (`host`); the page header band's bottom border is the line under its page tabs, the band's separate `Divider` and `data-grammar-page-header-separator` are gone. `Tabs` has no `line` prop: the host decides, and no page and no child of a zone can override it. The strip stands on its line with no padding below, so the fold "More" trigger and the toolbar's search button sit on it. A scrolling strip keeps its indicator whole by one pixel of scroller padding drawn over the line. Offset Pop thickens the line to its outline width (`--starci-core-tabs-line-width`).
- Changed: Offset Pop draws the divider between zones at its outline width.
- Added: `SurfaceCard kind="table"` (the cash book): a card whose body is a table Grammar owns, built on `DataTable surface="none"` (one implementation). Props `columns` (`id`, `label`, `align`, `numeric`, `priority`), `rows` (`id`, `cells` by column id, `href`) OR `groups` (`id`, `label` the date, `fact` the end-of-day balance, `rows`), `empty`, the usual `isLoading`, `error`, `headers` and `footers`. The column header is drawn once; each group is a heading row (`--surface-secondary`) inside the same table; numeric cells are `nowrap` in tabular numerals; every line runs to the card's edges. Below the table's collapse width the `low` columns fold under the first column as muted lines and the group rows stay. Types `TableColumnData`, `TableRowData`, `TableGroupData`, `TableData`.
- Added: `DataTable groups` (`DataTableGroup`: `id`, `label`, `fact`, `rows`; use it instead of `rows`) draws a group heading row (one cell across the table) before each group's rows, and `DataTableColumn.isNumeric` (end-aligned, `nowrap`, tabular numerals).
- Fixed: a figure value never breaks inside a number. The value is `nowrap` and each cell has a minimum width from its value (its characters at the figure's size, plus the cell inset), so the strip wraps to 2 x 2, then one column, before a number would break ("12.000.000" at 390px). Story `FiguresFullBleed`.
- Verified (no change needed): zone seams, list row lines, figure cell lines (vertical lines and the 2 x 2 cross), table lines and accordion seams all run flush to the card's edges; stories `EveryLineIsFlush1920` and `EveryLineIsFlush390` walk them.
- Changed (docs): `Tabs` and `ButtonGroup` document the choice: `Tabs` switch views or periods of one block (in a card, the `filter` or `toolbar` header zone), `ChoiceChips` or `RadioGroup` choose a form value, a `ButtonGroup` holds commands and no selection state (it has none). Joined buttons or pills acting as tabs are banned by the lint rule `no-button-view-switch` (`@starci/eslint-grammar-core` 0.24.0).
- Added: `Tabs appearance: "secondary" | "primary"` (naming follows HeroUI). `secondary` is the default and is the underline (`kind` views and filter; `data-grammar-tabs-variant` now says `secondary`, it said `primary`); the one-line and flush-underline rules apply to it only. `primary` is HeroUI's primary variant, a pill in a track, still `role="tab"`, for a mode or period of the same data: two to four short fixed options, no `count`, no `href`, no `isAttention` (the types refuse them: `PrimaryTabItem`, `PrimaryTabItems`, `PrimaryTabsProps`; a development throw refuses what the types cannot see), no line (`data-grammar-tabs-line="none"`), hugging its options. Types `SecondaryTabsProps`, `PrimaryTabsProps` are exported; `PageHeader tabs` is secondary only.
- Added: header zone `{ kind: "switch", label, items, selectedKey, onSelect }` (primary tabs): in a card with a label it stands in the label row at the trailing edge, beside the label (before `labelEnd`); a card with no label and a `Board` draw it as a trailing strip. It takes no line. The home of "This month / Last month", "Day / Week / Month", "List / Board".
- BREAKING: `SegmentedControl` is deleted with no alias (component, `SegmentOption`, `SegmentedControlProps`, `SegmentedControlSize`, its Common and Offset Pop styles, the `segmented-control` contract role renderer and its DNA rules `DNA-COMMON-SEGMENTED-RAMP`, `DNA-COMMON-SEGMENTED-RADIO`, `DNA-CORE-SEGMENT-SELECTED`). Migrate: a switch of a mode or period is `Tabs appearance="primary"` (the `switch` zone in a card); a value of a form is `ChoiceChips` or `RadioGroup`. The in-package stories are migrated (the Appearance control of the Settings page is a `RadioGroup`).
- Stories `Surfaces/Card zones` with play tests: a list with a toolbar, filter and search as two zones, figures plus a list, footer `more`, link and paging footers, loading/error/empty zone geometry, the 390px fold (the fold trigger and the search button on the line), the one-line measure for `views` in a page head, a `filter` in a card zone and a standalone strip at 1920px and 390px, and a board header. Stories for `bands` and `footer` are migrated.

## 0.23.3 - 2026-11-06 - surface and radius tokens

- Fixed: `--starci-core-surface-radius` is `--radius` (it was 4/3 of it, 10.67px at Nivo's 0.5rem), so every card, media viewport, toast, flow graph and diagram draws at the one block radius.
- Fixed: 21 corner radii that mapped to no HeroUI token now use `--radius` (`--grammar-radius-md`): board column, message bubble body (the tail corner is square), sidebar item, icon tiles, text action, schedule item, bar chart fill, code, input reveal, shortcut hint, mention list, flow graph tip, node and lane label; `progress-step` is a pill (full). Left as they are because they mirror the vendor Button radius: the button loading ring and the tooltip trigger (`calc(var(--radius) * 3)`).
- Added: an `EmptyNotice` on the page itself (not inside a surface, not an error band) is one `--surface` card, never bare text on the tinted page.
- Not done here (needs a vendor override, listed in AUDIT-SURFACE-RADIUS.md): HeroUI `Alert`, `Card--transparent` and `table-root` radii (24px, 24px, 20px) must be `--radius`; avatars drawn with the rounded shape must be full.

## 0.23.2 - 2026-11-06 (additive, for the Nivo canvas)

- Added: `MessageBubble tone="soft"` on an outgoing bubble: the brand tint (`--accent-soft` with `--accent-soft-foreground`), for an agent speaking on the reader's behalf (no new token). Story `MessageBubbleTones`.
- Added: `RelativeTime style="compact"`: the amount and its unit alone ("2 min", "2 phut") for the end of a row's title line (relative mode). Story `CompactRelativeTime`.
- Added: a closed glyph vocabulary Grammar draws itself, `GLYPH_NAMES` (`more`, `send`, `panel-end`, `pencil`, `close`): `IconButton glyph` and `Button startGlyph`, for an app with no icon registry; an icon-only button still needs its `label`. Story `Glyphs`.
- Fixed: `Tabs kind="filter"` measured each tab 8px wide twice and assumed an 8px gap, so three tabs with counts folded into the "+n" menu in a 336px list pane; the fit now uses the measured widths and the list's own column gap. Story `TabsInAPane`.
- Added: `Tabs` of kind `views` fold the tabs that do not fit into the fold menu when the app gives `overflowLabel` (the selected one stays visible), and the selected page tab is `--accent-soft-foreground` at the semibold weight.
- Added: `SearchField measure="compact"` (up to 26rem, at the start); `PaneHeader close` (the round close button at the trailing end); `ListBoxItem.meta` (a short fact at the end of the title line) and `ListBoxItem.footer` (marks under the description); `DataTable surface="none"` (hairline rows, no container paint); `ProportionBar` (one track split by share with a legend: `label`, `parts`, `empty`, `isLoading`, `error`); a `Board` column is the tinted surface (`--surface-secondary`, exactly the canvas's #f3eeee) with its title and a white count chip in the head and its items as white cards (canvas column surface; each item is its own card, so a column is no longer one card of rows). Story `BoardTintedColumns`.
- Not built: a loading shimmer for `ListBoxItem.meta` and `footer`.

## 0.23.1 - 2026-11-05

- Changed: `GrammarToneRegistry` lives in `src/common/tone-registry.ts`, a module that imports nothing, and `@starci/grammar/common` re-exports it (an app still augments `"@starci/grammar/common"`), so a component that reads the app's tones no longer reaches the common entry's renderers (FE_GRAMMAR_TIER_DIRECTION).

## 0.23.0 - 2026-11-05

- Added (R4-22, batch 12): `BubbleMapNode.caption` (the name inside a bubble) now wraps to two lines and its type scales with the disc until the longest word fits, and `BubbleMapNode.detail` is one small line under it (a count); both sit in a block 70% of the disc wide, inside its inscribed square, and are never cut. `mark` stays at 4 characters. Laws `DNA-COMMON-BUBBLE-TEXT-INSIDE-START`, `-END`, story `BubbleNames`.
- Added (R4-27, batch 12): `PaneSection rule="start"`: a hairline (`--separator`) on the block-start edge of the band, for a pinned decision bar or footer. Law `DNA-COMMON-PANE-SECTION-RULE`, story `PaneFooterRule`.
- Added (R3-48 listing tile): `TileData.byline` (a muted small line under the name, beside the mark), `TileData.facts` takes `string | readonly string[]` (one muted line each), `TileData.figure` (one plain bold value at the start of the action row, the action and menu at its end, one line; a tile with a `figure` has no single `badge`). Loading draws the same box. Laws `DNA-COMMON-TILE-BYLINE`, `-FIGURE-START`, `-FIGURE-BEFORE-ACTION`, story `TileByline`.
- BREAKING (minor, 0.23.0): `info` is no longer a Grammar built-in. Core ships HeroUI's tones only (accent, default, success, warning, danger); an app ADDS tones: it writes `--<tone>`, `--<tone>-foreground`, `--<tone>-soft`, `--<tone>-soft-foreground` in its theme and declares the name once with `declare module "@starci/grammar/common" { interface GrammarToneRegistry { info: true } }`, after which `tone="info"` type-checks on `Badge`, `StatusDot`, `IconTile`, `Progress`, `Alert` and the `FlowGraph` and `BubbleMap` nodes and is painted from the app's tokens by one generic rule per component (`customToneProps`, `data-grammar-tone-custom`). A declared tone whose token is missing throws in development (never in production) and fails `DNA-COMMON-TONE-CUSTOM-COMPLETE`. `informative` stays an intent that is the accent pair unless the app writes the optional `--informative`, `--informative-foreground`, `--informative-soft`, `--informative-soft-foreground`. Removed: `--info` and `--info-foreground` from Core's palette (`core/dna.ts`, `core/theme.css`), every `var(--info...)` in Core and Common CSS, `info` in `BadgeTone`, `ProgressTone`, `FlowGraphTone`; the FlowGraph execute-node default is `accent` (was `info`). New check `npm run check:tones` (in `npm test`) fails a Core or Common rule that reads a tone token outside HeroUI's palette and `--informative*`. Laws `DNA-COMMON-TONE-CUSTOM-COMPLETE`, `DNA-COMMON-ALERT-TONE-PAIR-INFORMATIVE` (was `-INFO`), story `AppTones`.
- Changed: the Grammar lint family reads the @starci/hfs runtime it peers (~5.13.0) at run time instead of a bundled copy; a later hfs data change releases neither.

## 0.22.0 - 2026-11-05

- Fixed: a text `Link` paints the exact `--accent` in Core: the shared rule that rebound `--accent` to `--accent-soft-foreground` on a link no longer names it (it still does on the current tab), so the P2 override holds and the theme proof sees it.
- Changed (one way to choose: counts are chips): a tab's `count` is a chip, neutral (`--default`), the accent soft pair on the selected tab, the warning soft pair when `isAttention` is set (was muted inline text, danger text). The tabs keep their underline. Laws `DNA-COMMON-TABS-COUNT-CHIP`, `-ATTENTION`, story `FilterTabsOverflowLabel` (counts) and `FilterTabsLoading`.
- Added (U0-G10, approved): `Heading scale="title"` and `PageHeader titleScale="title"`: the middle 24px step (3xl, semibold, tight leading) for a first-run or lobby head and a welcome card title; the standard and display scales are unchanged. Law `DNA-COMMON-HEADING-TITLE-SCALE`, story `TitleScale`.
- Changed (U0-G9, approved): `Stepper` markers form: the current step is a filled `--accent` circle with the accent foreground number, an upcoming step a filled `--surface-secondary` circle with a muted number and no ring, a complete step unchanged (filled accent), error and paused keep their tone ring on `--surface`. Laws `DNA-COMMON-STEPPER-MARKER-FILLS`, `-UPCOMING`, story `StepperMarkerFills`.
- Checked (item 20d, approved): the Grammar draws no vertical centring of `EmptyNotice` (a content-height column with 24px inset, text centred across, as 2-inbox.empty and 2-inbox.noselection draw it); a notice that reads centred in a pane is app CSS (FE-CSS-1 refuses it). Guarded by law `DNA-COMMON-EMPTY-NOTICE-TOP`, story `EmptyNoticeAtTop`.
- Changed (item 20b): a text `Link` is the exact primary brand colour, `--accent`, still underlined. The raw accent measures 3.2 to 4.3 as text on several Nivo grounds (page ground, secondary and tertiary surfaces, the dark surfaces), below 4.5, and no contrast law judges a link. Law `DNA-COMMON-LINK-ACCENT-TEXT` pins `--accent`, story `LinkAccentOnEveryGround`.
- Changed (item 20a, approved): the `alternative` button is the outlined pill (hairline border, `--default-foreground` words) in every placement in Core, as System.html draws the secondary command; it was the grey `--default` fill. `neutral` is unchanged (outline in decision and item, bare in chrome). Buttons carry `data-grammar-intent`. Law `DNA-CORE-BUTTON-ALTERNATIVE-OUTLINE` (Core only) replaces `DNA-COMMON-BUTTON-ALTERNATIVE-INK`, story `AlternativeButtonInk`.
- Fixed: a `Select` without `placeholder` no longer shows the vendor's English "Select an item" (the Grammar speaks no language of its own): the trigger shows an empty, sized value; pass `placeholder` in the app's language. Law `DNA-COMMON-SELECT-NO-VENDOR-ENGLISH`, story `SelectWithoutPlaceholder`.
- Fixed: `Link media` keeps the `width` and `height` of its `media` (a logo of 113 x 40 stays 113 x 40, was drawn at its container's width), contained inside that box. Law `DNA-COMMON-LINK-MEDIA-KEEPS-BOX`, story `LinkMediaKeepsBox`.
- Changed: the canon pins give the family the same-minor range `~0.22.0`; a minor, since the batch removes the law DNA-COMMON-BUTTON-ALTERNATIVE-INK and changes the one-way-to-choose contract.

## 0.21.38 - 2026-11-05

- Changed (G7-11): a `ListRowData` with `actionPlacement="end"` and two or more commands (an action and a menu, or a control) puts the commands under the text on a container narrower than 28rem, so the text column keeps the row width instead of about 130px; one command stays at the end. The loading row follows. Law `DNA-COMMON-ROW-TEXT-FIRST`, story `RowTextFirst`.
- Added: `size="sm"` on `Select`, `ComboBox`, `SearchField`, `NumberField` and `Input`: the compact 32px single-line field for a list head or toolbar (the default `md` is the 40px field). Works with `isLabelHidden` and region loading (the box follows the one field height variable); the touch floor does not lift it, as a sm Button keeps 32px. Law `DNA-COMMON-FIELD-SM` (`DNA-COMMON-FIELD-MD` now leaves compact fields to it), story `CompactFields`.
- Fixed: `Disclosure chevron="start"` leaves the trigger row start-aligned, so the title follows the chevron instead of standing at the row end. Law `DNA-COMMON-DISCLOSURE-CHEVRON-TITLE-NEXT`.
- Fixed: a `DataTable` of four columns or fewer fits its container (columns shrink to their words, so a narrow aside never clips the last column); a wider table keeps its natural width and scrolls inside its own box. Law `DNA-COMMON-TABLE-NO-CLIP`, story `CompactTableInAside`.
- Fixed (G5-F1): `Stepper kind="bar"` no longer carries the marker form's orientation and size attributes, so the connector `::after` of the markers never paints on a segment. Law `DNA-COMMON-STEPPER-BAR-NO-CONNECTOR`.
- Changed (G5-F2): `DescriptionList layout="columns"` sits side by side from 16rem of its own width (was 20rem), so a phone drawer's 308px content box keeps terms beside values. Stories measure at 308px.
- Added: `Tabs kind="filter"` follows a loading region: the labels stay real text (static chrome), each count is the geometry of its ready box, the tabs are inert and the fold fit is unchanged. Law `DNA-COMMON-TABS-FILTER-LOADING-COUNTS`, story `FilterTabsLoading`.
- Added: `ChoiceChips width="fill"`: the chips grow evenly from their own width to share the row and wrap only when they cannot fit; the loading twin fills the same way. Law `DNA-COMMON-CHOICE-CHIPS-FILL`, story `ChoiceChipsFill`.
- Added: `Cluster label="..."` makes the row a labelled group (`role="group"`, `aria-label`) for separate buttons that mean one thing (less/more, a row of actions). Not a ButtonGroup (R380): the controls stay separate. Law `DNA-COMMON-CLUSTER-GROUP-NAMED`, story `LabelledActionRow`.
- Added (G10b-1): `PaneSection scroll={{ align: "start" | "center" | "end" }}`: the scroll content is at least as tall as the band and stands at the foot (`end`, a thread beside its composer) or in the middle (`center`, an empty greeting); it still scrolls when taller. Laws `DNA-COMMON-PANE-SCROLL-ALIGN`, `-END`, story `ScrollBandAlign`.
- Added (G10b-2): `Alert tone="accent"`: the accent soft pair (`--accent-soft`, `--accent-soft-foreground`), flat, for a welcome or "new" band; it acts as informative (commit action, polite). Law `DNA-COMMON-ALERT-TONE-PAIR-ACCENT`, story `AlertAccentTone`.
- Fixed (U2-G7): Badge, DescriptionList, Quote, ColorSwatch, MediaFrame, Meter, Progress, ProgressCircle, Video (and Toast, DropdownMenu, PopoverPart, the overlay scope) call a region wrapper or a hook and now begin with `"use client"`, so a server component can import them from `@starci/grammar/common`. New contract check `npm run check:client` (in `npm test`) fails any module under `src/core`, `src/common` or `src/offset-pop` that calls a hook, `createContext` or a region wrapper without the directive as its first statement.
- Fixed (U2-G8): a bleed `Page` that holds a `WorkspaceShell viewport="flow"` no longer fixes its fill at one viewport height; the fill is a floor (`min-height`), so the canvas the Grammar root paints reaches the end of a long public page. Law `DNA-COMMON-PAGE-FILL-GROWS`, story `PageFlowGrows`. No prop.
- Fixed (U2-G6): an unselected radio and checkbox draw their own ring (`--grammar-choice-ring`, default `--muted`) instead of the field border and shadow, which an app may set to transparent. Law `DNA-COMMON-CHOICE-RING`, story `ChoiceRingWithoutFieldEdge`.
- Added (G7-7): `ListRowData.actionPlacement: "below" | "end"` (default below); `end` keeps the command and menu at the end of the row, centred against the copy, at every width. Law `DNA-COMMON-ROW-ACTION-END`.
- Added (G7-8, G9c-2): `Disclosure chevron="start" | "end"` (the chevron before the title points toward the reading direction closed and down open) and `Disclosure kind="quiet"` (a small link-toned line, chevron first, content folded under it). Law `DNA-COMMON-DISCLOSURE-CHEVRON-START`.
- Added (G7-9): `Tabs overflowLabel` draws the app's word ("More") on the fold menu of `kind="filter"` instead of "+n"; `moreLabel` still names the menu with the count.
- Added (G7-10): `ItemLeading` position `format: "ordinal" | "hash"`; `hash` draws a muted semibold "#1".
- Changed (G9c-1): `Section kind="figures"` inside a Pane draws one bordered row (2 x 2 only below 20rem of its own width), the value at the 2xl step. Law `DNA-COMMON-FIGURES-PANE-ROW`.
- Fixed (U9c-3): the `alternative` button (HeroUI secondary) writes its words in `--default-foreground`, the pair of its `--default` fill; the vendor used `--accent-soft-foreground`, which is the brand rose in a brand-coloured app (pink words on grey). The info Alert is G7-7 (set `--info-soft` and `--info-soft-foreground` in the theme). Law `DNA-COMMON-BUTTON-ALTERNATIVE-INK`.
- Changed: `DescriptionList layout="columns"` answers its own width (side by side from 16rem) instead of the viewport (30rem), so a phone-wide drawer keeps terms beside values. Law `DNA-COMMON-DESCRIPTION-DRAWER-COLUMNS`.
- Added: `Stepper kind="bar"`: one thin segment per step, filled up to the current step, the current label under it (horizontal, pressable with `onStepSelect`, loading keeps the box). Law `DNA-COMMON-STEPPER-BAR`, story `StepperBar`.

## 0.21.37 - 2026-11-05

- Added: `Pane collapse="drawer" trigger="head"` and `PaneHeader drawerOpener={{ pane, icon, label }}`: the grid owns the drawer's open state and the head draws the icon button that opens it, shown only where the pane's area is not arranged, so a server page needs no state. The head keeps its height at every width.

## 0.21.36 - 2026-11-05

- Fixed: a `Pane collapse="drawer"` opened as a drawer rendered unstyled (no section gaps, row spacing or text sizes) because it was portalled into the document body, outside the Grammar root that carries every family rule and token. It now portals into the nearest Grammar root like every other overlay. DNA laws `DNA-COMMON-PANE-DRAWER-SPACING` and `DNA-COMMON-PANE-DRAWER-SECTION-GAP` measure it (story `PaneDrawerSpacing`).

## 0.21.35 - 2026-11-05

- Added: `ItemAction.isPrimary` (with `intent="commit"`): a row or tile command that is the region's one primary draws as the filled accent button, not the outlined item pill; at most one per region, counted by `DNA-COMMON-ONE-ACCENT-FILL`. Changed: below 30rem an `Alert` button action stacks under the text, full width, in its tone's intent (the dismiss stays beside the text).
- Fixed: a loading `RadioGroup` and `CheckboxGroup` draw their option labels and descriptions (data) as geometry of their own text; only the group label stays real.
- Added: `Calendar width="fill"` (the month takes its container's width; tracks share it, day cells stay centred); `ChoiceChips selectionMode="multiple"` with `values`, `defaultValues`, `onValuesChange` (any number of chips, none allowed); `Button width="fill-narrow"` (content width on a wide screen, full width below 30rem).
- Added: `span="full"` on `Input`, `CopyField`, `OtpInput` and `PressableField` (every other field already took it from the shared field props). Fixed: in a one-column form row, a field that follows a vendor `<template>` (a ready `Select`) no longer gets an extra section gap above it.
- Changed: `informative` (an `Alert`) and the new `Badge tone="info"` use the info soft pair (`--info-soft`, `--info-soft-foreground`; blue in Nivo) and fall back to the accent pair where the theme defines none; accent stays its own tone for "new" and "selected". Core theme defaults derive `--info-soft*` from `--info`. DNA `DNA-COMMON-ALERT-TONE-PAIR-ACCENT` is renamed `-INFO`; new `DNA-COMMON-BADGE-TONE-INFO`.
- Added: `Inset` (the Quote ground around rows or a block, an optional label, its own loading region); `Disclosure` `leading` (a step mark) with the summary as the end meta and its data parts as geometry in a loading region; `DisclosureList` (sibling disclosures joined into one list).

## 0.21.34 - 2026-11-05

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.33 - 2026-11-05

- Added: `RadioGroup appearance="rows"`; form field `span="full"`; `Avatar tone="accent"` and `IdentityLockup markTone`; `PageIntro`; `Page measure="narrow"` and rail width `medium`; `ErrorData.isInline`; `AccordionRowData.leading` (a step mark); `Page headerCollapse="narrow"`; `Alert leading` and `action.kind="row"`; `Select appearance="pill"`.
- Added: `ListRowData.control` (a Select or Switch at the row end), `leading.size` (`md` is 40px) and a tile-shaped loading mark for an icon leading; `Select.prefix`; `TopBar density="compact"` (56px); `PaneHeader back.placement="always"`.
- Added: `Section.fact` (a muted fact on the title line); `Section kind="list" ariaLabel` (a list with no heading under a pane head); `FileButton` `text`, `description`, `errorMessage` (a labelled pill picker with a note); `TextAction appearance="destructive"` (underlined danger text); `PrimaryRailLayout` is exported. Changed: the breadcrumb separator is a slash at 12px with a strong current page; `SearchField` is always the field tone; the page header keeps its command on the title row on a phone while it fits.
- Changed: a `neutral` command at the `item` placement (a row or tile action) is the outlined pill (was bare text), in both families; `ItemAction.intent` accepts `destructive` (the soft danger pill of the entry step); a `kind="tile"` card with a mark and no poster draws the mark beside the name with its status chips under it, the description under the pair, the action at the start of the foot and the overflow menu at its end. Loading keeps the box (law `DNA-COMMON-LOADING-SAME-BOX`, story "Loading keeps the box"); `Select`, `ComboBox` and `DropdownMenu` popovers start a fresh loading region.
- Changed: region loading. A loading `Section`, `PaneSection`, `SurfaceCard`, `Form` (new `isLoading`), `Dialog` and `Drawer` body (new `isLoading`) is read by every component inside it: controls and data draw the ready box (inert, one `aria-busy` on the region), static chrome (buttons, links, tabs, labels, icon buttons, breadcrumbs, steppers) keeps its words and only goes inert, an explicit `isLoading` overrides one control. New loading support: DateField, TimeField, Slider, DatePicker, DateRangePicker, OtpInput, Rating, PressableField, Link, Tabs, Pagination, Breadcrumbs, Accordion, Disclosure, AvatarButton, AvatarGroup, IdentityLockup, MessageStatus, RelativeTime, ProgressCircle, Image, MediaFrame, Video. A Dialog, Drawer or Popover resets the region. Law `DNA-COMMON-LOADING-REGION-INERT`, contract check `check:loading`, story "Every component, loading". Also: `Pane collapse="drawer" trigger="none"`, `DescriptionList density="compact"`, a row's badges move to the end group with its `meta`.
- Added: `FileDropzone` and `FileButton` take `isLoading` and follow a loading region (the drop target as a Skeleton of the same box, labels real); `ListRowData.meta` (one end fact, `danger` tone for a problem) and `ListRowData.onPress` (the whole row presses); `Board` `onMove` with a keyboard move (Alt + arrows) and an announcement; `ScheduleGrid` `onDrop`, `onCellPress` and per entry `isDraggable`, `isSelected`, `isInvalid` with `why`, `isDashed`; `TabItem.isAttention`. Fixed: a card's `fact` and `labelEnd` sit on the label line (the head row is a row again).
- Changed: one way to choose among a few. `Tabs` takes `kind="filter"` (the underline one size smaller, in the list pane under its search field, with a muted `count` per item, `isAttention` for a danger count, and the tabs that do not fit folded into a "+n" menu with the selected one always visible; `moreLabel` names the menu) and a `count` per item; `ChoiceChips` options take `disabledReason` (a taken time says so on hover and to a screen reader); `Calendar` takes `locale` (month and weekday names, and Monday as the first day for Vietnamese), `firstDayOfWeek`, `unavailableReason` (a full day says so) and `isLoading` (header and cells kept, numbers as geometry). `ButtonGroup`, `FilterButtonGroup` and `SegmentedControl` are deprecated, still exported, and removed in a later release: use separate `Button`s or a `DropdownMenu`, `Tabs kind="filter"`, and `ChoiceChips` or `RadioGroup`. The lint rule `starci-grammar/no-grouped-choice-controls` (R380) refuses new uses. `DNA-COMMON-TABS-BY-LAYER` separates views tabs (underline) from filter tabs (pills). A standalone Calendar's chosen day reads ink in Offset Pop.
- Changed: `Alert` has one look in Core and Offset Pop, the tone's soft pair: the row is `--<tone>-soft` at full strength, the glyph, title (semibold) and description (regular) are `--<tone>-soft-foreground`, with no shadow and no border; informative maps to accent, affirmative to success, cautionary to warning, negative to danger, and neutral, pending and unavailable to default. The `appearance` prop is a deprecated no-op (both values render this look) and will be removed in the next release; delete it at call sites. The DNA laws `DNA-COMMON-ALERT-SURFACE`, `DNA-CORE-ALERT-RAISED` and `DNA-OFFSET-POP-ALERT-SOFT` are replaced by `DNA-COMMON-ALERT-TONE-PAIR-*`.
- Added: `ChoiceChips`, one choice among a few short options as pills that wrap (a time, a day), with empty, loading and error. DNA law `DNA-COMMON-CHOICE-CHIPS-WRAP`.
- Added: `Board` (stages as columns of rows that scroll and snap), `ScheduleGrid` (entries placed by row and column; an agenda below 48rem of its width) and `BarChart` (bars on one scale), each with loading, empty and error drawn in the shape of real content. DNA laws `DNA-COMMON-BOARD-ONE-WIDTH`, `DNA-COMMON-SCHEDULE-HEADINGS`, `DNA-COMMON-BAR-CHART-ONE-SCALE`.
- Added: `PaneHeader`, the head band of one pane (back control where a phone shows the pane alone, mark, title with status and one muted line, trailing commands), as tall as a touch target; a loading head keeps its box. DNA law `DNA-COMMON-PANE-HEADER-TOUCH-HEIGHT`.
- Changed: `EmptyNotice` and the failed-read notice read their message as the title and their description as the muted line; the retry is an alternative command, and in a pane the failure draws as a soft danger band (`data-grammar-error-layout="band"`), elsewhere as the centred notice.

## 0.21.32 - 2026-11-05

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.31 - 2026-11-05

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.30 - 2026-11-05

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.29 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.28 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.27 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.26 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.25 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.24 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.23 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.22 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.21 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.20 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (`pane-grid-page` judges the child of `Page chrome="panes"`).

## 0.21.19 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.18 - 2026-11-04

- Changed: version stamp only, with the Grammar lint family (a runtime copy moved).

## 0.21.17 - 2026-11-03

- Changed: version stamp only, with the Grammar lint family (their runtime copies moved).

## 0.21.16 - 2026-11-03

- Fixed: `FlowGraph layout="lanes"` nodes no longer overlap or collapse. A row is as tall as its tallest node (the layout estimates the wrapped lines of the label, the description and the count chip) and its nodes sit in the middle of it, so a long label never runs into the row below; the count chip wraps to a line of its own instead of squeezing the label into a few letters a line; a column that a labelled edge runs out of is wide enough for the label, so the words never run under the node they point at. `lanesLayout` returns `columnX` (the column centres) and `contentHeight`; `lanesStepPosition` takes the run in graph units.
- Fixed: a `FlowGraph layout="lanes"` branch label no longer reads as struck through. It was an SVG label painted inside its own edge, so the line of an edge drawn after it (another branch running into the same node along the same row) crossed its words; it is now an opaque chip in React Flow's edge label layer, above every line, centred on the straight part of its last run between the corner and the arrowhead (`data-grammar-flow-edge-label`). A column that a labelled edge runs out of also makes room for the fork point of its source and for air on either side of the chip. Held by `DNA-COMMON-FLOW-LANE-LABEL-ABOVE-LINES` and `DNA-COMMON-FLOW-LANE-LABEL-OPAQUE`.

## 0.21.15 - 2026-11-03

- Changed: version stamp only, with the Grammar lint family (the canon runtime copies moved).

## 0.21.14 - 2026-11-03

- Changed: version stamp only, with the Grammar lint family (the canon runtime copies moved).

## 0.21.13

- Changed: Align the Grammar family with the updated FE canon.

## 0.21.12

- Changed: Align the Grammar family with the updated FE canon.

## 0.21.11

- Changed: Align the Grammar family with the updated FE canon.

## 0.21.10

- Changed: Align the Grammar family release with the shared lint and canon updates.

## 0.21.9

- Changed: Keep the Grammar and both lint families at the same full version. Component source, styles and public rendering API are unchanged; the build stamp carries the release version.

## 0.21.8

- Changed: Keep the component package and both lint families at the identical release version. Component source, styles and public API are unchanged; the build stamp carries this release version.

## 0.21.7

- Changed: Keep the component package and both lint families at the identical release version as bundled canon pins change. Component source, styles and API are unchanged; the build stamp carries this version.

## 0.21.6

- Changed: Align the component package release with both Grammar lint families. Component source, styles and public API are unchanged; the build stamp carries this release version.

## Unreleased

## 0.21.3 - 2026-11-02

- Added: EntryFrame; semantic Grid sections, pair and featured roles; centred wrapped Cluster items; headless or titled unpainted Section figures reusing FigureCells; native ButtonGroup loading, member pending and borrowed size; IconButton pending; typed media tiles; MessageStatus footer semantics; passive CalendarDay. Existing DOM order, form measures, native joined corners and content geometry stay with their owning roles.

## 0.21.2 - 2026-11-02

- Added: `TabItem.isDisabled` forwards to the vendor tab so locked choices keep their labels and native tab accessibility while refusing mouse and keyboard selection. Stories cover disabled focus, selection and keyboard skipping.

## 0.21.1 - 2026-11-02

- Added: `Link` can carry structured `media` from `ImageProps` with a required accessible destination `label`, mutually exclusive with text children. Native navigation, external-tab safety, focus, disabled state and Image loading/fallback stay with their existing owners. The new media destination keeps transparent logo shapes unclipped.
- Added: `Grid kind="week"` for seven dated event regions and `kind="week-summary"` for seven daily metric summaries, with required region labels and the existing agenda/summary responsive tracks owned by the grid's container. A wrong day count is refused in development; reading and action order stay unchanged.
- Added: a `ListRowData` string title can have `href` and optional `Link.onFollow`; the title is a native link beside separate row commands, and a row without `href` takes no follow handler. Loading removes the link. Stories cover media destinations, week layouts and title navigation.
- Added: `ColorSwatch` previews actual vendor-typed color data with a required accessible label and inert loading geometry; no appearance or arbitrary-content props. `Figure` data can carry a native destination and follow callback for its whole cell while values remain neutral; loading, disabled figures and pending cards open nothing. `ItemAction.isPending` preserves the Button's busy spinner and duplicate-press guard in row and tile actions. Stories cover raw HEX values, whole-figure navigation and busy item actions.

## 0.21.0 - 2026-11-02

- Changed: ONE LOADING FLAG (lane 11, contexts/ui/loading.md). `isSkeleton` is renamed `isLoading` on every component. `Section`, every kind of `SurfaceCard`, `ListBox`, `Timeline`, `DataTable`, `MessageBubble` and `PaneSection` derive their skeleton from the rows and fields they are given, or three default rows, keep the title and hide the count, and a `Section` or `PaneSection` that loads tells the Grammar components inside it. Added: an `error` slot (`ErrorData`: `message`, `description`, `actionLabel`, `onAction`, exported) on those seven, drawn as a live alert with its own mark, and `isError` on `EmptyNotice`. Removed: `loadingRows` (`ListBox`, `Timeline`, `DataTable`, `Section`, list `SurfaceCard`), `DataTable` `loadingContent`, and `MessageBubble` `rows` (a loading `MessageBubble` without a `side` is one default thread). Run `starci app codemod loading-states`.

- Fixed: DNA DEVIATIONS (grammar lane 12). A tab bar lands on the md height (40px, was 32; the strip under a sticky TopBar grows with it, `--starci-core-band-height`), the page header band is inset by the region step above and below its content (32px, was 24), a `Badge` dot sits one identity step (4px) before its words (was 6), a segmented control in `md` is 40px at every width (the vendor stepped it to 36 on a desktop width), and a list row's description is one line with an ellipsis. Pixels move on every page band, tab bar, dot badge, md segmented control and long row description; no colour changes.
- Added: `FileButton`, a control the size of an `IconButton` that opens the browser's file picker (`accept`, `multiple`, `isDisabled`, a `label`, `onFilesChange`); `FileDropzone` stays for a real drop area. Stories `FileButton` and `FileButtonDisabled`.
- Added: the situation stories `Surfaces / Contradiction` and `Surfaces / Needs approval` (open item G-22 closed).
- Fixed: a button skeleton takes the corner of the button it stands for (the vendor's), not the shimmer's small one; `Tabs` takes one `panelId` string when a single panel is swapped, and `Page` names its body as the panel of its page tabs.
- Changed: the story `Forms / Surface defaults / Layer defaults` no longer draws a card inside a card (a surface never stands inside another).
- Changed: the contract states the selected segment on the soft accent fill only (the accent border the knowledge named was never drawn), and lists `info` and `info-foreground` as the optional extension pair that reads as accent when unset.
- Changed: THE TIER BINDING (grammar audit 2026-11, lane 8b). `children` belongs to frames. `NoChildren` and `LabelChild` are exported (`@starci/grammar/core`) and every leaf, branch and composite props type carries one, so nested JSX under it fails to compile for every caller; a leaf takes its text as `children: string` (`Button`, `Badge`, `Heading`, `Link`, `TextAction`, `Code`), `Text` alone keeps inline content. `starci-grammar/tier-props` (the grammar's own ESLint config) refuses a children or className that breaks the tier.
- Changed: the children that were slots are named: `Disclosure` and `DragItem` take `body`, `MessageBubble` takes `body`, `MediaFrame` takes `media`, `Quote` takes `text`, `Field` takes `control` (a render function), `Tooltip` takes `trigger` and `content: string`. `Footer` loses `children`. Codemod `tier-binding` rewrites each.
- Removed: `className` from every public props type but `Freestyle`'s: `Avatar`, `Image`, `Link`, `Mascot`, `Video`, `MediaFrame`, `Accordion`, `Calendar`, `DataTable`, `Disclosure`, `FlowGraph`, `ListBox`, `Rating`, `AvatarGroup`, `Pagination`, `Stepper`, `TagGroup`, `Timeline`, `TopBar`, `Page`, `WorkspaceShell`, `GrammarRoot`, `NavLandmark`, `PaneGrid`, `HorizontalScrollRegion`, `VerticalScrollRegion`. A frame draws its own scroll region through an internal part that keeps the class.
- Changed: no upward import. `Button` draws its disabled reason with the vendor tooltip (a leaf never imports the branch `Tooltip`), `StatusDot` and `CopyField` share `tooltipClassName`, `MediaFrame` names its corner type itself, `OtpInput` draws its scroller with `HorizontalScrollFrame`, `FilterButtonGroup` draws its popover through `PopoverPart`. `MarkdownArticle` (with `FencedCodeBlock` and `MarkdownTableFrame`) and `MermaidDiagram` are frames: they host content and draw lower tiers. `Tooltip` loses `isDisabledTrigger` and `triggerDescribedBy` (a disabled `Button` explains itself with `disabledReason`).
- Removed: `PlainPressable` from the public API (an internal of `IdentityLockup` and `AvatarButton`, outside the ladder).

- grammar: SurfaceCard is the one card, a discriminated union on `kind` (body, figures, list, accordion, bands, tile). Removed: SurfaceListCard, SurfaceAccordionCard, StaticStateRow, the public ListRow, DescriptionList `stat-strip` and `className`, and the SurfaceCard props `composition`, `placement`, `scroll`, `isScrollable` (`height` keeps `fill`). A card inside a surface throws in development; the nested edge and `depth` are gone. A tile names itself inside (G-20).
- Fixed: `Page chrome="bleed"` and `chrome="panes"` measured the top of their fill box once, so a header whose font arrived later left the fill top a few pixels off and two runs of one screen laid out apart (the `PagePanes` stories). The measurer now also follows the size of the bands above the fill box and the fonts becoming ready.
- Changed: the render proof checks that every id of `proof/approved.json` names a story, so a renamed story fails the run instead of approving nothing; the approved chat picture follows `MessageBubble`.

- Added: the render proof, Playwright's `toHaveScreenshot` over every story of the built Storybook (`npm run prove-render`): both families, light and dark, at 1920 and 390, device scale factor 2, against the baselines committed in `proof/baselines` (taken in the pinned Playwright image CI runs in); the baselines are unreviewed and detect change, a changed picture fails and is reported as changed, `npm run prove-render:accept` refreshes the unreviewed ones, and `proof/approved.json` names the approved pictures (chat), whose change needs a person (`prove-render:approve`). `@playwright/test` 1.63.0 replaces `playwright` (dev dependency). The Storybook preview sets `.dark` on `html` for the dark theme and renders the HeroUI Button and Chip the vendor-parity laws compare with. Stories: `Primitives/Media and drag` (DragItem states, Video poster).
- Removed: `shoot.cts`, `scripts/run-plays.mts`, `capture-refs.mts` and `svg-shot.mts`, the hand-written capture tools the proof replaces.
- Changed: PAGE AND NAVIGATION (grammar audit 2026-11, lane 6). `Page` is the one route frame and absorbs its parts: `PageHeader`, `PageContainer`, `Breadcrumbs` and `FillViewport` are no longer exported (the code stays as Page's internals). The head is `Page header` (`PageHeaderContent`; `PageHeaderBreadcrumbs`, `PageHeaderTabs` and `BreadcrumbItem` stay as types), the width is `measure`, and `Page chrome="bleed"` has a measured fill body (the viewport height left below the band, less bottom chrome) with a `minHeight` floor (`PageMinHeight`) exactly as `chrome="panes"`, which is what `FillViewport` did. Pixel move: a bleed body reaches the viewport edge (no 1.5rem bottom inset).
- Changed: `Grid` is the one owner of the form and main-rail layouts: `FormGrid` is `Grid kind="form"` and `PrimaryRailLayout` is `Grid kind="main-rail"` (same props bar `className`); the two names are no longer exported. `Rail` is no longer exported (a rail is the `rail` slot of `Grid kind="main-rail"`, or the rail of `WorkspaceShell`).
- Changed: `TopBar` takes `subnavigation` with `subnavigationLabel` (a second and last layer, a named region) and absorbs `NavigationFeatureNav`: identity is `brand`, the compact trigger is `menu`, the feature row is `subnavigation`. A sticky `TopBar` now publishes `--starci-core-band-height` and `--starci-core-band-offset` (6rem with a subnavigation); the `bandSubnavHeight` and `subnavOffset` band tokens are gone.
- Removed: `Subnav`, `BottomNav` (zero current uses; a bottom tab bar is refused by R316), `NavigationFeatureNav`, and their styles, `--starci-core-bottom-nav-*`, `--starci-core-subnav-*` and `--starci-core-navbar-z` tokens, Offset Pop's dock sheet and their stories. Codemod `page-navigation` in `@starci/hfs` rewrites `PrimaryRailLayout` and `FormGrid` and reports the rest.

- Changed: ROWS, LISTS, SECTIONS (grammar audit 2026-11, lane 5). New `Section` (frame): a named `<section>` landmark whose `title` is the heading and the landmark name, with `description`, `count`, `meta`, one `action` that hugs its label at the end of the head row, `headingLevel` 2 to 6 and an `id` anchor; `kind="list"` draws `items` (the fields of a list row, plus `position` for an ordered list and `detail` for custom content) under an optional `filter` row (a `FilterButtonGroup`), with a required `empty` and `loadingRows`. Its head, filter and body stand one section step (24) apart; the head row is inline (8) and the title lines identity (4). Removed, not deprecated: `SectionHeader` (and its `eyebrow`, `composition`, `className`, free `level` 1), `Region` (and `spacing`), `List`, `ListItem`, `LeadingNumber`, `CollectionItem`, `ItemActions`, `ToolbarActions` and the public `Label`; the `.starci-core-section-eyebrow`, `.starci-core-region` and `.starci-core-semantic-list` styles go with them. Codemod `section-frame` (`starci app codemod section-frame`) migrates an app.
- Changed: `Text` has one stronger weight, `isStrong`, in place of `weight` (`medium` and `semibold` both draw `semibold`). `parentEmphasis`, `size="metric-lead"` and `tone="accent"` are gone; `TextWeight` is no longer exported.
- Changed: SMALL CUTS (grammar audit 2026-11, lane 7). Removed, not deprecated: `Backdrop`, `RankArtwork`, `IncludedMark`, `SurfaceCopyGroup`, `ConnectionStatus` and `CloseButton`; the `--grammar-art-*` tokens go with the medals. Codemod `small-renames` (`starci app codemod small-renames`) migrates an app.
- Changed: `ChatBubble` is `MessageBubble`. `ChatBubbleSkeletons` is `MessageBubble isSkeleton rows={n}`, a single skeleton bubble takes `hasAvatar`, and the props are a union so a skeleton carries no children. `ChatBubbleProps` and `ChatBubbleSide` are `MessageBubbleProps` and `MessageBubbleSide`.
- Changed: `StatusDot` is the dot alone (`aria-label` required, optional `echo`). A status with its words is `Badge isDot`, and `ConnectionStatus` is `Badge isDot isLive` (the dot echoes and the badge is a polite live region). The dot chip class is `starci-core-badge-dot`.
- Changed: `CloseButton` is `IconButton intent="dismiss"`, which draws the close glyph itself (`source` is optional only for that intent). Dialog, Drawer, Toast and Alert dismiss through it.
- Changed: `TextAction` has no `href`: a destination in text is `Link`. `EmptyNotice` has no `actionVariant` (its action is a `commit`). `DragItem` takes `tone` (neutral, accent, success, warning, danger) in place of `leadingColor`. `SegmentedControl` sizes are `sm` and `md`. `ButtonGroup` takes `actions` as data (`id`, `label`, `source`, `intent`, `onPress`, `isDisabled`), not children.
- Changed: `variant` is out of the public types (G-1 to G-3): `Button` and `IconButton` resolve the plate from `intent` and placement, fields and `Select` from the surface they stand on, and `Tabs` is the one underline bar. `size="control"` is out of `Button`, `IconButton`, `Input`, `SearchField` and `SegmentedControl` (G-4). `ButtonVariant`, `IconButtonVariant` and `InputVariant` are no longer exported.
- Changed: one field vocabulary (G-19). `Input` takes `isInvalid` in place of `isError`; `OtpInput` takes `isDisabled`, `isInvalid` and `onValueChange` in place of `disabled`, `invalid` and `onChange`. `foldForSearch` is no longer exported and folds without naming a language (combining marks and stroke letters).
- Changed: `FlowGraph layout="orbit"` is its own component, `BubbleMap`: `bubbleDiameter` (was `flowGraphDiameter`), `bubbleMapLayout` (was `orbitLayout`), `BubbleMapNode` (with `form`, `mark`, `caption`, `diameter`, `fill`, `ring`), `BubbleMapEdge`, `BubbleMapFill` and `BubbleMapRingPart`. `FlowGraph` keeps radial, layered, lanes and manual and exports `lanesLayout`.

- Changed: THE FOLDERS ARE THE LADDER (grammar audit 2026-11, section 4.2). `src/core` holds exactly `leaf`, `branch`, `composite` and `frame`; each component sits in the tier its test sorts it into, not in its old folder, and `primitive` and `composition` are gone. `data-tier` carries the folder (`leaf` for the old `atom`, `frame` for the old `composition`). Public import paths from `@starci/grammar/common`, `/core` and `/offset-pop` do not change. The Storybook group `Primitives` is `Leaves`.

- Changed: NO HARDCODED VALUE IN A COMPONENT RULE (grammar audit 2026-11, lane 3). `src/common/ramps.css` is the one place a type size, weight, leading, tracking, corner, stroke, opacity step, duration, loop cycle, part geometry or art colour has a number; every rule in `src/common` and `src/offset-pop` and every component reads it by name. Type: `--grammar-text-*`, `--grammar-leading-*`, `--grammar-weight-*`, `--grammar-tracking-*`. Corners: `--grammar-radius-*`, steps of the app's `--radius` (a literal 0.75rem, 1rem, 999px or 50% is a role now, so a theme that rounds its controls rounds the parts). Motion: `--starci-core-motion-duration`/`-easing` are defined once in Common; loops read `--grammar-loop-*`. Strokes `--grammar-hairline`, `--grammar-stroke-fine`, `--grammar-ring-width`. Offset Pop's small offset and corner steps are `--offset-pop-shadow-sm-*` and `--offset-pop-radius-*`.
- Changed: no `var()` fallback is a literal. The geometry tokens (`--starci-core-control-min-size`, the rail, sidebar, band and layer tokens, and the rest) are defined on the root and read bare; `--starci-core-subnav-rest` is the band a Subnav assumes when no band is sticky. Small value shifts: the workspace floating inset is 12 (was the off-scale 16), the flow graph lane radius 12 and label padding 8 and 4 (were 14, 6 and 3), motion that fell back to 150ms takes 180ms, line heights 1.2, 1.3 and 1.45 take the nearest step.
- Changed: HeroUI's `--disabled-opacity` is the disabled opacity everywhere (was 0.4 to 0.6 by rule), `--skeleton-animation` (shimmer, pulse, none) is honoured by every skeleton the grammar draws, and a `Tooltip`, `CopyField` and `StatusDot` no longer pass `delay={0}`, so `--tooltip-delay` is the app's.
- Changed: `Heading` carries no Tailwind class (its look is `data-level` and `data-scale` in the stylesheet), `ListBox` marks an unread item by `data-grammar-list-emphasis` instead of an inline weight, `Skeleton` circle is `data-shape`, `RankArtwork` fills read `--grammar-art-*`, `MermaidDiagram` reads its font size from `--grammar-text-md` and keeps no system-colour fallback, `FlowGraph` reads its tones bare and draws its canvas units from the spacing scale (`COMMON_SPACING_PX`).
- Added: the lint that keeps it so. `eslint.config.mjs` and `stylelint.config.mjs` (rules in `scripts/lint/`) refuse a literal colour, radius, type value, shadow geometry, duration, easing, opacity, literal `var()` fallback, utility class that decides a look and off-scale spacing; `npm test` runs them, so CI judges every change. Dev dependencies: eslint, typescript-eslint, @eslint/js, stylelint, postcss-value-parser.

- Changed: THE APP OWNS THE THEME (grammar audit 2026-11, section 8). No stylesheet declares a HeroUI token on the grammar root any more, so an app's `--accent`, `--background`, `--scrollbar` and every other HeroUI token, set on `:root`, `.light` and `.dark`, reaches every part in both families. Common reads HeroUI's tokens first, with no private token before them and no literal fallback; `*-soft` pairs and hovers are derived by HeroUI from the app's values (so default tints follow HeroUI's mixes, not Common's old 50/50 ones), and `--info` with its pairs, which HeroUI lacks, falls back to `--accent` at each read.
- Added: `@starci/grammar/core/theme.css` and `@starci/grammar/offset-pop/theme.css`, each family's default palette as HeroUI tokens on `:root, .light` and `.dark`, in the first layer (`starci-grammar-theme`) and optional: an app with its own theme skips it or writes its values after it. Import it after `@heroui/styles`. The family sheets keep only rules, geometry and motion.
- Changed: the accent painted as text on the page (link, current tab and bottom-nav destination, section eyebrow) reads `--accent-soft-foreground` through one Common rule, replacing each family's own text-safe accent; `accentText` is gone, the pair rule holds (accent alone is `--accent`, on its tint `--accent-soft-foreground`).
- Changed: Offset Pop's palette is HeroUI's: ink is `--foreground`, pink `--accent`, yellow `--warning`, mint `--success`, critical `--danger`, blush `--accent-soft`; `--offset-pop-shadow-ink` (the colour of the hard offset) stays, reads `--foreground` when unset, and the surface shadow is `--surface-shadow`. Core's `--shadow-surface` and Offset Pop's are `--surface-shadow`, the token HeroUI's own cards read. Radii derive from `--radius`.
- Changed: the grammar no longer forces `scrollbar-width: none` on every descendant; it reads `--scrollbar-width`, `--scrollbar`, `--scrollbar-track` and `--scrollbar-gutter`, so an app's scrollbar shows.
- Changed: `GrammarRoot theme` sets nothing (the mode is the app's, `.dark` on `html`) and is deprecated; `data-grammar-theme` is not rendered. `STARCI_CORE_TOKEN_NAMES`, `OFFSET_POP_TOKEN_NAMES` and their default objects name HeroUI's tokens and are deprecated; `--starci-core-<colour>` and `--offset-pop-<colour>` names are removed.
- Changed: the flow graph lane copy and the filter button gaps take the identity step (4) instead of 2 and 6.

## 0.20.2 - 2026-11-01

- Changed: the status pair rule: content on a tone background wears `x-soft` and `x-soft-foreground`, a mark that stands alone wears `x`. The alert dialog icon tile drew the tone as text on a 16% tint of itself; it now takes the tone's soft pair (`--starci-core-overlay-soft` and `--starci-core-overlay-soft-foreground`, set per tone beside `--starci-core-overlay-tone`), in every tone and both families.
- Changed: core's light `--success`, `--warning` and `--info` are darker (`oklch(62.8% 0.1941 162.85)`, `oklch(67% 0.159 84.37)`, `oklch(66.8% 0.17 250)`): a bare mark reaches 3:1 on the surface, a solid fill keeps 5.8:1 ink, the soft pairs keep 4.5:1 or more. The step error and paused markers and the lost-connection status are bare x; Offset Pop's light theme keeps the soft foreground for them through `--starci-core-mark-danger` and `--starci-core-mark-warning`, and its dark theme resets them to the tone.
- Changed: the reader's own `ChatBubble` (`side="outgoing"`) is the brand fill `--accent` with `--accent-foreground` and the other party's is the surface; a link, a mention, code and a muted Text inside an outgoing bubble inherit its foreground (Offset Pop too).
- Added: `SurfaceCard` takes a `footer`, the same small muted bottom line as `SurfaceListCard`, so a card whose note was a hand line under it keeps it in the card.
- Added: `FilterButtonGroup`: peer filter values as one row of `sm` toggle buttons (the vendor ToggleButtonGroup, single selection, optional count), never wrapping: the fit is measured from the real width and the options that do not fit go behind a "+n" button that opens a search list (tone-mark-free match), a chosen hidden option taking the place of the last visible one; selected is the accent soft pair. Removed: `TagGroup` has no selection (`selectionMode`, `selectedIds`, `defaultSelectedIds`, `onSelectionChange`): it holds values the user entered, with remove or reorder.
- Added: `FlowGraph layout="lanes"`: branch lanes, a column per stage and one row per branch of a condition; one width per node with an optional subline (`description`); `kind` (`trigger`, `condition`, `execute`, `output`) sets the tone through the soft pair; orthogonal edges with rounded corners, an arrowhead and one fork point per node; a branch label on its own edge; sentence-case column headers only over a column that holds a node; the canvas is as tall as the graph and never magnifies it, and a graph wider than a narrow canvas starts at its first column. Exports `lanesLayout`. Stories: Flow graph lanes (Chatbot, 9 nodes; Sales, 24).
- Fixed: inside a `FlowGraph` every theme variable came back as HeroUI's light value whatever the theme of the Grammar root (React Flow's `light` class re-scopes the HeroUI theme), so a node was white on a dark canvas; the graph takes the root's values back.
- Changed: in Offset Pop the `Divider` between the bands of a joined card is the outline width (2px), as the stat strip's lines are.
- Added: `--info-soft`, `--info-soft-hover` and `--info-soft-foreground` in Common (the information tone had no soft pair, so a tone read from it fell back to the accent); Offset Pop binds them to its blush accent pair (a mix of its pastel information tone into the ink read 2.5:1 on its own tint). The flow graph's information node and the ink band read them.
- Fixed: the footer of a `SurfaceListCard` is a small muted line the full width of the list (12px, the muted ink); a `Text` an app puts in it takes the same size and ink instead of drawing a second, larger line.
- Stories: Status pair (the alert dialog in every tone, the surface list footer, a joined card with the stat strip and a Meter), rendered in Core and Offset Pop, light and dark.
- Fixed: `DescriptionList layout="stat-strip"` drew no dividers (none at all below 48rem, a column gap with an inset rule above it). The cells now touch (gap 0), each inset by the nested step (8), and a line runs between the cells of a row and between rows, at every wrap, to the strip's edge and never on its outer edge (each cell draws its start and top edges as box-shadows; the strip clips the outer ones), so an odd last cell is divided correctly. The strip answers its own width through a container query, with no script: one row from 40rem, 2 x 2 from 18rem, one column below; it follows the viewport no longer. In a default card it bleeds to the card edge, in a `SurfaceCard composition="joined"` it is a band. Line colour is `--separator` (Offset Pop: the ink outline), so dark mode follows the tokens; loading keeps the same cells and lines.
- Fixed: a `Divider` between the bands of a `joined` card is a seam (no margin of its own) instead of keeping the card inset above and below it.
- Stories: Navigation & Data / StatStripDividers (four widths, an odd last cell, a joined card with a Meter band, loading, light and dark).

## 0.20.1 - 2026-11-01

- Changed: moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.20.1, RELEASE_VERSION_NOT_BUMPED: their bundled canon pins changed); no component changed.

## 0.20.0 - 2026-11-01

- Added: `Quote` (`children`, `source`, `byline`, `isSkeleton`; `QuoteProps`): words taken from a source, drawn as a `<blockquote>` on a tinted ground at the nested inset (`--grammar-inset-nested`), one radius below the host surface, with no shadow, outline or action. It is not a surface, so it is legal in a pane, a card and a drawer. Registered in Common, so every family renders it; its contract is the `quote` role of `grammars/contract.yaml` and it wraps no vendor part, so it has no parity entry. Story: Compositions / Quote.
- Changed: moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.20.0); no rule changed.

## 0.19.1 - 2026-11-01

- Changed: moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.19.1, RELEASE_VERSION_NOT_BUMPED: their bundled canon pins changed); no component changed.

## 0.19.0 - 2026-10-31

- Added: `FlowGraph layout="orbit"`, the value-sized map. The root sits at the centre; ring two holds its children in sectors weighted by what they hold, ring three their children staggered on two radii, and ring four the fans of the open ring-three nodes, pushed apart and cut at the widest empty arc. Dashed ring guides sit under the nodes. `orbitLayout` is exported as a pure function.
- Added: nodes that open and close: `expandedIds`, `defaultExpandedIds`, `onExpandedChange`. A node's children past ring three show only while it is open; `fanLimit` (default 30) folds the rest of a fan into a `+n` bubble that selects the parent. Enter, Space and click select the node and toggle it; an openable node is a button that reports `aria-expanded`.
- Added: node `form: "bubble"` with `mark` (cut to 4 characters), `caption`, `diameter` (24 to 128 graph units) and the exported `flowGraphDiameter(value, max, range?)`, a square-root scale so the disc's area tracks the value. A bubble's `label` is its name for hover and screen readers; its text keeps one screen size through `--starci-flow-zoom` and drops out under zoom 0.42 (caption) and 0.5 (mark).
- Added: status that does not rest on colour alone: `fill` (`solid`, `half`, `soft`, `outline`, `hatched`) beside `tone`, and `ring`, a conic ring of `{ tone, value }` arcs round an inner disc.
- Added: `FlowGraphTone` `info`, painted from `--info`.
- Added: one tip on hover and focus of a bubble (the label, then the description), hidden on pan and zoom and on blur, in the Tooltip's tokens. `isDimmed` draws a filtered-out node faint (it keeps its place and stays focusable) and its edges dim with it. In `orbit` the edges from the root to the selected node draw strong and a selected bubble draws an outline. The screen-reader list follows the nodes that draw.
- Added: `Stepper` `size="dense"` (a 20px marker and 12px type, for a list row; `data-grammar-stepper-size`) and the `paused` step state (a dashed circle in the warning ink; `StepperSize`).
- Added: `Progress` `tone` (`accent` default, `success`, `warning`, `danger`, `info`; `ProgressTone`, `data-grammar-progress-tone`) and `valueText` on a bar, the spoken reading (`aria-valuetext`) such as "56 of 120 chunks, paused"; before, only step mode had one.
- Added: `ConnectionStatus` (`state`: `live`, `reconnecting`, `lost`; `label`): a dot and its words in a polite live region, the dot echoing while live or reconnecting and still when lost. Registered in Common; its contract is the `chip` role of `grammars/contract.yaml` and it wraps no vendor part, so it has no parity entry.
- Changed: a `readable` fit with only bubbles has no label text to keep at 12px and fits like `contain`. Existing `radial`, `layered` and `manual` graphs render unchanged.
- Changed: the Grammar moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.19.0, which follow the same Grammar). Stories: Navigation & Data / FlowGraph (orbit: bubbles, rings, fans) in light and dark.

## 0.18.0 - 2026-10-31

- Changed (breaking values): one spacing scale, 0 4 8 12 24 32 with no 16 (`COMMON_SPACING_SCALE`; the family scales are Common's). Root tokens by role: gaps `--grammar-identity-gap` 4 (new), `--grammar-inline-gap` 8, `--grammar-row-gap` 12, `--grammar-section-gap` 24, `--grammar-region-gap` 32; insets `--grammar-inset` 12 (new: every container), `--grammar-inset-nested` 8 (new: a box inside a card), `--grammar-inset-open` 24 (new: an empty state or drop target); `--grammar-page-inset` 12, 24 from 48rem, 32 from 70rem (no `clamp`); `--grammar-card-padding-inline`/`-block`, `--grammar-overlay-inset` (new) and the four `--grammar-pane-inset-*` read `--grammar-inset` (12 on every side); `--grammar-control-padding-inline-{sm,md,lg}` 8 / 12 / 24 and `--grammar-control-padding-glyph-*` 4 / 8 / 12 (new).
- Added: `Stack` (`gap` role, `align`, `measure`, `as`), `Cluster` (one `gap` role on both axes, `wrap`, `align`, `justify`) and `Grid` (`kind="cards"` with `columns?: 2 | 3 | 4` and the section gap on both axes; `kind="form"` renders `FormGrid`; `kind="main-rail"` renders `PrimaryRailLayout`); none takes a class or a style. `COMMON_GAP_ROLES`, `GapRole`, `CommonGapRole`.
- Changed: every off-scale spacing value of the sheets is on the scale (the 6px meter gap is identity, the dialog and drawer body lose the 3px offset, 2px gaps are identity, forms and dialogs space their bands by the row gap, the empty notice and the drop target take the open step, a nested card and an alert in a card the nested step). `components-spacing.css` restyles the vendor parts' padding and gap in the vendor `components` layer (dialog, drawer, button inline padding with the glyph side, alert, toast, list option, table cells), with no `!important`.
- Changed: on `Page chrome="panes"` the header takes the container inset 12 at every width (the title, the first tab and the pane content share one edge) and its band spans the full width.
- Changed: `Tabs` default to the underline bar everywhere (no pill inside a surface); the first label stands on the content edge. `Button` stamps `data-grammar-button-start`/`-end="glyph"`. `Rail inset="content"` is the container inset on every side.

## 0.17.1 - 2026-10-31

- Fixed: `Page` renders from a server component again. 0.17.0 called the fill measuring hook inside `Page` itself, so every `Page` rendered by a server component failed with "Attempted to call useFillMeasure() from the server". The measured fill box of `chrome="panes"` is now its own client component (`PanesFill`), and `Page` calls no hook.

## 0.17.0 - 2026-10-31

- Added: `PaneSection`, the one band primitive of a Pane (composition tier, exported from common, core and offset-pop; type `PaneSectionProps`): `grow`, `scroll` (`{ label, role, tone, scrollRef }`, a full-bleed scroll owner with the inset inside), `align` (`start` | `center`), `bleed="inline"`, `gap` (`inline` | `row` | `section`) and `as` (`div` | `header` | `footer`); no `className`, no `style`. It throws `PANE_SECTION_OUTSIDE_PANE` outside a Pane. Data-contract `PADDING-4 GAP-3`.
- Added: `Pane` owns its content inset: `inset?: "content" | "flush"` (default `content`; type `PaneInset`). The pane never pads itself; it publishes `--starci-core-pane-inset-inline`, `--starci-core-pane-inset-block-start` and `--starci-core-pane-inset-block-end` (outer or divider per breakpoint, from the grid layout's new `blockEnd`) to its PaneSections, so dividers, nested grids and scrollbars stay full-bleed. Data-contract `PADDING-4 PADDING-3` (content) or `PADDING-0` (flush). Drawer panes render under the same inset and the drawer header's inline padding is the pane inset.
- Added: `Page chrome="panes"` (`PagePanesProps`): the header band or the trail, then exactly one PaneGrid attached flush under the band's separator in a measured fill box (gap 0, no block padding, no radius, to the viewport bottom less Grammar bottom chrome, `minHeight` floor). FillViewport's measuring is one shared hook (`useFillMeasure`) used by both. Data-contract `LAYOUT-1 BOUNDARY-1 GAP-0`.
- Added: root tokens, one place per axis: `--grammar-pane-inset-inline` (1rem), `--grammar-pane-inset-block-start` (0.75rem), `--grammar-pane-inset-block-end-outer` (1rem), `--grammar-pane-inset-block-end-divider` (0.75rem) and the card padding `--grammar-card-padding-inline` / `--grammar-card-padding-block` (1rem; SurfaceCard and SurfaceListCard content, the full-bleed divider margins and the Core labelled-panel label). Offset Pop inherits them.
- Changed: in a Pane, `ListBox` resolves `inset="panel"` (not only under a surface) and drops the vendor listbox inline padding (an inline style, because the vendor rule sits in a later cascade layer), and a `Tabs variant="secondary"` track drops its inline padding, so the row box, the selected pill and the first tab pill start at the content edge. A Pane is a flex column now.
- Changed (breaking): `Pane` no longer takes `className`. In development `PaneGrid` throws `PANE_GRID_CHILD_NOT_PANE: <type>` for any child that is not a Pane element (`null`, `false` and arrays of Panes stay legal; production keeps filtering), and a content Pane that registers no PaneSection and no PaneGrid logs `PANE_WITHOUT_SECTION: <area>`.
- Stories Compositions / Renderers: the PaneGrid stories use PaneSection; PaneInset, PaneInsetPhone, PagePanes and PagePanesPhone assert the 16px content edge, the grid top at the tab line and the grid bottom at the viewport bottom at 1200 and 375px.

## 0.16.6 - 2026-10-31

- Changed: no component changed; the version moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.16.6, which follow @starci/hfs 4.14.0), so the Grammar and its lint packages stay one version.

## 0.16.5 - 2026-10-31

- Changed: no component changed; the version moves with its lint family (eslint-grammar-core and eslint-grammar-offset-pop 0.16.5, which follow @starci/hfs 4.13.2), so the Grammar and its lint packages stay one version. 0.16.4 was never a Grammar version.

## 0.16.3 - 2026-10-31

- Removed (breaking): `ChatWorkspace` and `PaneLayout` (with `ChatWorkspaceProps`, `PaneLayoutProps`), with no alias; `PaneGrid` replaces them. The grammar is a generic UI/UX layer, so a name states the layout role, never a product feature. Their hooks go with them: classes `.starci-core-pane-layout*`, attributes `data-grammar-pane-layout*` and the `paneLayout*` class-name exports; the slot props (`conversation`, `conversationLabel`, `composer`, `header`, `rail*`) have no successor, an app places its own pieces in panes. Story Compositions / PaneGrid.
- Added: PaneGrid and Pane, the one generic pane grid. `PaneGrid` takes `label`, `areas` (`grid-template-areas` rows such as `["a b c", "d d d"]`), `columns` and `rows` (track roles `auto`, `fill`, `fill-2`, `fill-3`, `compact`, `standard`, `wide` from the Rail widths), each also as an object keyed by breakpoint (`base`, `medium` from 48rem, `wide` from 70rem), chosen by CSS container query on the grid's own width. Panes sit flush; one divider, in the shared separator colour and weight, separates neighbours (n-1, never doubled, none on an outer edge) at every breakpoint. `Pane` takes `area`, `surface` (the flat `--surface` ground with no border, radius or shadow; default transparent), `scroll` (its own VerticalScrollRegion, needs `label`), `label`, and `collapse="drawer"` with `collapseLabel`, `openLabel`, `closeLabel`, `isOpen`, `onOpenChange` (a Drawer opened from a trigger above the grid wherever its area is not arranged, below 48rem for a single `areas`). A pane imposes no padding or structure on its children. Types `PaneGridProps`, `PaneProps`, `PaneTrack`, `PaneBreakpoint`, `PaneResponsive`, `PaneByBreakpoint`. Stories Compositions / Renderers: PaneGrid, PaneGridApp, PaneGridResponsive.
- Added: Freestyle, the one sanctioned escape hatch: a div that fills its host where the app writes its own plain elements and CSS (layout, paint, radius, arbitrary values, absolutely positioned art) because no Grammar component fits. It takes `children`, `className` and a required `reason` (stamped as `data-grammar-freestyle-reason`; `data-component="Freestyle"`, `data-grammar-freestyle`), adds no paint of its own, and is a last resort. Story Surfaces / Freestyle.

## 0.16.2 - 2026-10-31

- Changed: a horizontal Stepper is a track: each step is an equal column with its marker centred over its label, and a connector line joins the markers through their centres (the accent after a completed step, the border colour otherwise); below 30rem every step keeps its equal column so the line stays straight.
- Fixed: a SurfaceListCard inside another surface (a SurfaceCard, a wizard step card) drew the top-level face, no outline and a shadow that vanishes on the parent: its depth now comes from the surface context like SurfaceCard's, so a nested list is outlined (BOUNDARY-5, DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE); `depth` still overrides.

## 0.16.1 - 2026-10-30

- Added: `accentCorner` on SurfaceCard and MediaFrame (start-start, start-end, end-start or end-end): that one logical corner is drawn at the Common accent radius `--grammar-accent-corner` (2.5rem) while the others keep the family's surface radius; the type is exported as `AccentCorner`. Story Surfaces / Accent corner checks both families.
- Added: Backdrop, the brand's own ground in a split screen (a sign-in brand half): the family's accentSoft tint full-bleed in its host, no border, shadow or card inset, the brand copy as children at the top and an `artwork` slot (a hero Mascot) taking the height left, with `accentCorner`. Story Surfaces / Backdrop.
- Fixed: a page-scrolling WorkspaceShell is at least one viewport tall (min-block-size 100dvh), so the canvas under a short page runs to the bottom of the screen instead of ending under the content. Story App shell layers / Short page fills viewport.
- Fixed: the StatusDot play expects the sm chip's 8px inline pad (the 2026-10-28 fix) instead of HeroUI's 4px.

## 0.16.0 - 2026-10-30

- Changed: the build and capture tools (build stamp, clean, CSS copy, plays, reference and SVG shots) are TypeScript, typechecked by tsconfig.scripts.json; no component change.
- Added: Mascot, one size scale for generated character art: size sm (6rem), md (10rem, default), lg (15rem) or hero (the container's height up to 30rem), always contained on a transparent ground with no plate, decorative when alt is empty, one step down below 48rem, a hero hidden below 64rem unless visibility="always"; it carries the Image provenance props (assetSlot, assetSha256, assetPrompt). Tokens --grammar-mascot-sm, -md, -lg, -hero-max.
- Added: SurfaceCard treatment soft, the brand's light tint (--accent-soft) with the default foreground, keeping the artwork slot.
- Added: EmptyNotice artwork (src, alt, loading and the provenance props, assetSlot required), drawn as a Mascot at md; it replaces iconSource for a first-run notice.
- Fixed: a vertical Stepper inside a coloured SurfaceCard drew upcoming step numbers in their circle's colour (1.04:1 on ink): every coloured treatment re-colours --surface with its text tokens and the step marker reads matching pairs; a play story checks every step number at 4.5:1 for every treatment in light and dark.

## 0.15.34 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.34), which re-pin hfs 4.11.22.

## 0.15.33 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.33), which re-pin hfs 4.11.21.

## 0.15.32 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.32), which re-pin hfs 4.11.20.

## 0.15.31 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.31), which re-pin hfs 4.11.19.

## 0.15.30 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.30), which re-pin hfs 4.11.18.

## 0.15.29 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.29), which re-pin ai-router 0.4.0.

## 0.15.28 - 2026-10-30

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.28), which re-pin hfs 4.11.16.

## 0.15.27 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.27), which re-pin hfs 4.11.15.

## 0.15.26 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.26), which re-pin hfs 4.11.14.

## 0.15.25 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.25), which re-pin hfs 4.11.13.

## 0.15.24 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.24), which re-pin hfs 4.11.12.

## 0.15.23 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.23), which re-pin hfs 4.11.11.

## 0.15.22 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.22), which re-pin hfs 4.11.10.

## 0.15.21 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.21), which re-pin hfs 4.11.9.

## 0.15.20 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.20), which re-pin hfs 4.11.8.

## 0.15.19 - 2026-10-29

- Changed: moves with the 0.15.19 cohort; no code changed.

## 0.15.18 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.18), which re-pin hfs 4.11.6 and pin `undici` in the canon pins.

## 0.15.17 - 2026-10-29

- Changed: moves with the 0.15.17 cohort; no code changed.

## 0.15.16 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.16), which re-pin @starci/test-world 1.3.0 in the canon pins.

## 0.15.15 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.15), which re-pin the hfs 4.11.3 canon.

## 0.15.14 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.14), which re-pin the hfs 4.11.2 canon.
- Changed: its lint family's canon pins also carry the hfs 4.11.1 re-pin of db baseline --squash (R213 transaction control in migrations, extensions schema in the bootstrap), which bumped no eslint package.

## 0.15.13 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.13), which re-pin the hfs 4.11.0 canon.

## 0.15.12 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.12), which re-pin the hfs 4.10.1 canon.

## 0.15.11 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.11), which re-pin the hfs 4.10.0 canon.

## 0.15.10 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.10), which re-pin the hfs 4.9.11 canon.

## 0.15.9 - 2026-10-29

- Changed: no component change; the version moves with its lint family (eslint-grammar-core and offset-pop 0.15.9), which re-pin the hfs 4.9.10 canon.

## 0.15.8 - 2026-10-29

- Added: `Page` `chrome="bleed"` (default `"standard"`), the app surface of a chat or a split editor: no inline gutter, no block-start or block-end padding, no `overflow: clip`, and the page and its body grow to fill the region, so a `FillViewport` in the body keeps its own bottom inset, never doubled (the fixed bottom navigation's padding skips a bleed page too). Its `header` is optional; a bleed header without a `title` is the trail alone (`{ breadcrumbs }`, type `PageTrailContent`: no heading, no band, no other slot), and a header with a `title` draws the band as in standard. `PageProps` is the union `PageStandardProps | PageBleedProps`, so `header.title` is optional only in bleed. The root carries `data-grammar-page-chrome` and `data-grammar-page-trail`. New types: `PageChrome`, `PageStandardProps`, `PageBleedProps`, `PageTrailContent`.
- Added: stories `Compositions/Renderers` PageBleedTrail (breadcrumbs only) and PageBleedBand (the band with link tabs).
- Changed: versioned together with `@starci/eslint-grammar-core` and `@starci/eslint-grammar-offset-pop` 0.15.8 (R325 reads the layout of a tabbed segment).

## 0.15.7 - 2026-10-29

- Changed: versioned together with `@starci/eslint-grammar-core` and `@starci/eslint-grammar-offset-pop` 0.15.7 (R325 reads a page's one `Page` through its root block). No component changed.

## 0.15.6 - 2026-10-28

- Added: link tabs. A `TabItem` takes `href`; a tab with one renders as a link and navigates through the `GrammarRoot` router (`navigate`, `useHref`) or the browser. `TabsProps.selectedKey` is optional: link tabs without it select the tab whose `href` is the current path, else the longest `href` the path lies under, else the first tab, and follow history moves; a press moves the indicator ahead of the route change. A server page can therefore pass `Page` `header.tabs` (or `PageHeader` `tabs`) as plain data with no `onSelect`. Controlled tabs (`selectedKey`, `onSelect`) are unchanged.
- Added: `Button` `form` (commands only, beside `type`): the `id` of the form the button submits or resets from outside it, so a `Drawer` or `Dialog` footer commit submits the form in the overlay's body.
- Added: story `Compositions/Renderers` PageHeaderLinkTabs (the tab of the current path is selected and is an anchor).

## 0.15.5 - 2026-10-28

- Fixed: `Alert appearance="soft"` now applies its tone's soft tint at half strength and removes the surface shadow, as documented by `AlertAppearance` and the 2026-10-11 ruling. The default surface appearance and Alert anatomy are unchanged.
- Added: `CopyField` (contract role `copy-field`), a read-only value with its copy action inside the field at its end, in HeroUI's field anatomy (Label, the InputGroup frame with the value and a Suffix action, description, FieldError) and at the 40px field height, so it sits level with `Input`, `Select` and `NumberField`. Props: `label`, `isLabelHidden`, `value`, `description`, `copyLabel`, `copiedLabel`, `copyErrorLabel` (the app's words; nothing is hard-coded), `onCopy`, `isDisabled`, `isSkeleton`, `variant` (from context when omitted). The value is a read-only textbox named by the label whose text is the whole value; a long value is truncated in the middle (the last eight characters stay) with the whole value in a Tooltip on hover and focus. `masked` with `lastFour` draws eight bullets and the last four characters and no Tooltip; its `onCopy` resolves the clear value (it may be async, a server reveal) and the field writes it to the clipboard through a `ClipboardItem` built in the press, keeping no copy. A plain copy uses the Clipboard API and calls the optional `onCopy(value)` after. A copy swaps the glyph and the action's name to `copiedLabel` for 2s and announces it politely; a refused copy shows `copyErrorLabel` in the field's error slot, describes the action and marks the field invalid. Icons come from `@heroicons/react`. Exported types `CopyFieldProps`, `CopyFieldPlainProps`, `CopyFieldMaskedProps`, `CopyFieldState`.
- Added: `FormGrid` (`columns` 1 or 2, default 2): fields fill rows; each row is a grid of four tracks (label, control, description, error) that every field takes as a subgrid, so the controls of a row stand on one line whatever label, description or error a neighbour carries. Two columns come from a container query on the grid's own width (32rem); below it each row is one column.
- Fixed (field anatomy): `Input`, `Field` and `FileDropzone` drew the description between the label and the control. Every field now draws HeroUI's order, label, control, description, error; groups (`RadioGroup`, `CheckboxGroup`, `Fieldset`) keep HeroUI's group order. `Input`'s label and description take the Common field classes and hooks (`starci-core-field-label`, `data-grammar-field-label`, `data-grammar-field-description`), so its label paints as every other field's in both grammars.
- Fixed: the `NumberField` group was 36px, the vendor's minimum, so it sat 4px short beside an `Input`; the `SearchField`, `NumberField` and date groups now hold the 40px field floor like `Input` and `Select` (DNA-COMMON-FIELD-MD).
- Added: stories with plays, run per grammar: `Forms/Copy field` Plain (CopyField height equals the Input's, 40px), Masked (the clear value is never in the document, before or after a copy, and the copy writes what `onCopy` resolved), Long value (truncated in the middle, the tail whole before the action, the whole value in the text and in the focus Tooltip), Copied (state, name and announcement, back after about 2s), Copy failed (error slot, description, announcement), Skeleton (the loading field keeps the ready box), With description (under the control, describing the value); `Forms/Form grid` Control line (2 columns: equal control tops and heights per row, every description under its control), Narrow owner (1 column), Skeleton; `Primitives/Skeleton parity` Forms gains the CopyField pairs.
- Migrate: an `Input isReadOnly isCopyable` that shows a value the reader only copies becomes a `CopyField`; a secret becomes `CopyField masked` with `lastFour` and an `onCopy` that reveals it. Pairs of fields laid side by side by hand become a `FormGrid`.

## 0.15.4 - 2026-10-28

- Fixed: a `Button` with `width="fill"` was 36px at desktop width: the size rules excluded the fill form so a wrapped label could grow, which left it to the vendor's `md:h-9`. The fill form now holds its step as a floor (md and control 40px, sm 32px, lg 48px) and only a wrapped label grows it. Story `Primitives/Control heights` FillWidthAtForty measures a sign-in card's submit, sm, lg and a wrapping label.
- Added: `MermaidDiagram` (contract role `diagram`): `source`, `label`, `height` (`sm` 16rem, `md` 24rem, `lg` 32rem, the least canvas box of every state), `errorTitle`, `sourceLabel`, `isSkeleton`, `className`. Mermaid 11.16.0 is an exact dependency, imported on the first diagram; it renders with `theme: "base"`, `securityLevel: "strict"` and colours resolved from the root's semantic tokens, and re-renders when the root's theme changes. A refused source is an `Alert` and the source as a `FencedCodeBlock` in the same frame. Exported types `MermaidDiagramProps`, `MermaidDiagramHeight`.
- Added: `FlowGraph` node `shape` (`stadium` default, `rect`, `round`, `diamond`, `circle`; type `FlowGraphNodeShape`) and edge `label`, drawn on a surface chip at the edge midpoint and repeated as "source → target: label" in a visually hidden edge list.
- Added: `Page` (contract role `page`): `header` (PageHeader's props as data, type `PageHeaderContent`), `children` (the body), `measure` (`reading`, `product`, `full`), `isSkeleton` (passed to the header), `className`. The band runs full width; the body sits in the measure and gutter one region step below it (or below the top without a header), its sections a region step apart, and clips one gutter step past its content box so nothing reaches across the gutter.
- Changed (breaking for pages that relied on a frame's inset): `Page` is the single owner of the page inset. No Grammar layout frame wraps a page in `PageContainer` (`WorkspaceShell`, `PrimaryRailLayout` and `PaneLayout` never did; `NavigationFeatureNav`'s container is its own bar), and `@starci/eslint-grammar-core` 0.15.4 refuses a page owner that draws `PageHeader` or `PageContainer` itself or anything beside its `Page` (R325), and page tabs outside the header (R324). The fixed bottom-nav offset applies to the outermost `Page`.
- Added: stories with plays: `Compositions/Renderers` Page, PageWithoutHeader, PageSkeleton; `Navigation & Data` FlowGraphFlowchart, MermaidDiagram. The settings and members page recipes and the app shell demo are drawn with `Page`.
- Migrate: a page owner's `PageHeader` plus `PageContainer` becomes `<Page header={{ ...headerProps }} measure={measure}>{content}</Page>`; page tabs move to `header.tabs`.

## 0.15.3 - 2026-10-28

- Added: `PageHeader`, the page header band (contract role `page-header`). Slots: `breadcrumbs` (`label`, `items`, `onAction`), `title` (the page's one `h1`; `titleId` names it), `description`, `meta`, `status` (chips beside the heading), `mark` (an identity mark left of the heading), `actions` (at the end of the heading row, wrapping under the heading at phone width) and `tabs` (page tabs, drawn as the underline bar). The band is the surface over the page background; its content sits in a `PageContainer` of the content's `measure`, so header and content edges align, with the region step above and the page inset inline. It ends in its own full-width separator (a presentation `Divider`), drawn with or without tabs; page tabs stand on it and the selected underline lies over it; the content below starts one region step after the band. `isSkeleton` keeps every slot's box (title, description, meta, status, mark and actions as measured placeholders; the trail and the tab labels stay real). Core draws the separator as the 1px `separator` hairline, Offset Pop as the TopBar's ink rule with a heavy heading.
- Added: stories `Compositions/Renderers` PageHeader (no tabs), PageHeader with page tabs and PageHeader at 360px, each with a play asserting the full-width separator at the band's bottom edge, the aligned content edge and the selected underline on the separator; `Primitives/Skeleton parity` Rows gains the PageHeader pairs with and without tabs.
- Migrate: a page head composed from `Breadcrumbs` and `SectionHeader` becomes one `PageHeader`, first in the primary region and outside the content's `PageContainer`; `@starci/eslint-grammar-core` 0.15.3 refuses the hand-rolled head.

## 0.15.2 - 2026-10-28

- Changed: versioned together with the Grammar lint families 0.15.2, whose bundled canon pins changed. The Grammar is unchanged.

## 0.15.1 - 2026-10-28

- Fixed: `GrammarRoot`'s module is a client module (`"use client"`, kept in `dist/`): it imports `RouterProvider` from react-aria-components, so a server component rendering it broke `next build` ("createContext is not a function"). Versioned together with the Grammar lint families 0.15.1.

## 0.15.0 - 2026-10-28

- Changed: versioned together with the Grammar lint families 0.15.0 (a minor: `SurfaceCard placement` moves a labelled Core card's label outside unless it is a `panel`), released with the release C pins.

- Added: `SurfaceCard placement` (`floating` default | `panel`), stamped as `data-grammar-surface-placement`. Each family places a card label per placement. Core: a floating card's label is an unpainted row above the material (the Common anatomy SurfaceListCard shares); a panel card (a docked panel or full-height region of the layout) carries its title inside, as the card header, inset by the surface inset. Offset Pop keeps both outside. Migrate: a Core labelled card that is a docked panel takes `placement="panel"`; every other labelled Core card now draws its label outside the card.
- Changed: a horizontal `Divider` placed in a card's content region runs full bleed, card edge to card edge (inset 0), with the card inset above and below it.
- Changed (skeleton parity): a loading leaf keeps the box of its ready state at the same size and props, in both families. A text skeleton line now takes exactly the line box of its type (`1lh`, the bar centred by its margins; contexts size the bar through `--starci-core-skeleton-line`), so `Skeleton lines={n}` is as tall as n lines of that copy. `Text` and `TextAction` skeletons are the same element (display, size, overflow, pressable floor) with the copy laid out unseen inside a shimmer bar; `Button`, `Badge` keep their start/end content as an unseen measured placeholder; `Icon` takes its usage box; the Offset Pop avatar ring is not drawn around a loading avatar; `SectionHeader`, `DescriptionList` (values now shimmer), `ListBox` and `Timeline` loading rows take the ready rows' line boxes.
- Changed (skeleton parity, forms): every form control's `isSkeleton` renders its ready anatomy (label, description, control box, options) inside an inert, `aria-busy` scope whose control boxes are painted as a Skeleton, replacing the fixed-height geometry blocks. The description now stays while loading (it is static guidance); nothing is invalid or pending while loading.
- Added: `isSkeleton` on `StatusDot` (text and dot-only), `Checkbox`, `RadioGroup`, `ComboBox`, `Field`, `Code`, `Terminal`, `TagGroup`, `Alert` and `FencedCodeBlock`.
- Added: `Primitives/Skeleton parity` stories, eight groups (typography, actions, status, identity, rows, collections, forms, content), each a side-by-side story whose play asserts every pair's border box and margins equal within 1px, plus `<Group>Ready` / `<Group>Loading` stories paired by `parameters.dna` for the `skeleton-parity` DNA gate. `Forms/Control states` covers the standard state set per control family with a play per family. `scripts/run-plays.mjs` runs every play headless per family against a running Storybook (Storybook 10 reports a failed play only on the preview channel).
- Fixed: the `Control heights` play skips a control that draws no box (the Tabs scroll carets while the row does not overflow).
- Added: the `Surfaces/Floating card and panel` story asserts per family, light and dark: a floating label above the material, a panel title inside it (Core) or outside (Offset Pop), a nested surface with a border and no shadow, a divider inset of 0, and Input, Select and Button at 40px. `Surfaces/SurfaceCard panel title inset` replaces the 0.13.0 label-inset check on a panel card.

## 0.14.0 - 2026-10-27

- Added: `StatusDot` (text chip, `echo`, static; one dot-size token, five tones; dot-only variants require `aria-label` and show it in a Tooltip; the text variant is a soft HeroUI `Chip` of the same `size`, so padding and height equal the Chip's, and capitalises its first letter). `Badge isDot` renders through the same anatomy (the `starci-core-badge-dot` class and `CircleFill` dot are gone).
- Added: `Text` `mono` and `tabular`; inline `Code`; `Meter size="sm"` (thin track); `Timeline` `isAttention` (tone row background); `Badge` tone `muted`; `Terminal` (dark monospace log tail, `role="log"`, `aria-live="polite"`, follows the end unless scrolled up).
- Added: client-side navigation. Every Grammar root accepts `navigate` and `useHref` and mounts react-aria's `RouterProvider`, so links, `Button href`, `Breadcrumbs`, `ListBox`/`Menu` items and `FlowGraph` nodes navigate without a reload.
- Added: `FlowGraph` `direction` (`TB` | `LR`), `layout="layered"`, `headers` (layer titles), `height` as a number or CSS length, and node `href`. The radial default is unchanged.
- Added: `Button disabledReason` shows its words in a Tooltip on hover and keyboard focus of a disabled Button and carries them as its accessible description; `Tooltip` takes `isDisabledTrigger` and `triggerDescribedBy` for a control the platform skips.
- Added: `PinnedActionBar` takes `summary` (text or node) with `dismiss` and `commit` actions beside the single-command `children` form.
- Added: `DataTable` rows take `href` (a whole-row link target); columns take `editor` (a field hosted in the cell, keyboard behaviour switches to React Aria's `tab` mode) and `priority` (`low` columns fold into the first column as stacked secondary text below `collapseBelow`, default 640px); `DataTableColumn` is generic over the row type.
- Added: `TagGroup onReorder` with `reorderInstructions` and `reorderAnnouncement` (drag, or Alt+arrow keys, with a live-region announcement). The vendor TagGroup has no drag-and-drop collection hooks, so Grammar wires native drag events itself.
- Added: `ListBox descriptionLines` and the `wrap` value of `ItemDescriptionLines`.
- Changed: `ListBox` descriptions wrap by default; pass `descriptionLines={1}` for the earlier one-line preview.
- Changed (breaking): `Input` takes `description` instead of `hint`. The package has no deprecation window, so `hint` is removed. Migrate: rename `hint` to `description`.
- Fixed: the Tabs selection underline follows a changed tab label at once instead of animating its width.
- Fixed: the `FlowGraph` layered layout spaces nodes by the widest node (`max-inline-size: 14rem`) plus a gap, so two nodes of one `TB` lane or one `LR` layer never overlap; `TB` layers sit 100 graph units apart (was 130), so a deep graph fits its canvas at a readable zoom.
- Fixed: a `TB` `FlowGraph` lane header ends a gap before the widest node can start (right-aligned, `origin [1, 0.5]`), so a long header never runs under a node; a click on a header no longer selects it as a node.
- Fixed: a `DataTable` editor fills its column (the hosted field stretches) instead of shrinking to its content.
- Fixed: a `SurfaceCard` `fact` renders in the muted fact style (`starci-core-surface-fact`) that `SurfaceListCard` uses, instead of an unstyled span inheriting the vendor card header's larger type.
- Changed: versioned together with the Grammar lint families 0.14.0 (a minor: `Input hint` is removed).
- Changed: the lint families' bundled canon pins name `starci-harness` in place of the retired `@starci/cli`.

## 0.13.0 - 2026-10-27

- Removed: the Heritage family (`@starci/grammar/heritage`, `heritage.css`, `HeritageGrammarRoot`, `HERITAGE_DNA`); the package ships two families, Core and Offset Pop, over Common. Migrate: select `core` or `offset-pop`.
- Changed: the Core DNA id is `core` (was `starci-core`). The CSS class prefix `starci-core-*` and the cascade layers are unchanged.
- Fixed: a labelled Core `SurfaceCard` insets its label row again. Common's `padding: 0 !important` on the label row, in the earlier layer, beat Core's inset, so the title touched the card edge; the label row now reads `--starci-core-surface-label-padding`, which Core sets. The `Surfaces/SurfaceCard label inset (Core)` story asserts a non-zero inline padding.
- Changed: versioned together with the Grammar lint families 0.13.0. The package lives in github.com/starci183/starci-harness; `src/common/rule-catalog.generated.ts` is committed source edited in place.

## 0.12.14 - 2026-10-27

- Changed: versioned together with the Grammar lint families 0.12.14. No component changes.

## 0.12.13 - 2026-10-26

- Changed: the control token is 2.5rem and every standalone control renders at 40px; IconButton sm/md/control/lg are 32/40/40/48 on both axes, the Switch control track is 40 with a 32 thumb, the chrome Avatar is 40, and Textarea, PressableField and the Select skeleton follow the token.
- Changed: Tabs and HorizontalScrollRegion share one scroll-caret implementation, so a horizontally scrolling row shows carets on the side that can scroll.

## 0.12.12 - 2026-10-26

- Changed: the messenger frame lands: `Divider` takes a vertical orientation, `ListBox` takes `selectionIndicator="none"`, `VerticalScrollRegion` takes a tone, `ChatBubble` carries a toolbar and `IconButton` takes `href`; the navbar `SegmentedControl` uses `size="control"`.

## 0.12.11 - 2026-10-26

- Changed: versioned together with the Grammar lint families 0.12.11 (the family equality spec). No component changes.

## 0.12.10 - 2026-10-26

- Changed: versioned together with the Grammar lint families 0.12.10, whose bundled canon pins moved. No component changes.

## 0.12.9 - 2026-10-26

- Added: Tabs `scrollPreviousLabel` / `scrollNextLabel` name the overflow carets (defaults "Scroll tabs left" / "Scroll tabs right"); HeroUI hardcodes English and has no label prop.
- Fixed: a selected ListBox row takes the vendor's own hover fill token (`--default`) because HeroUI's selected rule is empty; it adds no vendor-part repaint.
- Fixed: the two-member AvatarGroup grid letterboxes the initials image per half so the letters are no longer cropped at the centre line.
- Changed: versioned together with the Grammar lint families 0.12.9, whose bundled canon pins moved.

## 0.12.8 - 2026-10-26

- Fixed: Switch `size="control"` is restored (HeroUI `lg` scaled to the 2.75rem control height, 20px thumb glyph); it adds no repaint of a vendor part.
- Changed: versioned together with the Grammar lint families 0.12.8, whose bundled canon pins moved.

## 0.12.7 - 2026-10-26

- Changed: no source change; versioned together with the Grammar lint families 0.12.7, whose bundled canon pins moved.

## 0.12.6 - 2026-10-26

- Changed: no source change; versioned together with the Grammar lint families 0.12.6, whose bundled runtime copies moved.

## 0.12.5 - 2026-10-26

- Changed: no source change; versioned together with the Grammar lint families 0.12.5, whose bundled canon pins moved.

## 0.12.4 - 2026-10-26

- Added: collection-item descriptions default to one line with an ellipsis and accept `descriptionLines: 1 | 2 | 3` on ListBox, DropdownMenu, Sidebar and Select/ComboBox options. The packaged stylesheet clamps the existing HeroUI Description slot, and each family's DNA owns the default.
- Added: `ListBoxItem.emphasis="unread"` makes the label and description strong through the active family's DNA; read rows retain vendor typography. Stories cover read and unread conversations and the three description limits.
- Changed: `AvatarGroup layout="grid"` shows three avatars and a total-count fourth cell at five or more members (`5`, `30`), four avatars at four, and the three-cell arrangement at three. Every cell has a surface-colour ring. The row layout retains `+N`, and `overflowLabel` still receives the hidden-member count. Chat examples carry no group glyph; optional `labelLeading` remains available.
- Fixed: Tabs use HeroUI's ListContainer overflow owner, scroll shadows and previous/next carets, retaining vendor keyboard, RTL and focus behavior. Vendor parity now rejects a wrapper that claims a vendor slot while omitting its owning part.
- Fixed: panel ListBox boxes align with search fields and tabs without negative-margin bleed. HeroUI retains list and item padding, rounding and interactive states inside scrolling panels. Added list and item `size` with centred 32/40/48px leading slots; `labelLeading` stays in the title line.
- Changed: every avatar without an uploaded `src` uses bundled DiceBear initials from the first and last words of its name. Colours follow `seed`, or the name when no seed is supplied; the local image follows the Avatar shape and retains readable text in either theme. AvatarButton, AvatarGroup cells and overflow counts share the renderer.
- Added: `kind="person" | "agent"` on Avatar, AvatarButton and AvatarGroup items. Agents keep the same free-text name and initials rule and add a bottom-right HeroUI bot badge with an accessible AI identity; tiny avatars and group grid cells hide the badge.
- Updated: panel-edge and app-shell knowledge, prop documentation, stories and focused package specifications.
- Added: Button and IconButton declare action intent and destructive step; each family maps intent and composition placement to existing HeroUI variants. CollectionItem and ItemActions supply item placement for custom rows, and ToolbarActions supplies chrome for a custom toolbar; collection rows, chrome and overlay decisions provide it automatically. AlertDialog uses dismiss and destructive confirm intents with safe initial focus unchanged. Stories cover every intent and placement in both themes.
- Changed: `Switch` `size` is HeroUI's `md | lg` (`control` is gone; the StarCi track and thumb geometry with it). `Skeleton shape="circle"` takes HeroUI's `rounded-full`. Hand-written field errors (SegmentedControl, Field, FileDropzone, Slider, Fieldset) render HeroUI's `FieldError`. `TagGroupItem.isOff` is HeroUI's `surface` Tag variant. `DataTableCellInteraction` loses `isHighlighted` and `tone`; `DragItem` and `FlowGraph` selection are state hooks with no Grammar outline. Copyable and revealable `Input` puts its actions in HeroUI's `InputGroup` suffix so the value never runs under them.

## 0.12.3 - 2026-10-26

- Changed: the package manifest lists `react-aria-components` as a dependency and `aria-query` as a development dependency; the README documents the collapsed Sidebar tooltip, `DropdownMenuItem.mark` and composing the interactive shell in a Client Component. No component API changes. 0.12.2 is the hotfix line published separately.

## 0.12.1 - 2026-10-26

- Added: `ListBoxItem.labelLeading`, a decorative glyph in the title line, inside HeroUI's `Label` before the text and on its baseline (e.g. a group mark before a group conversation's name). It is `aria-hidden` (A11Y-2) and reuses the leading wrapper, so `label` stays the string name and `textValue`, and no family CSS changes.
- Fixed: Select triggers use the shared 2.5rem field-height token, matching Input. The examples show the controls together; the vendor wrapper manifest records the field-height override.
- Fixed: Tooltip and Divider delegate their accessibility and anatomy to HeroUI Tooltip and Separator; stepped Progress uses the HeroUI ProgressBar root and track. Vendor role parity reads a generated index of every public HeroUI component, including expression-valued roles; link actions and assertive toast announcements delegate to their matching HeroUI components.
- Changed: SurfaceCard always paints a surface, with a shadow on the page background and a border inside another surface. Its depth follows the parent context; the frameless frame and explicit depth prop are removed. Rail and unpainted disclosure containers inherit their parent's field layer.
- Fixed: WorkspaceShell uses an intrinsic navigation track in fixed viewports, keeps the compact drawer opener at control size and defaults drawer-backed navigation to wide visibility. Its header, TopBar and NavigationFeatureNav supply the nested field layer; app shells without a drawer declare navigation visibility. IconButton badges require an accessible badgeLabel. DropdownMenu keeps the exclusive mark/iconSource leading API and neutral/danger tones.
- Fixed: drawer Sidebar destinations close their owning overlay and return focus to its opener. Countdown labels round seconds before choosing and flooring the display unit, and always use numeric copy; RelativeTime adds digital `m:ss` / `h:mm:ss`, serializable `{time}` templates and `expiredLabel`, accepts arbitrary RFC 3339 fractions and compact offsets, and renders invalid-timestamp fallback with a development warning. Tabs default to the nested secondary presentation. Documented the Common server-layout import boundary.
- Added: `seed` on `Avatar`, `AvatarButton` and `AvatarGroup` members. Grammar renders a deterministic, memoized Lorelei DiceBear circle from the user or identity id when `src` is absent; uploaded `src` wins, and with neither prop the initials fallback remains. Server and client use the same data URI and the existing decorative-image accessibility contract. `@dicebear/core` and `@dicebear/styles` are pinned runtime dependencies owned by Grammar; apps supply identity data and draw no avatar visuals.
- Changed: the Node engine floor is 22, matching the pinned DiceBear runtime.
- Fixed: two React Aria warnings ("provide a visible label ... `aria-label`") on every page mounting a trigger-less overlay. The 0.12.0 `OverlayPressTarget` — an unnamed, display-none stand-in for the `PressResponder` of the `DialogTrigger` root — was itself the unnamed hidden button. A `Dialog`, `AlertDialog` or `Drawer` with no `trigger` now mounts no root at all: its `Backdrop`/`Content`/`Dialog` render directly and the Backdrop (React Aria's `ModalOverlay`) owns the open state through `isOpen`/`defaultOpen`/`onOpenChange`, so the `close` render prop and drag-to-dismiss behave exactly as under a trigger. `OverlayPressTarget` is gone; the public props are unchanged.
- Added: `DropdownMenuItem.mark`, a decorative `ReactNode` in the existing leading icon slot, mutually exclusive with `iconSource` in the public type and sharing its alignment and size rule.
- Changed: `WorkspaceShell.navigationDrawer` reuses the shared overlay contract. `defaultOpen` lets the Drawer own state and its trigger, keeping layouts free of client state hooks; optional `isOpen` / `onOpenChange` remain available for coordinated interactions.
- Added: `RelativeTime`, a semantic `<time dateTime>` primitive with localized relative and countdown modes. All instances share one subscriber-owned ticker; the server and initial hydration use the same fallback, and an expired countdown settles at now.
- Updated: component stories, catalog, Grammar knowledge/DNA and FE clock ownership guidance.

## 0.12.0 - 2026-10-26

- Added: app-shell control size support across buttons, bare pressables, identity, text actions and search/input fields; shipped stamp CSS aligns them to the navbar height. Navbar and mobile opener bands follow `FE-APP-SHELL-1` and `FE-APP-SHELL-2` on the surface background.
- Added: collapsed Sidebar label tooltips through Grammar's internal `AnchoredTooltip`, whose native popover reaches the top layer while keeping family scope and HeroUI collection anatomy; count badges in both presentations; and end-placed settings groups. Destination activation also runs on the selected item. App-shell stories cover the navbar order, menus, persisted collapse state, icon rail and mobile drawer.
- Added: fixed `WorkspaceShell compactHeader` shares the mobile opener band's shipped geometry for a client-owned `Drawer` trigger; `navigationDrawer` owns its existing row without a duplicate frame.
- Added: account-menu triggers use `AvatarButton seed` and its shared `Avatar` renderer for the local DiceBear fallback; an uploaded source takes precedence.
- Added: shell menus use `DropdownMenuItem.mark` for workspace identity marks as an alternative to `iconSource`, and `tone="danger"` for destructive commands, preserving HeroUI anatomy and default selection indicators.
- Fixed: `IdentityLockup` fallback monograms keep the mark transparent and use foreground text under `FE-APP-SHELL-2`.
- Changed: mobile page recipes reuse the fixed app-shell drawer composition; their existing story links remain available.

Shared control heights, a fixed viewport workspace shell, surface-aware fields and lists, composite group avatars, and markup/console fixes from the NIVO review. Unpublished; field, OtpInput and ListBox defaults change in this release.

- Changed: Grammar surface compositions provide the ANATOMY-2 nesting context. Field controls, including OtpInput, default to `secondary` within cards, panels and overlay content, and `primary` outside; overlay triggers retain the surrounding context. Apps omit the variant.
- Changed: `ListBox inset="panel"`, selected automatically within the surface context, aligns rows, loading states and section captions to the panel content edge. `sections` and exported `ListBoxSection` provide named groups without application padding wrappers (PADDING-0).
- Added: `AvatarGroup layout="grid"` creates one round composite at every Avatar size, including `control`, with Zalo's two/three/four-member arrangements, a hairline gap, overflow `+N`, and Avatar's shared fallback. The overlapping `row` layout remains the default. COLLECTION-3 records the group-identity pattern.

- Added: `Switch isLabelHidden`, a visually hidden label that stays the accessible name, for a theme switch that carries only an aria label.
- Added: `Switch size="control"`, `Avatar size="control"` and `AvatarButton size="control"` at the shared control height (`--starci-core-control-min-size`, 2.75rem, the IconButton of a bar), so a language button, a theme switch, a bell and an avatar line up at one height. `SwitchSize` and `AvatarSize` gain `control`.
- Added: `WorkspaceShell viewport="fixed"` (default `flow`): the shell is exactly `100dvh`, the header stays on top and the navigation, primary and rail regions scroll independently, so an app needs no `h-[calc(100dvh-...)]`. `navigationDrawer` (exported type `WorkspaceShellNavigationDrawer`) adds the compact-width opener row (the bar's height via `--starci-core-band-height`, an edge-to-edge divider, a round tertiary `IconButton`) that opens a left `Drawer` holding a `Sidebar presentation="drawer"`; the app owns the open state.
- Fixed: the `Timeline` loading view rendered a `<div>` inside a `<p>` (a hydration warning); the title wrapper is a `<div>`.
- Fixed: React Aria's "PressResponder rendered without a pressable child" console warning. The source was not `Sidebar` itself but a controlled `Drawer`, `Dialog` or `AlertDialog` mounted without a `trigger` (the console's Sidebar drawer): HeroUI's roots are `DialogTrigger`s and had no pressable child. A trigger-less overlay now hands the root an inert, display-none button (`OverlayPressTarget`).
- Fixed: `DropdownMenu` divides sections with HeroUI's own `Separator` (between two entries when either is a section), so sections no longer run together.
- Changed: `DropdownMenu` selection uses HeroUI's default `Dropdown.ItemIndicator` for single and multiple selection alike (its default glyph, a check, in the vendor's own placement); the Grammar-chosen dot for single selection is gone.
- Added: `DropdownMenu` items take `leading` (a node, e.g. an identity mark, in a slot at least 20px square) beside `iconSource` (a glyph drawn at the canon 20px). `DropdownMenuItemTone` is `neutral | danger` (was `neutral | negative`); `danger` maps to HeroUI's `variant="danger"` so the label and glyph take its danger colour.
- Changed: `ListBox` and the options of `Select` and `ComboBox` are HeroUI's own list-box items: a `Label` and a `Description` under it, then the vendor item indicator at the end of the row. The Grammar-invented row, copy, label, description and indicator spans, the forced 2.75rem row height (now only the coarse-pointer touch floor) and the accent-soft selected paint are gone; the selected row is the vendor's. A leading and a trailing node keep their own layout wrappers.
- Changed: `Select` renders HeroUI's own trigger, value and indicator: the Grammar field gap, the 2.5rem trigger height, radius and padding, the ellipsised one-line value (and its title) and the read-only trigger paint are removed, so the trigger is HeroUI's `min-h-9` field. Its loading skeleton is 2.25rem to match.
- Changed: `Sidebar` puts HeroUI's `Separator` between its sections, as the list box and the menu do.
- Fixed: the sun/moon (or any) `thumbIcon` of `Switch size="lg"` and `"control"` renders at the canon 20px glyph size (size-5, `Icon` `leading`), centred in the thumb, in an explicit 20px box; `md` keeps the 16px `chip` step its 1rem thumb can hold.
- Canon: `@dicebear/core` and `@dicebear/styles` are Grammar's avatar-illustration dependencies (`knowledge/hfs/fe-stack.yaml`, `canon-pins.yaml`); applications use the Avatar `seed` prop.

## 0.11.0 - 2026-10-25

Minor, additive: the StarCi switch, a bare pressable with an avatar and an identity lockup built on it, and a DropdownMenu that renders HeroUI's own Dropdown anatomy. An app built on Grammar writes no visual CSS for any of these.

- Added: `Switch` takes `size="md" | "lg"` (default `md`, unchanged). `lg` is the StarCi look ported from the Academy stylesheet: a 4rem by 2.25rem fully round track, a 1.75rem round thumb inset 0.25rem, the on position at `calc(100% - 1.75rem - 0.25rem)`. The loading Skeleton keeps the geometry and the description and error align past the wider track. Exported `SwitchSize`.
- Added: `Switch` takes `thumbIcon` and `selectedThumbIcon` (an `IconSource`) drawn centred in the thumb. With both, the glyph of the current state shows (a sun/moon theme switch); with `thumbIcon` alone it always shows. The glyphs are decorative; the label names the switch.
- Added: `PlainPressable` (primitive), a pressable that does not look like a button: no padding, background, border or button shape in any state, no hover effect, a zoom-out `scale(0.96)` on press only on the canon motion duration and easing, a visible keyboard focus ring (`shape="circle"` for a round mark), and no zoom under `prefers-reduced-motion`. It is a vendor React Aria button, so it works as the trigger of `DropdownMenu` and `Popover`.
- Added: `AvatarButton` (composite): an avatar that is only a circle and a control, 40px at `md`, on `PlainPressable`; the account-menu trigger.
- Added: `IdentityLockup` (composite): a logo or monogram (image, falling back to initials on an accent tint) beside a title and a muted subtitle, no caret, the whole lockup a `PlainPressable`; the workspace-switcher trigger of a top bar. The logo mark is a square, transparent box with no corner and no clipping, the image contained (`object-fit: contain`) so round, square and wide logos keep their own shape; `markShape="rounded"` is the explicit opt-in. The monogram fallback keeps the accent tint so initials stay legible.
- Added: `Avatar` takes `shape="circle" | "square" | "rounded"` (default `circle`, unchanged). Exported `AvatarShape`.
- Changed: `DropdownMenu` renders HeroUI's own Dropdown anatomy and default look: `Dropdown`, the trigger, `Dropdown.Popover`, `Dropdown.Menu`, `Dropdown.Section` with `Header`, `Dropdown.Item` with `Label`, `Description`, a `Kbd` in `slot="keyboard"` (`variant="light"`), `Dropdown.ItemIndicator` (dot for single, check for multiple selection) and `variant="danger"`. The Grammar overrides of the popover, menu, section, item, label, description and indicator (padding, radius, colours, min size, hover and focus paint) are removed, so the choice marker slot now comes from HeroUI's own item layout (this also fixes the dot overlapping the first letter of a label). Grammar keeps only: the muted/danger icon colour, the two layout wrappers of the description layout, the keyboard slot push, and the forced-colors highlight. Public props are unchanged.

## 0.10.0 - 2026-10-18

Minor, additive: table-cell interactions, native drag-source presentation, controlled command toggles and caption-aware video.

- Added: `DataTable.getCellInteraction` and `DataTableCellInteraction` for cell actions, native drag-over/leave/drop callbacks, highlighting and muted tone. Actionable cells retain table semantics and arrow-key focus, activate with Enter/Space or a plain-content click, and leave nested controls to their own actions.
- Added: exported `DragItem` and `DragItemProps`, a native drag-source frame with selected, invalid and dashed states and a caller-owned leading color. Its content must provide the operation without dragging; the frame adds no focus stop.
- Added: command `Button` accepts controlled boolean `aria-pressed` and forwards both `true` and `false` to the native button; destination buttons do not accept toggle state.
- Added: exported `Video`, `VideoProps` and `VideoCaptionsTrack` with native controls, accessible title, poster and genuine optional WebVTT captions. Unavailable captions produce no placeholder track; caption language and cross-origin media policy remain explicit caller inputs.

## 0.9.14 - 2026-10-12

Patch (review of nivo.vn, FOCUS-1). No API change.

- **One focus ring per field, drawn on the field frame.** A focused `SearchField` could show a doubled ring: the wrapper group and the inner input were both outlined. The inner text input of `SearchField`, `NumberField` and `ComboBox` now never draws an outline or ring shadow of its own, and the ring stays on the frame (the group, via `:focus-within`, so keyboard focus remains visible; a system outline in forced-colors). `ComboBox` moves its ring from the vendor input to its input group, the box Common's single-line anatomy already names. `Input`, `Select` and the date fields already draw exactly one ring (checked in every family) and are unchanged.

## 0.9.13 - 2026-10-12

- Fixed: generate the rule catalogue from authored UI knowledge YAML, including STATE-8 and sparse and nonnumeric addresses; renderer and family claims resolve to active canonical rules without exceptions for retired identifiers.
- Fixed: preserve function-child loading behavior in Breadcrumbs and ListBox, active canonical renderer claims and scoped FlowGraph slot styling across the runtime merge.
- Fixed: the stories typecheck overrides the build exclusions so every story is checked. The test and prepack scripts continue to run typecheck plus build; the package carries no spec suites.
- Fixed: scope the underline bar's bottom padding and border resets to primary Tabs so secondary Tabs retain HeroUI's pill-track inset.
- Changed: integrate the canonical catalogue and claims with 0.9.11's HeroUI secondary Tabs and visible labels for icon-less tabs; keep the vendor pill paint and the existing public component API.

## 0.9.12 - 2026-10-12

Patch (review of nivo.vn, STATE-6 case-7). No API change.

- **The secondary pill strip keeps its track padding on every side.** The zero bottom margin and padding the underline bar needs were applied to every tab list, so the selected pill sat on the bottom edge of the track and the strip looked jammed. They are scoped to `variant="primary"` now.

## 0.9.11 - 2026-10-12

Patch (STATE-6 case-7). No API change.

- **`Tabs variant="secondary"` is HeroUI's own pill tabs.** The 0.9.9 accent-soft re-paint is gone: a soft `--default` track, the selected tab a white `--segment` pill with the surface shadow and foreground text, as HeroUI ships it. The primary underline geometry (indicator height, flex-end alignment, inline and end padding) is now scoped to `variant="primary"`, so it no longer flattens the pill.
- **A tab with no `leading` icon always shows its label.** Under `labelVisibility="responsive"` a narrow viewport hid every label, which left icon-less tabs empty.

## 0.9.10 - 2026-10-12

Published component-feature release: secondary Tabs, danger-soft IconButton and the no-tests package policy.

- **`Tabs` `variant?: "primary" | "secondary"`** (default `"primary"`, today's look). `primary` is the underline tab bar: the page's main area switcher, at most one per page.
  `secondary` is a compact pill strip with the SegmentedControl footprint (a soft `--default` track, 0.25rem padding, 2.5rem tall; the touch floor still wins on coarse pointers) whose selected tab is an
  `--accent-soft` pill with `--accent-soft-foreground` text, the selectable-chip family. It is for tabs inside a sub-region (drawer, card, dialog, rail). Same `tablist` / `tab` / `tabpanel` wiring (`panelId`),
  keyboard and focus ring, and it works with `labelVisibility` and `inset`. The frame exposes `data-grammar-tabs-variant`. Offset Pop paints the secondary strip as one ink-outlined unit with the hard offset and a pink selected pill.
- **`IconButton` `variant="danger-soft"`**: the danger tone's soft tint plate (`--danger-soft` ground, `--danger-soft-foreground` glyph, `--danger-soft-hover` one step stronger on hover) for a reversible or
  row-level destructive action such as a trash glyph deleting a row. Same sizes, focus ring and required accessible label. A confirmed destructive action inside an AlertDialog still uses the solid `danger` Button.
  Offset Pop gives it the ink outline and a small hard offset, pressed flat. Grammar ships no trash glyph (it ships no icon registry, only `CircleFill`): the app passes its own `IconSource`, as for every other glyph.

- **Removed: every spec suite, the test helpers (`src/__test__`), the vitest configs and the Storybook a11y gate.** `test` and `prepack` are now `typecheck` + `build`; `pack:check` is `build` + `npm pack --dry-run`. Dev dependencies vitest, @vitest/*, jsdom, @testing-library/react and @storybook/addon-vitest are gone. The UI contracts stay in the runtime (`tests/work-ui`) and the grammar DNA snapshot.

## 0.9.9 - 2026-10-12

- Fixed: generate the rule catalogue from authored UI knowledge YAML, preserving sparse and nonnumeric addresses and including STATE-8.
- Changed: migrate renderer and family contract stamps to active canonical rules; preserve geometry, interaction and source-ownership assertions without exceptions for unknown rule ids.

## 0.9.8 - 2026-10-12

Minor, additive (feedback from nivo.vn: the fields of one form did not look like one family; a long selected value broke the field height). No new catalog component (still 104).

- **One single-line field anatomy.** Input, Select, ComboBox, SearchField, NumberField, DateField, TimeField (and the pickers on the date group) share one radius token (`--field-radius`), one minimum height
  (`--starci-core-field-min-height`, default 2.5rem, the height the loading skeletons already promised; the 44px touch floor still wins on coarse pointers), border-box sizing, 0.75rem inline padding and a trigger or chevron
  0.5rem from the inline end. Defined once in `common/components-forms.css`. The ComboBox box is its input group: the group carries the radius and height, the inner input inherits the corner and stretches (no square right side
  behind the trigger). Offset Pop paints the ComboBox on the group (ink outline, surface) and leaves the inner input bare, so the secondary tint no longer fills it as a second box.
- **The selected value stays on one line.** The Select value (label only, never the option description) and the ComboBox input ellipsize and keep the field height; the full text is the value's / input's `title`. Popover options still wrap.
- **Every emitted class has a rule.** The roots `starci-core-field-skeleton` (forms), `starci-core-list-box-skeleton` (navigation), `starci-core-meter-skeleton` (overlays), `starci-core-flow-graph-background` and
  `starci-core-flow-graph-edge` (navigation) now have real layout rules (inert loading roots, the list and meter columns, the background fill, a non-interactive edge). No consumer-hook entries were added.
- **`Input` `onBlur`, `onPaste` (the native ClipboardEvent) and `autoFocus`**, forwarded to the underlying input; `SearchField` and `Textarea` take the same three (the textarea keeps its mention-list close on blur).
- **`Input` `isLabelHidden`**: the label stays the accessible name and is visually hidden (the same `starci-core-form-label--screen-reader` as Select, SearchField and Field).
- **`Disclosure` `summary`**: muted, one-line (ellipsis) text at the trailing end of the trigger row, visible closed and open, the trigger's `aria-describedby` (not part of its name).
- **Input error alignment.** The error is the last row of the field and reserves no space, so the control box never moves when it appears. The control box carries `data-grammar-input-control="true"`, the hook a row with a trailing action
  (input plus Delete) aligns to.

## 0.9.7 - 2026-10-11

Minor, additive (knowledge STATE-8: the loading view is the page's own component tree, labels real, only unresolved content as inert
geometry). Closes the gaps an app migrating to it found. Same rules as the 0.9.5 loading views: skeleton geometry is `aria-hidden`, the owning region is
`aria-busy`, no interactive child is drawn, and reduced motion comes from the existing Skeleton atom. No new catalog component (still 104).

- **`SectionHeader isSkeleton`**: title, description and meta become Skeleton text (each only if passed), keeping the heading rank and size; `count` is dropped;
  `action` keeps a small Skeleton footprint with no control inside; `eyebrow` stays real. The heading is `aria-hidden` with its line (no empty heading is announced); root `aria-busy`.
- **`Breadcrumbs` item `isSkeleton?: true`**: a data-driven crumb whose label is not known yet draws a short Skeleton text line in place of its `label` and `leading`,
  `aria-hidden`, never a link. The other crumbs stay real (pass `label: ""` for the unknown one).
- **`Select isSkeleton`**: the label stays real text (still the name when `isLabelHidden`), the trigger becomes a Skeleton field of the same height (2.5rem, the touch floor on coarse pointers),
  `aria-hidden`, nothing focusable; root `aria-busy`. Description and error copy are not drawn.
- **`Textarea isSkeleton`**: label real, the field a Skeleton block of the `rows` height (1.25rem a line plus padding, never under the 5rem field minimum); no `<textarea>` is mounted; root `aria-busy`.
- **`Meter isSkeleton`** (mirrors `Progress isSkeleton`): label real, the bar a static Skeleton bar of the track height; no `role="meter"`, value or reading is announced; root `aria-busy`.
- **`ListBox isLoading` / `loadingRows`** (default 3, 1 to 12): with no `items`, skeleton options (a label line and a description line, `aria-hidden`) inside the same named list, which is
  `aria-busy`; real `items` win and loading beats `emptyContent`.
- **`ChatBubble isSkeleton`**: the bubble face on its `side` with two Skeleton text lines (a Skeleton circle only if `avatar` is passed); no author, meta, actions or footer; `aria-hidden`.
  `children` is now optional. New helper **`ChatBubbleSkeletons`** (`count` default 3, 1 to 12; `hasAvatar`): a loading thread of alternating incoming and outgoing skeleton bubbles in one
  `aria-busy` wrapper, for the `conversation` slot of a `PaneLayout` (which lays out whatever the app puts there; it owns no bubbles).
- **Second pass (same release).**
  - `NumberField`, `SearchField`, `SegmentedControl`, `CheckboxGroup`, `Switch` take `isSkeleton`: the label stays real, the control becomes `aria-hidden` Skeleton geometry of the
    loaded size (one-line field 2.5rem with the touch floor; `SegmentedControl` one block, 5rem per option, `fill` stretches it; `CheckboxGroup` keeps every option label real beside a
    Skeleton box, descriptions are not drawn, `orientation` is kept; `Switch` a Skeleton track beside its real label). Nothing is focusable and no `role` such as `switch` is announced; root `aria-busy`.
  - `Avatar isSkeleton`: a Skeleton circle at the avatar's `size`, `aria-hidden`, no name or initials.
  - `Stepper isLoading`: step labels stay real when given (an empty `label` draws a Skeleton text line), each marker is a static Skeleton circle, descriptions are not drawn, no step is
    current or a button, the landmark is `aria-busy`. A stepper draws no connector line, so none is tinted.
  - `Timeline isLoading` / `loadingRows` (default 3, 1 to 12): with no `items`, skeleton entries (static marker, title, time and description lines, `aria-hidden`) in the same named, `aria-busy` list, the
    connector line tinted as skeleton; real `items` win.
  - Offset Pop: the loading `NumberField`, `SearchField` and `SegmentedControl` keep the ink-outlined field box; a loading checkbox box and switch track keep the ink outline.
- CSS lives in the group sheets: `styles.css` (SectionHeader, ChatBubble), `components-forms.css` (all loading fields), `components-navigation.css` (Breadcrumbs, ListBox, Avatar, Stepper, Timeline), `components-overlays.css` (Meter).
  Offset Pop: a loading Select or Textarea keeps the ink-outlined field box and control radius; the loading Meter bar wears the ink-outlined track at the 0.75rem height.
- Internal: `FieldSkeleton` in the `Field` module is the shared loading anatomy of every loading field.

### Tests

- `src/core/loading.spec.tsx` extended for all the components above under bare Common, Core and Offset Pop; new `src/core/v097.spec.tsx` (version, sheet placement, skeleton field sizes, token-only
  rules, Offset Pop treatment, no animation of its own), wired into `npm test` after `v096`. `v095.spec` and `v096.spec` accept the 0.9.7 version.

## 0.9.6 - 2026-10-11

Patch (a group of buttons uses secondary and a border).

- **Selectable `TagGroup` chips read as secondary buttons with a border** (`selectionMode` `single` or `multiple`). Unselected chips take the
  secondary-button face (`--default`, hover `--default-hover`, default foreground) plus a 1px inset `--border`; selected chips keep
  `--accent-soft` / `--accent-soft-foreground` and gain a 1px inset `--accent` border. `selectionMode="none"` groups and `isOff` chips are unchanged;
  `aria-selected` and the `data-grammar-selected` hook are unchanged. The vendor `.tag--default` paint sits in the later `components` layer, so the
  background (only) is `!important`, driven by `--starci-core-tag-bg` / `--starci-core-tag-bg-hover`. Forced colors: an unselected chip gets a
  1px `ButtonText` outline (the inset shadow is dropped there) and a selected chip keeps its `Highlight` outline.
  Offset Pop: the same chips take the ink outline, the family `--default` fill and a small ink offset shadow, like its secondary Button; selected stays pink and lifted.
- `Select` `isLabelHidden`: already supported (it is part of `FieldControlProps`, rendered by the same `FieldLabel` as `SearchField`: the label stays
  in the DOM as the accessible name, visually hidden). 0.9.6 adds a spec pinning it; no API change.

## 0.9.5 - 2026-10-11

Minor, additive (the NIVO "Second brain" knowledge map is drawn from grammar components only).

- **New branch component `FlowGraph`** (Common renderer, 104 in all; exported from `@starci/grammar/common` and `/core`). A node-and-edge
  map drawn with React Flow (`@xyflow/react`) in grammar tokens: pill nodes tinted by `tone` (`neutral`, `accent`, `success`,
  `warning`, `danger`, `muted`), a `count` badge, an optional `description`, dashed outline and muted ink for `isPlaceholder`
  slots; straight `--separator` edges, dashed for placeholder edges; no background grid; no attribution mark.
  Props: `label` (required), `nodes`, `edges`, `selectedId`, `onSelect(id | null)`, `height` (`sm` 16rem, `md` 24rem, `lg` 32rem),
  `isInteractive` (pan and zoom, default true), `showControls` (zoom buttons, default follows `isInteractive`), `layout`
  (`radial` default, or `manual` with `node.position`) and `emptyLabel`. The radial layout puts the root (`isRoot`, else the first
  node) in the centre, its direct children evenly on a ring and deeper levels on outer rings inside their parent's wedge;
  `radialPositions(nodes, edges)` is exported for hosts that want the coordinates. The viewport fits on mount and whenever the node set changes.
  Accessibility: a `figure` named by `label`; nodes are focusable and selectable with Enter or Space (Escape clears); the selected
  node and keyboard focus use the package focus ring; a visually hidden list repeats every node with its count; edges never animate.
- **New peer dependency `@xyflow/react` `^12.11.6`** (dev copy `12.11.6` for the tests). It is a peer, not a dependency, so an app keeps a single
  React Flow copy; install it next to `@heroui/react` (`npm i @xyflow/react`). The structural rules React Flow needs are shipped
  inside `common/styles.css`, scoped to `.starci-core-flow-graph`, so **no `@xyflow/react/dist/*.css` import is needed**.
- **Loading views (knowledge STATE-8): the page own component tree, real labels, inert geometry only where content is unresolved.**
  - `SurfaceListCard isLoading` draws `loadingRows` (new, default 3, 1 to 12) skeleton rows when it has no children, the collection
    `aria-busy="true"`; real children still win, and loading beats the `empty` notice.
  - `ListRow isSkeleton` (new): the same anatomy as inert geometry (title and description Skeleton text, leading Skeleton circle,
    actions a small Skeleton footprint, each only if passed), `aria-hidden`, no interactive child.
  - `DescriptionList isLoading` (new, incl. `layout="stat-strip"`): terms stay text, `description` and `meta` become Skeleton text,
    `unit` is dropped, `aria-busy` on the root.
  - `DataTable isLoading`: keeps the real column headers and draws `loadingRows` (new, default 3) `aria-hidden` skeleton rows instead of
    the empty state; passing `loadingContent` keeps the old behaviour (that content replaces the body).
  - `FlowGraph isLoading` (new): the frame at its height with a Skeleton block, no React Flow mounted, `aria-busy`.
  Reduced motion comes from the existing Skeleton atom.
- `package-boundary.spec.mjs` now expects the peer list `@heroui/react`, `@xyflow/react`, `react`; runtime `dependencies` stay empty.

### Tests

- `src/core/loading.spec.tsx` (default 3 rows, clamping, real labels, aria-hidden and aria-busy for each loading view).
- `src/core/branch/FlowGraph/index.spec.tsx` (label, node count, hidden list, placeholder hook, click / Enter / Space / Escape, controlled
  selection, empty state, static mode, radial geometry); `src/core/v095.spec.tsx` (peer boundary, client module, token-only CSS, heights,
  reduced motion); catalog 103 to 104; Offset Pop family render table.

## 0.9.4 - 2026-10-11

Patch (reported from nivo-lite).

- **Fixed: a layout className on `List`, `ListItem` and `Region` takes effect.** Their element resets (display, gap, margin,
  padding, list marker) sat in the grammar layer, which a host declares after Tailwind's `utilities`, so `flex`, `grid`, `gap-3`
  or `py-3` passed as `className` lost and layout had to be wrapped in an inner element. The resets now live in `@layer base`;
  without a className the shape is unchanged. Region's prop-driven `spacing` stays in the grammar layer.
- **Fixed: `ListRow` actions in a narrow container.** Below the 28rem container query the actions took `flex: 1 1 100%`, so one
  small ghost button got a line of its own and every row of a ~20rem rail grew by a line. The copy now takes `1 1 12rem` and the
  actions `0 1 auto`: the action stays on the copy line while it fits and wraps only when it does not; the detail region and the
  28rem grid are unchanged.

### Tests

- `src/core/v094.spec.tsx`: the three resets are base-layer rules, Region spacing stays a grammar rule, the className passes
  through beside the hook class; the collapsed ListRow copy and actions flex values.

## 0.9.3 - 2026-10-11

Patch, additive (from the live nivo.vn connections drawer).

- **`Progress` step mode.** `steps={{ total, completed }}` (and `valueText`) draws one segment per wizard step at the small
  bar's height (0.25rem), the finished and current steps on the accent, the rest on `--default`; one `role="progressbar"`
  with `aria-valuemax` = total and `aria-valuenow` = completed. Clearer than one long bar for a 3-7 step flow.
- **`IconButton` `variant="primary"`, `size="lg"` and `isFloating`.** The accent plate for the one glyph action that must
  stand out (a floating assistant or compose button), a 3.5rem size and the overlay elevation; the app owns the position.
- **Fixed: `Label` takes the full foreground.** It inherited the muted tone a vendor body passes down (the Drawer body), so
  section labels read as hints.
- **Fixed: overlay header on one row.** The vendor's `drawer__header` / `modal__header` is a flex column and pushed the close
  action under the title; the header now keeps title and close on one row, the action at the end.
- **Fixed: `ChatBubble` footer width.** A message with a `footer` gets a definite stack width and the footer stretches, so
  percentage widths inside it (an approval card at `w-full max-w-xl`) no longer collapse in a shrink-to-fit loop (threads
  of tens of thousands of pixels on nivo.vn). Hook `data-grammar-bubble-footer`.

### Tests

- `src/core/v093.spec.tsx` (step segments, clamping, label colour, overlay header row, bubble footer, floating IconButton);
  stories `ProgressSteps` and `IconButtonFloating`; the a11y matrix passes them.

## 0.9.2 - 2026-10-11

Patch, additive (an Alert may take its tone's soft tint; amends ACCENT-5 case-5's "the tone never
fills the Alert's background" for this opt-in appearance only).

- **`Alert` `appearance`** `"surface"` (default, unchanged: the HeroUI white row with the surface shadow) or `"soft"`: the
  row takes `--<tone>-soft` at half strength (`color-mix(in srgb, var(--<tone>-soft) 50%, transparent)`; informative
  accent, affirmative success, cautionary warning, negative danger, every other tone default) and drops the shadow, for a
  notice that reads as part of the region it sits in. Anatomy, title tone, action variant and urgency are unchanged.
  Hook `data-grammar-appearance`; type `AlertAppearance`. Story "Soft appearance", spec in `Alert/index.spec.tsx`.

## 0.9.1 - 2026-10-11

Minor, additive (nivo-lite connections: several accounts per provider, read from the UI knowledge - COLLECTION-1/2,
PADDING-0/4 side contact, BOUNDARY-3, DISCIPLINE-1, ACCENT-2).

- **`ListRow`** (composite, exported from every entry and the registry; 103 renderers): an interactive `<li>` for
  `SurfaceListCard` - `leading` (an `IconTile`, avatar or logo tile), `title`, `badges` (at most two), one muted
  `description`, trailing `actions` (one visible `Button`, then a `DropdownMenu`), and a `children` detail region under
  the copy (an `Alert` about the row, revealed values). It carries `starci-core-static-row` as well as
  `starci-core-list-row`, so it shares the row inset (PADDING-4), the row gap and the edge-to-edge separator with
  `StaticStateRow` and the two mix in one collection. Collapsed by default (collapse law): mark and copy share a line,
  actions and detail take their own; `@container starci-core-surface (min-width: 28.001rem)` lays it out as
  leading | copy | actions. `state` and `verdict` expose `data-grammar-state` / `data-verdict` as `StaticStateRow` does.
- **`SurfaceListCard` label row shows a `fact` and a `labelEnd` together.** Before, `labelEnd` replaced the fact; now
  the fact reads beside the label (e.g. a count) and the end slot (`.starci-core-surface-label-end`) holds the end
  (`data-grammar-label-end`). A lone fact renders as before.

## 0.9.0 - 2026-10-11

Minor, additive. Every grammar gap the app-wide
Grammar-conformance refactor had to leave as app classes now has a Grammar piece. No existing prop, default, class or token
changed meaning.

- **New renderer `ChatBubble`** (composite): one chat message - `side` `incoming` (recessed SURFACE-3 face) or `outgoing`
  (the reader's own, SURFACE-4 accent-soft pair), `author`, `avatar`, `meta` (time), `status` (e.g. an "AI" Badge), `footer`
  (an attachment or an approval card under the body), `actions` (revealed on hover and focus-within, always on touch),
  `isHighlight` (focus ring for a jump target) and `id`. The corner on the author's side tightens toward the avatar
  (RADIUS-6); plain text keeps its line breaks. Server-component safe. The thread, grouping and day dividers stay the app's.
- **New renderer `FillViewport`** (composite, client): fills the viewport height left below whatever chrome sits above it
  and keeps that true on resize. It measures its own top edge into `--starci-core-fill-top` and the visible Grammar
  bottom chrome (WorkspaceShell's compact navigation, BottomNav and PinnedActionBar now mark themselves
  `data-grammar-bottom-chrome`) into `--starci-core-fill-bottom`; CSS computes `100dvh - top - bottom - inset`, so the
  server render already has a full-height fallback. Helper `bottomChromeHeight`. `minHeight` `none|sm|md|lg`
  (20 / 28 / 36rem floor, default `md`), `bottomInset` `page|none`, optional `label` makes it a named region.
- **`Textarea` mention suggestions and Enter-to-send.** `mentions={{ options, label, trigger?, onSelect? }}`: typing the
  trigger (default `@`) at a word start opens a listbox filtered accent- and case-insensitively on label or description
  (at most eight); ArrowUp/ArrowDown move, Enter/Tab insert `trigger + label + space`, Escape closes, pointer selection works.
  The textbox carries `aria-autocomplete="list"` and, only while the list exists, `aria-controls` and
  `aria-activedescendant`. `onSubmitShortcut`: Enter (no Shift, not composing, no open list) submits instead of breaking the
  line. Exported helpers `findMentionQuery` and `filterMentionOptions`; types `TextareaMentions`, `TextareaMentionOption`.
- **`IconButton` count badge.** `badge` (number or short text), `badgeLabel` (appended to the accessible name) and
  `badgeMax` (default 99, larger shows `99+`); `0` or empty draws nothing, and a loading button shows none. The plate is
  decorative, pinned to the top end corner on the accent pair with a canvas ring. Helper `iconButtonBadgeText`.
- **`PrimaryRailLayout` `railPosition`** `trailing` (default) or `leading`: the same tracks mirrored for a module switcher
  or a filter list, the rail drawn first with `order: -1`, reading order and the collapse unchanged.
- **`Image` `plate`** `default` or `none`: `none` drops the loading plate so cut-out art (a mascot, a logo with alpha) sits
  directly on its surface.
- **Fixed: Grammar objects inside React Server Components.** `SurfaceCard`, `SurfaceListCard`, `SurfaceAccordionCard`,
  `Dialog`, `AlertDialog`, `Drawer`, `Rail`, `Subnav`, `Tooltip` and `Alert` (and the new `FillViewport`, plus `Textarea`)
  are now `"use client"` modules. They use hooks or hand the vendor a render function, so rendering one directly from a
  server component failed with "Functions cannot be passed directly to Client Components".

### Tests

- `ChatBubble/index.spec.tsx`, `FillViewport/index.spec.tsx` (server fallback, client measurement, named region),
  `IconButton/badge.spec.tsx`, `Textarea/mentions.spec.tsx` (query helpers, keyboard and pointer insertion, Escape,
  Enter / Shift+Enter / IME), `v090.spec.tsx` (leading rail CSS, image plate, client directives).
- `collapse.spec.tsx` counts the mirrored leading tracks; the Offset Pop render table and the Storybook catalog (102
  renderers) include `ChatBubble` and `FillViewport`. Stories: `ChatBubble`, `FillViewport`, `PrimaryRailLayoutLeading`,
  `IconButtonBadge`, `TextareaMentions`; the a11y matrix passes all of them.

## 0.8.5 - 2026-10-11

Patch (nivo-lite connections; the copy action belongs inside the field).

- **The `Input` copy action moves inside the field.** It is now an in-field action at the field's end, after a secret's reveal
  toggle, like the reveal toggle itself: both live in `.starci-core-input-actions` and the field reserves their measured width
  (`--starci-core-input-actions-width`), so the value never runs under them. New `copyIcon` / `copiedIcon` draw a glyph instead of
  the label text (the label stays the accessible name); `copiedLabel` is announced through a polite live region.
  `.starci-core-input-row` and the outline `Button` beside the control are gone.
- **Fixed: a short `Dialog` / `AlertDialog` stretched to the viewport height.** The vendor container fills the height and the dialog
  stretched with it (`flex: 1`); inside `.starci-core-dialog-container` the dialog is now `flex: 0 1 auto` and centred
  (`justify-content: center`), so it is as tall as its content. Drawers keep filling their edge.
- **Fixed: a `Drawer` with `placement="right"` (or `bottom`) opened on the left (or top).** The vendor content is `inset: 0` and a
  fixed width keeps the start edge; each placement now releases the opposite edge (`inset-inline-start: auto` for right, and so on).

## 0.8.4 - 2026-10-10

Patch, additive (product connections screen).

- **Copyable and read-only `Input`.** `isCopyable` with `copyLabel` (and `copiedLabel`, `onCopy`) adds a Grammar `Button` after the
  control that copies the current value, controlled or not, masked secrets included without revealing them; when the clipboard is
  refused the value is selected instead. `isReadOnly` keeps the value focusable and selectable at full contrast but not editable
  (`data-grammar-readonly`). The control and the action sit in `.starci-core-input-row`.
- **Fixed: `defaultValue` and edits on an uncontrolled `Input`.** The vendor TextField owned the value and overrode the inner input,
  so a `defaultValue` rendered empty. `value`, `defaultValue` and the change callback now belong to the TextField.

## 0.8.2 / 0.8.3 - 2026-10-05

Minor, additive (lane C0-CANON).

- **Semantic structure primitives.** `Region` (a named, non-card `<section>` landmark: `label` or `labelledBy` names it, `id` is its anchor, `spacing` is `spaced` or `flush`), `NavLandmark` (a named `<nav>` row of links: `label`, `layout` `bar` or `scrolling`), `List` (`<ul>`, or `<ol>` with `as="ol"`) and `ListItem` (`<li>`) are exported from every entry, with specs and stories, so app code that must not draw raw structural tags still renders semantic elements.

## 0.8.1 - 2026-10-01

- Changed: declares its build tool vite as a devDependency (lane PKGT clean proof); no source change. The published package.json differs from 0.8.0, so the version moves.

## 0.8.0 - 2026-10-01

Minor, additive (lane FONT; the brand layer must be able to set the brand typeface).

- **Font tokens.** The grammar now reads `--font-sans` (the core family root's `font-family`) and `--font-mono` (the leading-number
  and the code/monospace surfaces), each with a system-font fallback, so an app's brand layer sets its typeface on `:root` (and
  `.dark`) with one token and every component follows. Nothing is re-declared on the family root, so a brand value on `:root` wins.
- **Removed `--starci-font-sans` and `--starci-font-mono`** (host-set names no product declared; superseded by the two tokens
  above, no alias kept). The heritage family keeps `--heritage-sans`/`--heritage-display` (its own namespace).

## 0.7.2 - 2026-09-30

Patch, additive (nivo-fe wave, lane F0).

- `Input` gains `kind="tel"`: `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`, so a phone field opens the phone keypad and
  offers the saved number (the expert lead form lost both when it moved to the grammar).
- `IconButton` takes the ARIA disclosure props, typed: `aria-controls?: string` and `aria-expanded?: boolean`, forwarded to the
  button only when set. There is no open `...rest`: no other attribute passes through.

## 0.7.1 - 2026-09-30

Test-suite policy only (follow HeroUI): the contrast pairs for a status soft pair (`--<tone>-soft-foreground` on `--<tone>-soft`), the Alert title and a bare status glyph or title on a ground are held to `SOFT_MIN` = 3:1 instead of 4.5:1. Body text, descriptions and interactive text keep 4.5:1. No shipped CSS or API changed.

## 0.7.0 - 2026-09-28

Additive (minor), plus one fix (StarCi Next `SignInBase#signed-out`).

- Fix: `SurfaceCard` `measure="form"` / `"formCompact"` now caps the card. The root's `width: 100% !important`
  (`.starci-core-surface-card`) beat the form surface's `min(100%, 30rem)`, so a form card stretched across the whole
  content region (the sign-in card rendered 1116px wide at a 1184px viewport). `.starci-core-surface-card
  .starci-core-form-surface` re-states the measure `!important` and centres the capped card (`margin-inline: auto`,
  knowledge MEASURE-4 case-3).
- Every form control whose HeroUI v3 anatomy has the layer variant takes `variant?: "primary" | "secondary"`
  (default `primary`), passed through to HeroUI: `Checkbox`, `CheckboxGroup` (and its options), `RadioGroup`,
  `Textarea`, `Select`, `SearchField`, `NumberField`, `DateField`, `TimeField`, `DatePicker`, `DateRangePicker`,
  `ComboBox` - `Input` already had it. `secondary` is the nested treatment for a control ON a surface (knowledge
  ANATOMY-2 case-1: page background -> Surface -> nested control). Each control root, `Input` included, stamps
  `data-grammar-variant`, which the draw gate `DRAW_NESTED_VARIANT` reads. `Switch`, `Slider` and a single `Radio`
  have no vendor variant. Exported `FieldVariant`, `fieldVariantAttributes`.

## 0.6.0 - 2026-09-27

Additive (minor): every grammar gap the real-component prototype
(`ModuleLedgerBase.draw.tsx`, lane draw-real-components) had to work around is now a grammar piece. No existing
prop, default, class or token changed meaning; one renderer is new; 28 renderers gain root attributes.

- `SurfaceCard` `treatment?: "surface" | "ink"` (exported `SurfaceCardTreatment`, default `surface`). `ink` is the
  one signature band painted on the family's brand ink: Common reads `--accent` (a product whose accent is its ink,
  e.g. Nivo `#040d1c`, gets that exact ink); Offset Pop re-binds it to its ink and canvas (the pink stays the
  decision accent) and Heritage keeps it over its paper surface. The band re-binds `--foreground`, `--muted`,
  `--separator`, `--border`, `--default` and the soft tone foregrounds on itself (new Common tokens
  `--grammar-ink-band`, `--grammar-ink-band-foreground`, `-muted`, `-separator`, `-plate`, `-orbit`), so
  SectionHeader, Text, IconTile, Badge, DescriptionList and Divider keep their anatomy and stay AA on any accent:
  the foreground is read from the ink's own lightness (white below 0.62, black above; a family's
  accent-foreground is only promised for button-size text), muted is the ink lifted to at least 80% lightness on a
  dark ink (about 10:1 on `#040d1c`; on Core's mid-tone violet it resolves to the foreground) or lowered to at most
  32% on a light one, hairline / plate / orbit step 14 / 8 / 16 points toward the foreground, and a status text is
  8% of its tone in the foreground (the Badge dot and soft fill carry the hue). An ink band is always a bounded
  shell (`frame="frameless"` is ignored).
  - `artwork?: ReactNode` (ink only): a decorative zone - `aria-hidden`, no pointer - holding the art (an `Image`
    or `MediaFrame` with its asset slot) on a transparent ground. Band 48rem and wider (container query): 22.5rem x
    15rem at the top inline-end corner, bleeding 2.25rem off the inline-end and 2.75rem off the top edge (clipped),
    and the head face (or the single content region) keeps a 12.25rem minimum block size so the content below
    starts clear of it. Narrower: 11.25rem x 7.5rem in flow at the head (the mascot minimum 180 x 120), bleeding
    2.5rem off the inline-end edge; content follows it, so the art never covers text.
  - `motif?: "none" | "orbit"` (ink only, exported `SurfaceCardMotif`): three thin concentric rings and five small
    nodes, one static `aria-hidden` SVG in the artwork zone only (never behind body copy), in the band's orbit ink
    (the ink lifted 16 points); it never animates, and forced colours drop it.
  - Hooks `data-grammar-surface-treatment` (root and surface), `data-grammar-surface-artwork="art|motif|none"`,
    `data-grammar-surface-motif`; classes `starci-core-surface-artwork`, `starci-core-surface-orbit`.
- `Divider` without a `label`: the unlabelled hairline between touching bands (GAP-0 case-1) - a 1px
  `--separator` `border-block-start` across its container, no margin (BOUNDARY-1), class
  `starci-core-divider-bare`, hook `data-grammar-divider="bare"`. `semantics?: "separator" | "presentation"`
  (exported `DividerSemantics`, default `separator`): `role="separator"` + `aria-orientation="horizontal"`, or
  `role="presentation"` + `aria-hidden` for a purely visual seam between faces that carry their own headings.
  The labelled Divider is unchanged (it gains the hook `data-grammar-divider="labelled"`).
- `DescriptionList` `layout: "stat-strip"` (exported `DescriptionListLayout`) with items
  `DescriptionListStatItem` (`icon?: IconSource`, `unit?: ReactNode`, `meta?: ReactNode`): key figures as one
  real `<dl>` - `<dt>` a neutral sm `IconTile` + the label, `<dd>` the figure (FONT-5 30/36, 600,
  `tabular-nums`) with its unit, a second `<dd>` the meta. Below 48rem a 2 x 2 grid 1.5rem apart; at 48rem and
  wider one row of equal cells, divided by a 1px `--separator` inline-start hairline with 0.75rem each side
  (PADDING-3 case-4). Label, unit and meta are FONT-2 muted at 400, so the strip speaks three sizes and two
  weights (TASTE-6). Offset Pop re-inks the hairline in its outline.
- `AlertAction.icon?: IconSource`: a leading `Icon` (`usage="leading"`, decorative) as the action Button's
  `startContent`. The tone -> variant mapping of 0.5.3 is unchanged.
- `Image` and `MediaFrame` take `assetSlot?`, `assetSha256?`, `assetPrompt?` (exported `AssetSlotProps`), emitted
  verbatim on the root as `data-asset-slot`, `data-asset-sha256`, `data-asset-prompt`; unset, nothing is emitted.
  Paint is unchanged.
- `SectionHeader` `count?: number` - a muted "(n)" at weight 400 in the title's own line, part of the heading's
  accessible name (class `starci-core-section-count`, hook `data-grammar-section-count`) - and `meta?: ReactNode`,
  the section's source time, FONT-1 muted at the end of the header row before any `action`
  (class `starci-core-section-meta`).
- `TagGroupItem.isOff?: boolean` and `offLabel?: string`: an off chip is HeroUI's tertiary (transparent) chip with
  a 1px `--border` outline and the muted foreground (`!important` over the vendor `.tag--default` paint; a dashed
  `GrayText` outline under forced colours), still focusable - unlike `isDisabled`. `offLabel` is appended to the
  accessible name as visually hidden text (and to the row's text value); omit it when the visible label already
  says the chip is off. Hook `data-grammar-tag-state="on|off"`.
- `IconButton` `variant?: "tertiary" | "ghost"` (exported `IconButtonVariant`, default `tertiary`): HeroUI's
  `ghost` is the quiet bare glyph for an overflow "..." menu. Hook `data-variant`.
- New renderer `PinnedActionBar` (`label`, `children`, `visibility?: "narrow" | "always"`, default `narrow`;
  exported `PinnedActionBarProps`, `PinnedActionBarVisibility`): the page's one command pinned to the bottom edge
  in thumb reach (UX-9 case-1) - `role="group"` named by `label`, sticky at the bottom, `--surface` ground behind a
  1px `--separator` top hairline (BOUNDARY-1), inset 0.75rem / 1rem / 1rem plus `env(safe-area-inset-bottom)`;
  `narrow` hides it at 48rem and wider so the command shows once per viewport (LAYOUT-4 case-2). Class
  `starci-core-pinned-action-bar`. The registry holds 96 renderers (43 base).
- Every registry renderer names itself in the DOM: `data-component="<Name>"` and a `data-tier` on its root. The 28
  that emitted none now do (draw-render had to map 15 of them by hook) - PageContainer, SectionHeader, SurfaceCard, SurfaceListCard, SurfaceAccordionCard,
  MediaFrame, SurfaceCopyGroup, RankArtwork, Label, IncludedMark, GrammarRoot, HorizontalScrollRegion,
  VerticalScrollRegion, StaticStateRow, Rail, Subnav, Tabs, Tooltip, MarkdownArticle, FencedCodeBlock,
  MarkdownTableFrame, PrimaryRailLayout, NavigationFeatureNav, WorkspaceShell, PaneLayout, StateMark,
  LeadingNumber and OtpInput (tiers atom / composite / branch / composition by their storage tier). A caller's own
  `data-component` still wins on HorizontalScrollRegion and VerticalScrollRegion (OtpInput uses that).

### Tests

- `src/core/branch/SurfaceCard/index.spec.tsx`: under every Grammar root, the ink hooks, the forced bounded shell,
  one `aria-hidden` artwork zone before (never around) the content, a static orbit (3 rings, nodes, no SMIL), and no
  zone on a plain surface or a bare ink band. `ink.spec.ts`: every text ink the band re-binds clears 4.5:1 on Core's
  violet accent, an ink accent (`#040d1c`), HeroUI's blue, a light accent, a mid-tone at the light/dark switch and
  Offset Pop's ink in light and dark; the orbit and hairline sit
  between the ground and the muted ink; the shipped geometry (container, isolation, content above the zone, zone
  boxes at both widths) and no animation on the zone.
- `Divider`, `DescriptionList`, `Alert`, `Image` (+ `MediaFrame`), `SectionHeader`, `TagGroup`, `IconButton` specs
  cover each addition's render, ARIA and shipped CSS; `src/core/primitive/PinnedActionBar/index.spec.tsx` covers
  the new renderer; `src/core/data-component.spec.tsx` proves every registry renderer's module stamps
  `data-component` and a valid `data-tier`, and renders the formerly silent ones.
- Offset Pop: the render tables (`family.spec.tsx`, `shipped-claims.spec.tsx`) include PinnedActionBar and the ink
  band; the family sheet writes no `--starci-core-*` name. `src/__test__/contrast.ts` reads relative-colour channel
  arithmetic (`calc(l + 0.14)`, `max(0.8, calc(l + 0.5))`, `clamp(...)`). Heritage paints the ink band over its
  paper surface; the Storybook a11y matrix (every family, light / dark / system) passes the ink band story.
- Stories: `Surfaces` SurfaceCard "Ink band ..." and SectionHeader "Count and trailing source meta", MediaFrame
  "Asset slot"; `Primitives` Divider "Unlabelled hairline", IconButton "Quiet (ghost)", Image "Asset slot";
  `NavigationData` DescriptionList "Stat strip", TagGroup "Off chip"; `Overlays` Alert "Action with a start icon";
  `Compositions` PinnedActionBar. The catalog guard lists 96 renderers.

## 0.5.4 - 2026-09-27

Visual change for Alert and SectionHeader; no API change (alert-white-surface; draw with the
real grammar components, lane draw-real-components): a drawing now renders the real components in the product CSS, and
the draw gates measured two places where Grammar painted over HeroUI or off the type scale.

- `Alert` is the HeroUI Alert exactly (`@heroui/styles` `alert.css`): a white `bg-surface` row with `shadow-surface`,
  `px-4 py-3`, radius `min(32px, --radius-3xl)`, the indicator (`p-1`, a `size-4` glyph) and the title in the tone's
  soft-foreground, a muted description. Grammar's common sheet no longer paints a tone tint, a tone border, a 12px
  radius, a 20px indicator or an overlay-tone indicator colour over it; it only lets the row wrap at a narrow width so
  the action stays inside the surface. Forced colours keep their CanvasText border.
- `SectionHeader` title follows the type scale (knowledge/ui/presentation/font.yaml): FONT-4 20px/28px for `level` 1,
  FONT-3 16px/24px for levels 2-6, weight 600 (was `clamp(1.25rem, 1rem + 0.75cqi, 1.75rem)` / 700 / -0.025em); the
  eyebrow weight is 600 (was 700); the header wraps its action below the copy when the copy would fall under 20rem.
- No export, prop, class, token or hook moved.

## 0.5.3 - 2026-09-27

Behaviour change for Alert actions, additive for Button and Badge. Grammar follows HeroUI v3
exactly - its Alert examples put a `primary` Button ("Refresh") in an accent Alert and a `danger` Button
("Retry") in a danger Alert, and its Button variants (`@heroui/styles` `button.css`) are primary,
secondary, tertiary, outline, ghost, danger and danger-soft.

- `Button` gains HeroUI's `danger` and `danger-soft` variants (`ButtonVariant` adds `"danger" |
  "danger-soft"`), mapped one to one onto the vendor `button--danger` / `button--danger-soft`, on both
  the command (`<button>`) and destination (`<a>`) elements. No tone prop; the default stays `secondary`.
- `Alert`'s action Button variant follows the tone through the vendor status (`vendorStatusFor`):
  `informative` (accent) -> `primary`, `negative` (danger) -> `danger`, every other tone (affirmative,
  cautionary, neutral, pending, unavailable) -> `secondary` - HeroUI has no success or warning Button
  variant. Before 0.5.3 every Alert action was `secondary`; an informative or negative Alert with an
  `action` now renders a filled primary or danger Button. Size stays `sm`.
- Offset Pop: its pink decision accent on alert actions yields to Common's danger fill for a negative
  Alert (the same treatment its negative confirm action already had); other tones keep the pink.
- `Badge` takes `isDot?: boolean` (status badges get their dot through the
  grammar, never hand-drawn CSS). True draws HeroUI's Chip dot - `<CircleFill width={6} />` - before the
  label: one 6px solid circle in `currentColor` (the badge's tone foreground), `aria-hidden`, class
  `starci-core-badge-dot` (6px box, `flex: none`, in `src/common/styles.css`), hook
  `data-grammar-badge-dot="true"` on the root. No halo, ring or size variant; skeleton draws no dot.
  Upstream Heroicons has no filled circle, so `CircleFill` is a Grammar-internal geometric glyph cut like
  the `@starci/heroicons` 16/solid customs (16 x 16 viewBox, `fill="currentColor"`, `data-slot="icon"`);
  it is not exported. In Offset Pop the dot follows that family's ink badge text.
- No class, token, hook or default of any other component moved.

### Tests

- `src/core/primitive/Button/index.spec.tsx`: `danger` / `danger-soft` render the vendor class (and not
  `button--secondary`) on the button and the anchor.
- `src/core/composite/Alert/index.spec.tsx`: under every Grammar root, the action Button carries the
  vendor class for every tone (informative primary, negative danger, the other five secondary) and no
  other variant class.
- `src/offset-pop/components-overlays.spec.ts`: the negative Alert action keeps the danger fill.
- `src/core/primitive/Badge/index.spec.tsx`: `isDot` renders exactly one leading `aria-hidden` 6px
  `currentColor` circle (and the root hook); none when `isDot` is false/omitted or while skeleton.
- Stories: `Primitives` `Button` shows Danger / Danger soft, `Badge` a "Status dot (isDot)" state;
  `Overlays` `Alert` shows the action variant per tone.

## 0.5.2 - 2026-09-27

Additive. `Meter` can draw a discrete count ("3 of 3", "2 of 3 capabilities") as equal segments: the
draw-time grammar proposal `Meter.segments`.

- `Meter` takes `segments?: MeterSegments`, a closed literal range `2 | 3 | ... | 12` (exported as
  `MeterSegments`). Untyped callers are clamped to 2..12. Without the prop nothing changes.
- Segmented, the reading is a whole count: `value`, `minValue` and `maxValue` are rounded to integers
  and the value clamped into range; `round((value - min) / (max - min) * segments)` segments fill.
- The track spans the full width of its container, the same length as a Progress track, at HeroUI's
  h-1 (0.25rem, 4px; the plain meter keeps h-2), laid out as N equal pill
  segments 0.25rem apart. Empty segments wear the track colour, filled
  ones the tone fill (`--starci-core-overlay-tone`: accent for neutral/pending, the tone colour
  otherwise). The continuous `meter-fill` is not rendered in this mode.
- Accessibility is unchanged: one `role="meter"` with `aria-valuenow` / `aria-valuemin` /
  `aria-valuemax` / `aria-valuetext`; the segments are `aria-hidden` spans with no role.
- New classes `starci-core-meter-segments` (on the vendor track) and `starci-core-meter-segment`,
  painted in `src/common/components-overlays.css`. The vendor track's `display`, `overflow`,
  `height` and `background` are re-cut with `!important` (the vendor `components` layer is declared after
  `starci-grammar-common`); forced colours draw empty segments as outlined `Canvas`, filled as
  `CanvasText`. New hooks `data-grammar-meter-segments` (root, the count) and
  `data-grammar-meter-segment="filled|empty"` (each segment).
- Offset Pop treats the segmented track through those hooks: the 4px line is too thin for its ink
  outline, so the track drops it and empty segments take the ink at 18%; filled segments are the
  family tone colour (the pink accent for neutral, a real measurement under ACCENT-1).
- No existing class, token, prop or default moved.

### Tests

- `src/core/primitive/Meter/index.spec.tsx`: under every Grammar root, a segmented meter is ONE
  `role="meter"` with the reading on `aria-value*`, N `aria-hidden` segments with the filled/empty
  split, full and empty extremes, integer rounding/clamping of the value and 2..12 clamping of the
  count; under the shipped overlay sheet (lifted out of its layer for jsdom) the track computes
  display flex, 4px (h-1) height, 0.25rem gap, transparent background, and each segment 100% height,
  flex 1 1 0 and the track's non-zero corner.
- `src/offset-pop/conformance.spec.ts`: ACCENT-1's decision list names the filled meter segment.
- `Primitives.stories.tsx` `Meter` gains a "Segmented count" state (3 of 3, 2 of 3, 5 of 8).

## 0.5.1 - 2026-09-25

Additive. Core gains the tertiary surface role the StarCi Academy render paints (a raised band on the
secondary surface).

- `STARCI_CORE_DNA.color.light.surfaceTertiary` = `oklch(93.73% 0.0012 354.13)` and
  `color.dark.surfaceTertiary` = `oklch(27.21% 0.0023 354.13)`, published through
  `STARCI_CORE_TOKEN_NAMES.surfaceTertiary` (`--starci-core-surface-tertiary`) and both token-default
  maps; the forced-colours block maps it to `Canvas`.
- The Core root binds `--starci-surface-tertiary` and `--starci-surface-tertiary-foreground` to it.
  HeroUI's `--surface-tertiary` is not re-bound: it stays Common's derived mix, so products that bind
  their own tertiary face never restyle vendor anatomy.
- Offset Pop does not mirror the role: it is a StarCi brand token and Common never reads it. The
  Offset Pop parity spec names it Core-only and no longer reads declarations out of CSS comments.
- No renderer, class or prop changed; no existing token moved.

## 0.4.13

Fix only. A live audit measured the conversation region of `PaneLayout` - the node stamped
`MEASURE-7 OVERFLOW-3` and named "Setup message" - rendering `overflow: auto auto` on every
capture. OVERFLOW-3 promises one scrolling axis and a second axis left clipped or visible on purpose;
both axes scrolled. This is the defect 0.4.11 repaired on `HorizontalScrollRegion`, on the sibling
region nobody had measured yet.

### The vertical region owns its overflow answer, and one axis

- Nothing in the family's sheet named `overflow-x` for this region. The vendor's
  `.scroll-shadow--vertical` sets `overflow-y: auto` alone, and every host class the region wears -
  `.starci-core-pane-layout-conversation`, `.starci-core-pane-layout-overlay-rail`,
  `.starci-core-accordion-scroll-region`, `.starci-core-form-scroll-viewport` - names that same one
  axis or names none at all. Per CSS a non-visible overflow on one axis forces the other from
  `visible` to `auto`, so the region rendered two scrolling axes under a one-axis claim.
- `src/common/styles.css` now declares `overflow-x: hidden; overflow-y: auto` on
  `[data-grammar-scroll-region="vertical"]`, the identity `VerticalScrollRegion` stamps on the
  scrollable branch. No `!important`: no host class and no vendor rule ever names `overflow-x`, so
  the declaration is unopposed whichever order a consumer imports the two sheets in.
- `VerticalScrollRegion` takes an `overflow?: "always" | "needed"` prop (default `"always"`), stamps
  `data-grammar-overflow` beside `data-grammar-scroll-region="vertical"`, and claims
  `MEASURE-7 OVERFLOW-3` or `MEASURE-7 OVERFLOW-4` accordingly - the shape `HorizontalScrollRegion`
  already has. `PaneLayout` asks for nothing, so its conversation, its inline rail and its overlay
  rail keep claiming `MEASURE-7 OVERFLOW-3`, as does every other host. A `data-contract` a caller
  passes in is still replaced by the region's own: one claim per node, and the node's own claim.
- No class, no markup, no JSX and no consumer prop changed. The non-scrollable branch is untouched.

### Tests

- `src/core/scrollable-surfaces.spec.tsx` gains the stamp-versus-render case the sibling region
  already had: the rendered node carries `data-grammar-scroll-region="vertical"` and
  `data-grammar-overflow="always"` under the single axis claim `OVERFLOW-3`, the shipped sheet
  declares both `overflow-y: auto` and `overflow-x: hidden` for that identity, and `overflow="needed"`
  moves the stamp and the claim together to `OVERFLOW-4`.
- `src/core/composition/PaneLayout/index.spec.tsx` measures the repair where the audit measured
  the defect: it renders the workspace under the shipped sheet in jsdom and reads the conversation
  region's COMPUTED overflow per axis, not the class list. Both axes are measured because a sheet
  that names one renders two - reading `overflow-y` alone would have called the old render correct.
  Without the repair the inline axis measures `visible`.
- The repository has no story for this component, so no story was updated. `SurfaceAccordionCard`'s
  own frameless double stamp stays out of scope and unchanged, and no consumer changed.

## 0.4.12

Fix only. A live audit measured a `Heading` stamped `FONT-4` rendering 36px and one stamped `FONT-3`
rendering 30px, where 0.4.9 rendered the same nodes at 20px and 16px - with `Heading/index.tsx`
unchanged between those versions. The component was never the defect. The family had no sheet behind
its own type scale.

### The FONT scale is the family's, so the family's sheet draws it

- `Heading` renders through the vendor's `Typography.Heading`, which adds `typography--h<level>`, and
  the vendor's sheet sizes those in its `components` layer. Against that the family fielded only the
  Tailwind utility classes on the component - `text-xl`, `text-base`, `text-sm`, `text-xs`,
  `text-4xl` - and a utility class exists only where the CONSUMER's Tailwind build scanned this
  package's dist. In the audited consumer that scan stopped finding the package after it was hoisted,
  the utilities vanished, and the vendor's sizes won under the family's stamps.
- `src/common/styles.css` now draws the scale itself, off the attributes `Heading` already stamps
  (`data-component`, `data-level`, `data-scale`): FONT-4 1.25rem/1.75rem, FONT-3 1rem/1.5rem, FONT-2
  0.875rem/1.25rem, FONT-1 0.75rem/1rem and FONT-6 2.25rem/1.25, with the recipe's weight and the
  `tracking-tight` that `font.md` gives FONT-4 and FONT-6 alone. This is what `.starci-core-text` has
  always done for its own sizes, and what `shipped-geometry.spec.ts` already demands of layout: a
  shipped object may not spell itself in classes only a consumer's build can create.
- `!important` on the standard levels, because a consumer may import this sheet before or after
  `@heroui/styles` and layer rank alone cannot decide the winner in both orders. The values re-state
  what the utilities carry, so where a scan still finds the package nothing moves. Only FONT-6's SIZE
  is important: `offset-pop` re-cuts the display row with its own weight, tracking and 0.96 line
  height, so display rhythm stays a normal declaration that a later family layer still owns.
- No class, no markup, no JSX and no component prop changed. `Heading/index.tsx` is untouched.

### The paired regression measures the render, not the class list

- `src/core/primitive/Heading/index.spec.tsx` renders every level and the display scale under the
  shipped sheet in jsdom, reads the `data-contract` off the node, and measures the computed size
  against the rank that stamp claims. jsdom's cascade skips rules inside an `@layer` block, so the
  spec lifts the sheet's rules out of their layer before measuring - the declarations it measures are
  the shipped ones. Without the repair the nodes measure UA defaults (32px under `FONT-4`).

## 0.4.11

Fix only. A live audit measured three of the family's own nodes stamping a `data-contract` the same
node's render contradicts. Every one of them is Core's render and Core's stamp, so every one of them
is repaired here rather than explained to a consumer.

### One node, one overflow answer

- `SurfaceCard`'s content node claimed `OVERFLOW-1 OVERFLOW-2` under `frame="frameless"` - "this
  surface does not clip" and "this surface clips" on one element. The shipped sheet paints
  `overflow: visible` on `.starci-core-surface.starci-core-frameless-surface` and `overflow: hidden`
  on `.starci-core-surface`, so the node now claims `OVERFLOW-1` alone when frameless and
  `OVERFLOW-2` alone when bounded. No class, no markup and no paint changed.

### A frameless surface takes no inset, and now says so

- The frameless card's body claimed `PADDING-4` (1rem) and rendered 0px on every side, because
  `.starci-core-frameless-surface > .starci-core-surface-content` sets `padding: 0`.
- The rule is the family's own canon, not a convenience: `frame="frameless"` means the content
  already owns its visible boundaries, so Core must not draw another shell - and the shipped sheet
  drops the inset together with the frame. `PADDING-0` is how this family answers "no inset"
  everywhere else, on this same body under `composition="joined"`, on `SurfaceListCard`'s root and on
  `SurfaceAccordionCard`'s panel. So the frameless body claims `PADDING-0`; `joined` keeps
  `GAP-0 PADDING-0` and the bounded single body keeps `PADDING-4`. The render (0) is unchanged - only
  the promise moved to meet it.

### The scroll region owns its overflow answer, and one axis

- `HorizontalScrollRegion` stamps its own `data-contract`, so a `data-contract` a caller passed in was
  silently replaced and never reached the DOM - `Tabs` passed `OVERFLOW-4` and the strip rendered
  `OVERFLOW-3`. The region now takes an `overflow?: "always" | "needed"` prop (default `"always"`),
  stamps `data-grammar-overflow`, and claims `PADDING-1 MEASURE-3 OVERFLOW-3 OVERFLOW-5` or
  `PADDING-1 MEASURE-3 OVERFLOW-4 OVERFLOW-5` accordingly. `Tabs` asks for `overflow="needed"`.
- `.starci-core-horizontal-scroll-region` now declares `overflow-x: auto; overflow-y: hidden`. The
  vendor's `.scroll-shadow--horizontal` sets `overflow-x: auto` alone, and a computed `overflow-x:
  auto` forces `overflow-y` to `auto` too, so the node rendered `overflow: auto auto` - two scrolling
  axes under a claim that promises one.

### Tests

- `src/core/scrollable-surfaces.spec.tsx` gains three stamp-versus-render cases that read the stamp
  off the rendered markup and the declaration out of the shipped sheet: one overflow id on the
  frameless and bounded content nodes, `PADDING-0` on the frameless body against the sheet's
  `padding: 0`, and the region's single axis claim against `overflow-x`/`overflow-y`.
- `src/core/branch/Tabs/index.spec.tsx` gains a case that the real rendered strip claims `OVERFLOW-4`,
  not `OVERFLOW-3`, and carries `data-grammar-overflow="needed"`.
- No consumer changes. `SurfaceAccordionCard`'s own frameless double stamp and `OtpInput`'s claim are
  out of this fix's scope and unchanged.

## 0.4.9

Fix Core `Tabs` external panel relationships after the underlying collection mounts or updates.

- A `panelId` callback now remains authoritative on initial render, pointer/keyboard selection,
  and collection changes, including stable callbacks. Tabs keep their existing focus and selection behavior.
- The adapter preserves the vendor relationship it actually observes and restores it when `panelId`
  is removed. Cleanup disconnects observation; unchanged attributes are not rewritten.
- Regression tests render real external panels with the real HeroUI collection and cover initial
  linkage, selection, changed/removed callbacks, collection replacement, multiple instances and cleanup.
- No public API, presentation, dependency or consumer changes.

## 0.4.8

Fix only. A live audit found `SectionHeader` stamping `data-contract="GAP-5"` on its root while the
narrow `@container starci-core-primary-rail (max-width: 32rem)` collapse rule hard-coded `gap: 0.75rem`
underneath it - true at the default width, false the moment the header's own container collapses.

### The collapsed header keeps the region gap instead of inventing a tighter one

- `.starci-core-section-header`'s narrow-container rule now sets `gap: var(--starci-core-region-gap,
  1.5rem)` instead of the literal `0.75rem`. The direction and alignment still change (`flex-direction:
  column; align-items: flex-start`) - only the gap value was wrong.
- The family already answers this question twice: `PrimaryRailLayout` and `WorkspaceShell` are the
  other two GAP-5 region roots, and both hold `var(--starci-core-region-gap)` across every collapse
  tier they define - only the grid columns/areas change underneath them, never the gap. A collapsed
  `SectionHeader` follows the same law: stacking to a column is a reading-order change, not a demotion
  from a region boundary to a tighter internal rhythm, so its claim stays GAP-5 in every state.
- This is different from `.starci-core-rail-frame`'s and `.starci-core-static-row`'s own narrow-container
  rules, which genuinely relax to a named compact custom property (`--starci-core-rail-gap-compact`,
  `--starci-core-row-gap-compact`) - those are component-internal frames with no `data-contract` GAP
  claim of their own to keep honest, not region roots.

### A spec that a container query can actually catch

- `shipped-claims.spec.tsx`'s existing `unbackedClaims` check unions declarations across every rule
  that targets a class, so it would have called `GAP-5` backed as long as ANY rule - even one buried
  inside a narrow `@container` query jsdom never evaluates - resolved to 1.5rem. It could not have
  caught this regression, and would not catch a repeat of it.
- Added a dedicated case that reads every stylesheet rule whose subject is
  `.starci-core-section-header` (via `cssRules`, not `unbackedClaims`) and asserts each one's `gap`
  declaration, if it has one, resolves to `1.5rem` - covering the narrow-container rule directly
  instead of trusting the union.
- `SectionHeader` was also added to the general `CONVERTED_OBJECTS` claims table alongside the other
  Core primitives.

## 0.4.7

Fixes only. 0.4.6 raised the band's action and compact-navigation slots to the 44px touch floor and
declared the feature layer out of scope; a reference-app measurement at 1280 found two more misses
the same law reaches, plus one it cannot reach without a vendor edit.

### The navigation slot's own destinations meet the floor

- The three primary destinations in the `navigation` slot are `route`-appearance TextAction
  elements, and they were the vendor-inherited 36px - `.starci-core-text-action[data-appearance="route"]`
  carried `padding: 0.5rem 0.75rem` over a `sm` line-height, 36px total, with nothing raising it.
  `route` now also carries `min-block-size: var(--starci-core-control-min-size, 2.75rem)`.
- `min-block-size` was chosen over a taller `padding-block` because `route` paints no background at
  rest - only `data-current="true"` does - so the extra block size is invisible chrome around
  unchanged FONT-2/PADDING-2 typography, not a bigger pill. `route` is always a destination, so the
  floor is unconditional on the appearance itself rather than scoped to one composition, the same
  way `choice`/`section`/`tab` are free to keep their own geometry.
- The `navigation` slot's CSS also gained the family's `:where(button, [role="button"], a[href])`
  selector already shipped on the action and compact-navigation slots, so a consumer that renders
  anything other than a `route` TextAction there - a plain button, a differently-appearanced link -
  is still caught, the same general-purpose net the other two slots already are.
- The identity slot's brand mark is a `plain`-appearance TextAction used as a same-document
  pressable (`onPress`, not `href`), and it was 36px for the same reason. `plain` elsewhere in the
  family stays a compact inline mark with no reserved hit area - it is not always a pressable - so
  the floor is scoped to `.starci-core-navigation-feature-nav-identity .starci-core-text-action[data-appearance="plain"]`
  instead of the bare `[data-appearance="plain"]` rule, which would have grown every quiet inline
  action across the app that never claimed to be a touch target.
- The band still does not grow: the primary row keeps its 4rem height and 0.5rem block inset on
  each side, `--starci-core-band-height` stays `calc(4rem + 1px)`, and a spec still asserts the
  arithmetic that 44px fits inside the 3rem the row already offers a control.

### The theme switch is a documented gap, not a silent one

- The vendor theme switch inside the actions slot is a bare HeroUI `Switch` rendered by the
  consumer's own `ThemeSwitch` leaf (`src/components/leaves/ThemeSwitch`), not a Grammar
  composition, and it measures 64x36. A HeroUI `Switch` puts its real interactive node on a hidden
  `input`/label pairing that the shipped `:where(button, [role="button"], a[href])` selector does
  not address, and does not visibly own a `button`, `[role="button"]` or `a[href]` node to hang a
  rule on without reaching into vendor markup the family does not own.
- Grammar does not publish a `ThemeSwitch` today - the only one in the codebase is the app-owned
  leaf above - and none is added here. Rather than grow the vendor selector into an `!important`
  override of HeroUI internals, or publish a one-consumer component the family has no second use
  for yet, this stays an open gap: the consumer should wrap the switch in an IconButton-sized
  pressable (the same 2.75rem hit area `IconButton` already gives the cart and account controls
  beside it) until a real second consumer justifies a Grammar `ThemeSwitch`.

### Specs

- `styles.spec.ts` asserts the `route` and identity-slot `plain` rules verbatim, and that the
  `navigation` slot now carries the same three-slot `:where(...)` selector as the action and
  compact-navigation slots, still with no `min-height`/`min-block-size`/`height` on any of the three
  slots themselves.
- `index.spec.tsx` adds a rendered check that a realistic consumer's markup - a `plain` identity
  link, three `route` destinations, a compact trigger button, and a mixed button/anchor actions
  group - actually matches the selectors the shipped rules target, so the floor is proven to land on
  what gets rendered, not only on the selector text.
- The band-height arithmetic assertion from 0.4.6 (`4rem` row minus `0.5rem` block inset either side
  is still `>= 44px`) is unchanged and still passes: nothing in this release raises the floor past
  what the row already offers.

## 0.4.6

Fixes only. Three defects a screenshot audit found on a real surface, all three of them Grammar's.

### A collapse can no longer be outranked

- `PrimaryRailLayout` NEVER COLLAPSED when `railWidth` was set. The collapse was a bare class inside
  a container query, `(0,1,0)`; the rail track was an attribute selector outside it,
  `[data-grammar-layout-rail-width="wide"]`, `(0,2,0)`. A container query adds no specificity of its
  own, so the two-column form survived at every width: in a 358px container the primary track
  computed to `0px` and the whole product explanation - illustration, benefits, disclosures - was
  invisible on a phone while the rail floated over the remains of a heading.
- `WorkspaceShell` had the identical defect one tier up. Its `[navigation="present"][rail="present"]`
  rule `(0,3,0)` in the 72rem query, and its leading-rail rule `(0,4,0)`, both outranked the collapse
  group's bare class, so a shell carrying a navigation and a rail never stacked either.
- The repair is NOT a longer list of overrides. Restating the collapse once per attribute value
  repairs today's variants and breaks again on the one somebody adds next year, and the break is
  silent: jsdom evaluates no container query, so no render test can see it. The narrow form is the
  DEFAULT instead, and every wide form moved inside a `min-width` container query. The two ranges
  are mutually exclusive, so nothing inside the query can reach the collapsed layout at any
  specificity, whatever attribute is invented later - and a renderer without container queries gets
  the stacked form, which is the safe half of the pair.
- `PrimaryRailLayout` gained one correctness rule on the way: a rail track is only granted to
  `[data-grammar-layout-rail="present"]`, so `railWidth` on a layout with no rail can no longer
  reserve a column for a rail that was never passed.
- The sweep for the same pattern covered every container query in the sheet. `Rail` (18rem),
  `SurfaceCard`'s label and rows (28rem), the section header (32rem) and `PaneLayout` are clean -
  their collapses either have no attribute rule competing for the property or already read
  mobile-first. `PrimaryRailLayout` and `WorkspaceShell` were the only two, and both are fixed.
- `src/core/composition/collapse.spec.tsx` is the guard. It renders every `railWidth` x
  `collapsedOrder` variant and every navigation x rail x position x width combination, matches the
  attributes each one emits against the selectors the sheet contains, and fails if any rule outside
  a container query gives a matching element a side-by-side grid. The last check is a law rather
  than a list: it holds for EVERY class a container query touches, so a new composition inherits it.

### The band's controls meet the touch floor

- Every pressable in `NavigationFeatureNav`'s action slots was the vendor button's own height -
  36px on desktop, 40px compact - and the touch floor is 44px. The language menu, the cart, the
  account button, the compact drawer trigger and the field-shaped search trigger all sat under it.
  Both action slots now give their controls `min-inline-size` and `min-block-size` of 44px.
- It is a MINIMUM, not a size, and it is spelled on the pressable, never on the slot. `min-*` are
  properties the vendor's rules never set, so nothing here is owed an `!important`, and the glyph,
  the label, the paint and the corner are untouched. A slot with a min-height would have padded a
  row that has nothing in it.
- The feature layer is deliberately out of scope: its tabs belong to the `Tabs` branch, and a tab's
  target is that branch's answer to give.

### One boundary for the surface family

- `SurfaceCard` beside `SurfaceAccordionCard` in one column disagreed by 16px at both edges.
  `SurfaceCard` is the only member of the three whose root is a HeroUI `Card`, and the vendor's
  `.card` carries a 1rem padding that pushed the card's visible surface and its label further in
  than its siblings'. The label row and the content shell were already given `padding: 0 !important`
  for exactly this reason; the root had been missed. It is zeroed now, and the content region keeps
  the family's single `--starci-core-surface-inset` where the `PADDING-4` claim already puts it, so
  the vendor inset is removed rather than moved.
- `SurfaceListCard` and `SurfaceAccordionCard` were checked for the same thing and are clean: both
  are rooted in a Grammar `<section>` and take no vendor slot at all. The claims spec now renders
  all three together and fails if a family root picks one up.

### Intentional visual deltas

- A `PrimaryRailLayout` or a `WorkspaceShell` in a narrow container STACKS, which is what both
  always claimed to do. Anything that was reading as a squeezed two-column form on a phone becomes
  one column, and a rail passed `collapsedOrder="rail-first"` finally leads.
- The band's controls grow from 36/40px to 44px. The band itself does not: the primary row is 4rem
  with a 0.5rem block inset on each side, so 44px is 4px short of the 3rem the row already offers,
  and `--starci-core-band-height` stays `calc(4rem + 1px)`. A spec asserts the arithmetic, so
  raising the floor again would fail rather than quietly desynchronise the published offset.
- A `SurfaceCard`'s interior moves outward by 16px. For a transparent card the visible surface now
  starts at the object's own box, level with a list or an accordion beside it, and its copy keeps
  the single `PADDING-4` inset. For a labelled Core card the material box is UNCHANGED - a padding
  paints inside its own background - and only the label and content lose the doubled inset, leaving
  the one `--starci-core-surface-inset` the family rule was written for.

## 0.4.5

Additive. Two numbers that consumers were restating, and one edge they were painting themselves,
move into the package.

### The sticky band publishes where it stops

- `NavigationFeatureNav` and `Subnav` now publish `--starci-core-band-offset` on the Grammar root
  when they are sticky, and a page pins to it with `top: var(--starci-core-band-offset)` and bounds
  itself with `max-height: calc(100dvh - var(--starci-core-band-offset))`. It is the sum of two
  parts, each published on its own: `--starci-core-band-height` is the navigation band -
  `calc(4rem + 1px)`, and `calc(4rem + 2rem + 1px)` once a feature layer is stacked on it - and
  `--starci-core-band-subnav-height` is a stacked sticky `Subnav`, `calc(3.25rem + 1px)`, which
  drops to `0rem` above 70rem where a compact one is not on screen.
- It is CSS ONLY. Presence and stacking are already spelled by the data attributes these
  compositions emit, so the sheet selects them with `:has()` on `.grammar-common-root` rather than
  measuring anything in JS; no hook, no new data attribute, and no rule reaching `:root`, which
  would put the package outside its own boundary.
- Nothing is defined when no sticky band is present, so `var(--starci-core-band-offset, X)` still
  resolves to a page's own `X` exactly as before this property existed.
- `Rail` in `mode="sticky"` consumes it: `--starci-core-rail-offset` is still the override a host
  sets, and unset it now reads the published band before falling back to the 5.5rem it always used.
  A `WorkspaceShell` rail region gets this through the `Rail` it hosts. `Subnav`'s own sticky `top`
  reads `--starci-core-band-height` the same way, so a subnav stacked under a two-layer band no
  longer needs `--starci-core-subnav-offset` set by hand.
- `STARCI_CORE_BAND_TOKEN_NAMES` publishes all five property names from `@starci/grammar/core`.
  They are deliberately NOT in `STARCI_CORE_TOKEN_NAMES`: a theme token has one default the family
  always defines, while each of these is derived from what is on the page or supplied by a host.

### A verdict collection paints its verdict

- `SurfaceListCard` with `isVerdict` already squared its collection's corners for these rows; it now
  ships the edge those corners were preparing for - 2px on the row's leading side, in `--success` or
  `--danger` - selected by `data-verdict` on the row.
- The row is where the value has to live, because the rows of this collection are the CALLER'S
  children and no prop of the card can reach them. `data-verdict="success" | "danger"` is therefore
  published as the card's slot contract: `StaticStateRow` gained a `verdict` prop that emits it, and
  an application-owned row spells the attribute and gets the identical shipped edge. The union is
  exported as `RowVerdict` and re-exported as `SurfaceListRowVerdict`.
- The edge is an INSET SHADOW, read from `--starci-core-verdict-edge`. A border would move a
  caller's row content by two pixels and a padding would fight the inset the row already owns; a
  shadow paints inside the box that is already there. The hover-invariant reset that clears row
  shadows reads the same property, so a verdict does not vanish under the pointer.
- It is drawn but NOT claimed. `data-contract` ids address the boundary catalog, whose six rows are
  seams, an outline and elevation; a one-sided semantic accent is none of them, so inventing an id
  would make the claim checker agree with a promise the catalog never made. The specs assert the
  shipped rule and the rendered attribute directly instead.
- `verdict` is not `state`. A `PresentationState` says how the row itself is doing; a verdict is the
  direction of what the row REPORTS, and it is drawn as the collection's edge rather than as the
  row's treatment.

### Intentional visual deltas

- `Subnav`'s toggle keeps its 2.75rem target with `!important`, and takes no new prop. The size was
  already in the sheet, but it lost to the vendor button's own sizing declared in a later layer -
  the same reason the four declarations beside it are important - so a consumer was re-forcing
  `size-11` from outside the package to get a 44px target back. A spec now asserts the rendered
  control carries the class the rule selects.
- A sticky `Rail` under a Grammar band moves from 5.5rem to the band's real bottom. That is the
  point of the offset, and the number was only ever right for a one-layer band plus a gap.

## 0.4.4

- The utility debt is PAID. Every object 0.4.3 recorded as still spelling its layout in Tailwind
  utilities - `MarkdownArticle`, `Rail`, `Subnav`, `SurfaceCard`, `SurfaceListCard`,
  `SurfaceAccordionCard`, the shared Core class names, `EmptyNotice`, `PaneLayout`,
  `NavigationFeatureNav`, `Divider`, `IconButton`, `IconTile`, `Icon`, `Input`, `Progress`, `Text`,
  `TextAction` and the shared action recipe - now owns its box in `src/common/styles.css`, selected
  by the data attributes each component already emits. `Label` joined them, because its type scale
  had the same problem. The recorded debt list is empty, and the package check that kept it honest
  now proves it stays empty.
- Corners come from the theme radius ramp (`--radius-lg` / `--radius-xl` / `--field-radius`),
  never from a HeroUI v2 radius name. `rounded-large`, `rounded-field` and friends emitted nothing
  anywhere, which is why several objects arrived square.
- `!important` is used only where a Grammar class lands on a HeroUI part - `Card`, `Accordion`,
  `Button`, `TextField`, `Input`, `Skeleton`, `ProgressBar` - whose own rules live in the vendor's
  `components` layer, declared after `starci-grammar-common` and therefore winning every normal
  declaration regardless of specificity. That is the same reason 0.4.3 documented for `Sidebar`.
- Added a shared claims-versus-CSS checker (`src/__test__/styleClaims.ts`, excluded from `dist`) and
  a spec that renders every converted object and fails if any `data-contract` id it emits is not
  backed by a declaration on a Grammar class that element actually carries.

### Intentional visual deltas

Each of these is a utility that emitted nothing, or a shipped rule a utility was overriding.

- `MarkdownArticle`, `FencedCodeBlock` and `MarkdownTableFrame` now carry their own Grammar classes.
  They never did: the components spelled `min-w-0 w-full` and the whole
  `.starci-core-markdown-article` block in the sheet - reading rhythm, heading scale, list, code,
  blockquote, table and rule treatment - was unreachable. Authored Markdown gains that rhythm.
- `Icon` and `IconTile` sizing is shipped. An app-owned SVG has no intrinsic box, so a glyph in a
  consumer that did not scan this package rendered at the SVG default size; it is now 1rem / 1.25rem
  / 1.5rem by `data-usage`, and the plate 2rem / 2.5rem by `data-size`.
- `Input`'s password field reserves 2.75rem of inline-end padding for its reveal toggle. The old
  `pr-9` is a utility no application in this repository writes, so it was generated nowhere and the
  toggle sat on top of the value at every width.
- The `Input` resting control takes the field corner from `--field-radius`; `rounded-field` is not a
  Tailwind v4 name and emitted nothing.
- `StaticStateRow` now draws the 0.75rem row gap and 1rem inset the sheet always specified, instead
  of the `gap-2 py-2` that overrode it. This makes its own `GAP-3 PADDING-4` claim true.
- `SurfaceAccordionCard`'s trigger draws the 1rem inset the sheet specifies rather than the
  `px-4 py-3` that overrode it, which makes its `PADDING-4` claim true. Its body's inset is
  unchanged but now claims the rows it actually paints; the old `PADDING-8` named a row the padding
  scale does not have. The body's inset also moved onto a Grammar-owned element inside the vendor
  `Accordion.Body`, because the vendor puts a `className` on an inner node and every other prop on
  the outer one, which would split the rule from the claim promising it.
- `SurfaceCard`'s composition inset claim (`PADDING-4`, or `GAP-0 PADDING-0` when joined) moved from
  the surface shell to the content region, which is the element whose shipped rule draws it.
- The compact `PaneLayout` rail trigger's corner is the published control radius (0.75rem)
  rather than `rounded-lg` (0.5rem), and its hover fill and shadow are now shipped.
- `Rail`'s body carries `flex: 1 1 0%` unconditionally, matching the `flex-1` it used to spell.

### Capabilities

- `Button` takes `width?: "content" | "fill"`. `fill` forwards the vendor's own full-width variant
  and adds what the vendor does not own: a label that WRAPS onto a second line instead of
  overflowing, with the control height released to follow it. Two products were reaching through the
  Grammar boundary with a descendant width utility to get this.
- `Text` takes `overflow?: "wrap" | "truncate" | "clamp-2"`, shipped by `data-overflow`. Three
  dashboard blocks were reaching in with descendant selectors on `[data-size]` to force wrapping or
  truncation.
- `NavigationFeatureNav` makes `navigation` optional through the same `WithNavigation |
  WithoutNavigation` union `WorkspaceShell` uses. With no destinations it renders NO `nav` element -
  an empty navigation landmark is announced and reached and names nothing - and the primary grid
  drops the track instead of keeping it empty.
- `PrimaryRailLayout` takes `collapsedOrder?: "primary-first" | "rail-first"`. Once the container
  collapses to one column, `rail-first` lifts the rail above the primary content, for a filter or
  summary a reader needs before the content itself.

## 0.4.3

- `Sidebar` now owns its geometry in the packaged stylesheet. Every Tailwind utility it used to
  spell in JSX (rail and drawer widths, the right separator, list/section/item/header/footer
  rhythm, item shape and states) moved to `.starci-core-sidebar*` in `src/common/styles.css`,
  driven by `data-presentation`, `data-collapsed` and the React Aria item states. A consumer no
  longer has to scan `node_modules/@starci/grammar` with Tailwind to get a sidebar, and the item
  corner comes from the theme radius ramp instead of `rounded-large`, which emitted no CSS.
- Added `PressableField`: a field-shaped press target with input anatomy - optional leading icon,
  placeholder-style copy, optional `kbd` shortcut hint - painted from the same `--field-*` tokens
  `Input` reads. It replaces the two app-local `PressableInputLike` clones that pushed field
  geometry into a Grammar `Button` through `className`. It is not a `Button` variant.
- Added a package check that no shipped component spells layout or geometry in Tailwind utilities,
  with the remaining offenders recorded as a list that may only shrink.
