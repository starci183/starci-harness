# Grammars

A grammar is the visual language an app's UI is drawn in. It is code first: the `@starci/grammar` package
publishes the components, their props and anatomy, the tokens and their values. This folder holds what code
cannot say: the contract every grammar implements, why each grammar looks the way it does, and how to compose
with it. Two apps built from the same package and the same knowledge must come out the same; a choice they could
make differently is a gap, listed in [open-grammar](../decisions/open-grammar.md) until an API, a lint rule or
one rule here removes it.

Read by: an agent drawing or implementing UI, a grammar author, an auditor judging a render. Gates read
[contract.yaml](contract.yaml), [vendor](../vendor/README.md) data and the code, never the prose.

## Three layers

A screen on a grammar is decided in three layers. Each decision has exactly one layer, and the layers never
trade work: a gate never judges taste, a reviewer never re-measures a constraint, and the LLM never re-decides
what a gate measures.

| Layer | Who decides | What it decides | Owner | Proof |
|---|---|---|---|---|
| 1. Grammar and gates | the package and the DNA gate | constraints: what holds on every render of the grammar, whatever was chosen | `@starci/grammar` code; the laws and their measures in [contract.yaml](contract.yaml) `mustKeep` | the DNA gate measures the render; pass or fail, no judgement |
| 2. The choice | the LLM drawing or implementing the screen | which component, which variant-deciding fact (intent, step, placement-free facts), which spacing step | the Choose sections of [ui/components](../ui/components/README.md), [ui/scale](../ui/scale.md) and [ui/presentation](../ui/presentation.md) | the record cites the choice anchor and the row it took |
| 3. Taste | a reviewer of a different model than the author | whether the whole reads well: hierarchy, balance, density, voice | [ui/proof](../ui/proof.md) scored lenses | the review verdict; a rejection names the rule that was missing |

**Layer 1 is constraints, never judgement.** A DNA entry is one sentence of law plus one measurement on the DOM
(a selector, a metric, an expected value). Examples: an `md` control is 40px tall
(`DNA-COMMON-CONTROL-MD`); a horizontal divider has inline inset 0px inside its surface
(`DNA-COMMON-DIVIDER-FULL-BLEED`); a StatusDot with text has the padding and height of the HeroUI soft Chip of the
same size (`DNA-COMMON-STATUSDOT-CHIP-PARITY`); no raised surface sits inside a surface
(`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`); a list card's label sits above its shell
(`DNA-COMMON-LISTCARD-LABEL-OUTSIDE`); in `offset-pop` pink is never a text colour
(`DNA-OFFSET-POP-PINK-NEVER-TEXT`). A law nobody can measure is not layer 1: it is a choice rule or taste.

**Layer 2 is a choice, read from a table and cited.** The LLM reads the Choose table that owns the decision,
takes the row whose condition the spec's facts meet, and cites it as `<anchor>:<row>`. Examples: page tabs or
region tabs (`tabs.choose.level`); which intent a command has, commit, alternative, dismiss, neutral or
destructive (`button.choose.intent`); a decision with its way out or a peer `ButtonGroup`
(`action-group.choose.kind`); which gap a relation takes (`space.choose.gap`); which step a control takes
(`scale.choose.step`). The grammar then renders the look the choice implies; the app never passes it. A choice
the tables do not settle is a gap in [decisions/open-grammar](../decisions/open-grammar.md) or
[open-ui](../decisions/open-ui.md), never an improvisation.

**Layer 3 is taste.** Whether a correct, cited page is also good is the reviewer's verdict on the render
([ui/proof](../ui/proof.md), ruling `beautiful-by-eye`). A rejection is evidence that a rule is missing: the
reviewer names the choice row or the law it would add.

**A rule moves down when it becomes measurable.** A choice rule whose outcome can be read off the DOM becomes a
DNA entry and its Choose row cites the id: "one commit per view" is a choice when the LLM assigns intents, and a
constraint once counted (`DNA-COMMON-ONE-ACCENT-FILL`); "one highlighted card per view" likewise
(`DNA-COMMON-ONE-HIGHLIGHT`). A taste verdict that recurs becomes a choice row or a threshold. Movement is only
downward, and each move deletes the sentence it replaces (CONTRIB-6). Every Choose row says whether it is
measured (a DNA id), measurable (a candidate) or a judgement.

## The model: one contract, composed implementations

```
HeroUI (anatomy, behaviour, a11y, default paint)                     ../vendor/
   │ wrapped once
   ▼
Common   renderers, anatomy, spacing, size ladder, intent map, root and portal mechanics; no colour
   │ every grammar implements contract.yaml over Common
   ├── core        strict HeroUI parity: tokens and theme bindings, a few scoped rules
   └── offset-pop  custom parity: tokens plus its own component sheets
```

- **Common is the base, not a grammar.** It supplies every renderer over HeroUI and assigns no colour: a page
  with only Common's sheet is unpainted, by design.
- **A grammar is a scope, not a subclass.** It replaces only `GrammarRoot`, which stamps
  `data-grammar-family="<id>"`, and ships one stylesheet whose rules sit in its layer under that attribute. Its
  types cannot change a Common prop (`owner: @starci/grammar src/common/registry.tsx`). Grammars are siblings;
  none imports another, and Common imports none (decision D-6 removes today's exception).
- **Nothing is a grammar outside its root** ([common](common.md#one-root)).
- **No default grammar.** The app names its grammar (`hfs.json` `sides.fe.grammar`); unknown fails.

The package stores Common's renderers under `src/core/**` today; that path is storage, not the `core` grammar
(decision D-1).

## Files

| File | Holds | Read when |
|---|---|---|
| [contract.md](contract.md), [contract.yaml](contract.yaml) | What every grammar provides, per role: slots, variants, sizes, states, what a grammar may change; `mustKeep`, the DNA laws with their measurements, per scope (`common`, `core`, `offset-pop`) | always, before the grammar file |
| [common.md](common.md) | The shared layer's reasoning: context over props, spacing, one root, idioms, playbook shapes | composing any screen |
| [core.md](core.md), [offset-pop.md](offset-pop.md) | How each grammar fills the contract and why: material, departures, lint | the app's grammar only |

Terms: **DNA** is a grammar's material as code (`src/<id>/dna.ts` plus its sheet) and the laws it keeps, each a
`mustKeep` entry with its measurement; knowledge explains the values and never copies one. An **idiom** is a composition chosen at least twice; a **playbook shape** is the
composition for a business situation. Both live in [common](common.md) because they hold in every grammar.

## Who owns what

The grammar package owns everything that is the same in every app; knowledge owns the rule for choosing; the app
decides product facts and layout. A row whose last column is not "nothing" is a product fact, a rule in
[ui](../ui/README.md), or a listed gap.

| Concept | Owner | App author decides |
|---|---|---|
| Component set, props, closed values | `src/common/registry.tsx` and each props type; per role in [contract.yaml](contract.yaml) `roles` | which role the job needs ([ui/components](../ui/README.md)) |
| Anatomy, roles, keyboard, focus | HeroUI through Common's wrappers; [vendor/parity.yaml](../vendor/parity.yaml) | nothing |
| Colour, radius, shadow, motion | `src/<id>/dna.ts` and `src/<id>/styles.css`, shaped by contract `tokens` and `dna` | nothing (brand tokens: gap G-14) |
| Spacing scale and rhythm | `src/common/spacing.ts` | which relationship a gap expresses ([ui/presentation](../ui/presentation.md)) |
| Control heights | Common tokens `--grammar-control-height-*`, contract `sizes`, ruling `control-height-40` | `sm` or `lg` by [ui/scale](../ui/scale.md) (gap G-6); `control` never |
| Hit area and target floor | Common tokens `--grammar-target-*`, contract `sizes.target` | nothing |
| Corners | contract `tokens.corner` roles, values from the grammar's base radius | the corner role of an app-owned box ([ui/presentation](../ui/presentation.md)) |
| Button variant | contract `intent`; resolver `src/core/buttonIntent.tsx` | `intent`, and `step` for a destructive command |
| Placement, bar control size | the composing Grammar component | nothing |
| Field, Tabs and Select look; card depth | surface nesting context `src/core/surfaceContext.tsx` | nothing (gaps G-2, G-3) |
| Root, overlay portal, toast region | `GrammarRoot`, `src/core/overlayScope.tsx`, `Toaster` | mount one root and one `Toaster` (placement: gap G-11) |
| Glyph set and sizes | Grammar `Icon`, DNA arrangement; grammar lint | which meaning to show (gap G-16) |
| Type ranks | `Text` and `Heading` props | the rank by job ([ui/presentation](../ui/presentation.md)); weight (gap G-12) |
| Composition for a business shape | [common](common.md#playbook-shapes) | product facts, copy and region order from the spec |
| Checks on app code | `@starci/eslint-grammar-<id>` (Grammar API) and `@starci/eslint-canon-fe` (universal) | nothing |

## Reading order for an author

1. Resolve the grammar from the app; verify the installed `@starci/grammar` version and exports.
2. [ui](../ui/README.md) for the job's meaning: hierarchy, which role, state.
3. [contract](contract.md) for what the role is; [common](common.md) for root mechanics, idioms and shapes.
4. The grammar file; open `dna.ts` only when a value is the question (brand, contrast).
5. [vendor/heroui](../vendor/heroui.md) only when writing a Grammar wrapper or when a vendor variant's meaning
   is the question.
6. Compose; lint with the canon and the grammar lint. Never re-derive what lint enforces.

## Where feedback lands

Feedback hardens, it never accumulates. In order of preference it becomes an API that removes the choice
(grammar package), a DNA entry or a lint rule, a stricter row in the Choose table that owns the decision, or a
stricter sentence in the one section that owns the concept: the contract role, the common section or the
grammar's role row. It is never a case note appended beside a rule.
