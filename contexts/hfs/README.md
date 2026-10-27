# HFS: the app shape

HFS is the one source and storage standard of a StarCi app: what may exist in the repository, where, which tier may
import which, and which rules judge it. It is data a machine reads; the reasons live in the patterns
([be](../code/be/README.md), [fe](../code/fe/README.md)).

| File | Holds | Read by |
|---|---|---|
| [slots.yaml](slots.yaml) | the slot manifest: editions, sides, app and trigger kinds, the tier matrix, rule parameters and every slot | the app CLI checks, the canon lint factories, the architecture machine, templates; an agent through `starci app explain` |
| [rules.yaml](rules.yaml) | the rule catalog: id, finding code, the law in one sentence, failure codes, enforcers | gates and lint (by code), an agent resolving a cited `R<n>` |

An app declares itself in `hfs.json` (kind app, its `edition` fixed at scaffold, its sides, apps, patterns,
backing services and its grammar). No product content lives here; product records belong in the app's `.starciwork`.

## One word, one meaning: "slot"

- **slot** (unqualified, in hfs and patterns): an entry of [slots.yaml](slots.yaml), a place a path may live.
- **anatomy slot**: a named part of a vendor or grammar component (`data-slot`), in [vendor](../vendor/README.md) and
  the [grammar contract](../grammars/contract.md).
- `Slot<T>` and `SlotView`: code identifiers of the front-end status recipe; prose calls the value a **resource**
  ([code/fe](../code/fe/README.md#data-status-of-a-region)).

## Slot fields

| Field | Meaning |
|---|---|
| `id` | stable dot-separated name (`<profile>.<...>`); never changes meaning inside a major |
| `profiles` | `app`, or the sides (`be`, `fe`) the slot exists in; the path is relative to that side |
| `path` | pattern: `<name>` binds one segment, `*`/`?` stay in a segment, `**` spans directories, `{a,b}` alternates; a trailing `/` owns the directory except what a more specific slot owns |
| `presence` | `required`, `optional`, `opt-in` (legal only when `hfs.json` declares it), `forbidden`; `litePresence` overrides it under lite |
| `tracked` | `tracked`, `ignored` (must be git-ignored) or `external` (must not exist; `goesTo` says where it lives) |
| `tier`, `owner`, `entries` | the node in the direction matrix; whether each matching directory is an owner; extra entry files besides `index.ts` |
| `requires`, `allows`, `forbids`, `minInstances`, `requiredInstances` | what an instance must, may and must not hold |
| `tests`, `coverage` | `unit-beside`, `e2e` or `none`; whether the logic roles of the subtree are measured |
| `budget` | size budgets of the slot (lines per file, files, exports, hooks); the one owner of those numbers |
| `trigger`, `pattern`, `appKind`, `composedBy`, `provider` | the feature kind, the declared pattern that enables it, the app kind it describes, the app kinds that compose it, the connection provider that enables it |
| `managedBy`, `liteManagedBy` | the template directory the app sync renders it from; a difference is drift |
| `editions`, `lite`, `editionWhy` | the editions it exists in, the fields it carries under lite, and why lite differs |
| `rules` | finding codes of [rules.yaml](rules.yaml) that judge the slot |

## Rule parameters (`ruleParams`)

The values a rule reads, each stated once: `common` (file and function line budgets, feature file budget, the
duplicate-block threshold), `be` (raw-library owners, the in-process event vocabulary the CQRS rule refuses, the
spec doubles of the test kit, injected parameter names, the closed file-suffix vocabulary and banned suffixes, the
unit, logic, value and thin roles, pattern proof scenarios, the patterns each trigger kind needs, the `app add`
kinds, backing services, and the lite overlay), `db` (allowed Postgres extensions, the queue outbox shape). A rule
law names the parameter instead of its value.

## Rules

A rule is a law that a machine can decide; one that needs judgement is a pattern rule reviewed by an agent. Each
entry names its enforcers by kind (`eslint-be`, `eslint-fe`, `eslint-grammar-core`, `stylelint`, `machine`,
`hfs`, `sonar`). Every rule is an error: no baseline, allowlist or suppression exists for a product. The rules of the
StarCi runtime repository itself are harness policy, not app knowledge, and are not in this catalog.

## Editing

A slot or rule changes here first, in its one entry, and the patterns cite it. A changed path, presence, import edge
or budget is a major change of the manifest and needs an owner ruling ([decisions/rulings.yaml](../decisions/rulings.yaml));
adding an optional slot or a rule is a minor one.
