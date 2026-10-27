# Open decisions: grammars and vendor

Decisions taken while writing [grammars](../grammars/README.md) and [vendor](../vendor/README.md), each with the
alternative and the reason, so the owner can overturn one in one place. A ruling the owner confirms moves to
[rulings.yaml](rulings.yaml) and its row here is deleted. The follow-up column names the code that must change for
the knowledge to be true; until then the gate that checks it stays red, by design.

## Decisions

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| D-1 | Two grammars: `core` (the legacy core grammar, kept faithfully, strict parity) and `offset-pop` (redesigned on the contract). The catalog id, source id and DNA id are `core`, its root is `CoreGrammarRoot` and its lint is `@starci/eslint-grammar-core`; the CSS class prefix `starci-core-*` and the rule namespace `starci-grammar/` stay. There is no `heritage` and no separate `starci` family | keep `starci` and `heritage`; or a plain-HeroUI `core` beside a violet `starci` | owner ruling relayed by the coordinator; one id per grammar ends the `starci`/`core`/`starci-core` split | package: move Common's renderers out of `src/core/**` so the path stops meaning two things; Common's base sheet reads `--grammar-*`, not `--starci-core-*`; band tokens become `--grammar-band-*` |
| D-2 | Tabs keep HeroUI's names one to one: `primary` is the pill (region tabs, inside a surface), `secondary` the underline (page tabs, on the page). The grammar resolves the look from nesting; apps never pass `variant` | name the looks by placement (`page`, `region`); keep the legacy inversion | every other wrapper passes vendor names one to one; the inversion made HeroUI docs and the grammar mean opposite things; placement names would add a third vocabulary when apps never write the value anyway (ui UI-9 allows either) | `Tabs` passes the variant through; remove the four `.tabs__*` restyles (wrapper rows dropped, D-11); lint refuses an app-set tabs variant |
| D-3 | One ramp `sm` < `md` < `lg` (reference 32/40/48), held at every breakpoint; `md` default; fields and selects `md` only; SegmentedControl `sm`, `md`; TagGroup `sm` default, `md`; `control` renders at `md` and is set only by the bar composition, never by an app | `control` stays a prop value an app may pass (ui scale.md allows "nothing or `control`") | a value the app may pass or omit with the same result is a choice made two ways (owner guidance 1); the bar already knows its children are bar controls, as placement already knows a button's context | remove `control` from app-facing size types (Button, IconButton, Input, SegmentedControl, Switch, Avatar) and set it from `TopBar`/`WorkspaceShell` context; SegmentedControl 2.75rem `control` and vendor `lg` go; merge `navbar-control-size` with canon `control-height` |
| D-4 | Common assigns the size tokens once: `--grammar-control-height-{sm,md,lg}`, `--grammar-target-{coarse,fine}`; a grammar assigns the corner roles `--grammar-radius-{tiny,compact,control,surface,hero,pill}` from its base radius | keep `--starci-core-control-min-size` and `-field-min-height` read with fallbacks | the legacy names were never assigned and carried about 60 fallbacks, two of which disagreed (2.5 vs 2.75rem); corner roles as tokens stop literals freezing one grammar's corner into all (ui UI-12) | Common sheet assigns the size and target tokens and deletes fallbacks; every pressable part gets a hit-area extension to the target floor; `core` DNA adds `tinyRadius`, `compactRadius`, `heroRadius` |
| D-5 | Parity modes defined in [vendor/parity.yaml](../vendor/parity.yaml): `strict` changes tokens only, `custom` may re-skin paint and arrangement in its scope; both keep anatomy, roles, keyboard and focus. Common's wrappers and sheets are judged strict for every grammar | drop the field; or leave `custom` undefined | `custom` was declared by two grammars and defined nowhere, so it permitted anything | parity judge reads the mode table from parity.yaml |
| D-6 | The intent map, arrangement, collection-item and avatar defaults are Common data in one module; a grammar's DNA does not carry them; the resolver imports no grammar and throws on an unknown one | keep a copy per DNA | the three copies were byte-identical, and the resolver's string switch made Common import every family and silently fall back to one | `src/common/intent.ts` (and siblings); `ButtonIntentFamilyProvider` loses its family switch |
| D-7 | Lint: `@starci/eslint-grammar-common` holds the Common-API checks; each grammar ships `@starci/eslint-grammar-<id>` with a factory, even when it only re-exports; a grammar without a factory fails closed | keep `eslint-grammar-core` as the shared package | the package named for one grammar holds every grammar's checks, so a grammar without its own package would get zero grammar rules silently | split; `fe-stack` refuses a grammar whose lint entry is missing |
| D-8 | `COMMON_SPACING_SCALE` is the only spacing scale; grammar spacing-scale exports go; there are no fractional rungs | publish the 0.5/1.5/2.5 and 5/10/12/16 steps the family copies carried | three answers to "what is the scale" (Common, two family copies, the lint); a grammar does not re-space | delete `STARCI_CORE_SPACING_SCALE`, `OFFSET_POP_SPACING_SCALE` |
| D-9 | Idioms and playbook shapes live once in [common](../grammars/common.md), product names replaced by roles; a grammar file lists only shapes it composes differently | per-family idiom and playbook files | the Core idioms were compositions of Common renderers with nothing grammar-specific, and Offset Pop's "idioms" were its CSS signature | none |
| D-10 | Measured snapshots (DNA census, renderer census, token census, gap lists) leave knowledge; values are read from `dna.ts`, gaps are tracked against the package | keep generated DNA.yaml files in knowledge | four copies of one renderer census; counts and versions in prose went stale | the census generator writes an untracked artefact if a gate still needs it |
| D-11 | The eleven wrapper overrides "listed for the owner ruling" are resolved: dropped (revert to the vendor) Drawer handle bar, SurfaceCard `.card` single column (the vendor card is already one column), the four Tabs slots (D-2), the two Textarea mention-list roles; kept with a proposed ruling the vertical scroll region (`grammar-scroll-region-fills-parent`) and Rating (`grammar-rating-radiogroup`); kept under `control-height-40` the Switch description indent | rule all eleven as they are | ruling `repaint-default-heroui-unless-ruled`: an unruled repaint reverts; a "listed for the pin" reason is not a reason | rebuild the mention list on the vendor ListBox in a Popover (or Autocomplete); remove the dropped CSS; record the two proposed rulings and the new wrappers digest |
| D-12 | Every grammar's Alert keeps the tone on the indicator and the title only; the `soft` appearance is the tinted alternative | let a grammar fill the alert with its tone | ruling `alert-white-surface` and the vendor's one-paint Alert; a filled outcome surface competes with the commit | `offset-pop` alert CSS (O-10) |
| D-13 | The shell has no bottom tab bar in any grammar | allow a bottom dock in a mobile-first grammar | the shell rule and the lint `no-shell-bottom-tabs` already refuse it; the legacy Offset Pop dock contradicted both | `offset-pop` dock CSS removed (O-4) |
| D-14 | The contract's colour roles include `surface-tertiary`, `default`, `default-foreground`, the three soft foregrounds and `field-shadow` | keep the shorter list | both grammars already bind or need them; an unbound role silently takes the host theme | `core` binds `surface-tertiary` under the HeroUI name and binds `field-shadow` (C-3) |
| D-15 | The vendor reference is an untracked cache keyed by version; the generator resolves `tailwind-variants` tables and covers every vendor component | keep 63 generated files in knowledge | regenerable facts add nothing an agent authors; the generator measured Button with no paint, so the strict gate was blind exactly where the size ruling acts | expect new findings on Button, IconButton and ToggleButton block size, ruled under `control-height-40` |

## offset-pop, designed on the contract

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| O-1 | The sticker (ink outline plus hard offset) on top-level objects only; nested surfaces keep the outline, drop the shadow and take the secondary fill. A recorded departure from "border and shadow are alternatives" | narrow it further or drop the outline | the pair is the grammar's face; at top depth only, it never doubles inside a surface | conformance evidence stays on BOUNDARY-6 |
| O-2 | One pink for action, selection, current and focus, each with a non-colour carrier (fill on the action, outline for focus, leading edge for selection, underline or raised pill for current) | a second hue for selection | a second decision hue dilutes the one-accent look; the carriers satisfy distinguishability with colour removed | audit every screen where focus, selection and the commit meet, in greyscale |
| O-3 | All shadow geometry derives from the DNA `offset` group, including the press vector and small chip shadows; narrow viewports change the offset tokens | literal shadows per component | literals did not follow the narrow-viewport drop | replace the `0.25rem 0.25rem` and `0.125rem 0.1875rem` literals |
| O-4 | No bottom dock (D-13) | keep the dock as the mobile signature | contract shell | remove the dock CSS |
| O-5 | No re-spacing, no resizing: Common's ramp and rhythm; answer choices are full-width rows, not enlarged controls | bigger targets for a playful app | targets meet the floor through hit areas (D-4), so the grammar keeps the ramp | none |
| O-6 | Every composition uses `intent`, never `variant` | the legacy `variant="primary"` examples | the lint refuses a variant | none in knowledge; package README examples |
| O-7 | `surfaceTertiary` equals `surfaceSecondary` | a third recessed tint | the grammar has one recessed level, the pocket | add the key to `OFFSET_POP_DNA` |
| O-8 | The display heading is heavy and tight; sizes and ranks stay Common's | Common's display weight | type voice is paint under custom parity | none |
| O-9 | Row states: yellow hover wash, pink focus ring on the row edge, selected soft pink pocket with a pink leading edge and `accentText` label; static rows have no hover | selected as a solid pink fill | a pocket reads as chosen without competing with the one pink fill | none |
| O-10 | Alert `surface` is a sticker with tone on indicator and title; `soft` is the palette tint with ink text (D-12) | tone-filled alerts | contract | change the alert tone CSS |
| O-11 | The modal backdrop is a blush tint in light and a pink-tinted near-black in dark | the vendor scrim | backdrop paint is custom; it pushes the page back in the grammar's own colour | none |
| O-12 | The legacy family shapes (home, one question per screen, result, browse and pick, bottom-sheet task, sign-up, settings) are product-neutral and move to Common's playbook; none is grammar-specific | keep them as offset-pop shapes | they compose Common renderers; only paint differs | none |

## Code follow-ups named by the grammar files

| Id | Change |
|---|---|
| C-1 | `Tabs` passes vendor variants one to one and drops its app-facing `variant` prop (D-2, G-3) |
| C-2 | Remove the dropped wrapper CSS: Drawer handle bar, SurfaceCard `.card`, Tabs slots (D-11) |
| C-3 | `core` binds `--field-shadow` (or a field border on top-level surfaces): today a field on a white top-level card shows no edge |
| C-4 | `core` binds `--surface-tertiary` under the HeroUI name instead of `--starci-surface-tertiary` (D-14) |
| C-5 | Common base sheet reads `--grammar-*` rhythm directly; today the base renderers read `--starci-core-*` aliases a grammar must set, and `data-grammar-theme` is read only inside a grammar scope |
| C-6 | Overlays use one portal helper; today two helpers implement the root rule |
| C-7 | Every grammar component that passes a render callback across the RSC boundary (`SurfaceCard` first) declares `"use client"` itself; found by the starci-next-fe trial, where an op re-exported `SurfaceCard` behind a `"use client"` shim in the app; R321 `FE_GRAMMAR_SHIM` refuses that shim in an app, which reports the defect instead |

## Gaps: choices an app can make two ways

Each is closed by an API that removes the choice (preferred), a lint rule, or one rule in the owning file.

| Id | Choice | Closing move |
|---|---|---|
| G-1 | `Button`/`IconButton` publish `variant` beside `intent` | API: drop `variant` from the app-facing type (lint `button-no-variant` refuses it today) |
| G-2 | Fields and `Select` publish `variant` | API: drop it; context resolves (lint `nested-control-variant` refuses a static one today) |
| G-3 | `Tabs` publish `variant` | API: drop it (C-1) |
| G-4 | `size="control"` equals `md`; `Input` publishes `md` and `control` | API: D-3 |
| G-5 | `EmptyNotice` takes `actionVariant` | API: the notice's action is a `commit` at `decision` placement (or `neutral`), resolved like any button |
| G-6 | `sm` vs `md` is judged by the app ("nested in an item or a dense toolbar") | API: `item` placement and a dense `Toolbar` composition set `sm`; `lg` only through a landing-hero composition |
| G-7 | Joined-card band insets are written by the app (`px-4 pt-3` …) | API: a band part of `SurfaceCard` that applies side contact |
| G-8 | Title and supporting line: `SurfaceCopyGroup` or an app stack of two `Text` | lint: two stacked `Text` at the tightest gap outside `SurfaceCopyGroup` |
| G-9 | `isHighlight` on more than one card per view | lint: one per render, like `single-commit-per-render` |
| G-10 | Drawer `placement` for a secondary task, side or bottom by width | API: a responsive placement (side on wide, bottom on narrow) as the default |
| G-11 | `Toaster` placement | API: the shell sets a placement clear of its fixed chrome; the app passes none |
| G-12 | `Text` weight `medium` vs `semibold` | rule in [ui/presentation](../ui/presentation.md), or one emphasis weight |
| G-13 | Button `width` content or fill | rule in [ui/components/button](../ui/components/button.md): fill only in a single-column action band at a narrow width |
| G-14 | Which tokens a product's brand file may set | API: each grammar exports its overridable token list; the stylesheet lint refuses any other |
| G-15 | `Tabs` `inset` page or none | API: derive `page` when the tabs are a direct child of `PageContainer` |
| G-16 | Mixed glyph sizes in one region | lint: one glyph step per region |
| G-17 | Alert `appearance` surface or soft | API: resolve `soft` inside a band, `surface` on the canvas |
| G-18 | `ListBox` publishes `className` | API: drop it (no public style doors) |
| G-19 | Base `Input` speaks `hint`/`isError`, the other fields `description`/`errorMessage`/`isInvalid`; `OtpInput` speaks `disabled`/`invalid` | API: one field vocabulary |

## What the contract cannot express yet

| Id | Today | Needed |
|---|---|---|
| X-1 | `offset-pop` changes its offset and surface radius at narrow viewports | contract tokens that may vary by a named viewport condition |
| X-2 | `core` re-declares `--accent` on the elements where Common paints the accent as text | Common reads an `accent-text` role there, so the scoped rule disappears |
| X-3 | Motion values live in each grammar's namespace; Common renderers cannot read them | contract `motion-duration` and `motion-easing` token names Common reads |
| X-4 | The ink band (`SurfaceCard treatment="ink"`) uses `--grammar-ink-band*` tokens a grammar sets | an ink-band role in the contract, or drop the treatment (ui UI-7 allows no copy on a slab) |
| X-5 | Display type voice (weight, tracking) is per-grammar CSS | a `font-display` role, or accept it as custom paint |

## Wrappers pin

[vendor/wrappers.yaml](../vendor/wrappers.yaml) changed (D-11, reasons rewritten as one sentence each with a
`ruling` field), so it needs a ruling that records its new sha256,
`6c17a7c16b8667208a4b3439336318954cba7108cafccf4e85c16479a39ae5f4`, together with the two proposed rulings. The
`grammar-menu-drawer-live-time` reasons on Pagination, Link and Avatar were copy-paste in the legacy file; they
are restated per part and need a render check.
