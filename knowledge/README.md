# Knowledge

What an agent needs to decide how an app is built, and the data the gates and generators read to hold it. It is
product-agnostic and English only; a product's own records (requirements, brand direction, screen records, worked
examples) live in that product's `.starciwork`. Policy (which gates run, loosening, secrets, coverage) is `policy/`,
not knowledge.

## The boundary model: four owners, one app

```
grammar package     a package that implements the grammar contract (grammars/contract.*): components, props,
  (code)            anatomy, variants, sizes, tokens and their values, the intent x placement map, root and overlay
                    mechanics. Grammars: `core` and `offset-pop`; an app picks one in hfs.json (sides.fe.grammar).
knowledge           decision rules: WHEN and WHY. ui/ decides which component, rank, step, state; patterns/ decide
  (this tree)       where code lives and how it is shaped; hfs/ and stack/ are the shape and library data.
lint and gates      enforcement: the canon lint (universal), the grammar lint (the contract's API), the HFS checks,
  (code)            the parity gate. Knowledge cites a rule id; it never restates what a rule flags.
the app             product facts, data, copy keys, routes, and layout CSS on the boundaries it owns. Nothing else.
```

Every app is built from the grammar package plus knowledge and must come out the same. A visual or structural choice
an app could make two ways is a gap: it is closed by a grammar API, a ui rule or a lint rule, never left to the app.
Adding a grammar means implementing the contract; nothing in `patterns/` or `ui/` changes.

**Generation path for a screen:** read order below → the grammar's API for each role (contract, then the grammar
file) → the knowledge rules that choose (ui composition, components, scale; fe patterns for the code) → write → lint
and gates prove it. An agent never re-derives what lint enforces and never invents an API the grammar lacks.

## Map

| Folder / file | Holds | Read by |
|---|---|---|
| [ui/](ui/README.md) | universal interface decisions: composition, presentation, the size scale, one page per component role, proof | authoring agent (spec, draw, implement), auditor; [ui/proof/thresholds.yaml](ui/proof/thresholds.yaml) by the proof gate |
| [grammars/](grammars/README.md) | the grammar contract and why each grammar looks as it does; [contract.yaml](grammars/contract.yaml) as data | authoring agent, grammar author; the conformance gate reads `contract.yaml` |
| [vendor/](vendor/README.md) | what HeroUI ships and what a grammar must keep; [parity.yaml](vendor/parity.yaml), [wrappers.yaml](vendor/wrappers.yaml) | grammar author; the parity gate reads both |
| [patterns/](patterns/README.md) | code patterns per side: [fe](patterns/fe/README.md), [be](patterns/be/README.md) | authoring agent before coding a slot; a generator reads the front matter (`slots`, `files`) |
| [hfs/](hfs/README.md) | the app shape: [slots.yaml](hfs/slots.yaml) (tree, tiers, budgets, rule parameters), [rules.yaml](hfs/rules.yaml) (one-sentence laws) | the app checks, canon lint factories, architecture machine, templates; an agent resolving `R<n>` |
| [stack/](stack/README.md) | [fe.yaml](stack/fe.yaml) one library per front-end concern, [pins.yaml](stack/pins.yaml) exact versions | canon lint, pin gate, scaffolder |
| [decisions/](decisions/README.md) | [rulings.yaml](decisions/rulings.yaml), the one log of owner rulings; `open-*.md`, the owner's review queue | every author citing a decision; the owner |

Machine-read data, each with `schema: starci/<name>@<major>`: `grammars/contract.yaml`, `vendor/parity.yaml`,
`vendor/wrappers.yaml`, `ui/proof/thresholds.yaml`, `hfs/slots.yaml`, `hfs/rules.yaml`, `stack/fe.yaml`,
`stack/pins.yaml`, `decisions/rulings.yaml`, and the front matter of pattern files. Everything else is Markdown
reasoning for an agent.

## Reading order by task

| Task | Order |
|---|---|
| FE screen on a grammar | [ui/README](ui/README.md) → [ui/composition](ui/composition.md) and the [components](ui/components/README.md) it uses → [ui/scale](ui/scale.md) → [grammars/contract](grammars/contract.md) and the app's grammar file → [patterns/fe/README](patterns/fe/README.md) (the app's limits, the status recipe) → [ui.md](patterns/fe/ui.md), [function.md](patterns/fe/function.md), the topics of the slots touched → lint |
| BE feature | [patterns/be/README](patterns/be/README.md) → architecture → folder → the topic of its trigger kind → domain, persistence → error, typing, naming → test; resolve each `R<n>` in [hfs/rules.yaml](hfs/rules.yaml) and each path in [hfs/slots.yaml](hfs/slots.yaml) |
| New dependency | [stack/fe.yaml](stack/fe.yaml) (or the be topic that owns the concern) → [stack/pins.yaml](stack/pins.yaml) |
| New pattern or rule | this file's house rules → the topic that owns the concept (extend it, never add a sibling) → [hfs/rules.yaml](hfs/rules.yaml) if a machine can decide it → a ruling in [decisions/rulings.yaml](decisions/rulings.yaml) when the owner decided it |
| New grammar | [grammars/contract](grammars/contract.md) → [vendor/parity.yaml](vendor/parity.yaml) → implement; nothing else changes |

## Feedback hardens

A feedback is absorbed by making the system stricter, never by adding text beside it. In order of preference it
becomes: a grammar API that removes the choice; a lint, gate or threshold; or the general rule rewritten in its one
place. It is never a case note ("for this case do X") and never a second rule that restates the first. Each
hardening records its ruling in [decisions/rulings.yaml](decisions/rulings.yaml). Every rule therefore has exactly one
place where a hardening lands: its own section (ui, patterns), its contract role, or its threshold key.

## House rules for editing knowledge

1. **One owner per fact.** A value code owns (a token, a size, a lint rule, a component) is not restated: name the
   owner (`owner: @starci/grammar src/common/spacing.ts`). A fact appears in one file; others link to it.
2. **Replace, never append.** An edit rewrites the sentence that holds the rule. No history in the present tense: no
   dates, release names, "no longer" or ruling citations inside a rule; the ruling id lives in `rulings.yaml`.
3. **Product-agnostic, English only.** No product names, locales as examples, or product records; those belong to the
   product's `.starciwork`.
4. **Shortest wording that keeps the reasoning.** State the rule, then why. No generated census copies, no prose
   that restates a lint rule (link its id).
5. **Markdown for reasoning, YAML for data.** YAML only when a machine reads it, with a `schema`. Every folder has a
   short README: what it holds, who reads it, reading order.
6. **How a ruling enters.** The owner decides; the decision is written as plain present-tense law in the file that owns
   the concept, and as one entry in `decisions/rulings.yaml` (id, date, ruling, owner of the fact). An agent's own
   choice that awaits the owner goes to the area's `decisions/open-*.md` with the alternative and the reason; when the
   owner confirms it, it moves to `rulings.yaml` and its row is deleted. A spelling that knowledge stops using is
   listed under `removedVocabulary` in the same file.
7. **Write what is true now.** Grammars and knowledge are under test; a rule describes the system as it is or as a
   recorded decision makes it, and an open gap is listed, not papered over.
