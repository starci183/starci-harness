# Grammars

A grammar is the visual language an app's UI is drawn in. It is code first: the `@starci/grammar` package
publishes the components, their props and anatomy, the tokens and their values. This folder holds what code
cannot say: the contract every grammar implements, why each grammar looks the way it does, and how to compose
with it. Two apps built from the same package and the same knowledge must come out the same; a choice they could
make differently is a gap, listed in [open-grammar](../decisions/open-grammar.md) until an API, a lint rule or
one rule here removes it.

Read by: an agent drawing or implementing UI, a grammar author, an auditor judging a render. Gates read
[contract.yaml](contract.yaml), [vendor](../vendor/README.md) data and the code, never the prose.

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
| [contract.md](contract.md), [contract.yaml](contract.yaml) | What every grammar provides, per role: slots, variants, sizes, states, keep vs may change | always, before the grammar file |
| [common.md](common.md) | The shared layer's reasoning: context over props, spacing, one root, idioms, playbook shapes | composing any screen |
| [core.md](core.md), [offset-pop.md](offset-pop.md) | How each grammar fills the contract and why: material, departures, lint | the app's grammar only |

Terms: **DNA** is a grammar's material values as code (`src/<id>/dna.ts` plus its sheet); knowledge explains
them and never copies a value. An **idiom** is a composition chosen at least twice; a **playbook shape** is the
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
(grammar package), a lint rule, or a stricter sentence in the one section that owns the concept: the contract
role, the common section or the grammar's role row. It is never a case note appended beside a rule.
