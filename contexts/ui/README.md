# UI knowledge

How an agent decides a user interface on any grammar, so that every app built from the same grammar and the
same knowledge comes out the same. Knowledge decides **when and why**; the grammar package owns **what it looks
like**; the app author decides only what the product supplies (facts, copy, routes, data).

## The system in one page

```text
product spec (.starciwork)
  -> COMPOSITION   regions, rank, actions, states, emphasis   decided before any DOM; no CSS value repairs it
  -> PRESENTATION  values on app-owned boundaries             space, type, paint, room; the grammar owns the inside
  -> RENDER        the grammar's components at their sizes     scale.md places every control on one ramp
  -> PROOF         observe the rendered page only             gating lenses + scored lenses + thresholds
```

| File | Holds | Read it when |
| --- | --- | --- |
| [composition.md](composition.md) | hierarchy, action and CTA, accent, state and feedback, collection, layout, responsive, taste, coverage | writing a spec or a direction, choosing what goes on a page |
| [scale.md](scale.md) | the one size ramp, the touch floor, density, how every control aligns | choosing a size, or building a grammar component |
| [components/](components/README.md) | one page per component role: job, choice against neighbours, variants, sizes, states, owner split | picking a component |
| [presentation.md](presentation.md) | space, type, paint, room and how they relate | writing layout classes on an app-owned boundary |
| [proof.md](proof.md) + [proof/thresholds.yaml](proof/thresholds.yaml) | lenses, verdict arithmetic, every numeric threshold as data | auditing a render or running UAT |

## Who owns what

| Owner | Owns | Never holds |
| --- | --- | --- |
| `knowledge/ui` | the choice and the reason: which component, which rank, which step of the ramp, which owner | a family's values, class names, the intent x placement map, lint logic |
| the grammar contract ([../grammars/contract.md](../grammars/contract.md)) and the package that implements it (`@starci/grammar`, grammars `core` and `offset-pop`) | components, props, anatomy, token and role names, the size ramp values, the intent x placement map | product facts |
| [../grammars/](../grammars/README.md) | why each family chooses its values, its departures | universal rules |
| [../vendor/heroui.md](../vendor/heroui.md) | what HeroUI ships and what a grammar must keep | when to use a component |
| lint packages (`starci-fe/*`, `starci-grammar/*`) | what is checked on app code | reasoning; knowledge cites the rule id |
| the product's `.starciwork` | brand direction, accepted page archetypes, the spec's acceptance assertions | universal rules |

Ownership words used across these files, defined once:

| Word | Meaning |
| --- | --- |
| App | the app writes the layout class on a boundary it owns |
| a component name | the grammar already owns the value; the app passes a prop or nothing |
| gap (`—`) | no published owner exists; the app records `COMMON_CAPABILITY_MISSING` and the grammar adds the capability |
| `APP_REIMPLEMENTATION` | the app writes what a component already owns |
| `APP_OVERRIDE` | the app reaches into a component with a selector or a passed class |
| `DOUBLE_OWNER` | two owners for one distance, edge or fact |

## Reading order

| Reader | Order |
| --- | --- |
| spec or direction writer | this file, composition.md, components/README.md, the components the page uses |
| implementer | composition.md (action, state), the components used, scale.md, presentation.md |
| grammar author | scale.md, components/*, presentation.md, ../vendor/heroui.md, ../grammars/ |
| auditor, UAT | proof.md, proof/thresholds.yaml, then the composition rule being tested |

## How the rules work

- **Ids are addresses.** `CTA-6`, `GAP-2`, `TASTE-5` are stable ordinal addresses, not severities or scale
  positions. A spec's acceptance assertions cite them; grammar `data-contract` stamps cite them. A closed id is
  never reused.
- **No two readings.** If an author could still decide two ways under these rules, that is a defect in the
  knowledge: write the rule that removes the choice, or list it in [../decisions/open-ui.md](../decisions/open-ui.md)
  as a grammar API change.
- **Feedback hardens, never piles up.** An owner correction becomes one of: a stricter general rule in the
  rule it corrects, a grammar API that removes the choice, or a threshold or lint. It is never a case note beside
  the rule. Each rule has one place for that hardening to land: its own table or its threshold key.
- **Present tense.** A ruling becomes the rule; its id and date live in
  [../decisions/rulings.yaml](../decisions/rulings.yaml).
- **Necessary, not sufficient.** Passing every rule does not ship a page; the owner's review still decides. A
  rejected render means a rule is missing or wrong: fix the surface, then fix the rule.
- **Names are the contract's.** Component, prop, token and role names are the grammar contract's
  ([../grammars/contract.md](../grammars/contract.md)); ui/ never writes a value or one family's look.
  Verify against the installed package; a missing capability is a gap to record, never an API to invent.
- Product records (a brand direction, a worked console example) live in that product's `.starciwork`, never here.
