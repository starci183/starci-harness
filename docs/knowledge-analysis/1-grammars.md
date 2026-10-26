# 1. Grammars: analysis of legacy `contexts/grammars`

Area: the grammar model (DNA, family, idioms, playbook; inheritance from Common/Heritage; StarCi vs Offset Pop; what an
agent reads to author UI on a grammar). Legacy root: `D:\Repositories\starci-academy-backend\.claude` (read only).
Paths below are relative to that root unless absolute.

---

## 1. Inventory

| File | Lines / bytes | Kind | Holds |
| --- | --- | --- | --- |
| `contexts/grammars/index.yaml` | 111 / 5.4 KB | authored catalog, **machine-read** (`scripts/lib/grammar-lint.mjs`, `packages/hfs/src/*spec*`, `brand.decide`) | family list with `contractRef`, `lint {package, factory, prefix}`, `authority`, `packageSnapshot`, `reusableStyle`, `productComposition`; guidance `catalog-not-default`, `verify-before-use`, `ui-owns-universal` |
| `common/DNA.yaml` | 3008 / 117 KB | **generated** by `scripts/work/ui/grammar-knowledge.mjs --write`, drift-checked; plus authored `observations`, `guidance`, `gaps` | identity (root, scope, CSS layers, dependency direction, presentation states, `--grammar-*` rhythm), 183 token rows, 110 renderer rows (classes, claims), 10 gaps |
| `heritage/DNA.yaml` | 2362 / 80 KB | generated | `HERITAGE_DNA` (vendor parity, arrangement, intent, collectionItem only; no colour/geometry), 40 tokens, 110 renderer rows, `gaps: []` |
| `starci/DNA.yaml` | 3101 / 115 KB | generated + authored `censusChange` changelog + `gaps` | `STARCI_CORE_DNA` (vendor, arrangement, intent, collectionItem, avatar, color light/dark, geometry, rhythm, elevation, motion), spacing scale, token names/defaults, 116 tokens, 110 renderers with `closedValues`, 13 gaps |
| `starci/index.yaml` | 82 / 4.2 KB | authored | provenance, topic list, guidance `lint-ownership`, `confirm-family-root`, `one-root-holds-everything`, `gaps-are-findings` |
| `starci/family.yaml` | 330 / 16.6 KB | authored | identity, lint contract, CSS direction (`commonOwns`/`coreOwns`), DNA values in prose, bound/unbound semantic variables, theme/a11y, 12 `sourceBackedBehavior` entries (button-pill, button-no-destructive, fields-on-a-surface...), 13 gaps |
| `starci/idioms.yaml` | 430 / 19 KB | authored | 8 idioms promoted from product source (≥2 occurrences), `seenOnce` (5), `deferredByOwner` |
| `starci/playbook.yaml` | 1214 / 67 KB | authored, **partly machine-read** (`presentation.padding/font` by `scripts/hfs/grammar-presentation.mjs`, `packages/hfs/src/helpers/ui-proof-family.mjs`; `#state-recipes` by `packages/eslint/grammar-starci/drawing.mjs`) | 7 shapes (idiomSequence or composition), readingSteps, authoritySplit, imagery, 6 guidance (incl. app-shell recipes, nested controls, state-recipes), `presentation` (collectionItems, glyphs, groupIdentity, padding ~380 lines, font ~185 lines), 8 `anatomyObservations` |
| `offset-pop/DNA.yaml` | 2996 / 106 KB | generated + authored observations/gaps | `OFFSET_POP_DNA` (Core shape + `accentText`, `offset`, `palette`), contrast table, 33 family-owned rule ids, 81 tokens, 110 renderers, 3 gaps |
| `offset-pop/index.yaml` | 80 / 4.4 KB | authored | provenance, topics, guidance |
| `offset-pop/family.yaml` | 300 / 16.6 KB | authored | identity, lint (inherits starci lint), CSS direction, DNA in prose, `authority` (signature, pinkIsTheDecision, rowStates, 2 departures), theme/a11y, 6 sourceBackedBehavior, 2 gaps, 2 openQuestions |
| `offset-pop/idioms.yaml` | 297 / 12.8 KB | authored | 7 **package** idioms (from CSS, not product), 3 seenOnce |
| `offset-pop/playbook.yaml` | 302 / 16 KB | authored, presentation part machine-read | 8 shapes (composition), readingSteps, authoritySplit, 7 guidance, `presentation.{font,padding}: inherits: starci` |

Total 14 613 lines / 580 KB. About 80% is generated measurement (four DNA files); the four renderer blocks alone are
~7 700 lines, and the three family blocks are byte-identical (`diff` of `renderers:` between starci and offset-pop: 0
lines; starci vs heritage: 2 lines). 110 renderer rows each.

Consumers (grep over the legacy tree): ops `interface.draw`, `interface.implement`, `interface.audit`
(`contexts/grammars/<family>/{DNA,family,idioms,playbook}.yaml`), `interface.scaffold`, `brand.decide`
(`<family>/DNA.yaml`), `grammar.update` ("read the WHOLE installed canon ... every grammar family file");
`contexts/code/fe/{index,function,error}.yaml`; `contexts/ui/presentation/padding.yaml` ("its playbook supplies
the concrete values"); `modules/kernel/owner-rulings.yaml`; scripts `grammar-knowledge*.mjs`, `grammar-presentation.mjs`,
`draw-dna.mjs`, `brand.mjs`, `prose-restates.mjs`, `check-version-pin-once.mjs`. `CONTEXT.md` never names
`contexts/grammars`; it carries its own frontend-standard block (lines 48-70) and `contexts/index.yaml:91-94` points at
`grammars/index.yaml` ("Family-specific package observations, not a guarantee of current exports").

---

## 2. The model

```
                contexts/ui (universal law: semantics, anatomy, state, a11y; rule ids TONE-*, PADDING-*, CTA-* ...)
                        │ rule ids (150 COMMON_UI_RULE_IDS generated from it)
                        ▼
   HeroUI v3 ──► Common  (@starci/grammar/common: 95-110 renderers, props, anatomy CSS, --grammar-* rhythm,
   (vendor)      GrammarRoot .grammar-common-root, data-contract rule stamps, NO colour)
                        │ defineGrammarFamily({id, replacements:{GrammarRoot}, extensions:{}})
          ┌─────────────┼───────────────────┐
          ▼             ▼                   ▼
   Core ("starci")   Offset Pop          Heritage           ← siblings, each = scope [data-grammar-family=<id>]
   DNA + styles.css  DNA + styles.css    DNA + styles.css      on Common's root + @layer + family sheet
   no component css  + 3 component css   tokens only
          │
          ├─ family.yaml  : what the family owns over Common, departures, gaps (authored)
          ├─ idioms.yaml  : reusable compositions (taste, promoted at ≥2 occurrences)
          └─ playbook.yaml: business shape → idiom sequence / renderer composition, reading steps, rules
   lint: @starci/eslint-grammar-<family> (API checks) beside @starci/eslint-canon-fe (universal)
   app:  hfs.json sides.fe.grammar = <id> (explicit; never defaulted) → one <Family>GrammarRoot + styles.css
```

The four terms, as the legacy actually uses them:

- **DNA** = the family's *material values as code*: a frozen object in `src/<family>/dna.ts` (`STARCI_CORE_DNA`,
  `OFFSET_POP_DNA`, `HERITAGE_DNA`) plus the tokens its stylesheet sets on the root. Groups: `vendor {name, parity}`,
  `arrangement` (indicator side, separators, icon sizes, density), `intent` (button intent × placement → variant),
  `collectionItem`, `avatar`, `color {accent, focus, light{...}, dark{...}}`, `geometry` (measures, three radii),
  `rhythm` (four gaps + page inset), `elevation`, `motion`; Offset Pop adds `offset` and `palette`
  (`starci/DNA.yaml:159-272`, `offset-pop/DNA.yaml:204-322`). `DNA.yaml` is the *snapshot* of that module plus a
  census of tokens and renderers; it is generated and drift-checked, never hand-edited (`common/DNA.yaml` guidance
  `refresh-not-rewrite`).
- **Family** = the *authority* file: identity (`definedBy`, `selectedBy` root, "implements Common contract"), CSS
  dependency direction, what Common owns vs what the family owns, which semantic variables it binds and does not bind,
  deliberate departures from a universal rule with the reason and owner status, theme/a11y mapping, source-backed
  behaviour, gaps (`index.yaml:95` maps it as `authority`).
- **Idioms** = *reusable style*: compositions of published renderers the family reaches for again. Promotion bar: two
  occurrences; single sightings go to `seenOnce` and must not be cited as house style (`starci/idioms.yaml:27-37`).
  "Taste, not law."
- **Playbook** = *product composition*: for a named business shape (purchase page, dashboard, sign-in, settings,
  destructive confirmation, app shell...), which idioms or renderers in what order, what a supplied reference may
  contribute, the reading steps an agent follows, and family-wide composition rules (one root, one Toaster, overlays
  inside the root, state recipes).

**Inheritance.** It is composition, not class inheritance:
1. *Components*: every family publishes exactly Common's registry; `defineGrammarFamily` merges `replacements`
   (only `GrammarRoot`) and `extensions` (none) and rejects collisions (`common/DNA.yaml` observation
   `family-selection-is-a-string`). So props/closed values are Common's in every family.
2. *CSS*: `<family>/styles.css` imports `../common/styles.css` first; family rules sit in a later `@layer` scoped on
   `.grammar-common-root[data-grammar-family="<id>"]`; Common never imports a family (`common/DNA.yaml` identity
   `dependencyDirection`, `offset-pop/family.yaml:60-80`).
3. *Tokens*: Common's base sheet reads `--starci-core-*` with literal fallbacks and assigns the universal `--grammar-*`
   rhythm; a family binds HeroUI semantic variables (`--accent`, `--surface`, `--field-*`, `--radius`,
   `--shadow-surface`) and aliases `--starci-core-*-gap` to `--grammar-*` (`starci/family.yaml:101-117`).
4. *Rules*: each family declares conformance over the 150 Common rule ids: Core inherits all 150 with no family
   evidence; Offset Pop owns 33 and inherits 117 (`offset-pop/DNA.yaml:85-119`).
5. *Lint*: Offset Pop's lint "inherits the exact matching Common API checks" from `@starci/eslint-grammar-starci`
   (`offset-pop/family.yaml:50-59`, `packages/eslint/grammar-offset-pop/README.md`).

**Heritage** is a third sibling family (green/ivory "heritage" skin, `--heritage-*` tokens), not a base layer. Its DNA
carries only parity, arrangement, intent and collectionItem; colour lives only in its CSS (`heritage/DNA.yaml:33-80`,
40 tokens such as `--accent: var(--heritage-green-700)`). It has no family/idioms/playbook and no lint package; the
catalog lists it with `contractRef: common` only (`index.yaml:70-73`). It is used as a symmetric test case
(`starci/family.yaml:174-180`, "Heritage's symmetric test paints only its inner frame").

---

## 3. The thinking the legacy encodes

### 3.1 Layering and ownership
- Universal vs family vs product: "Common semantics, renderer anatomy, state and accessibility remain owned by
  contexts/ui. A family owns its scoped visual realization and promoted idioms; the product owns its facts, content,
  routes and approved composition" (`index.yaml:34-41`). The four-question test is FE-RULE-OWNERSHIP
  (`contexts/code/fe/index.yaml:29-49`): universal law → contexts/ui or hfs; one family's number/token/shape →
  its DNA and styles.css; how to call one Grammar's components → its lint package; checkable on code regardless of
  Grammar → universal canon lint.
- Common supplies anatomy, never colour: "None is a colour literal ... this is owned direction, not an oversight"
  (`common/DNA.yaml` observation `common-supplies-no-colour`).
- A family is only a scope: "Without the root or the sheet nothing on the page is Offset Pop"
  (`offset-pop/index.yaml` guidance `confirm-family-root`). Hence the hard rules "one root holds everything" and
  "overlays portal into the nearest Grammar root" (`starci/index.yaml` `one-root-holds-everything`).
- No default family: "Silent fallback to StarCi would invent product direction" (`index.yaml:26-27`).

### 3.2 StarCi Core vs Offset Pop and why

| Axis | StarCi Core (`core`) | Offset Pop | Why (source) |
| --- | --- | --- | --- |
| Accent | violet `#7547ff`, white foreground | pink `#ff3593`, **ink** foreground | white on pink 3.40:1 fails, ink 5.23:1 (`offset-pop/DNA.yaml` contrast notes) |
| Accent as text | `accentText #6a3cf2` | `accentText #b8005f`; pink never text | pink text 3.22:1 on cream (`offset-pop/family.yaml:140-153`) |
| Canvas/surface | near-white oklch neutral, white surfaces | cream `#fff8ef`, blush secondary | playful consumer tone |
| Edge | border *or* soft shadow (BOUNDARY-6) | 2px ink outline **and** hard offset shadow | "This pairing is the family's recognisable face; dropping either half is a different family" (`offset-pop/family.yaml:128-135`) |
| Elevation | `0 8px 28px .../0.07` diffuse; top = shadow no border, nested = border no shadow | unblurred ink copy at 0.25rem × 0.5rem; nested keeps outline, drops shadow, takes secondary fill | "a pressed-in pocket, not a second sticker" (`offset-pop/idioms.yaml:52-58`) |
| Radius | surface 1rem, control .75rem, Button pill via `rounded-3xl` = 3 × `--radius` | surface 1.5rem (1.25 narrow), control 1rem | — |
| Motion | 180ms `cubic-bezier(0.2,0,0,1)` | 140ms springy; press travel into the shadow | "No meaning rides on it and reduced motion removes the travel" |
| Component CSS | none: 53 new renderers are Common anatomy painted via bound variables (`starci/family.yaml:181-187`) | 3 component sheets; every renderer targeted | — |
| Vendor parity flag | `strict` | `custom` | (heritage also `custom`) |
| Rule conformance | inherits 150, claims none | owns 33, inherits 117, two flagged departures | |
| Idiom evidence | product source (dashboard blocks) | package CSS ("No product source has been observed yet") | |
| Target | product/workspace UI | "playful, mobile-first learning or consumer app" | |
| Shared | rhythm (`0.5/0.75/1/1.5rem`, page inset `clamp(1rem,3vw,2rem)`), spacing scale, intent map, arrangement, 40px control floor, typography renderers | identical | "the family does not re-space" (`offset-pop/family.yaml:68-72`) |

Offset Pop records its own tension with universal law honestly: BOUNDARY-6 says border and shadow are alternatives
(drawing both is DOUBLE_OWNER), the family draws both; ACCENT-3/COLOR-3 want selection, destination, command and focus
distinguishable, the family uses one pink and carries the distinction by geometry and state
(`offset-pop/family.yaml:167-205`, open questions `:289-300`). This is the model for how a family should depart.

### 3.3 Per component (where the grammar layer carries the reasoning)
- **Button variants follow intent, not taste.** Apps pass `intent` (`commit|alternative|dismiss|neutral|destructive`)
  and `step` (`entry|confirm`); placement context (`decision|item|chrome`, plus `navbar` for IconButton) is set by the
  composition; the active family's DNA `intent` table resolves the vendor variant
  (`packages/grammar/src/core/buttonIntent.tsx:9-60`, `starci/DNA.yaml` `STARCI_CORE_DNA.intent`). Reading: commit is
  the filled primary only at a decision, secondary on an item (a collection item never holds the commit); neutral is
  outline at a decision, ghost on items and chrome; destructive is `danger-soft` at the entry step and solid `danger`
  only inside the AlertDialog that confirms it, dismiss first and focused (`starci/family.yaml:207-213`).
- **Button sizes** `sm|md|lg|control`: three vendor sizes plus `control`, which is the 2.5rem (40px) shared height of
  bar controls, so every navbar control aligns (`starci/playbook.yaml:185-192`; `control` maps to vendor `md` plus
  `data-grammar-control-size`, `Button/index.tsx:89,124`). The 40px floor is Common's (owner ruling control-height-40,
  `starci/family.yaml:63`).
- **Button shape**: a pill in Core because its corner is `3 × --radius` and Core binds `--radius` to the .75rem
  control radius, so the corner exceeds half of every height; ".75rem ... is the field and tooltip corner, never the
  Button's: a Button drawn with a 12px corner is a defect, and a Button skeleton takes the same pill corner"
  (`starci/family.yaml:194-200`). This is the cleanest example of radius derived from one token rather than chosen.
- **Offset Pop Button**: outline, `0.25rem 0.25rem` ink shadow, weight 800, `:active` travels into its shadow
  (`offset-pop/idioms.yaml:93-101`); one pink fill per view (`offset-pop/playbook.yaml` guidance `one-pink-per-view`).
- **Tabs**: `variant primary|secondary`, `inset page|none`; primary for page areas, secondary inside a painted surface;
  lint rejects primary Tabs inside a painted surface (`starci/playbook.yaml:350-368`, `CONTEXT.md:56`).
- **Fields**: never pass a static `variant`; the surface nesting context resolves `secondary` inside a surface and
  `primary` outside, "never raise both" (`starci/playbook.yaml:353-363`). Core fields are white fills with transparent
  border, so on a white card only `--field-shadow` draws them, which Core does not bind (`starci/family.yaml:188-193`).
- **Cards**: one flush card divided by bands rather than inner cards; side padding resolves by what the side touches
  (outer edge 1rem, separator .75rem, child-owned 0) (`starci/idioms.yaml:39-97`, `starci/playbook.yaml` guidance
  `side-contact`); at most one `isHighlight` card per view, "a claim about the task, not decoration"
  (`starci/idioms.yaml:320-347`).
- **Pending**: same tree at rest, never a spinner (`starci/idioms.yaml:273-318`), formalised as `state-recipes`
  (`starci/playbook.yaml:410-496`).
- **Type**: closed six-step scale shared by Text and Heading; Heading for structure, never for size; weight is a second
  axis that never manufactures a level (`starci/playbook.yaml:924-1108`).

### 3.4 How an agent is supposed to author UI on a grammar (legacy reading order)
Scattered across `index.yaml`, `<family>/index.yaml`, playbook `readingSteps` and op manifests; assembled:
1. Resolve the family from the app (`hfs.json sides.fe.grammar`, design spec); never default (`index.yaml:22-27`).
2. Verify the installed package (manifest/lockfile, `dist/**/*.d.ts`, CSS) against the snapshot; record the version
   in `.starciwork` (every `provenance.limitations`).
3. contexts/ui rules for semantics; FE-RULE-OWNERSHIP for placement.
4. `<family>/family.yaml` for what the family owns, departures and gaps; `DNA.yaml` for renderers, closed values and
   tokens.
5. Playbook reading steps: business shape first → reference (region order and dominant decision only, never layout,
   brand, palette or anatomy) → idioms whole, in the shape's order → compare with DNA and gaps → compose the rest
   from Common semantics (`starci/playbook.yaml:275-310`).
6. Render inside one family root with its stylesheet; one Toaster; app classes are layout only; lint with
   `eslint-canon-fe` plus the family package.

---

## 4. Problems

### Duplicates (one fact, several places)
1. **Renderer census ×4.** The 110-row `renderers:` block is in all four DNA files (~7 700 lines); the three family
   copies are byte-identical. Families replace only `GrammarRoot`, so the census is one Common fact.
2. **Gaps ×2.** `starci/family.yaml:224-330` restates all 13 `starci/DNA.yaml` gaps nearly verbatim; Offset Pop
   repeats its DNA gaps in `family.yaml:265-288`; the BottomNav-offset gap appears in common, starci-adjacent and
   offset-pop files.
3. **DNA values in prose.** `starci/family.yaml:76-83` and `offset-pop/family.yaml:96-104` re-type the hex/oklch values
   that the generated DNA holds.
4. **arrangement / intent / collectionItem** are identical in all three `dna.ts` and all three DNA.yaml; they are
   Common choices copied per family.
5. **The intent → variant table** lives in three DNA files, `starci/family.yaml:207-213`, `CONTEXT.md:56` and
   `packages/grammar/docs/button-intent-props.generated.md`.
6. **Root/overlay/Toaster rule** stated in `common/DNA.yaml` observations, `starci/index.yaml`,
   `starci/family.yaml:130-133`, `starci/playbook.yaml:379-395`, `offset-pop/index.yaml`, `offset-pop/family.yaml`,
   `offset-pop/playbook.yaml` guidance: seven places.
7. **"verify installed source, do not invent APIs"** limitation paragraph is repeated in every one of the 13 files.
8. **Offset Pop signature** is stated in family `authority`, `sourceBackedBehavior`, idioms (`sticker-surface`,
   `selected-row`, `sheet-from-an-edge` repeat `rowStates`, `sheets-throw-shadow-away...`) and DNA observations.
9. **Padding/font recipes** in `starci/playbook.yaml#presentation` overlap `contexts/ui/presentation/padding.yaml`
   (same `side-contact`, `composite-insets`, `axis-variants` guidance ids, universal vs concrete wording).

### Contradictions
1. **Renderer counts**: catalog "110 renderers" (`index.yaml:48`), `identity.counts.renderers: 110`, groups 42+20+14+19
   = 95 (`common/DNA.yaml:170-174`), purpose "100 renderers" (`common/DNA.yaml:6`), family files "95"
   (`starci/family.yaml:29`) and "all 100" (`offset-pop/family.yaml:69`). Classes: "465 emitted" vs "384 grammar
   classes" in the same file's gap.
2. **Versions**: DNA/index say `0.12.13`; family, idioms, playbooks say `0.5.0` with the same checkout hash; the starci
   DNA `censusChange` narrates 0.5.1–0.6.0 additions under a 0.12.13 header.
3. **Heritage**: `common/DNA.yaml` identity `familiesOverCommon` says heritage snapshot "none in this catalog" while
   `heritage/DNA.yaml` exists and is cataloged.
4. **Tests**: `CONTEXT.md:70` "No grammar tests ... no spec suites"; `offset-pop/DNA.yaml` `rendererTreatment` cites
   `components-{forms,overlays,navigation}.spec.ts` suites as the assertion.
5. **Dependency direction**: knowledge says "Common never imports a family"; `src/core/buttonIntent.tsx:4-6` (Common
   anatomy) imports `OFFSET_POP_DNA` and `HERITAGE_DNA` and selects by string id.
6. **Vendor parity**: house ruling "every Grammar follows HeroUI anatomy, only CSS differs"; DNA declares
   `parity: "strict"` for Core and `"custom"` for Offset Pop and Heritage with no definition of what `custom` permits.
7. **Naming**: catalog id `starci`, family id `core`, DNA id `starci-core`, entry `/core`, scope
   `data-grammar-family="core"`, lint `eslint-grammar-starci`, title "StarCi Core"; and the "Common" lint checks live in
   the package named `-starci`, so Offset Pop "inherits starci" when it means Common.
8. **Common-level data owned by a family**: `offset-pop/playbook.yaml#presentation.{font,padding}: inherits: starci`
   ("reads the shared Common rank-to-renderer recipes in the StarCi playbook"); the scripts resolve that chain
   (`scripts/hfs/grammar-presentation.mjs:71-75`). Common recipes are stored in one sibling family.

### Stale / removed vocabulary and history in the present tense
- History blocks violate CONTRIBUTING "present tense, no ghosts": `censusChange` (common, starci), "The 0.4.13 absence
  is closed" (`starci/family.yaml:218`), `since: "0.5.0"` shape markers, "the 53 renderers added in 0.5.0" (8 mentions
  in the starci playbook alone), "(@starci/grammar 0.9.1)" row annotations.
- `contexts/ui/presentation/radius.yaml:71` says "`@grammar/core`" (no such package).
- Product names in a product-agnostic layer: `starci/idioms.yaml` provenance and evidence name StarCi blocks and
  `nivo apps/app/...AuthenticationPanel`; `starci/playbook.yaml` names `modules/i18n/messages/app-shell.yaml`,
  `modules/goal/source-phrases.yaml`, `examples/shape-slot`, "Learner dashboard", "StarCi Academy render"
  (`starci/DNA.yaml` censusChange).
- `starci/playbook.yaml#anatomyObservations` (`prompt-shape-b2`, `direction-scale-drift`) is draw-lab image-prompt
  craft, not grammar knowledge.

### Prose restating code rules
- `nested-controls-and-panel-lists` restates lint codes `FE_NESTED_VARIANT`, `FE_GRAMMAR_LAYOUT_ONLY`,
  `DRAW_NESTED_VARIANT`, `FE_LIST_PANEL_PADDING` (`starci/playbook.yaml:364-373`); `state-recipes` names
  `starci-fe/no-data-status-shape` and `starci-grammar/slot-status-through-slotview`.
- App-shell `recipes` (`starci/playbook.yaml:184-269`) describe what `@starci/eslint-grammar-starci/app-shell.mjs`
  enforces (control size, cluster order, no BottomNav).
- `button-pill` and the field-variant resolution describe component code behaviour; the source is the owner.

### Gaps in the model
- No written definition of DNA / family / idiom / playbook in one place; they are implied by `index.yaml` keys
  (`authority`, `reusableStyle`, `productComposition`).
- No reasoning file for *why* the DNA groups exist (why three radii, why four gaps, why `control` size, why intent ×
  placement). The reasoning is scattered as single-component observations.
- DNA `closedValues` misses `Button.intent`/`step` (they come through an intersection type the census does not read),
  so the snapshot advertises `variant`, which apps must not pass.
- Heritage has DNA without colour, no family file, no lint; its status (test fixture or real family) is undeclared.
- Common has no idioms/playbook by design, yet Common-level composition (padding/font owner tables, state recipes,
  forms/overlay rules) has to live somewhere and landed in the starci playbook.
- Offset Pop open questions (BOUNDARY-6, single pink) have no recorded answer.
- The per-family "applicableUiRules" ranges (`starci/family.yaml:33-39`) duplicate the conformance record and go
  stale silently.

---

## 5. Proposal for the new harness

### Principles
- Separate **measurement** (generated, never hand-edited, read by gates and generators) from **reasoning** (authored,
  read by agents). The legacy mixes them in DNA.yaml (observations, guidance, gaps, changelog) and playbooks
  (machine-read tables).
- Common is the base layer and owns everything families share: census, anatomy, rhythm, intent/arrangement defaults,
  padding/font owner tables, state recipes, root/overlay/Toaster rules, forms contract. A family file states only its
  delta.
- One place per concept; history goes to the grammar package CHANGELOG; versions appear once (the snapshot header).
- Everything a machine checks (lint codes, app-shell recipes, nested variants, slot status) is owned by the eslint
  package; knowledge cites the rule id, never re-describes the check.

### Keep / merge / drop / move

| Legacy item | Action |
| --- | --- |
| `index.yaml` catalog (families, root, entries, lint package, files) | Keep as the one machine-read catalog; add heritage status; drop repeated guidance that lives in `README`. |
| `common/DNA.yaml` identity, tokens, renderers | Keep, generated. **Single renderer census** for all families (props + closedValues incl. `intent`/`step`). |
| family `renderers:` blocks | Drop (identical to Common); generator verifies "family replaces only GrammarRoot". |
| family `dna` + `tokens` | Keep, generated: only the family's `dna.ts` and its root tokens. Move shared `arrangement`/`intent`/`collectionItem` defaults into Common DNA; a family lists only overrides. |
| DNA `observations`, `guidance`, `censusChange` | Move observations into `family.md` reasoning or Common reasoning; drop guidance boilerplate; changelog → package CHANGELOG. |
| `gaps` | One list per layer, generated or authored once (`gaps.yaml`), not duplicated in family files. |
| `family.yaml` | Keep, slimmed to: identity delta, what it owns over Common, bound/unbound variables, **departures with reason and owner status**, theme/forced-colours mapping. Drop prose values and duplicated gaps. |
| `idioms.yaml` | Keep the concept and the promotion bar; strip product names (evidence as role descriptions, e.g. "dashboard section with several content kinds"). Offset Pop's CSS-treatment "idioms" move into its family signature; its idioms file stays empty until product evidence exists. |
| `playbook.yaml` shapes, readingSteps, authoritySplit | Keep shapes per family; move readingSteps and authoritySplit (identical in both) to one grammar-level authoring guide. |
| `starci/playbook.yaml#presentation.padding/font` owner tables | Move to Common as generated/declared data (`common/presentation.yaml`), read by `grammar-presentation`; remove the `inherits: starci` hop. Universal recipes stay in `contexts/ui/presentation`. |
| `#state-recipes`, forms, overlays, Toaster | Move to Common playbook (they apply to every family). |
| app-shell `recipes`, nested-controls prose | Move into the lint package docs; knowledge keeps the universal law (`ui/composition/app-shell`) and a one-line pointer. |
| `anatomyObservations` (draw prompt craft, scale drift) | Move to the draw op's knowledge, not grammar. |
| `@starci/eslint-grammar-starci` naming | Rename to `eslint-grammar-common` (shared API checks) with thin `-starci`/`-offset-pop` family packages; catalog id `core` or `starci` used consistently. |
| `buttonIntent.tsx` importing family DNAs | Code fix: the family root passes its intent table down; Common imports no family. |
| `parity: strict/custom` | Define in one place what each value permits under the house ruling, or drop the field. |

### Target layout

```
contexts/grammars/
  README.md            concepts: DNA, family, idiom, playbook; layering; inheritance; how to read     (agent)
  authoring.md         the one reading order + authority split + reference rules (from both playbooks) (agent)
  index.yaml           catalog: id, root, entries, styles, lint package, files, status               (gate, generator, agent)
  common/
    DNA.yaml           GENERATED: tokens, rhythm, shared dna defaults (intent, arrangement), the single
                       renderer census with closed values                                             (gate drift-check, lint, draw)
    presentation.yaml  DECLARED data: padding/font/radius owner tables per component                 (proof scripts, audit)
    reasoning.md       why the anatomy is as it is: root & portal scope, surfaces & nesting, sizes
                       (control=40px), intent x placement, rhythm, state recipes, forms contract      (agent)
    playbook.yaml      family-neutral shapes: forms, destructive confirmation, secondary task, app shell
    gaps.yaml          Common gaps (one list)
  <family>/            starci (core), offset-pop, heritage
    DNA.yaml           GENERATED: family dna.ts + root tokens + contrast; no renderer census          (gate, brand.decide, draw)
    family.md          authored delta: signature, owned vs inherited, departures (+ owner status),
                       theme/forced-colours, why                                                      (agent, audit)
    idioms.yaml        promoted compositions, product-neutral evidence                                (agent at draw/implement)
    playbook.yaml      family-specific shapes only                                                    (agent)
    gaps.yaml          family gaps (one list)
```

### What an agent reads to author UI on a grammar (new)
1. `grammars/README.md` once (concepts) and `authoring.md` (reading order).
2. `index.yaml` → the app's bound family (from `hfs.json`), root, style entry, lint package; verify installed version.
3. `contexts/ui` rules for the job (semantics, presentation), then `common/reasoning.md`.
4. `<family>/family.md` (signature, departures) and `<family>/DNA.yaml` tokens only when choosing tokens (brand).
5. `common/DNA.yaml` renderer census for props and closed values; `common/presentation.yaml` for who owns an inset.
6. Shapes: `common/playbook.yaml`, then `<family>/playbook.yaml` and `<family>/idioms.yaml`.
7. Gaps: `common/gaps.yaml` + `<family>/gaps.yaml` before promising a capability.
Gates (lint, drift-check, presentation proof) read the YAML data; agents never re-derive what lint enforces.
