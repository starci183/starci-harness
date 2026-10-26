# 5. FE patterns (the app side of UI knowledge) and the whole-knowledge map

Scope: how an app consumes a Grammar, what `contexts/code/fe/*` says about UI versus what grammar/ui knowledge says,
which facts `@starci/eslint-canon-fe` (`packages/eslint/fe`) enforces, the UI parts of `contexts/hfs/*`, and a map of all of
`contexts/` with a proposed top-level layout for `D:\.claude\knowledge`.
Legacy root below = `D:\Repositories\starci-academy-backend\.claude` (read only). Paths are relative to it.

---

## 1. Inventory

### 1.1 Files read in my area

| File | Bytes | Holds | Machine data or prose |
|---|---|---|---|
| `contexts/index.yaml` | 5.8k | Load order and branch list of the whole tree | Prose (agent); no script parses its branches |
| `contexts/code/enforcement.yaml` | 8.7k | ENF-MANDATORY-1..7 anti-bypass law, ENF-PROP-* proposals | Prose; **no script, skill or module references it** (grep: 0 readers) |
| `code/fe/index.yaml` | 10.1k | FE-RULE-OWNERSHIP (the 4-question placement test) + topic table | Prose; topic `slots:` lists read by `scripts/gates/read-digest.mjs` |
| `code/fe/ui.yaml` | 4.0k | FE-UI: compose the selected Grammar; avatar/group identity cases | Prose + `verification.automated` codes; copied into the `eslint-grammar-starci/runtime` bundle |
| `code/fe/css.yaml` | 5.5k | FE-CSS-1..4: globals.css shape, colour only in brand.css, forbidden CSS, family tokens belong to Grammar | Prose + codes |
| `code/fe/theme.yaml` | 1.7k | FE-THEME: next-themes in components/providers | Prose |
| `code/fe/icon.yaml` | 4.2k | FE-ICON: one glyph vocabulary through its icon owner, 7 owner cases | Prose |
| `code/fe/motion.yaml` | 1.4k | FE-MOTION: framer-motion | Prose (restates fe-stack) |
| `code/fe/toast.yaml` | 3.0k | FE-TOAST: modules/toast + use*WithToast | Prose |
| `code/fe/chart.yaml` | 1.4k | FE-CHART: recharts "styled by the dataviz grammar" | Prose (restates fe-stack) |
| `code/fe/form.yaml` | 4.9k | FE-FORM: rhf + zod + INPUT_BOUNDS | Prose |
| `code/fe/folder.yaml` | 21.6k | FE-FOLDER-1..6 tiers; `frameworkPinnedRootFiles` | Mixed: the pinned-file list is **machine data** read by `scripts/hfs/architecture/framework-pinned.mjs` |
| `code/fe/boundaries.yaml` | 13.6k | FE-BOUNDARY-1..5 incl. the overlay host tree | Prose |
| `code/fe/naming.yaml` | 12.8k | FE-NAMING-1..7 incl. class-name exports | Prose |
| `code/fe/architecture-check.yaml` | 14.4k | FE-ARCHITECTURE-1..5 (route adapters, direction, world ownership) | Prose |
| `code/fe/function.yaml`, `imports.yaml` (UI parts) | 21.8k / 14.4k | FE-FUNCTION-2 `{state, props, on}` drawing law; FE-IMPORTS-5 vendor boundaries | Prose |
| `hfs/fe-stack.yaml` | 12.9k | One library per FE concern with `forbids` | **Machine data** (eslint-fe `fe-stack-import`, `scripts/hfs/rules/fe-stack.mjs`) + `why` prose |
| `hfs/slots.yaml` (fe part) | 150k total | `tiers.fe`, `fe.*` slots, budgets | **Machine data** (`scripts/hfs/slots.mjs`, 42 code readers) |
| `hfs/rules.yaml` (UI rules) | 451k total, 294 rules | R61/62/63/92/93/97/244/286/313-320 with `law`, `enforcers`, `proves` | **Machine data** (50 code readers) with a prose `law` string |
| `hfs/design-truths.yaml` | 10.1k | Loosening exceptions; `fe-has-no-specs`; fe budgets | Machine data (loosening-state check), digest-pinned |
| `hfs/facts.yaml` | 1.2k | 2 prose-contradiction facts (fe package.json, one lockfile) | Machine data (`scripts/hfs/runtime-rules/facts.mjs`) |
| `hfs/surfaces.yaml` | 66.9k | **Standard-coverage surfaces (A15)**, not UI surfaces; `code-fe` lists rules/slots per edition | Machine data (`check-hfs-coverage.mjs`) |
| `hfs/runtime-slots.yaml` | 36.9k | Slots of the `.claude` runtime itself; UI touch: `grammar-dist`, `grammar-vendor-parity` checks, eslint runtime bundles | Machine data |
| `hfs/rulings.yaml` | 29.4k, 40 rulings | Owner rulings; UI one: `heroicons-family-icon-set` | Machine data (coverage check) + statement prose |
| `hfs/canon-pins.yaml` | 31.3k | Exact versions; `@starci/grammar` 0.12.13, both grammar lint packages, stylelint canon | Machine data; `why` strings carry a Grammar changelog (one `why` is 565 chars) |
| `hfs/README.md` §6 | 233k total | FE source tree (generated block) + §6.2 rules prose | Prose; tree block generated |
| `packages/eslint/fe/*` | 37 law modules, 18.5k lines, 19 docs (60.8k) | `@starci/eslint-canon-fe` 9.1.9 | Code + `docs/*.md` prose per law |
| `packages/eslint/grammar-starci`, `grammar-offset-pop` | | Family lint; offset-pop re-exports starci's rules | Code |
| Context: `CONTEXT.md:49-70`, `modules/kernel/removed-vocabulary.yaml`, `packages/grammar/src/core/*` | | | |

### 1.2 Totals per top-level knowledge folder

| Folder | Bytes | Files |
|---|---|---|
| `hfs/` | 1,198k | 14 |
| `grammars/` | 580k | 13 |
| `code/be/` | 524k | 31 |
| `vendor/heroui/` | 421k | 65 |
| `ui/` | 404k | 41 |
| `code/fe/` | 242k | 41 |
| `patterns/repo/` | 89k | 10 |
| top-level yaml (index, op-gate, sonar-gate, architecture-rules, design-patterns, application-stacks, enforcement, scan-coverage) | 75k | 8 |

---

## 2. The model: how an app consumes a Grammar

```
 contexts/ui  (universal meaning: CTA-6, STATE-*, FE-APP-SHELL-*, ANATOMY-*, PADDING-*)
      |  realised by
      v
 @starci/grammar  ── entries: common (anatomy, no colour) | starci | offset-pop | heritage (family = DNA + styles.css)
   src/core/{primitive, composite, branch, composition}/<Name>      peerDeps: @heroui/react, react only
      |  wraps (vendor parity: contexts/vendor/heroui/*.yaml, wrappers.yaml)
      v
 HeroUI v3 (react-aria)                                             
      ^
      | the app imports only the published entry  (@starci/grammar/common | /core | /<family>)
 fe/apps/<app>/src
   app/                       route adapters (thin, no drawing)
   features/{pages,layouts,overlays}/<Name>/{index.tsx, component.tsx, classNames.ts}
   components/{blocks,composites,branches,leaves}/<Name>/   + components/providers
   modules/brand/brand.css    the ONLY colour file: sets Grammar brand tokens, light+dark
   app/globals.css            @import tailwind, grammar css, brand.css, then @source  (nothing else)
   classNames.ts              layout utilities only (flex/grid/gap/width), Grammar scale classes
```

What the app may do, and who checks it:

1. **Compose, never draw.** Components compose published Grammar components with published props
   (`code/fe/ui.yaml:29-33`). A missing capability is added to the Grammar and released first (ui.yaml case-1). Raw
   `<input|select|textarea|button|img>` are refused (R62, eslint-fe `no-native-form-control`, `no-native-img`).
2. **Layout CSS only.** Class strings live in a colocated `classNames.ts` (`naming.yaml:123-129`, eslint-fe `class-names-in-colocated-file`,
   `no-inline-class-name`), hold Grammar scale classes only, no arbitrary values (`no-arbitrary-value`), no paint
   (`no-app-surface-paint`, R318), no colour literal outside brand.css (`no-raw-brand-value` + stylelint canon, R61).
3. **Intent, not variant.** An app `Button`/`IconButton` declares `intent` (+ `step` for destructive) and never `variant`;
   the Grammar resolves the variant from intent and placement (CTA-6, R319, eslint-fe `button-intent-*`).
4. **Context, not override.** Painted surfaces (`SurfaceCard`, `SurfaceListCard`, `SurfaceAccordionCard`, `Dialog`, `Drawer`,
   shells) set the variant of nested fields and Tabs and own the panel-list content edge; apps omit those props
   (R318, `nested-control-variant`, `no-list-panel-padding`, `divider-full-bleed`).
5. **Drawing law.** A split unit's pure `component.tsx` exports `XBase` taking `{ state, props, on }` of atoms; `state` is a drawn
   shape, never a data status; slot status renders only through the Grammar `SlotView` (`function.yaml:71-84`, R92,
   eslint-fe `base-props-atom`, `no-data-status-shape`, grammar-starci `slot-status-through-slotview`).
6. **No public style doors.** App components expose no `className`, per-part className or frame CSS props
   (`props-and-slots.mjs`: `no-public-classname-prop`, `no-per-part-classname-prop`, `no-public-frame-css-props`).
7. **Shell and overlays.** The selected Grammar shell (StarCi: `WorkspaceShell`) owns the fixed frame, navbar cluster, mobile
   drawer (FE-APP-SHELL-1..7, R313-R317, grammar-starci `app-shell-frame`, `navbar-*`, `no-shell-bottom-tabs`). URL-selected
   overlays mount through the layout → `features/overlays/OverlayRouteHost` → `components/branches/OverlayHost` tree
   (`boundaries.yaml:167-187`).

**On the vocabulary the brief asked about (Tree/slots, Surface* branches, Modal/Drawer shells):** the legacy knowledge tree
does not contain it. `ModalShell`, `DrawerShell`, `CardShell`, `ContractComponent`, `LeafComponent` and `Tree` appear in no
`contexts/**` file; only two eslint specs mention them. The current code contradicts that model: `Dialog`
(`packages/grammar/src/core/branch/Dialog/index.tsx:20`) and `Drawer` (`Drawer/index.tsx:18`) are **branches** that take `children`,
and so does `SurfaceCard` (`SurfaceCard/index.tsx:73-74`, `readonly children: ReactNode`). The "only two shells take children"
rule lives only in the owner's auto-memory (`fe-contract-wrapper-shell-model.md`, dated 2026-10-08) and is stale. What survives is:
Surface* are branch-tier wrappers that paint a face and give context to their content; "slots" in the live code means two other
things: HFS **slots** (where a file may live, `hfs/slots.yaml`) and `Slot<T>` (a data resource with a status, rendered by `SlotView`).
The new tree has to pick one meaning per word (see 4.4).

---

## 3. The thinking the legacy encodes

- **Placement test (FE-RULE-OWNERSHIP, `code/fe/index.yaml:29-52`).** Four questions in order: does it hold for any design
  system → `contexts/ui` or `hfs`; is it a family's visual choice → that Grammar's DNA and styles.css; is it about calling one
  Grammar's components → that Grammar's lint package; is it checkable regardless of Grammar → the universal FE canon, which
  "name[s] no family-specific component, prop, variant or size". Rationale: "One owner for meaning, visual choices and
  executable checks" (line 50). This is the best idea in the area and the new tree should be built on it.
- **Why only layout in apps.** "Each of these is a way to fork the design system inside one app, and a forked app drifts
  from every other app" (`css.yaml:85`). Colour in one file because "a token layer keeps dark mode and contrast the family's
  responsibility" (`css.yaml:59-60`). "Two token owners produce two dark modes and two contrast decisions" (`css.yaml:110`).
- **Why the pure half takes atoms.** "A pure half of atoms renders from a fixture, so audit can draw every shape" (`function.yaml:85-86`);
  `drawing.mjs:4-7`: mixing shape and status "is what made every block ship four hand-drawn variants that disagreed".
- **Why native controls are refused.** `native-controls.mjs:3-7`: a bare control has "no focus ring, no dark value, no density,
  no disabled or invalid state"; the hand styling "is where the private colour and pixel values came from".
- **Why one library per concern.** `fe-stack.mjs:4-7`: a second library "always arrives one import at a time".
- **Button variant from intent** (CTA-6, `ui/composition/cta.yaml:147-160`, R319): variant follows three objective facts of the
  spec (consequence, rank, placement): commit→primary, alternative→secondary, dismiss→tertiary, neutral→outline/ghost,
  destructive entry→danger-soft, destructive confirm→danger inside an AlertDialog; one commit per render; none in a collection item.
- **Control height** (`packages/eslint/fe/docs/control-height.md:3`): one 40px default (HeroUI `h-10`) for every standalone control;
  48px only for a landing hero CTA; one size per row. Reasoning lives **only in an eslint doc** (see 4.1).
- **Component by job** (`CONTEXT.md:52-62`): Tabs vs SegmentedControl vs Select/ComboBox; Tabs `primary` for page areas,
  `secondary` inside drawer/card/dialog/rail; SurfaceListCard+ListRow for collections; two Buttons at `gap-2`, way out first.
  This is real UI thinking, but it sits in the runtime bootstrap file, not in `contexts/ui`.

---

## 4. Problems

### 4.1 Duplicates (same fact, several places)

| Fact | Places | Count |
|---|---|---|
| App CSS is layout only / Grammar tokens only | `code/fe/ui.yaml:29`, `css.yaml` (all 4 rules), `hfs/README.md:728-733`, `CONTEXT.md:52`, `ui/composition/app-shell.yaml`, R61 + R318 `law`, `code/fe/index.yaml:48`, eslint-fe `docs/surface-rules.md`, `grammars/offset-pop/playbook.yaml` | 9 |
| globals.css shape, brand.css only colour file, forbidden CSS list | `css.yaml:25-100`, `hfs/README.md:728-733` (near verbatim), `slots.yaml` `fe.modules.brand.why`, R61 `law` | 4 |
| Heroicons is the one icon set; @starci/heroicons fills gaps | `fe-stack.yaml:118-127`, `code/fe/icon.yaml`, `imports.yaml:185-193`, `hfs/rulings.yaml:415-425`, `modules/kernel/owner-rulings.yaml`, `canon-pins.yaml:18-24` why, grammar-starci `icon.mjs` | 7 |
| Avatar = Grammar DiceBear initials, apps never import @dicebear | `fe-stack.yaml:128-139`, `code/fe/ui.yaml:52-61`, `grammars/starci/playbook.yaml` (groupIdentity), `ui/composition/collection.yaml`, `ui/composition/app-shell.yaml`, `vendor/heroui/wrappers.yaml`, `hfs/README.md`, R-rule, `canon-pins.yaml` | 9 |
| FE budgets (component 300, index 200, 6 data hooks, 6 useState) | `slots.yaml:2141-2172` (machine), `design-truths.yaml:63-74` (pinned copy), `hfs/README.md:739`, R65 `law` | 4 |
| 40px control height | eslint-fe `docs/control-height.md`, R320 `law`, `grammars/starci/family.yaml:63,221`, `grammars/offset-pop/family.yaml:72`, `offset-pop/playbook.yaml:256` | 5, and **no `contexts/ui` owner** |
| Button intent→variant table | `ui/composition/cta.yaml` CTA-6, `CONTEXT.md:55`, eslint-fe `docs/button-intent.md`, R319 `law`, grammar DNA/playbook rows | 5 |
| One-library-per-concern for theme/motion/chart/toast/form | `fe-stack.yaml` row `why` and `forbids`, plus the matching `code/fe/<topic>.yaml` restating the forbids list in prose (e.g. `motion.yaml:25-26`, `chart.yaml:25-26`, `toast.yaml:32-33`, `form.yaml:44`) | 2 each |
| Overlay host tree | `boundaries.yaml:167-241`, `architecture-check.yaml:105-106`, `function.yaml:183-184,233-237`, `folder.yaml:178`, `hfs/README.md` §6.2 "Overlay hosts" | 5 |
| Direction matrix for fe tiers | `slots.yaml:176-186` (machine), `hfs/README.md` §6.2 "Direction", `architecture-check.yaml:77-80`, `imports.yaml:134-142` | 4 |
| Per-rule prose | Each eslint-fe law has a `docs/<law>.md` (60.8k total) **and** a pattern rule **and** a `rules.yaml` `law` string, three prose bodies for one check | 3 per rule |

### 4.2 Contradictions

1. **Universal canon names family components and values.** FE-RULE-OWNERSHIP Q4 says the universal canon names "no family-specific
   component, prop, variant or size", and `removed-vocabulary.yaml:11-15` says "the universal FE canon exposes no component inventory".
   But `packages/eslint/fe` hard-codes them: `surface-rules.mjs:8-11` (`SurfaceCard`, `SurfaceListCard`, `WorkspaceShell`, `TopBar`,
   `NavigationFeatureNav`, ...), `button-intent.mjs:7-10` (`ConfirmDialog`, `CollectionItem`, `ListRow`), `control-height.mjs:6-10`
   (Grammar's `control` size, 40px, `LANDING_PATH` regex), and every module repeats the family entry regex
   `@starci/grammar(/(common|core|heritage|offset-pop))?`. R320's `law` puts "40px" in a universal rule. The ownership test is
   right; the code placement contradicts it.
2. **Frontend tests.** `hfs/rules.yaml` R97 `FE_NO_TESTS` and `design-truths.yaml:89-93` (`fe-has-no-specs`) say the front end has
   no tests, with no exception. `patterns/enforcement.yaml` ENF-PROP-P0-1 (line 115) asks for FE skeletons with "paired tests",
   and ENF-PROP-P1-FE (line 141) asks to "require behavioral coverage of both connected mapping and rendering".
3. **A second visual owner is legal.** Owner ruling: every visual element lives in the Grammar package. Yet slot `fe.package.ui`
   (`slots.yaml:2500-2514`, `packages/<family>-ui` with composites, branches, leaves) and `hfs/README.md:734` allow a
   product-family UI package. `css.yaml:101-108` tries to square it ("a shared UI package's family.css is a family entry of
   @starci/grammar"), which leaves the package's renderers unowned by the Grammar.
4. **Two tier vocabularies.** Grammar tiers are `primitive / composite / branch / composition` (`packages/grammar/src/core/*`,
   `folder.yaml:367`); app tiers are `blocks / composites / branches / leaves` (`folder.yaml:32`). The word "leaf" then means
   the Grammar `Icon` primitive in `imports.yaml:185,193` ("Only the Icon leaf imports the icon set ... everything else takes the
   Grammar Icon") and in `rulings.yaml:422`, which reads as an app leaf to anyone following FE-FOLDER-1.
5. **The memory model vs code** (Tree/slots, only Modal/Drawer shells take children): stale, see §2.
6. **`hfs/surfaces.yaml` is not about UI surfaces.** It is the A15 standard-coverage ledger (`surfaces.yaml:1-4`); the word
   collides with `Surface*` components and `ui/presentation/surface.yaml`.
7. **R313 is a family law in the universal catalog**: its `law` says "StarCi requires WorkspaceShell viewport=fixed ..."
   (`rules.yaml:5474`). Family-specific invocation belongs to the family lint (which does enforce it) and the family playbook.
8. **grammar-starci is two things.** `grammar-offset-pop/index.mjs:1-12` re-exports all rules of `@starci/eslint-grammar-starci`
   ("inherits the Common component checks"). So the "StarCi family" package is in fact the Common-tier lint plus StarCi rules;
   offset-pop cannot differ from StarCi in any checked API.

### 4.3 Stale or removed vocabulary and dangling ids

- "the dataviz grammar" (`code/fe/chart.yaml:5,25`, `fe-stack.yaml:188`, `code/fe/index.yaml:180`): no such grammar
  exists in `contexts/grammars` or `packages/grammar/src`.
- `CONTROL-HEIGHT-1` (R320, eslint-fe docs) and `ANATOMY-2`/`PADDING-0` (`surface-rules.mjs:1`) are cited as canon ids. CONTROL-HEIGHT-1
  is defined in no knowledge file; its only definition is the eslint doc.
- `code/fe/ui.yaml` and `icon.yaml` `verification.automated` list codes whose enforcers moved to the family package
  (`FE_APP_SHELL_FRAME`, `FE_NAVBAR_*`, `FE_ICON_INLINE_SVG`); the codes kept the `FE_` prefix after the rule namespace moved to
  `starci-grammar/` (`removed-vocabulary.yaml:16-20`). Harmless for the machine, confusing for a reader.
- `icon.yaml` lists `FE_COPY_IN_CALL`, `FE_NO_ALERT`, `FE_NESTED_VARIANT`, `FE_LIST_PANEL_PADDING`, `FE_DIVIDER_FULL_BLEED` as the checks
  of the icon rule (lines 76-87); they check copy, alerts and surfaces, not glyphs. Copy-paste verification lists also appear in
  `toast.yaml:54` (`FE_ICON_INLINE_SVG` under toast) and `naming.yaml:146-154` (world-ownership codes under class-name exports).
- `folder.yaml:44-55` holds the same machine-list comment twice.

### 4.4 Prose that restates code rules

- `code/fe/{theme,motion,chart,toast(forbids part),form(forbids part),markdown,code,diagram,upload,pdf,observe,utils,storage,date,number}.yaml`
  are each ~1.4-3k files whose rule is "use library X, refuse Y". `fe-stack.yaml` is the machine owner and eslint-fe `fe-stack-import`
  enforces it; the topic adds one example case at most.
- `hfs/README.md` §6.2 is a prose copy of slots.yaml tiers, budgets and code/fe css/boundaries.
- `rules.yaml` `law` strings, eslint `docs/*.md` and pattern `requirement` texts describe the same check three times.
- `patterns/enforcement.yaml` ENF-MANDATORY-2..7 restate gate behaviour that `starci gate run`, `HFS_RULE_OFF_WITHOUT_REPLACEMENT`
  and the loosening-state check implement; nothing reads the file.

### 4.5 Gaps

- No `contexts/ui` rule owns control height, the size scale or how size/radius/gap relate for controls; the reasoning is in an eslint doc.
- The "component by job" table (`CONTEXT.md:52-62`) has no knowledge owner; each line cites a ui case, but the selection table itself
  exists only in the bootstrap.
- Nothing in knowledge states the content model of a Grammar component (what may be `children`, what is a named prop, which
  components are wrappers). The legacy had it only in memory; the code now lets SurfaceCard/Dialog/Drawer take `children`
  without a written rule on what the app may put there.

---

## 5. Facts `@starci/eslint-canon-fe` enforces (UI-relevant laws)

Published as `starci-fe/<rule>`, all at error, one factory (`index.mjs:48-80`). Knowledge owner = where the meaning should live.

| Law module | Rules | HFS rule / code | The fact | Knowledge owner today | Placement verdict |
|---|---|---|---|---|---|
| `fe-stack.mjs` | `fe-stack-import` | R244 `FE_STACK_FORBIDDEN` | No package listed under a concern's `forbids` in `hfs/fe-stack.yaml` | fe-stack.yaml (data) | Correct: universal, data-driven |
| `brand-values.mjs` | `no-raw-brand-value` | R61 `FE_STYLE_TOKEN_ONLY` | No colour or px length in TS outside brand.css; stylelint holds the CSS half | css.yaml FE-CSS-2 | Correct |
| `tokens.mjs` | `no-arbitrary-value` | R61 | No `gap-[..]`, `p-[..]`, raw `text-[#..]` | css.yaml FE-CSS-3 | Correct (universal Tailwind discipline) |
| `class-names.mjs` | `no-inline-class-name`, `class-names-in-colocated-file`, `cn-arguments-are-single-tokens` | R92 | Class strings live in colocated classNames.ts | naming.yaml FE-NAMING-3 | Correct |
| `native-controls.mjs` | `no-native-form-control`, `no-native-img`, `image-has-size` | R62 `FE_NATIVE_FORM_CONTROL` | No raw select/input/textarea/button/img in product tiers | css.yaml FE-CSS-3, imports.yaml FE-IMPORTS-5 | Correct |
| `props-and-slots.mjs` | `public-component-signature`, `props-fields-readonly`, `no-inline-parameter-type`, `no-public-classname-prop`, `no-per-part-classname-prop`, `no-public-frame-css-props`, `no-css-door-type-laundering` | R92 `FE_COMPONENT_API` | No style doors on app components; typed readonly props | function.yaml, naming.yaml | Correct |
| `drawing.mjs` | `base-props-atom`, `base-import-pair`, `no-data-status-shape` | R92 | `XBase({state, props, on})`, atoms only, no status in `state` | function.yaml FE-FUNCTION-2 | Correct |
| `loading.mjs` | `no-resting-twin-component`, `no-placeholder-prop`, `no-resting-branch-at-call-site` | R92 | Loading view is the same tree, not a twin | ui/composition/state.yaml STATE-8 | Correct |
| `lists.mjs` | `list-item-has-key`, `no-index-key`, `no-inline-literal-prop-in-list` | R65 `FE_LIST_KEY` | Keys are identities | none in ui/ | Correct (code law) |
| `landmark.mjs` | landmark rules | | Native landmarks in route composition | ui/proof/accessibility.yaml | Correct |
| `button-intent.mjs` | `button-intent-required`, `button-no-variant`, `destructive-confirm-in-dialog`, `single-commit-per-render`, `no-commit-in-collection-item` | R319 `FE_BUTTON_*` | Intent not variant; destructive confirm inside AlertDialog; one commit per render | ui/composition/cta.yaml CTA-6 | Meaning universal, but code names `ConfirmDialog`, `CollectionItem`, `ListRow`, `intent`/`step`: these are Grammar API, so the check belongs in the Grammar lint (or the names come from the selected Grammar's manifest) |
| `control-height.mjs` | `control-height` | R320 `FE_CONTROL_HEIGHT` | Default size, 40px, 48px only in a landing hero, one size per row | **eslint doc only** | Value (40px, `control`, `lg`) is family; the "one size per row, default unless hero" meaning is universal ui |
| `surface-rules.mjs` | `nested-control-variant`, `no-list-panel-padding`, `no-app-surface-paint`, `divider-full-bleed` | R318 `FE_NESTED_VARIANT`, `FE_LIST_PANEL_PADDING`, `FE_GRAMMAR_LAYOUT_ONLY`, `FE_DIVIDER_FULL_BLEED` | Context owns nested variants and the list edge; apps never paint | ui/presentation surface/padding (ANATOMY-2, PADDING-0) | `no-app-surface-paint` is universal; the others hard-code a component inventory (`SURFACES`, `FIELDS` sets) and belong to the Grammar lint or a Grammar-exported manifest |
| `ui-rulings.mjs` | `selection-fill-no-check`, `no-grammar-internal-selector` | R318 | Selection shows fill, not a check; apps never target Grammar internal selectors | ui/composition (selection), FE-UI | Second is universal; first names Grammar components |
| `client-boundary`, `the-split`, `hooks-folder`, `file-layout`, `naming`, `transport`, `swr-family`, `translation`, `served-locale`, `env-owner`, `next-conventions`, `size-and-state-budget`, `size-growth`, `function-budget`, `comments`, `hygiene`, `formatting`, `type-safety`, `callback-shape`, `lint-escape-hatch`, `project-graph`, `sonar-parity` | (code shape) | R26-R65, R91, R243 ... | Code shape, not UI | code/fe | Correct |

Family lint (`@starci/eslint-grammar-starci`, re-exported by offset-pop): `app-shell-frame`, `navbar-control-size`, `navbar-cluster`,
`no-shell-bottom-tabs`, `no-navbar-create` (R313-R317), `no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`,
`no-off-scale-glyph-size`, `no-icon-size-class`, `destructive-menu-entry-needs-danger-tone`, `no-decorative-icon-in-metric-cell`,
`vendor-primitive-has-named-owner` (R93), `no-fractional-step`, `no-hand-rolled-heading`, `no-unresolved-token-class`,
`no-heading-tag-outside-heading-component`, `status-text-uses-soft-foreground` (R61), `no-raw-structural-element` (R62),
`no-inline-svg-outside-brand-mark-leaf` (R286), `slot-status-through-slotview` (R92).

Net: about 25 UI facts are enforced; 4 law modules of the universal canon (button-intent, control-height, surface-rules, ui-rulings)
carry Grammar component inventories, against their own ownership rule.

---

## 6. Whole-knowledge map (legacy)

Readers counted by grep over `engine/ scripts/ packages/hfs/src packages/eslint ui/api bin` (code) and `skills/ modules/` (prompts/contracts), specs excluded.

| Top-level item | What it is | Machine readers | Agent readers | Notes |
|---|---|---|---|---|
| `index.yaml` | Load order + branch list | none | CONTEXT load order | Prose router |
| `hfs/README.md` | HFS standard prose (233k) | generated tree blocks only | every code op | Restates slots, rules, patterns |
| `hfs/slots.yaml` | App slot manifest, tiers, budgets | 42 scripts, eslint runtimes | via `starci app explain` | Core machine owner |
| `hfs/rules.yaml` | 294-rule catalog with enforcers/proves | 50 scripts | via codes | Core machine owner; `law` is prose |
| `hfs/runtime-slots.yaml` | Slots of the `.claude` runtime | 22 scripts | | Harness, not app knowledge |
| `hfs/fe-stack.yaml` | One library per FE concern | 7 (eslint fe-stack, hfs check, draw-source) | code/fe | Machine owner |
| `hfs/canon-pins.yaml` | Exact versions | 11 | | `why` holds changelog prose |
| `hfs/design-truths.yaml` | Loosening exceptions, pinned | 7 | | Policy, digest-pinned |
| `hfs/rulings.yaml` | Owner decisions (40) | 1 (coverage) | | Duplicates `modules/kernel/owner-rulings.yaml` |
| `hfs/requirements.yaml` (160k), `surfaces.yaml` | Standard coverage ledgers | 1-2 (coverage check) | | Not knowledge: coverage evidence |
| `hfs/facts.yaml` | Prose-contradiction facts | 1 | | Gate data |
| `hfs/ci-standard.yaml`, `peer-integrations.yaml` | CI shape, peers | 1-2 each | | Machine data |
| `hfs/docker.md` | Docker notes | none | none found | Orphan |
| `code/fe/*` (41) | FE code patterns | `read-digest` (topic `slots:`), `framework-pinned.mjs` (folder list), eslint-grammar-starci runtime bundle (index, ui) | READ step of code ops | |
| `code/be/*` (31) | BE code patterns | 9 scripts (`files:` trees for `starci app add`) | READ step | |
| `patterns/repo/*` (10) | Repository law | none | 6 skills/modules | |
| `patterns/enforcement.yaml` | Anti-bypass prose | **none** | **none** | Orphan |
| `patterns/scan-coverage.yaml` | Check limits | 1 | | Coverage evidence |
| `ui/*` (41) | Composition, presentation, proof | draw scripts (`draw-dna`, `draw-layer`), eslint runtime bundle (app-shell, font, padding, anatomy-source) | interface.draw/implement/audit | |
| `grammars/*` (13) | DNA snapshots (generated), family, idioms, playbook | `grammar-presentation`, `sync-runtime`, version-pin check | interface ops | DNA is generated |
| `vendor/heroui/*` (65) | HeroUI anatomy + wrappers parity | `grammar-vendor-parity`, `vendor-heroui`, `grammar-knowledge` | grammar authors | `wrappers.yaml` pinned by sha |
| `op-gate.yaml` | READ-CODE-CHECK loop | 13 scripts | 37 skills/modules | Harness contract, not knowledge |
| `sonar-gate.yaml` | Sonar thresholds | 11 | | Policy |
| `application-stacks.yaml` | Stack/deploy profiles | 25 | 18 | Machine + prose |
| `architecture-rules.yaml` | Semantic obligations needing review | 1 | 4 | Prose |
| `design-patterns.yaml` | Pattern selection | none | 3 | Prose |

---

## 7. Proposal for the new harness (`D:\.claude`)

### 7.1 Principles applied

- **Three kinds of file, never mixed:** *data a machine reads* (yaml with a schema), *prose an agent reads to decide* (one file per
  concept), *code* (eslint packages, checks). A check's description lives with its code (`docs/<rule>.md` in the package); knowledge
  cites the rule id and explains **why**, never restates **what** is flagged.
- **One owner per fact**, using FE-RULE-OWNERSHIP as the placement test for the whole tree.
- Harness contracts (op loop, gates, loosening, sonar thresholds, coverage ledgers) are policy, not knowledge: they go to the
  existing `D:\.claude\policy\` (already holds `canon.yaml`, `loosening.yaml`, `quality.yaml`).

### 7.2 Target layout

```
contexts/
  index.yaml                         router: one line per folder, who reads it (no rule text)
  ui/                                universal design thinking, any design system           (agent: draw/implement/audit)
    composition/  presentation/  proof/      as today, plus:
    components/<role>.yaml           per HeroUI role: job, when to pick it vs neighbours, size/variant/tone reasoning
                                     (button.yaml owns CTA-6 + control height meaning; tabs.yaml owns primary/secondary;
                                      select-vs-segmented, surface-card, dialog-drawer ...). Absorbs CONTEXT.md:52-62.
    scale.yaml                       how size, radius, gap, padding, tone and hierarchy relate (the meaning; values stay in grammars)
    content-model.yaml               what a component takes as children vs named props; wrapper (Surface*) vs shell
  grammars/<family>/                 one design language each                               (agent + generator)
    DNA.yaml (generated)  family.yaml  idioms.yaml  playbook.yaml
    values: 40px control, radius scale, tone map; component API recipes (WorkspaceShell, groupIdentity, Icon cuts)
  vendor/heroui/                     vendor anatomy, generated + wrappers.yaml (pinned)      (gate: vendor parity; grammar authors)
  stack/
    fe.yaml                          today's hfs/fe-stack.yaml (machine owner: library, home, forbids); `why` one line, no prose dupes
    be.yaml                          if a BE equivalent exists
    pins.yaml                        today's canon-pins (versions only; `why` <= 1 line, no changelog)
  hfs/                               the app shape                                          (gate + generator + agent)
    slots.yaml                       machine owner of tree, tiers, budgets (design-truths reads it, does not copy budgets)
    rules.yaml                       catalog: code, title, enforcers, proves; `law` = one sentence, no values, no family names
    README.md                        explains the model and points to slots/rules; no copied tables (generated tree only)
  patterns/
    fe/                              code shape only: architecture, folder, naming, function (drawing law), imports, boundaries,
                                     typing, error, i18n, transport, data, form, toast, realtime, css (app side: globals.css, brand.css)
                                     -> drop the one-library topics (theme, motion, chart, markdown, code, diagram, upload, pdf,
                                        observe, utils, storage, date, number): their fact is stack/fe.yaml; keep a case only if it
                                        shows non-obvious usage (form, toast, date) inside the remaining topics.
    be/                              unchanged scope
    repo/                            repository law
  decisions/
    rulings.yaml                     ONE owner-ruling log (merge hfs/rulings.yaml with modules/kernel/owner-rulings.yaml)
policy/                              (exists) gates, loosening/design-truths, sonar, op loop, enforcement, coverage ledgers
packages/eslint/
  canon-fe/                          universal laws only: no Grammar export names, no family entry regex, no px values
  grammar-common/                    rules over the Common API (Surface* context, Button intent, control size, SlotView)
  grammar-<family>/                  family-only rules, extends grammar-common
```

### 7.3 Keep / merge / drop / move into code

| Item | Action |
|---|---|
| FE-RULE-OWNERSHIP | **Keep**, promote to `contexts/index.yaml` as the placement test for every folder |
| `code/fe/ui.yaml` FE-UI | **Keep** one sentence ("compose the selected Grammar; layout CSS only; missing capability → Grammar first"); move avatar/group cases to `grammars/starci/playbook.yaml` and `ui/components/avatar.yaml` |
| `code/fe/css.yaml` | **Keep** as the single owner of the app CSS shape; delete the copy in `hfs/README.md:728-733` and the prose in R61 `law` |
| `code/fe/icon.yaml` | **Merge** into `ui/components/icon.yaml` (one vocabulary, one size per region: meaning) + `stack/fe.yaml` (library) + grammar playbook (cuts); drop `rulings.yaml` statement duplicate |
| theme, motion, chart, markdown, code, diagram, upload, pdf, observe, utils, storage, number | **Drop**; fact lives in `stack/fe.yaml`, enforced by `fe-stack-import` |
| "dataviz grammar" | **Drop** the phrase or create the grammar; today it is dangling |
| `patterns/enforcement.yaml` | **Move** ENF-MANDATORY-2..7 to `policy/` (they are gate law already implemented); **drop** ENF-PROP-P0-1/P1-FE test clauses that contradict R97; drop proposals nobody reads |
| CONTROL-HEIGHT-1 | **Create** the owner in `ui/components/button.yaml` (meaning) + `grammars/*/family.yaml` (40px value); eslint doc cites it |
| CONTEXT.md:49-70 FE block | **Move** into `ui/components/*` and `ui/composition/*`; CONTEXT keeps one line pointing there |
| `hfs/README.md` §6.2 | **Replace** with links; keep the generated tree |
| `hfs/surfaces.yaml`, `requirements.yaml`, `scan-coverage.yaml` | **Move** to `policy/coverage/` and rename "surfaces" to "coverage areas" to free the word for UI |
| `hfs/design-truths.yaml` budgets | **Reference** slots.yaml budgets by pin hash instead of copying the numbers |
| `canon-pins.yaml` `why` changelogs | **Move** to the package CHANGELOG; keep one-line `why` |
| eslint-fe button-intent, control-height, surface-rules (inventories), ui-rulings `selection-fill-no-check` | **Move into code** of `grammar-common` lint; leave universal parts (`no-app-surface-paint`, `no-grammar-internal-selector`) in canon-fe. Alternative: canon-fe reads a component-role manifest exported by the selected Grammar, so no names are hard-coded |
| Verification code lists in pattern rules | **Generate** from `rules.yaml` `enforcers` instead of hand lists (fixes the copy-paste lists in icon/toast/naming) |
| Tier words | **Decide one vocabulary**: e.g. Grammar `primitive/composite/branch/composition`, app `blocks/composites/branches/leaves`, and never call a Grammar primitive a "leaf"; record the old spelling in removed-vocabulary |
| "slot" | Keep `slot` = HFS file slot; rename data `Slot<T>` usage in prose to "resource slot" or keep `Slot<T>` only as a code identifier |
| `fe.package.ui` slot | **Owner decision needed**: either remove (all visuals in Grammar) or define it as a Grammar family entry |

### 7.4 Who reads each new file

| File | Reader | When |
|---|---|---|
| `contexts/index.yaml` | agent | first, every task |
| `ui/**` | agent (interface.draw/implement/audit), draw scripts | authoring and audit |
| `ui/components/*.yaml` | agent choosing a component; eslint docs cite ids | authoring |
| `grammars/<family>/DNA.yaml` | generator writes, gate drift-checks, agent reads | grammar release, audit |
| `grammars/<family>/{family,idioms,playbook}.yaml` | agent (grammar author, app implementer) | authoring |
| `vendor/heroui/*` | generator, vendor-parity gate, grammar author | grammar work |
| `stack/fe.yaml`, `stack/pins.yaml` | eslint `fe-stack-import`, pin gate, scaffolder | lint, install, scaffold |
| `hfs/slots.yaml`, `hfs/rules.yaml` | `@starci/hfs`, eslint runtimes, gates, `starci app explain` | every gate run |
| `hfs/README.md` | agent | onboarding to the app shape |
| `code/fe/*`, `code/be/*` | agent via READ digest (topic `slots:`), `starci app add` (`files:` trees) | before coding a slot |
| `decisions/rulings.yaml` | coverage gate, agent | when a rule cites a ruling |
| `policy/*` | gates only | every gate |
