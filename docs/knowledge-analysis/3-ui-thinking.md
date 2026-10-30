# 3. UI thinking (contexts/ui): analysis

Scope: `D:\Repositories\starci-academy-backend\.claude\knowledge\ui\**` (composition, presentation, proof incl.
calibration, examples, both `index.yaml`) plus the top-level `contexts/index.yaml` branch that points at it. The
legacy tree was only read, never changed. Where the thinking depends on code (intent resolver, size props, gate
scripts), the code was read to check what the prose claims. Paths are relative to `.claude/` unless absolute.

---

## 1. Inventory

36 YAML files, 3 HTML anchors, about 404 KB. By rough count there are 190 rules and 780 cases, and 43 cases carry a
dated "Owner ruling/decision". Every rule file uses `schema: starci/knowledge-source@1`.

| File | KB | Rules (cases) | Holds | Machine reader |
|---|---|---|---|---|
| `contexts/index.yaml` | 5.8 | – | Load order and the branch list. The `ui` branch names DISCIPLINE-1..3, HIERARCHY-6, ACCENT-6 and the worked example | runtime loader |
| `ui/index.yaml` | 5.2 | – | The three topics and four guidance blocks: maturing-rules, image-first-direction, brand-direction, binding-criteria | loader |
| composition/index.yaml | 5.1 | – | The `business -> composition -> presentation -> render` chain, the topic table, closed addresses and the rule shape | – |
| composition/hierarchy.yaml | 8.3 | HIERARCHY-1..6 (26) | Rank from job; one anchor per region; reading order; fact vs measurement vs outcome; one focal point | prose only |
| composition/action.yaml | 5.8 | ACTION-1..3 (14) | One activation, one effect; pending on initiator; anchor vs command | `eslint/fe/ui-rulings.mjs` (case-5) |
| composition/cta.yaml | 15.1 | CTA-1..6 (33) | Emphasis follows consequence; one primary per command per view; intent → variant; destructive; group order | `eslint/fe/button-intent.mjs` (CTA-6 c4) |
| composition/accent.yaml | 11.1 | ACCENT-1..6 (30) | Accent budget: 1 dominant per decision, identity tiles stay neutral, 90/10 colour budget, Alert anatomy | prose; `ui-proof-brief` via TASTE-5 |
| composition/state.yaml | 14.8 | STATE-1..8 (33) | The five kinds of state; carriers; absence; Tabs vs SegmentedControl; loading/failure anatomy. Also a loading-ownership table | `draw-dna.mjs` reads the PresentationState vocabulary |
| composition/feedback.yaml | 5.5 | FEEDBACK-1..3 (17) | Correct at the nearest owner, recover at the smallest owner, claim only after settlement | – |
| composition/collection.yaml | 10.9 | COLLECTION-1..3 (18) | A list is a section, never a card; a card is one item; group avatars | `ui-rulings.mjs` (c9) |
| composition/layout.yaml | 11.0 | LAYOUT-1..4 (26) | Regions, composition owners, scroll axes, out-of-flow regions | – |
| composition/responsive.yaml | 7.6 | RESPONSIVE-1..4 (21) | What survives, named query owners (56rem/48rem), single branch | – |
| composition/taste.yaml | 7.7 | DISCIPLINE-1..3 (16) | Reduce before adding; numbers are heroes; one brand moment | – |
| composition/coverage.yaml | 4.4 | COVERAGE-1 (7) | What a spec must enumerate; the five surface classes | – |
| composition/app-shell.yaml | 10.9 | FE-APP-SHELL-1..7 (15) | Shell frame, navbar height, cluster order, mobile drawer, icon rail, chat list | FE_APP_SHELL_* checks |
| presentation/index.yaml | 7.8 | – | may/mustNot authority; the shared spacing scale; rule shape | – |
| presentation/gap.yaml | 12.1 | GAP-0..6 (24) | **Data**: closed scale 0/4/8/12/16/24/32 with `--grammar-*-gap` tokens; ownership rows | `ui-proof-spacing.mjs scalePx('gap')` |
| presentation/padding.yaml | 11.5 | PADDING-0..9 (29) | Abstract "selected Grammar" insets with **no values** | `scalePx('padding')` (returns empty, see §4) |
| presentation/margin.yaml | 9.0 | MARGIN-0..6, AUTO (14) | Margin as a named exception; the same scale | – |
| presentation/font.yaml | 5.4 | FONT-1..6 (9) | Abstract ranks with **no values**; the values moved to `grammars/starci/playbook.yaml` | – |
| presentation/tone.yaml | 7.3 | TONE-1..3 (6) | default/muted/accent; `xs` forces muted | – |
| presentation/surface.yaml | 11.8 | SURFACE-1..6 (17) | Surface+foreground pairs; accent-soft; success-soft; ink slab | – |
| presentation/boundary.yaml | 12.4 | BOUNDARY-1..6 (21) | Separator vs border; last-row drop; depth-based elevation | – |
| presentation/radius.yaml | 11.5 | RADIUS-2..9 (14) | **Data**: ramp with reserved addresses; three core tokens | – |
| presentation/measure.yaml | 11.3 | MEASURE-1..7 (17) | Fluid → fitted → capped; width scale W-sm..W-7xl, 65ch | draw gate `DRAW_MEASURE_UNCAPPED` |
| presentation/overflow.yaml | 8.9 | OVERFLOW-1..5 (14) | visible/clip/scroll/auto/contain | – |
| presentation/text-flow.yaml | 7.0 | FLOW-1..5 (12) | Align, wrap, break, truncate, clamp | – |
| proof/index.yaml | 5.8 | – | Proof lenses; closed `UI-*`; rule shape | – |
| proof/accessibility.yaml | 7.4 | A11Y-1..5 (21) | Names, relationships, 44px (accordion/rail only), verdict | `ui-proof-brief` (A11Y-4 c1 regex) |
| proof/contrast.yaml | 9.9 | COLOR-3, COLOR-5, CONTRAST-1 (18) | 4.5/3:1, soft pair 3:1, secondary field fill accepted | – |
| proof/focus.yaml | 9.4 | FOCUS-1..6 (30) | Indicator, order, containment, parity | – |
| proof/motion.yaml | 7.4 | MOTION-1..5 (23) | Meaning without movement, reduced motion | – |
| proof/render-truth.yaml | 7.8 | TRUTH-1..5 (24) | Every claim traces to authority | – |
| proof/anatomy-source.yaml | 11.4 | ANATOMY-1..5 (14) + 8 observations | `direction = real-render(anatomy) + brand + composition`; the layer chain | `DRAW_NESTED_VARIANT`, `FE_NESTED_VARIANT` |
| proof/brand.yaml | 7.7 | BRAND-1..3 (14) | Primary/danger equal brand tokens; mascot slots; off-palette | `scripts/work/ui/render.mjs` |
| proof/taste.yaml | 23.7 | TASTE-1..13 (66) | The measured taste rubric: focal, void, grid, rhythm, colour, type, shape, imagery, density, states, touch, reference, scoring | `ui-proof-brief.mjs` **regex-parses case prose for thresholds** |
| proof/ux.yaml | 21.3 | UX-1..12 (49) | The task-run rubric: completion, steps, recovery, latency, findability, dead ends, continuity, forms, reach, consistency, copy | `uat.verify` |
| proof/calibration/calibration.yaml + 3 HTML | 1.7 + 12.9 | data | Score anchors for TASTE-13 / UX-12, tolerance 1 | TASTE-13 c9 |
| examples/brand-direction.example.yaml | 38.5 | – | Nivo console direction: principles P0–P8, geometry, archetypes, vocabulary, rubric, anti-patterns | `draw-critic.mjs`, `check-example-coupling.mjs` |

What machines read and what is prose:
- Machines read the `scale.steps` of gap, margin and padding (`scripts/work/ui/ui-proof-spacing.mjs:100`).
  `ui-proof-brief.mjs:355-415` applies a regex to `observe` sentences to pull thresholds out of them, for example
  `/Exactly (\w+) accent-filled/` and `/At most (\w+) distinct sizes, and at most (\w+) weights/`. So some English
  prose works as configuration.
- The `componentOwnership.rows` tables are generated-looking data that nothing verified reads. Some rows are
  truncated, for example `element: root, not (isSkeleton` with no `rule` (`surface.yaml:43-46`, `tone.yaml:53-56`,
  `gap.yaml:152-153`).
- Everything else is prose that an agent reads while authoring or auditing.

---

## 2. The model

```text
business (.starciwork spec)
  │
  ▼ COMPOSITION: decided before DOM, "no later CSS value repairs it"
  │   layout ─► regions + composition owner + scroll axis   (LAYOUT, RESPONSIVE, APP-SHELL)
  │   collection ─► section vs card vs row                   (COLLECTION)
  │   hierarchy ─► rank per meaning, 1 focal + 2-3 secondary  (HIERARCHY)
  │   action/cta ─► consequence → intent → variant; 1 primary/command/view (ACTION, CTA)
  │   accent ─► scarce budget: 1 dominant/decision, ~10% of area (ACCENT, DISCIPLINE)
  │   state/feedback ─► named facts → carriers; nearest owner reports (STATE, FEEDBACK)
  │   coverage ─► spec enumerates actions, regions, branches, states, surface class
  │
  ▼ PRESENTATION: values only on app-owned boundaries; Grammar owns the inside of components
  │   space:   gap (siblings) > padding (edge→content) > margin (named exception)  ─ one closed scale
  │   type:    font rank + tone (default/muted/accent)  ─ Grammar owns values
  │   paint:   surface+foreground pair, boundary (separator vs border), radius ramp
  │   room:    measure (fluid→fit→cap), overflow (one owner per axis), text-flow
  │
  ▼ RENDER
  │
  ▼ PROOF: observe only the rendered page; each rule names its falsifier
      gating, all-or-blocked: A11Y, CONTRAST, FOCUS, MOTION, TRUTH (any unobserved criterion → blocked)
      scored 1-5 with gates + mean ≥ 4: TASTE (capture), UX (task run); calibrated by 3 anchors
      provenance: ANATOMY (real render), BRAND (pixels vs brand record)
```

Cross-cutting ideas that hold the layers together:
- **Owner vocabulary.** Every presentation case names `App`, a component, or `—`. That owner decides whether the app
  writes a class at all. The failure codes are `APP_REIMPLEMENTATION`, `APP_OVERRIDE`, `DOUBLE_OWNER` and
  `COMMON_CAPABILITY_MISSING`.
- **Facts → carriers.** One fact has one carrier, and one carrier holds one fact. This appears in STATE-1, ACTION-2,
  FEEDBACK-3 c4 and ACCENT-3.
- **Scarcity.** There is one focal point (HIERARCHY-6), one anchor per region (HIERARCHY-2), one primary per command
  per view (CTA-1 c5), one dominant accent per decision (ACCENT-1), about 10% accent (ACCENT-6), one signature
  moment (DISCIPLINE-3) and at most 2 badges and 3 hairlines (DISCIPLINE-1).
- **Two checks.** Composition commits the intent and proof measures the outcome. `composition/taste.yaml` and
  `proof/taste.yaml` are explicit twins: "taste tests the outcome and composition tested the intent".
- **The surface class** is one of `console | form | landing | catalog | reader` (COVERAGE-1 c7). It is the key that
  selects banded thresholds: TASTE-9 density, UX-2 step budget, UX-5 navigation depth and the TASTE-5 accent
  allowance.

---

## 3. The thinking

### 3.1 Hierarchy: rank comes from the job, and is carried by size before colour
- "Hierarchy is decided from the job the content does, never from how prominent the direction wishes it looked"
  (`hierarchy.yaml:10`). Each job has one owner: Heading names, Text explains, Badge is an authority-backed outcome,
  Progress is a verified measurement (HIERARCHY-1).
- A rank is made visible in this order: "first by size … then weight, then space around it; a tone or colour is added
  only after those, and a distinction that exists only in colour is not a rank" (`hierarchy.yaml:143`).
- Page budget: "exactly one primary focal point … then two or three secondary elements; everything else is named
  background" (`hierarchy.yaml:139`). A fourth candidate is demoted, not promoted. Proof uses the squint test: an 8px
  Gaussian blur plus greyscale, and the heaviest mass must be the named focal point (TASTE-1 c5,
  `proof/taste.yaml:51`).
- Fact, measurement and outcome are three separate ranks (HIERARCHY-4): "No filled bar stands for a completion, and
  no ordinary fact takes a warning treatment."
- DOM order follows task dependency: prerequisite → decision → consequence → support. CSS `order` never reverses
  meaning (HIERARCHY-3, LAYOUT-4 c5, CTA-5 c2).

### 3.2 Actions and CTAs: consequence → intent → variant (the button decision)
The strongest piece of thinking here is CTA-6. It also has a code owner:
`packages/grammar/src/core/buttonIntent.tsx` and `core/dna.ts:36-45`.

The app declares three objective facts (`cta.yaml:155`):
- consequence: `none | neutral | negative | destructive`
- rank in its decision owner: `next | alternative | way-out`
- step, for destructive only: `entry | confirm`

The app passes `intent` and never `variant`. Grammar reads the **placement** from React context: `decision` (form,
dialog, drawer or wizard footer, page header decision, empty state), `item` (one per collection item) or `chrome`
(toolbar, top bar, panel header).

| intent (from facts) | decision | item | chrome | IconButton |
|---|---|---|---|---|
| `commit` (next, consequence neutral/negative) | **primary** | secondary (code) | primary (code) | as Button |
| `alternative` (real alternative, incl. Reject beside Approve) | secondary | secondary | secondary | secondary |
| `dismiss` (no consequence: Cancel, Close, Back, Skip) | tertiary | tertiary | tertiary | – |
| `neutral` (not part of a decision: Edit, Export) | outline | ghost | ghost | ghost; navbar → tertiary |
| `destructive` entry (opens confirm / removes unsubmitted row) | danger-soft | danger-soft | danger-soft | danger-soft |
| `destructive` confirm (final irreversible press) | danger | – | – | does not exist |

The rules that turn this into decisions:
- **How many primaries.** Exactly one `primary` per decision owner (CTA-1 c1, ACCENT-1 c1). One view shows one
  primary per *command*: when the region is empty, the EmptyNotice owns the command and the header omits it; once
  content exists, the header owns it (CTA-1 c5, 2026-10-11). The proof side counts accent-filled controls: exactly
  one per view, two on a `landing` (TASTE-5 c1). Equal-consequence peers get no dominant accent: "no paint breaks the
  tie" (ACCENT-1 c3).
- **Per-item commands are never primary.** A command repeated per item takes `neutral` and renders as ghost
  (CTA-6 c4, 2026-10-26). The lint rule `button-intent.mjs no-commit-in-collection-item` enforces this.
- **The label word does not decide.** "Cancel offer" is destructive; "Cancel" that changes nothing is dismiss
  (CTA-6 c7). A destructive verb painted outline, ghost or secondary is a defect (c9).
- **Destructive flow.** `danger-soft` at entry, solid `danger` inside `AlertDialog` at confirm, with no primary in
  that dialog and initial focus on dismiss (CTA-4 c2, CTA-6 c5). An unsubmitted row is removed at once with a
  `danger-soft` trash IconButton; stored data needs an AlertDialog (CTA-4 c5).
- **Grouping.** A decision and its way out are separate Buttons at GAP-2, way out first and primary last, never a
  `ButtonGroup`. `ButtonGroup` is only for 2-5 peers with the same intent acting on one object (zoom, align)
  (CTA-1 c7, 2026-10-12).
- **Command or destination.** `href` means anchor semantics and the button shape only paints it (CTA-2, ACTION-3).
  The dominant action keeps a visible text label, and glyphs only support it (CTA-2 c4).
- **Disabled, pending and skeleton are three conditions** (CTA-3). Disabled means the work cannot start. Pending
  means this control accepted work: label and box unchanged, a second activation refused, never swapped for
  `isDisabled` (ACTION-2 c4). Skeleton means content never resolved. Pending is never page-wide.
- **Peer choices are not buttons** (CTA-1 c6, CTA-6 c6). Use `TagGroup` or `SegmentedControl`: the secondary look with
  a 1px border, and the selected one on accent-soft with an accent border. A primary never sits among them.

**Button size.** The knowledge only says that `size` is "bound through the published prop from that interaction
context" (CTA-1 c4). It never maps contexts to sizes. Code publishes Button and IconButton `sm|md|lg|control`
(default md), Input `md|control`, SegmentedControl `md|lg|control` (`control` = HeroUI lg held at 40px) and Tabs with
no size. The only cross-component size rule is `control`, the 40px shared bar-control height: FE-APP-SHELL-2,
`grammars/starci/family.yaml:63` "control-height-40", `playbook.yaml:188`, and `eslint/fe/control-height.mjs`.
**There is no sm/md/lg alignment table across Button, Input, Tabs and Chip** (gap §4.6).

### 3.3 Tabs vs SegmentedControl vs TagGroup vs ListBox (the choice decision)

| Need | Owner | Rule |
|---|---|---|
| Switch whole screens/panels of content | `Tabs` (each tab owns its panel via `panelId`) | STATE-6 c1-c2, c5 |
| Page-level area switch under the header, once per page, may reflect the URL | `Tabs variant="primary"` (underline bar) | STATE-6 c6 |
| Panels inside a drawer, card, dialog or rail; never in the URL; the nested one | `Tabs variant="secondary"` (HeroUI pill: soft `--default` track, white selected pill with surface shadow, padded track) | STATE-6 c6-c7 |
| One value *inside a form* (audience, period, density) | `SegmentedControl` | STATE-6 c5 |
| Peer filters/categories (multi or single) | selectable `TagGroup` | CTA-1 c6 |
| Navigation-like single-select list | `ListBox selectionIndicator="none"` (fill, no check) | COLLECTION-1 c9 |

The reasoning: secondary tabs are "never re-painted in the accent-soft chip family: next to a ButtonGroup or
selectable chips that paint read as a row of buttons, not a view switcher" (`state.yaml:197`). Selection and chip
filters do spend accent-soft; view switchers do not. Two tab sets of the same variant are never nested. In code the
Grammar Tabs default to `nested ? "secondary" : "primary"` and map them *inverted* onto HeroUI's names
(`branch/Tabs/index.tsx:93-96`). That inversion is a vocabulary trap, and no knowledge file explains it.

### 3.4 Accent: allocation, not paint
- "Every extra dominant treatment reduces what the previous one meant, so the decision is about allocation"
  (`accent.yaml:10`).
- Accent may go only on these places: the primary action, the focus indicator, a verified measurement fill, the
  current-selection indicator, and the one signature moment. "Headings, eyebrows, numbers, card borders, identity
  tiles and summary cells take none" (ACCENT-6 c2).
- Budget: about 90% of the painted content area is neutral and accent stays under 10%. TASTE-5 c5 measures this with
  colour buckets.
- Status hues (success, warning, danger) appear only where authority reports a real state. They are never category
  or decoration (ACCENT-6 c3, ACCENT-5). A figure that reports a state keeps the default tone with a toned Badge
  beside it (DISCIPLINE-2 c5).
- "Two reds": an accent slab sharing the first screen with the primary competes with it. The ink band is reserved for
  the overview signature moment (ACCENT-6 c5).
- Notices use the HeroUI Alert. `surface` is the default on the canvas; `soft` (the tone's soft tint at 50%, no
  shadow) is used when the notice belongs to a band. Alert action variant by tone: accent → primary,
  danger → danger, else secondary (ACCENT-5 c5-c6).

### 3.5 State and feedback
- The five kinds (`state.yaml:63`): transient cue (hover, focus), persistent value (selected, expanded), lifecycle
  fact (unavailable, pending, unresolved), settled outcome (needs authority), absence (contributes nothing). The
  rule: "Two facts that share a carrier become one fact, and a fact with no carrier becomes a guess."
- `PresentationState` (neutral, informative, affirmative, cautionary, negative, pending, unavailable) paints a fact
  that authority already settled and never creates one.
- Absence is complete: unmounted, with no wrapper, track, divider or focus stop left behind (STATE-3, LAYOUT-4 c4).
- Loading and failure keep the page's anatomy. Render the page component in skeleton mode; collections show 3 rows by
  default; a failed region fails in place; a failed route keeps its chrome (STATE-8, 2026-10-11).
- Feedback lives at the smallest correctable owner: a field error on `Input.errorMessage`, recovery on that region's
  `EmptyNotice`, an announcement on one `live="polite"` owner. A result is claimed only after settlement (FEEDBACK-1..3).

### 3.6 Collection and layout
- "A list of entities is a section, never a card" (COLLECTION-1). The commonest drawn defect is to wrap a list in a
  card, which then forces a second heading inside it and strips the rows of their own affordances
  (`collection.yaml:9-14`). A card is one subject, divided into bands by rules, never into more cards (COLLECTION-2).
- A rail holds standalone lists as `SurfaceListCard` stacked at GAP-4 (COLLECTION-1 c7). Multi-value input is a list
  of single `Input`s, never a "one per line" Textarea (c8).
- Every region resolves to a published composition (`PrimaryRailLayout`, `WorkspaceShell`, `PaneGrid`) or to a
  recorded gap. Vendor grid and width arithmetic are refused (LAYOUT-2). There is one owner per scroll axis
  (LAYOUT-3), and a list/detail/info screen is one joined surface with vertical Dividers (LAYOUT-1 c10).

### 3.7 Responsive
Breakpoints belong to a named owner, never to a device: `PrimaryRailLayout` container query at 56rem,
`NavigationFeatureNav` and `PaneGrid` at 48rem (RESPONSIVE-2). A form inside a narrow owner stays one column
whatever the viewport, because a viewport `md:grid-cols-2` misaligns fields inside a drawer (RESPONSIVE-1 c6). Only
one branch exists at a time.

### 3.8 Taste (decision side)
DISCIPLINE-1 says reduce before adding: an element with no job "is removed, not made quieter". It caps a card at 3
hairlines, an entity at 2 badges, and a title at 1 supporting line plus 1 meta line. DISCIPLINE-2 says numbers are the
heroes: the lead figure is the largest text in its cell, a lighter unit, tabular numerals, default tone, and a ribbon
of at most 4 cells on a white card. DISCIPLINE-3 allows one brand signature moment per page and never puts a promo
strip on a working page.

### 3.9 Presentation scales: how they combine

**Spacing rhythm** comes from one closed scale shared by gap, padding and margin (`gap.yaml:31-56`):

| ID | px | token | meaning |
|---|---|---|---|
| GAP-0 | 0 | – | the seam is drawn by a separator or joined faces |
| GAP-1 | 4 | – | two lines read as one identity (title + qualifier, value + unit) |
| GAP-2 | 8 | `--grammar-inline-gap` | inline companions inside one control: icon+label, badge row, decision+way-out buttons |
| GAP-3 | 12 | `--grammar-row-gap` | peer items in one row/group: field + submit, two filters |
| GAP-4 | 16 | `--grammar-section-gap` | sibling blocks under one heading: cards of one collection, field groups |
| GAP-5 | 24 | `--grammar-region-gap` | page regions, each with its own heading |
| GAP-6 | 32 | – | a named major transition (marketing, unrelated halves) |

Combining rules:
- Distance between siblings belongs to gap, edge to content belongs to padding, and margin is only a named exception
  ("an application that reaches for margin first will produce two owners for one distance", `margin.yaml:14-16`).
- Rhythm must be monotonic: region > section > row, and equal peers get equal gaps (TASTE-4).
- The example reduces this to "24/16/12/8/4".
- Padding follows **side contact**: an outer edge takes content clearance (16), a side facing a separator takes the
  smaller separator clearance (12), and a side already owned by a child adds nothing (`padding.yaml:21-26`,
  SURFACE-6 c2).
- A divider is full-bleed and padding sits on the bands, never on the ancestor (BOUNDARY-1 c5).

**Type scale.** The ranks (FONT-1..6) are lowest supporting, supporting reading, ordinary reading, page heading,
leading value and display. The values now live only in `grammars/starci/playbook.yaml:1002-1075`: xs 12/16, sm 14/20,
md 16/24, metric-lead. The example pins a console at 20/28 (page) > 16/24 (section) > 14/20 (card title) > 12/16 meta,
weights 400/600, lead metric 30/36. Weight refines a chosen rank and never creates one. `xs` and `Heading level 4`
always resolve to muted (TONE).

**Tone ↔ surface.** A surface and its foreground travel as a pair (SURFACE). The order of preference is: no paint
(SURFACE-1) → card face `surface` (2) → recessed neutral band `surface-secondary` (3) → raised band `accent-soft` with
its foreground (4) → proven outcome `success-soft` (5) → full `accent` slab only with no copy on it (6). Text tone is
default / muted / accent (one short span). Status is never a text colour.

**Radius by surface level** (`radius.yaml`):

| Level | Value | Owner |
|---|---|---|
| Surface / card (top-level region) | 1rem (`--starci-core-surface-radius`, RADIUS-6) | SurfaceCard; app panel `rounded-2xl` |
| Control (field, button box, tooltip) | .75rem (`--starci-core-control-radius`) | Grammar |
| Region nested in a surface (band, notice, bordered group, icon tile) | .75rem (RADIUS-5) | App |
| Compact mark / segment / small notice | .5rem (RADIUS-4) | App |
| Swatch, skeleton line | .25rem (RADIUS-2) | App |
| Hero band | 1.5rem (RADIUS-7) | App |
| Pill / circle (Button, Badge, Chip, pill tabs, avatar) | full (RADIUS-9, `--starci-core-pill-radius`) | Grammar |

The nesting law: an inner box radius is ≤ its container's. A pill is "its own shape and is not a box" (TASTE-7 c4).
Shape consistency means one family of steps per view (TASTE-7 c1). The ramp scales from one `--radius`, so writing a
literal like `rounded-[1.25rem]` "freezes one family's decision into every family".

**Boundary.** `--separator` draws a line between things and `--border` outlines one thing. A set of n rows has n−1
lines (`last:border-b-0`). Elevation depends on depth: top-level cards are raised and nested ones subordinate
(BOUNDARY-5/6, ANATOMY-2 c2). The layer chain is page background → painted surface → nested controls, and a form's
fields and submit share one surface (ANATOMY-2 c3).

**Measure.** Prefer fluid → fitted (`w-fit max-w-full`) → capped (closed W-scale, `65ch` for prose) → never fixed. A
form caps itself (`SurfaceCard measure="form"` 30rem / `formCompact` 28rem, or `max-w-md mx-auto`); it is never capped
by the page measure (MEASURE-1 remark, MEASURE-4 c4). Every text region gets `min-w-0`.

**Overflow / text-flow.** One owner per axis; a scroll class always travels with a height cap; `overscroll-contain`
on panels. Truncation is allowed only when the full value is reachable elsewhere, and "never for a value the reader
must act on" (FLOW catalogNotes). Wrapping is the default, never `nowrap` on translated text.

### 3.10 Proof: how a verdict is reached
- The gating lenses (A11Y, CONTRAST, FOCUS, MOTION, TRUTH) pass only when every criterion passes. An unobserved
  criterion makes the verdict `blocked`, never pass and never fail. There is no averaging.
- The scored lenses (TASTE, UX) score each criterion 1-5. `ship` requires no fail on the gate set (TASTE-1/2/5/8/12;
  UX-1/3/4/6/7) and a mean ≥ 4. "A score of 3 means the criterion is met without conviction", so an inoffensive page
  is `fix-first` (TASTE-13 remark).
- A score is valid only when the same auditor scored the three anchors in the same round within ±1 (TASTE-13 c9,
  `calibration.yaml`). This is the strongest anti-drift device in the tree.
- Numeric thresholds include contrast 4.5:1 / 3:1 (soft status pairs 3:1, owner 2026-09-30), 44px targets
  (accordion/rail only), void > 64px, edges within 1px, ≤ 3 sizes and 2 weights per region, ≤ 2 card nesting levels,
  ≤ 1 decorative image, density bands per class (console ≥ 60%, catalog ≥ 50%, reader 40-70%, form 25-50%,
  landing ≤ 40%), latency 100ms / 1s / 10s, and step budgets per class.

### 3.11 Worked combination (what an agent should conclude)
Take an "Add documents" drawer:
- **Layout.** A drawer (decision placement) holds the main task first, then a closed `SurfaceAccordionCard` with batch
  options, and the summary says who may read the result (LAYOUT-1 c8).
- **Choices.** Upload | write | FAQ switches whole panels, so it is `Tabs variant="secondary"` (nested, pill, not in
  the URL) (STATE-6 c5-c6). Audience inside the form is a `SegmentedControl`.
- **Sources.** The Drive picker is a secondary button under the dropzone. Links are a list of `Input`s with a ghost
  "+ add link" (LAYOUT-1 c9, COLLECTION-1 c8). A pasted row is removed with a `danger-soft` IconButton and no confirm
  (CTA-4 c5).
- **Footer.** Cancel (`dismiss` → tertiary), then Add (`commit` → primary) at GAP-2, way out first, not a ButtonGroup.
  The primary never reads "Add 0 documents" (CTA-1 c7). Pending sits on Add (ACTION-2).
- **Fields.** Fields stay one column (RESPONSIVE-1 c6) and take the nested field treatment that Grammar resolves from
  the surface (ANATOMY-2 c1).
- **Accent budget.** Accent goes to one primary, the focus ring and the selected tab pill indicator only.

---

## 4. Problems

### 4.1 Direct contradictions
1. **Action group order contradicts itself inside `cta.yaml`.**
   - CTA-5 c1: "DOM order runs dominant decision, supporting alternative, then escape" (`cta.yaml:134`).
   - CTA-1 c7: "the way out first and the single primary last" (`cta.yaml:49`), and CTA-6 c5 agrees.
   - The example follows CTA-5 in `actionRow` "dominant, alternative, escape" and wizard "primary first, ghost back"
     (`brand-direction.example.yaml:357,517`). That also contradicts CTA-6 c5, which makes dismiss `tertiary`, not
     ghost.
2. **Type count.**
   - DISCIPLINE-2 c4 allows "Three or four sizes and two weights at most" (`taste.yaml:72`).
   - TASTE-6 c1 allows "At most three distinct sizes" (`proof/taste.yaml:159`), and that sentence is the one the
     regex gate reads.
3. **Destructive paint.**
   - The example P1 "Destructive is words plus the danger glyph, never paint" (`example:55`) and detail "never: a red
     destructive button" (`example:303`) contradict CTA-4 c2 and CTA-6, which require `danger-soft` → `danger`.
4. **The ink KPI band.**
   - DISCIPLINE-2 c6 says the KPI ribbon is "never the ink band" (`taste.yaml:80`).
   - The example's signature band puts four KPI cells inside `treatment="ink"` (`example:208,536-541`).
   - ACCENT-6 c5 allows ink only as the overview signature moment. The overview case is therefore ambiguous.
5. **Group glyph.**
   - FE-APP-SHELL-7: "a group marker beside its name" (`app-shell.yaml:174`).
   - COLLECTION-3 c1: "Conversation titles carry no group glyph" (`collection.yaml:140`).
6. **Field variant.**
   - The example form note says "fields inside a card use the secondary variant" (`example:349`), and COLOR-3 c6
     frames it as a static `secondary` variant.
   - ANATOMY-2 c1 (2026-10-25) says apps "omit the field variant" and Grammar resolves the layer.
     `FE_NESTED_VARIANT` reports a static variant.
7. **Accent where accent is banned.**
   - RADIUS-4 c1 renders `bg-accent-soft` on a marker and RADIUS-5 c3 on an "icon tile" (`radius.yaml:139,168`).
     RADIUS-7 renders a hero `bg-accent-soft`.
   - ACCENT-2 c1/c5 and ACCENT-6 c2 say identity tiles are neutral.
   - RADIUS-4 c2 shows "An app-owned segmented control's own segment", which CTA-1 c6 forbids.
8. **Stale state in the example.**
   - The header says main colour is "Still OPEN" (`example:21`), but `pendingRulings.main-colour.status: ruled`
     (`example:835`).
   - `toneBadge` says "never an info tone (not published)", while ACCENT-5 c6 uses an informative Alert tone.
9. **Radius values vs ramp claim.**
   - The headings print fixed rem values (`rounded-2xl / 1rem`), and the core surface token is 1rem.
   - The notes say "every step is a multiple of one number" and that core sets `--radius` to .75rem.
   - Both cannot hold for the same class names, so the doc does not say whether `rounded-xl` moves with the family.

### 4.2 Duplicates (the same fact in several places)
- **One-primary rule, 7 places:** CTA-1 c1 and c5, ACCENT-1 c1, ACCENT-6 c2, TASTE-5 c1, example P1, rubric A1, and
  antiPattern A10. All of them derive from the one code fact `dna.ts intent.commit.decision = primary`.
- **Alert anatomy and action-by-tone mapping, 5 places:** ACCENT-5 c5, example header comment, `vocabulary.notice`,
  `archetypes.dashboard.notes`, rubric G2, and antiPatterns A14 and A22.
- **Meter track h-2/h-1, 5 places** in the example.
- **Budgets:** the badge cap ≤ 2 appears in DISCIPLINE-1 c3, TASTE-5 c6, example P4, `toneBadge` and T1. Hairlines
  ≤ 3 appear in DISCIPLINE-1 c2, TASTE-7 c5, P5 and `entityCard`. The 90/10 accent split appears in ACCENT-6 c1,
  TASTE-5 c5, P1 and B2.
- **Twin rules in composition and proof:** HIERARCHY-6 ↔ TASTE-1 c5, DISCIPLINE-1 ↔ TASTE-5 c6 and TASTE-7 c5,
  DISCIPLINE-2 ↔ TASTE-6 c5, DISCIPLINE-3 ↔ TASTE-8 c5, ACCENT-6 ↔ TASTE-5 c5, STATE-8 ↔ TASTE-10. The design is
  intentional (intent vs outcome), but each threshold is restated rather than referenced, which is how drift #2
  happened.
- **FONT, twice:** abstract ranks in `presentation/font.yaml` and full recipes plus ownership rows under the same IDs
  in `grammars/starci/playbook.yaml:~980-1075`. Padding is likely the same (the playbook `p-1`/`p-2` recipes at
  `:799,814`).
- **Pending/disabled/skeleton, 4 places:** CTA-3, ACTION-2, STATE-2 and TRUTH-3.
- **Boilerplate text:** "Applicability: API examples belong to the documented Grammar family…" is repeated in 10
  files. The "Retained ownership reference, not proof…" note is repeated in 9. Each verdict rule (A11Y-5, CONTRAST-1,
  FOCUS-6, MOTION-5, TRUTH-5) repeats the same four cases.

### 4.3 Stale, broken or removed vocabulary and form
- `presentation/index.yaml:107-135` and `proof/index.yaml:81-97` prescribe Markdown headings
  (`## GAP-5 — gap-6 / 1.5rem`), Markdown tables (`| Case | When | Owner | Render |`) and
  `## What this file does not decide`. The files are YAML with `cases:` and `doesNotDecide:`.
- References to `.json` files that no longer exist: "`contrast.json` publishes only…" (`proof/index.yaml:84`) and
  "closed `ui/color.json` topic" (`contrast.yaml:14`).
- `@grammar/common` and `@grammar/core` (`layout.yaml:19`, `radius.yaml:71`); the package is
  `@starci/grammar/{common,core}`. "Common" as a proper noun appears in 9 presentation files, and FONT and PADDING use
  "selected Grammar" instead, so two vocabularies coexist.
- Conversion artifacts:
  - `topics: [{}, {}, …]` in measure, surface, overflow, text-flow and boundary.
  - Sentences split across `notes` and `remark` ("there is" / "no separate receipt…") in all five verdict rules and in
    TASTE-13 and UX-12.
  - Truncated `componentOwnership` rows (§1).
  - FOCUS-1 `case-6` sits between case-3 and case-4.
- Product-specific content inside product-agnostic knowledge breaks the house ruling: Nivo, unicorn mascot, `vi`
  locale, hex `#040d1c`, `draw-bakeoff/r5/...`, "Zalo group-avatar reference" (COLLECTION-3) and "nivo.vn review"
  (FOCUS-1 c6). The StarCi DNA tokens are also baked into the universal presentation layer:
  `--starci-core-surface-radius`, `.starci-core-surface-highlight` (OVERFLOW-1 c2) and `starci-core-` (ACTION-3 c5).
- Dates and "Owner ruling … (2026-10-12, corrected the same day)" inside assertions: 43 cases are history inside
  canon. CONTRIBUTING requires present tense with no ghosts.
- `ui/index.yaml` image-first-direction names a tool and receipt (`starci work imagegen`, `image_gen.imagegen`) inside
  knowledge.

### 4.4 Prose that restates or acts as code
- CTA-6 c2 restates the full `dna.ts` intent map in prose, and the prose is incomplete: it omits commit→secondary in
  `item` placement and commit in `chrome`. The code is the owner, so the prose should cite it.
- `ui-proof-brief.mjs` regex-parses English `observe` text for thresholds ("Exactly one accent-filled",
  "At most three distinct sizes", "more than two levels", the A11Y-4 size). Rewording a sentence silently disables a
  gate (`NONE('the case names no count')`). Thresholds should be data fields.
- `scalePx(knowledge,'padding')` reads `presentation/padding.yaml scale.steps`, but padding.yaml now has no `scale`.
  The padding contribution to TASTE-4 c3 is therefore empty, a **silent gate degradation** caused by the
  abstraction rewrite.
- Lint-backed cases (ACTION-3 c5, COLLECTION-1 c9, CTA-6 c4, ANATOMY-2 c1) carry `verification.automated` pointers.
  That is correct, but they also restate the selector logic in prose.

### 4.5 Silent changes in direction
- FONT and PADDING were rewritten to the "selected Grammar owns values" model, while GAP, MARGIN, RADIUS and MEASURE
  still print StarCi values and Tailwind classes. The layer split is half-done, and the presentation index still
  promises "every topic opens with a scale table".
- A11Y-4 asserts 44px only for "Accordion triggers and controls inside a rail", while TASTE-11, UX-9 and rubric M2
  (40px) cite "the minimum A11Y-4 names". The control floor elsewhere is 40px (control-height-40), so the target
  floor is unsettled.

### 4.6 Gaps, especially the thinking the owner asked for
1. **No component size model.**
   - No file explains *why* Button has `sm|md|lg|control`, which context picks which, or how sizes align across
     Button, IconButton, Input (`md|control` only), SegmentedControl (`md|lg|control`), Tabs (no size), Chip, Badge,
     ListBox (`sm|md|lg` = 32/40/48 leading slot) and IconTile (`sm` 32 / `md` 40).
   - CTA-1 c4 names three contexts ("dense toolbar, a card, or a page-level decision") but maps none of them.
2. **No variant rationale per component.** Only Button and IconButton (via intent) and Tabs (STATE-6) have one.
   Badge/Chip soft vs solid, Input primary vs secondary (layer), Alert surface vs soft and Card treatments are each
   argued once in passing, with no per-component page.
3. **Radius ↔ size coupling** (a small control gets a smaller corner, a pill only for short controls) is implicit in
   RADIUS-9 and TASTE-7 c4, never stated.
4. **Density** is a surface-class band in proof only. Composition gives no "density → control size → gap step"
   decision.
5. **Icon size scale** appears only in app-shell prose ("one size chosen from that system's icon scale").

---

## 5. Proposal for the new harness

### 5.1 Principles applied
- One owner per fact. A value lives in the grammar (DNA/tokens), a rule a machine checks lives in eslint or the proof
  scripts, and contexts/ui keeps the **why** and the **choice**, citing the owner by ID.
- Product-agnostic and family-agnostic. Knowledge/ui speaks of roles: surface, control, pill, inline-gap, region-gap,
  intent, placement. StarCi numbers and class names move to `grammars/starci`.
- Present tense: rulings become the rule. Dates and "corrected the same day" go to git history or a ruling ledger.

### 5.2 Keep (core of the new `contexts/ui`)
- The three-layer chain and the owner vocabulary (App / component / gap).
- Composition topics, rewritten as **decision guides** with the falsifiable case tables kept: hierarchy, collection,
  layout + responsive, action + CTA (merge), accent, state + feedback (merge), taste/discipline, coverage.
- The intent model (consequence × rank × step → intent; placement from context), with the mapping table cited from
  the grammar DNA, not restated.
- Proof lenses with their verdict arithmetic, calibration anchors and the surface-class vocabulary.

### 5.3 Merge
- `action.yaml` + `cta.yaml` → `composition/action.md`. Resolve the order conflict: way-out first, primary last,
  matching the code and CTA-6. One place states "one primary per command per view".
- `state.yaml` + `feedback.yaml` → `composition/state.md`. The pending/disabled/skeleton distinction is stated once.
- `gap` + `padding` + `margin` → `presentation/space.md`: one scale, three relationships, side-contact law.
- `surface` + `tone` + `boundary` + `radius` → `presentation/surface.md`: the layer chain (page → surface → nested
  control), pairing, edges and corner by level, as one decision.
- `measure` + `overflow` + `text-flow` → `presentation/room.md`.
- The five verdict rules → one `proof/verdict.md` (gating vs scored arithmetic, `blocked` semantics, calibration).
- Composition/proof twins: keep both sides, but the threshold number lives only in proof data, and the composition
  rule cites it.

### 5.4 Add (the owner's priority)
`contexts/ui/components/` holds one short page per HeroUI component family, all with the same sections: *job*,
*variants and why*, *sizes and which context*, *states*, *placement*, *never*. Start with button (+IconButton,
ButtonGroup), tabs, segmented-control, tag-group/chip, input/field, badge, alert, card/surface, list-row/listbox,
icon-tile. Plus:
- `contexts/ui/scales.md` gives the cross-component alignment table: one control-size ramp (sm/md/lg/control) mapped
  to height, radius role, icon size, label font rank and gap step, with the contexts (dense toolbar / item row → sm,
  form and card → md, page hero / marketing → lg, bars → control). Values stay in each grammar's DNA; this file holds
  the roles and the reasoning. This needs owner decisions, because nothing in the legacy tree settles it.

### 5.5 Move into code or data
- Thresholds in proof prose become structured fields (`threshold: {max: 3, unit: sizes}`) read by
  `ui-proof-brief`; the regex parsing of sentences is dropped.
- Spacing scale steps go to grammar DNA (with `--grammar-*` tokens) and proof reads them from there. Repair the empty
  padding scale read.
- `componentOwnership` tables are generated from grammar source (data-contract attributes already exist, for example
  `data-contract="GAP-2"`). Hand-maintained rows are deleted.
- Intent → variant stays in `dna.ts`. Knowledge cites `STARCI_CORE_DNA.intent`, and each grammar's playbook may print
  its own table.
- Lint-backed cases keep a one-line pointer to the eslint rule ID, without restating the logic.

### 5.6 Drop or relocate
- `examples/brand-direction.example.yaml` moves to the Nivo product `.starciwork` (it is a product record). If a shape
  example is wanted, keep a product-free skeleton under `contexts/ui/examples/` of about 60 lines, with no hex, no
  mascot and no locale.
- StarCi tokens, `starci-core-*` classes, Tailwind class literals and px values in presentation go to
  `grammars/starci/playbook`.
- Rule-shape prose describing Markdown that does not exist, `.json` references, `topics: [{}]`, split
  `notes`/`remark` text, and the 10x and 9x repeated applicability boilerplate (state it once in `ui/index`).
- The closed-address catalog notes (`UI-*`, `COLOR-1/2/4`, `ACTION-4` …) move to a removed-ID list or
  removed-vocabulary, not to topic files.

### 5.7 Target layout and readers

```text
contexts/ui/
  index.md                 load order, owner vocabulary, layer chain           ← every UI agent (authoring + audit)
  composition/
    hierarchy.md  collection.md  layout.md (incl. responsive, app-shell roles)
    action.md (action+cta, intent model)  accent.md  state.md (state+feedback)
    discipline.md (taste decisions)  coverage.md (surface classes)            ← design/direction agent, spec writer
  presentation/
    space.md  type.md  surface.md (surface+tone+boundary+radius)  room.md      ← implementation agent
  components/
    button.md  tabs.md  segmented-control.md  tag-group.md  field.md  badge.md
    alert.md  card.md  list.md  icon-tile.md                                   ← authoring agent at component choice
  scales.md                cross-component size/radius/gap role alignment      ← authoring agent; grammar authors
  proof/
    accessibility.md contrast.md focus.md motion.md render-truth.md anatomy.md brand.md
    taste.md ux.md verdict.md                                                 ← audit agent, uat.verify
    thresholds.yaml        numeric bands per class/criterion (data)            ← ui-proof-brief gate, draw critic
    calibration/{calibration.yaml, anchor-*.html}                              ← TASTE/UX scorer
grammars/<family>/ (outside this area): DNA values, intent map, scale tokens, playbook recipes,
  generated componentOwnership                                                 ← generator, gates, grammar authors
eslint packages: button-intent, ui-rulings, control-height, tokens …         ← CI gate (rule IDs cited from knowledge)
```

Open decisions for the owner, before writing the new files:
- (a) the canonical action-group order (CTA-5 vs CTA-1 c7);
- (b) the type-size cap (3 or 4);
- (c) whether the overview KPI band may be ink;
- (d) the target-size floor (40 vs 44);
- (e) the cross-component size ramp and its contexts.
