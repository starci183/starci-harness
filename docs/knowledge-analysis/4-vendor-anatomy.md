# 4. Vendor anatomy (HeroUI parity) — analysis

Area: `contexts/vendor/heroui/` (65 files) of the legacy runtime and how the Grammar package and the Grammar DNAs map onto it.
Legacy root below = `D:\Repositories\starci-academy-backend\.claude` (read only). HeroUI version measured: `@heroui/react` + `@heroui/styles` 3.2.6.

---

## 1. Inventory

### 1.1 `contexts/vendor/heroui/` (585 KB, 3 633 lines, 65 files)

| File(s) | Lines | Kind | Author | Holds |
|---|---|---|---|---|
| 63 `<component>.yaml` (accordion … typography) | 27–154 each | machine data (`schema: starci/vendor-heroui@1`) | **generated** by `scripts/work/ui/vendor-heroui.mjs --write` (header line 3 of each) | per component: `anatomy` (root, parts, required parts, style slots, embedded components), `variants` (defaults + closed value sets), `parts` (impl, data-slot, classes, defaults, **paint families**), `css` (files, classes, every vendor CSS rule as `apply` utilities + raw declarations) |
| `roles.yaml` | 56 | machine data (`starci/vendor-heroui-roles@1`) | **generated** (same script + `aria-query` 5.3.0) | ARIA role → HeroUI parts that carry it (e.g. `button` → 43 contracts), public API per role |
| `wrappers.yaml` | 76 | machine data with a prose header (`starci/vendor-heroui-wrappers@1`) | **hand-written StarCi decisions**, sha256-pinned in `modules/kernel/owner-rulings.yaml:691` | one row per Grammar file importing HeroUI: `wraps`, `delegates`, `overrides` (kind slot/style/default/role + target + reason) — 63 rows, 16 rows carry overrides (29 overrides total) |

No prose file exists in the folder. Nothing in `contexts/index.yaml` describes vendor; the folder is reached only by code:
`scripts/lib/grammar-vendor-parity.mjs` (the judge, 330 l), `scripts/checks/check-grammar-vendor-parity.mjs` (the gate),
`scripts/work/ui/grammar-vendor-dna.mjs` (input loader), `scripts/work/ui/grammar-knowledge.mjs:368` (writes references),
`scripts/work/ui/export-repaints.mjs`. `packages/hfs/runtime/scripts/lib/grammar-vendor-parity.mjs` is a byte-identical copy (`diff -q` clean).

### 1.2 Where the vendor is consumed / restated outside the folder (read for this analysis)

| Place | Kind | Vendor relevance |
|---|---|---|
| `contexts/grammars/{starci,offset-pop,heritage}/DNA.yaml` (`vendor`, `arrangement`, `intent` blocks; e.g. starci 160–200) | generated snapshot of `packages/grammar/src/*/dna.ts` | `vendor: {name: heroui, parity: strict|custom}`, arrangement (indicator side, separators, icon size, density), button intent → vendor variant map |
| `contexts/grammars/common/DNA.yaml:818` | generated token census | `--starci-core-control-min-size`, `assignedBy: family`, fallback 2.5rem, 53 uses |
| `contexts/grammars/starci/playbook.yaml:185–192`, `family.yaml:147–204` | prose | restates vendor slots (Label/Description), control sizes |
| `contexts/ui/composition/state.yaml:190–197` (STATE-6 case-6/7) | prose (owner decisions) | tab variant meaning and the "HeroUI's own pill tabs" paint |
| `contexts/ui/examples/brand-direction.example.yaml` (852 l) | prose example | ~15 restatements of HeroUI values ("Meter h-2 (8px)", "the real HeroUI Alert … bg-surface … shadow-surface") |
| `contexts/code/fe/toast.yaml:27–31` | prose rule FE-TOAST | "toast.tsx (the HeroUI toast wrapper)", "HeroUI toast region" |
| `modules/kernel/owner-rulings.yaml:656–712, 895` | rulings | `grammar-vendor-parity`, four successive wrapper pins, `repaint-default-heroui-unless-ruled`, `control-height-40` |
| `packages/grammar/src/core/**` (Button, IconButton, Tabs, Input, Select, SegmentedControl, Toast, `buttonIntent.tsx`, `dna.ts`) | code | the wrappers themselves |
| `packages/grammar/src/common/{styles.css (3 700 l), components-forms.css (593 l)}` | code | the Grammar CSS judged against the reference (control heights, field heights) |
| `packages/eslint/fe/control-height.mjs` | code (CONTROL-HEIGHT-1) | app-side size rule |
| `packages/grammar/README.md:268–273` | prose | "HeroUI parity" paragraph |

---

## 2. The model

```
 @heroui/react + @heroui/styles 3.2.6 (node_modules)            aria-query 5.3.0
            │  measured, never hand-written                         │
            ▼                                                       ▼
 vendor/heroui/<component>.yaml  ── anatomy · variants · parts(paints) · css rules      roles.yaml
            │                                                       │
            │            ┌──────────── wrappers.yaml (StarCi) ──────┤  file → wraps / delegates / overrides[]
            │            │            sha256 pin in owner-rulings   │
            ▼            ▼                                          ▼
      GRAMMAR_VENDOR_PARITY judge (scripts/lib/grammar-vendor-parity.mjs)
        UNIVERSAL layer (every Grammar):  role · anatomy · undeclared
        PER-GRAMMAR layer (DNA `vendor.parity`):
            strict  → also slot · style · default · stale  (only pinned overrides may deviate)   = StarCi Core
            custom  → universal layer only; may re-skin and re-arrange                          = Offset Pop, Heritage
            ▲
 packages/grammar/src/<family>/dna.ts  (paths, vendor.parity, arrangement, intent)
```

Concept relations:

- **Component family** = one HeroUI compound (`Tabs` = Root, ListContainer, List, Tab, Indicator, Separator, Panel). A Grammar file
  *wraps* one or more families; parts it does not draw are *delegated* (Modal `Trigger`/`CloseTrigger` go to the caller).
- **Anatomy** (must keep, every Grammar): the parts, required parts, embedded components (Button embeds Spinner; Select embeds
  ListBox, Label, Description), ARIA roles, keyboard and focus behaviour. Never hand-roll a role HeroUI has (`role` finding).
- **Paint** (strict Grammar keeps, custom Grammar may change): the paint families each part's vendor CSS decides
  (`paints: [background, block-size, padding, radius, …]`). Tokens are not paint: a strict Grammar may rebind `--accent`,
  `--radius`, `--field-radius` etc. (`packages/grammar/src/core/styles.css:47–83`) and the vendor rules resolve through them.
- **Arrangement** (declared per Grammar in DNA, never inferred from CSS): indicator side, separators, icon size, density.
- **Intent** (StarCi layer above vendor variants): `commit | alternative | dismiss | neutral | destructive` × placement
  `decision | item | chrome` → a vendor Button variant (`core/buttonIntent.tsx`).
- **Override**: a pinned, reasoned deviation of a strict Grammar from a vendor slot, style, default or role.

Offset Pop and Heritage do not import HeroUI themselves: `offset-pop/index.tsx` re-exports `../common/index.js` and adds CSS.
So in practice there is **one set of wrappers** (Core/Common) and families differ only by token sheet + CSS — exactly the
owner's "only CSS and arrangement differ".

---

## 3. The thinking

### 3.1 Parity law (StarCi decision)
`owner-rulings.yaml:710` (grammar-vendor-parity): "Each Grammar component that wraps HeroUI keeps HeroUI's anatomy and defaults.
The vendor reference … is generated … and never written by hand". `:675` (repaint-default-heroui-unless-ruled): an unruled repaint
"reverts to the HeroUI default and never waits for the owner". The judge's header (`grammar-vendor-parity.mjs:9–16`) is the best
single statement of the model: "`strict` keeps HeroUI's default CSS and arrangement … `custom` may re-skin and re-arrange (tokens,
radius, padding, colour, where the indicator sits, separators, icon size)".

### 3.2 Per component family (vendor facts from the generated YAML; StarCi decisions marked **SC**)

**Button** (`button.yaml`). Anatomy: Root only, embeds Spinner (`data-slot="spinner"`); no parts. Variants:
`primary | secondary | tertiary | outline | ghost | danger | danger-soft`, sizes `sm | md | lg`, `isIconOnly`, `fullWidth`;
defaults md/primary. The vendor's variant thinking is an **emphasis ladder on two axes — fill and tone**:
primary = accent fill; secondary = neutral `--default` fill + accent-soft text; tertiary = neutral fill + neutral text;
outline = border, no fill; ghost = nothing until hover; danger / danger-soft = the destructive pair (solid / soft)
(`button.yaml:40–46`). States are data attributes on the root: hover (only under `@media (hover: hover)`), pressed
(scale 0.97; 0.98 sm, 0.96 lg — bigger buttons move less), focus-visible, disabled, pending (`status-*` utilities).
Size scale: sm h-9→md:h-8, md h-10→md:h-9, lg h-11→md:h-10, i.e. **the vendor steps every size down 4 px on desktop**
(touch first); icon-only is the same square; svg size-5 (size-4 at sm). Radius rounded-3xl (pill at any height).
**SC**: Grammar `Button` (`core/primitive/Button/index.tsx:13,89`) adds size `control` = vendor md, adds `width: content|fill`
(fill releases height and wraps the label), `isSkeleton` distinct from action `isPending`, and splits destination (`href` → HeroUI
`Link` with `buttonVariants`) from command (HeroUI `Button`) at the type level. Apps declare `intent`, not `variant`
(`buttonIntent.tsx`, `docs/button-intent-props.generated.md`); the mapping is DNA data: commit → primary (decision/chrome) or
secondary (item); alternative → secondary; dismiss → tertiary; neutral → outline (decision) / ghost (item, chrome) / tertiary
(icon button in a navbar); destructive → danger-soft (entry) / danger (confirm) (`starci/DNA.yaml:175–195`). Thinking: the
*same* intent drops one emphasis step when it repeats per item, so a list of rows never shows a column of primaries.

**ButtonGroup** (`button-group.yaml`). Root + Separator; `orientation`, `fullWidth`; no size, no variant — the group inherits its
buttons' size and variant. Vendor arrangement: gap-0, inner corners squared (`rounded-none`, ends rounded-s/e-3xl), outline
borders collapsed between neighbours, press-scale disabled inside a group (`transform: none`), focused button raised `z-10`,
separator 1px at 50 % height, 15 % current colour. **SC**: `width="fill"` gives each Button `flex: 1 1 0`
(`common/components-forms.css:419–425`). ToggleButtonGroup (`toggle-button-group.yaml`) is the same arrangement for toggles
plus `isDetached`; ToggleButton repeats the Button size scale exactly (h-10/md:h-9 …) with variants `default | ghost`.

**Tabs** (`tabs.yaml`). Parts Root, ListContainer, List, Tab, Indicator (required), Separator, Panel; variants `primary | secondary`,
`align start|center|end`; **no size prop**. Vendor `primary` = a **segmented pill**: list container `bg-default`, radius
`--radius*2.5`, list `p-1`, tab `h-8 px-4 text-sm text-muted`, the Indicator is a full-size `bg-segment` pill with
`shadow-surface` sliding under the selected tab (250 ms translate/size), separators between unselected tabs fade beside the
selection. Vendor `secondary` = an **underline bar**: no track, `border-b`, indicator `h-0.5 bg-accent`, selected text
`foreground`. Note the vendor's size alignment: tab 32 px + list padding 2×4 px = a **40 px bar**, the same as a mobile md
Button. **SC**: STATE-6 case-6 (`ui/composition/state.yaml:192`) — the underline bar switches the page's main areas, once per
page, may reflect the URL; the pill strip switches panels inside a sub-region; never nest same-variant sets. The Grammar
names them the other way round from HeroUI and swaps at the boundary (`core/branch/Tabs/index.tsx:93–96`:
"STATE-6 names the page underline "primary" and the nested pill "secondary". HeroUI names those looks secondary and primary").
Variant defaults from surface nesting (`useSurfaceNesting`), the same "secondary inside a surface" thinking HeroUI uses for
fields (below). Four slot overrides pinned (`wrappers.yaml:31`).

**Chip** (`chip.yaml`). Root + Label; **two orthogonal axes**: `color` (tone: default, accent, success, warning, danger) ×
`variant` (emphasis: primary = solid tone fill, secondary = neutral fill + toned text (default), soft = tone-soft fill + soft
text, tertiary = transparent); sizes sm/md/lg ≈ 20/24/28 px (text-xs leading-5 with py-0 / py-0.5 / text-sm py-1).
Chips live **below** the control scale: they are labels, not targets. Badge (`badge.yaml`) is the same tone × emphasis
(primary/secondary/soft) plus `placement` on an Anchor, min-h 16/28/32. Tag (`tag.yaml`) is the *interactive* sibling
(RemoveButton required, gridcell/row roles) at text-xs/py-1, variants `default | surface`. **SC**: Grammar `Badge` wraps Chip
(`wrappers.yaml:51`); STATE-6 case-7 forbids painting tabs "in the accent-soft chip family" because chips next to a
ButtonGroup "read as a row of buttons, not a view switcher".

**Input / TextField / InputGroup / TextArea** (`input.yaml`, `textfield.yaml`, `input-group.yaml`, `textarea.yaml`).
TextField is the field frame (Label, Input|TextArea, Description, FieldError as embeds); InputGroup adds Prefix/Suffix and
squares the input's inner corners next to them. Variants `primary | secondary` only, `fullWidth`; **no size prop**. Vendor
variant thinking: `primary` = `bg-field` + `shadow-field` (a field on the page canvas), `secondary` = `--default` fill,
no shadow (a field **inside a surface**, where a white field would vanish) (`input.yaml` `.input--secondary`). Text is
`text-base` on mobile and `sm:text-sm` above (16 px avoids iOS focus zoom). Vendor height: `min-h-9` / `h-9` = **36 px** on
every field family (InputGroup, Select trigger, NumberField/SearchField/DateField/TimeField groups); InputOTP slot h-10.
**SC**: all single-line fields drawn at 2.5 rem / 40 px ("ONE SINGLE-LINE FIELD ANATOMY (0.9.8)",
`common/components-forms.css:195–219`), pinned as `InputGroup.Input:block-size` and `Select.Trigger:block-size`
(`wrappers.yaml:27,60`); variant resolved by nesting (`useFieldVariant`, `core/primitive/Input/index.tsx:119`).

**Select / ComboBox** (`select.yaml`, `combo-box.yaml`). Select: Trigger, Value, Indicator, ClearButton, Popover (required
Trigger+Popover), embeds ListBox/ListBoxItem/Label/Description; variants primary/secondary as fields. The option list is
**ListBox** (`list-box.yaml`): Item, ItemIndicator, Section; item `min-h-9 gap-3 rounded-2xl px-2 py-1.5` — the same 36 px row
as the menu item. **SC** arrangement: `Select.Indicator: end`, `ListBox.ItemIndicator: end` (`starci/DNA.yaml:168–173`).

**Card** (`card.yaml`). Root, Header, Title, Description, Content, Footer; variant = **surface level**, not emphasis:
`default` (bg-surface) / `secondary` / `tertiary` / `transparent`; `p-4 gap-3 shadow-surface`, radius `min(32px, --radius-3xl)`.
No size. The shared `surface.css` (`surface--default|secondary|tertiary|transparent`) is the same ladder reused by Accordion,
Alert, Popover, Modal, Drawer, Dropdown, Select, ComboBox, DatePicker. **SC**: `SurfaceCard` drops the shadow when nested on
another surface (`surfacecard-always-painted`, `wrappers.yaml:30`).

**Modal / AlertDialog / Drawer** (`modal.yaml`, `alert-dialog.yaml`, `drawer.yaml`). Same anatomy: Trigger, Backdrop,
Container, Dialog, Header, Heading, Icon, Body, Footer, CloseTrigger (required Trigger, Dialog, Heading, CloseTrigger: an
overlay must be named and closable). Variant = **backdrop** (`opaque | blur | transparent`), not the dialog paint.
Modal size = **max inline size** `xs|sm|md|lg` (max-w-xs…lg) + `cover` (fills the container) + `full` (edge to edge, no radius,
no shadow); `scroll: inside|outside`. AlertDialog adds `status` (accent…danger, default danger) and has no `full`. Drawer
replaces size with `placement` (bottom default, top/left/right) and adds Handle. Rhythm: dialog `p-6`; header→body `mt-2`,
→footer `mt-5`; footer `justify-end gap-2`. **SC**: Grammar `Dialog` wraps Modal, delegates Trigger/CloseTrigger to the
caller; Drawer overrides the handle bar slot. FE canon: only Modal and Drawer are shells (memory `fe-contract-wrapper-shell-model`).

**Dropdown / Menu** (`dropdown.yaml`). Trigger, Popover, Menu, Section, Item, ItemIndicator, SubmenuTrigger, SubmenuIndicator;
embeds Label, Description, Separator. No variants at the root; `menu-item--danger` is per item. Item `min-h-9 px-2 py-1.5
rounded-2xl gap-3`, indicator absolute at `start-2`. Roles: menu, menuitem, menuitemcheckbox, menuitemradio. **SC** arrangement:
`Dropdown.ItemIndicator: start, submenu: end`, leading glyph 20 px, `separators: between-sections`; the parity judge fails a
wrapper that renders a `Section` without the vendor's embedded Separator (`grammar-vendor-parity.mjs:22`).

**Table** (`table.yaml`). 14 parts (ScrollContainer, Content, Header, Column, SortableColumnHeader, ColumnResizer, Body, Row,
Cell, Footer, LoadMore …), required Content, Column, Row, Cell, ColumnResizer; variants `primary` (the table sits in a
`bg-surface-secondary` tray, `px-1 pb-1`, radius `--radius*2.5`) / `secondary` (no tray, header cells tinted, rows divided by
`border-separator-tertiary/50`). Density: column `px-4 py-2.5 text-xs text-muted`, cell `px-4 py-3 text-sm`. No size.
**SC**: `DataTable` wraps Table + Checkbox, delegates ColumnResizer.

**Alert / Toast** (`alert.yaml`). Alert: Indicator, Content, Title, Description; **only `status`** (default, accent, success,
warning, danger); one paint for all statuses: `bg-surface shadow-surface px-4 py-3 gap-4`, tone only on the indicator glyph and
title (`*-soft-foreground`). There is no toast reference: HeroUI's Toast is not wrapped. **SC**: Grammar `Toast`
(`core/branch/Toast/index.tsx`) is its own queue (timeouts, WCAG 2.2.1 persistence, pause on hover/focus) rendering HeroUI
`Alert` + `Spinner`; ruling ACCENT (2026-09-27) accepts the Alert "as the HeroUI Alert renders it" (`ui/composition/accent.yaml:138`).

**Small members** used by the above: Spinner sm/md/lg/xl = 16/24/32/40; CloseButton h-6 (24); Kbd h-6; Checkbox control
size-4; Avatar sm/md/lg = 32/40/48; Pagination link sm/md/lg = 32/36/40 (→28/32/36 desktop); ProgressBar/Meter track
h-1/h-2/h-3; Label text-sm; Description/Header/ErrorMessage text-xs muted.

### 3.3 How sizes align across components

| Family | sm | md (default) | lg | size prop? | vendor note |
|---|---|---|---|---|---|
| Button, ToggleButton, icon-only | 36 → 32 | 40 → 36 | 44 → 40 | yes | 4 px smaller from `md:` breakpoint |
| Pagination link | 32 → 28 | 36 → 32 | 40 → 36 | yes | one step under Button |
| Tabs bar (tab h-8 + p-1) | – | 40 | – | no | |
| Fields (Input, Select, Search/Number/Date/Time) | – | 36 | – | no | text 16 px mobile / 14 px desktop |
| InputOTP slot | – | 40 | – | no | |
| Menu / ListBox item | – | ≥36 | – | no | |
| Avatar | 32 | 40 | 48 | yes | **already the 32/40/48 scale** |
| Chip / Badge / Tag | ≈20 / 16 | ≈24 / 28 | ≈28 / 32 | yes | below control scale (labels) |
| Spinner | 16 | 24 | 32 (+xl 40) | yes | glyph scale |

Vendor logic: controls cluster at 36–40 px with a 4 px step and a desktop step-down; labels and glyphs live on their own smaller
scales; the only vendor family already on an 8 px 32/40/48 ladder is Avatar.

**SC** (`owner-rulings.yaml:895`, control-height-40, 2026-10-26): "One control height, 40px (2.5rem, HeroUI's own h-10), is the
default of every standalone control … Only two other steps exist: sm (32px) for a control nested in an item or a dense toolbar,
and lg (48px) for a marketing hero call to action … Controls in one row … share one height". Implemented in
`common/styles.css:2909–2946` (Button md/control 40, sm 32, lg 48, `!important`, all breakpoints; IconButton a 40 px circle) and
app-side by `packages/eslint/fe/control-height.mjs` (CONTROL-HEIGHT-1). The thinking: *a row is read as one object, so its
controls share one height*; the vendor's desktop step-down and its 36 px fields broke that in mixed rows (top bar with Button,
Switch, Avatar, SearchField). StarCi effectively adopts the Avatar ladder for every control.

---

## 4. Problems

### 4.1 The parity gate is blind exactly where the size ruling acts
`button.yaml:22`: `Root: {"impl":"ButtonRoot", … "classes":[], … "paints":[]}`. The same empty `paints` on ToggleButton,
Spinner, Separator, Label, Description, CloseButton, ListBox root and 15 more roots (grep of `"paints":[]` on `Root:`). The
generator finds classes only when they are literal in the component source; Button's come from `tailwind-variants`
(`buttonVariants`). Consequence: Grammar CSS that repaints Button height (sm 2 rem, lg 3 rem, md:h-9 removed) and IconButton
size (`common/styles.css:2914–2930`) and the SegmentedControl segment height (`components-forms.css:410–412`) raise no `style`
finding, so `wrappers.yaml` declares only `Link.Root:block-size` for control-height-40 (`:52`) and nothing on IconButton or
SegmentedControl. "Zero findings are suspicious" applies: the strict layer under-measures the most-used component.

### 4.2 Contradictions in the control scale
- SegmentedControl `control` = **2.75 rem (44 px)**, described as "the shared control height (2.75rem, the IconButton and bar
  control height)" (`core/composite/SegmentedControl/index.tsx:25–26`, `components-forms.css:405,411,157`), while the ruling
  and IconButton say 40 px. `playbook.yaml:188` says "2.5rem (40px) shared height" and three lines later (`:191`) "held to
  2.75rem" in the same recipe.
- The "44px TOUCH FLOOR" block (`components-forms.css:545–582`) declares the floor with `var(--starci-core-control-min-size, 2.5rem)`
  = 40 px, not 44.
- `--starci-core-control-min-size` (53 uses) and `--starci-core-field-min-height` are never assigned; `common/DNA.yaml:818`
  records `assignedBy: "family"` although no family sheet sets it. The value lives in ~60 duplicated fallbacks, two of which
  disagree (2.5 vs 2.75 rem).
- `control-height.mjs:9` asserts "the vendor `md` and Grammar's `control` are the same 40px height". False for SegmentedControl
  (md = vendor ToggleButtonGroup md, 36 px desktop; control = 44), for Switch (vendor md track is not 40), and for Button on
  desktop without the Grammar CSS.

### 4.3 Tabs vocabulary inverted against the vendor
Grammar `primary` = vendor `secondary` (underline) and vice versa (`Tabs/index.tsx:94–96`), fixed by an owner decision
(STATE-6). Every other Grammar component passes vendor variant names one-to-one (Button `VARIANTS` table, Input, Select). The
wrappers reason "the primary tabs are StarCi's underline look: the vendor tab list is restyled" (`wrappers.yaml:31`) is
misleading: the vendor already ships the underline look as `secondary`. Parity by name is broken for one family only; agents
reading the HeroUI docs and the Grammar get opposite meanings.

### 4.4 Duplication
- **Inside the generated reference**: a CSS file shared by several components is copied into each (1 584 rule rows, 1 257
  distinct; 239 rule keys appear in more than one file). `surface.css` is copied into 11 files, `close-button.css` into 6,
  `textfield.css` into 4; `button.yaml` carries all of `button-group.css` again.
- **Across DNAs**: the `arrangement` block (indicatorSide, separators, iconSize, density) and the `intent` block are
  byte-identical in `starci`, `offset-pop` and `heritage` DNA (`starci/DNA.yaml:166–195`, `offset-pop/DNA.yaml:211–248`,
  `heritage/DNA.yaml:41–78`; verified with diff). Arrangement was supposed to be the per-Grammar difference; today it is one fact in three places.
- **Pin accretion**: four rulings each record a new sha256 of `wrappers.yaml` (`owner-rulings.yaml:661,669,683,691`); only the
  last is live (current file hash = `f4c77c1e…`, matches `:691`). Three are dead history inside a live rules file.
- **Lib copy**: `scripts/lib/grammar-vendor-parity.mjs` and `packages/hfs/runtime/scripts/lib/grammar-vendor-parity.mjs`.

### 4.5 Prose restating vendor values (will drift on the next HeroUI bump)
`ui/examples/brand-direction.example.yaml` ("Meter/Progress track h-2", "bg-surface row with shadow-surface", "size-4 indicator
glyph" — lines 13, 160, 485, 632), `ui/composition/state.yaml:197` (pill paint described in detail), `playbook.yaml:191`
("HeroUI lg group"), `ui/presentation/radius.yaml:66` (rounded-field). Each could cite `vendor.heroui.<c>` instead.

### 4.6 Stale or wrong vendor claims
- `code/fe/toast.yaml:27,31`: "toast.tsx (the HeroUI toast wrapper)", "The HeroUI toast region is mounted once": the Grammar
  Toast is StarCi's own queue over HeroUI Alert; HeroUI Toast has no reference file and no wrapper.
- `wrappers.yaml` reasons cite ruling ids of three shapes (`ruling:R318/case-1`, `owner ruling control-height-40`,
  `owner 2026-10-25`, `listed for the owner ruling that pins it` ×11). Eleven overrides have no ruling of their own, only "listed
  for the pin", which `repaint-default-heroui-unless-ruled` (`owner-rulings.yaml:675`) says must revert.

### 4.7 Gaps
- No human-readable vendor page: agents learn the anatomy only from 100-line JSON-in-YAML rows; nothing states the variant
  *thinking* (emphasis ladder, tone × emphasis, surface ladder, backdrop variant, "secondary = inside a surface").
- No reference for components StarCi hand-builds where HeroUI has one: Menu (HeroUI `Menu.Root` is in `roles.yaml`), Toast,
  Toolbar, Autocomplete; Rating and the Textarea @-mention list are declared `role` overrides.
- The reference is generated only for the wrapped set, so "may a Grammar use X?" cannot be answered from it.

---

## 5. Proposal for the new harness

### 5.1 Keep / merge / drop / move

| Item | Decision | Reason |
|---|---|---|
| 63 generated `<component>.yaml` | **Keep as generated, but out of `contexts/`**: emit to a build cache (`.cache/vendor/heroui@3.2.6/`) on demand, keyed by installed version; not committed knowledge | pure HeroUI facts, regenerable, 585 KB; committing them adds nothing an agent authors |
| shared CSS duplicated per component | **Generate once per CSS file** (`css/<file>.yaml`) and reference it from the component | removes the 239 duplicate rule keys |
| generator class discovery | **Fix in code**: resolve `tailwind-variants` slot tables (`buttonVariants`, `toggleButtonVariants`, …) so Root paints are measured | closes 4.1; expect new red findings on Button/IconButton/SegmentedControl, to be ruled or reverted |
| `roles.yaml` | keep, generated, same cache | consumed only by the judge |
| `wrappers.yaml` | **Keep as the one StarCi vendor-decision file**, but every override must carry a `ruling:` id field (not prose); drop the 11 "listed for the pin" entries or rule them | one owner per deviation |
| sha256 pin history | keep only the live pin; move history to git | 4.4 |
| DNA `arrangement` + `intent` | **One default in Common DNA**; a family DNA lists only what differs | 4.4; makes "per Grammar" visible |
| control-height facts | **One token** `--grammar-control-height` assigned in the Common sheet (sm/md/lg = 2/2.5/3 rem); delete fallbacks; SegmentedControl → 2.5 rem or a ruled exception; touch floor its own token (2.75 rem) | 4.2 |
| Tabs variant names | **Owner decision needed**: either adopt vendor names (pill = primary) and keep STATE-6 semantics as *placement* (`page` / `region`), or record the inversion as a `default`-kind override | 4.3 |
| prose restating vendor values | replace values with `see vendor.heroui.<c>` references | 4.5 |
| `code/fe/toast.yaml` wording | fix to "Grammar Toast (Alert-based)" | 4.6 |
| `packages/hfs/runtime/scripts/lib/grammar-vendor-parity.mjs` copy | single source, imported | 4.4 |

### 5.2 Target layout (vendor area of the new `contexts/`)

```
contexts/vendor/
  heroui.md                 # prose, ~200 lines, hand-written: the vendor's design thinking per family —
                            #   emphasis ladder (Button), tone × emphasis (Chip/Badge), surface ladder (Card/surface.css),
                            #   backdrop variant (Modal/Drawer), "secondary = inside a surface" (fields, Table, Tabs),
                            #   the vendor size table (3.3) and what StarCi changed about it; links to HeroUI docs per family
  parity.yaml               # StarCi decisions only: strict/custom meaning, must-keep vs may-change list (anatomy, roles,
                            #   required parts, embeds, a11y = keep; paint, arrangement = per parity), the size ladder
                            #   decision (32/40/48, one height per row) with its ruling id
  wrappers.yaml             # moved unchanged in role: file → wraps/delegates/overrides(ruling id), pinned
(generated, not committed)  .cache/vendor/heroui@<ver>/{components/*.yaml, css/*.yaml, roles.yaml}
```

Component-level UI *thinking* (when to use underline vs pill tabs, when a chip vs a button) belongs to `contexts/ui/<component>`
(analysis 3); `heroui.md` states only what the vendor ships and why, so the ui layer can cite it rather than restate it.

### 5.3 Readers

| File | Agent at authoring time | Gate | Generator |
|---|---|---|---|
| `vendor/heroui.md` | yes — before writing or reviewing a Grammar wrapper or picking a variant/size | no | no |
| `vendor/parity.yaml` | yes (what a Grammar may change) | `GRAMMAR_VENDOR_PARITY` reads parity modes and the size ladder | grammar-knowledge (DNA defaults) |
| `vendor/wrappers.yaml` | yes when adding an override | parity judge + pin check | repaint export |
| `.cache/vendor/heroui@ver/**` | only on demand (exact vendor value) | parity judge | `vendor-heroui.mjs` writes it |
| `packages/eslint/fe/control-height.mjs` | no | ESLint in apps (CONTROL-HEIGHT-1) | — |

Machine rules stay in code (judge, eslint, Grammar CSS); knowledge selects and explains; each vendor fact lives in the generated
cache, each StarCi deviation in `wrappers.yaml` with one ruling id, each piece of vendor design thinking in `heroui.md`.
