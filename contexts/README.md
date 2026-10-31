# StarCi contexts

Read this file first, in this repository or in any app the harness drives. It names what to read for the task in hand;
every fact lives in one file of this tree (or in the code that owns it), and this file points at it.

The harness is one TypeScript CLI (`cli/`, the `starci` command) plus the data it reads: `ops/` (worker labels, lanes and routes, check
presets, routing), `policy/` (gates and profiles), `contexts/` (this tree: the harness's own rules and how app code is
written), `packages/` (the canon packages apps install) and `skills/starci/` (the agent entry for operating the
harness). [README.md](../README.md) is the overview and says how it works.

## Load order

Read the files of your task's row, in order, before planning or editing. A task that spans rows reads each row. Every
row starts with [harness/rules.md](harness/rules.md), the rules no task may bend, then
[authority/README.md](authority/README.md), what your role may edit, commit, merge, push and publish and which tier of
checks it runs, under either runner.

| task | read |
|---|---|
| operate the harness: send a task, run a workflow, verify, push | `skills/starci/SKILL.md` (a `[Supervisor]` seat reads its rendered brief instead, `ops/coordinators/supervisor.md`), then `starci explain <group>` for the verbs you call |
| work as a worker on one task | the brief the harness rendered for the task (the worker procedure of [ops/ops/README.md](../ops/ops/README.md), then the label's op file `ops/ops/<label>.md`), then the contract it names |
| plan as a Kernel | [harness/roles.md](harness/roles.md) and [project/README.md](project/README.md); the rest of [harness/](#harness) and [project/index.md](project/index.md) (generated: every file of this tree with its size, first sentence, sections and ids) on demand, by `starci contexts search` or the file a table below names; open only the files the tasks need, through the rows of "Reading order by task", and name them in each contract's `context.extend` |
| edit the harness itself (`cli/`, `ops/`, `policy/`, these documents) | [CONTRIBUTING.md](../CONTRIBUTING.md), then the owner of your surface: [cli/README.md](../cli/README.md) through [harness/cli-sections.md](harness/cli-sections.md) (generated: its sections with anchor, size and first sentence; open a section with `starci contexts anchor <anchor>`, never the whole file), [policy/README.md](../policy/README.md), the header of the `ops/` file you change, and [harness/decisions.md](harness/decisions.md) |
| author app code or UI | "Reading order by task" below and the files it routes you to; the app's own `hfs.json` and `.starciwork/` |
| change a gate, a profile, a banned marker or the secret scan | [policy/README.md](../policy/README.md) and the file it names; the code of the gate is under `cli/src/core/check/` |
| change a canon package (lint, tsconfig, prettier, stylelint, jest) | [packages/README.md](../packages/README.md), then the package's own README |

The verbs available in the working directory, with flags, effect and json schema, come from `starci explain`
(`--json` for machines). It is generated from the verb definitions and is the one list of commands.

## Two layers of context

Every seat, worker, Kernel and Supervisor alike, loads a minimal fixed core and reads the rest on demand (owner decision
`minimal-core-search`, [harness/decisions.md](harness/decisions.md)). The first layer is read before any work and is fixed:
your row above, or for a worker the brief's files (the op's `context.base`, then the contract's `context.extend`, within the
op's budget). It is the few pages the seat cannot act without plus an index of what exists: this file's tables, and a
generated section index (`*-sections.md`, beside the document it indexes: every section with its anchor, size and opening
sentence) in place of a document too large to load whole. The second layer is looked up on demand. A section an index lists
opens with `starci contexts anchor <anchor>`. A worker's brief lists its rule pages: each code topic owning a rule over a
path under its allowPaths, opened at the sections a written file needs and citable, outside the budget. Any other question
mid-task goes to `starci contexts search "<question>" [--scope ui,code,...]`, asked in English since the tree is English (a
question in another language is translated first, keeping rule ids and names as written; the verb refuses it otherwise with
`SEARCH_QUERY_NOT_ENGLISH`), which ranks the sections of this tree, the op files, `policy/` and the harness documents and
prints each hit's id, file, line and text, the way "Looking a rule up" below says. Open the hit's file before you rely on it. A hit marked citable carries a rule or
decision id; `rulesApplied` may cite it only when that file is among the task's context files (its rule pages included, and
a section index standing for its source), since the rules-cited check reads ids from those files alone.

### Looking a rule up

A rule an agent breaks is almost always a rule it did not find, so a lookup follows these steps before every answer, plan,
brief or refusal ([harness/rules.md](harness/rules.md) rule 7), and again after a context compaction or a resumed session,
which keep nothing that was read:

1. **Several phrasings.** Ask the request in English, then the action it takes ("link a local build", "remove a worktree"),
   then the artifact or rule id it touches (`PaneGrid`, `node_modules`, `CONTRIB-20`), in one call:
   `starci contexts search "<request>" --also "<action>" --also "<artifact>"` fuses the rankings and says how many phrasings
   found each hit. One phrasing ranks one wording; a rule written in other words sits below the top 5.
2. **The right scope, deeper when it matters.** `--scope harness,decisions` for how the harness works and is changed,
   `ui,grammars` for a screen, `code,hfs,stack` for code; with `--limit 10` whenever the answer decides a brief, a plan, a
   constraint or a refusal.
3. **The area's index.** Read your row of the load order or of "Reading order by task", and the section index
   (`*-sections.md`) of a document too large to load, so a rule the ranking missed is still in view.
4. **Open, then cite.** A hit counts once its file is open; cite its id and path. A hit that contradicts what you remembered
   wins.

A brief, to a worker, an Op or a subagent of any host, states each constraint with its rule id and path and in the rule's own
words, never from memory, and tells its reader to look up the same way before acting: a subagent knows only its brief.
Before you send a brief, a plan or an answer, check it:

- every "never", "must", "only" or "wait for" names a rule id and path you opened in this session;
- the lookup ran in English, in at least two phrasings, and no hit contradicts what you wrote;
- every constraint names its enforcer (a hard rule's gate, an `R<n>` lint rule of [hfs/rules.yaml](hfs/rules.yaml), a CLI
  refusal) or is held by review, and this check is that review.

## Harness

| file | holds |
|---|---|
| [harness/rules.md](harness/rules.md) | the hard rules every role and task holds |
| [harness/axes.md](harness/axes.md) | edition (lite, full) and runner (orca, inline) |
| [harness/roles.md](harness/roles.md) | worker, Kernel, Supervisor, Debug and Owner: job, never, escalation |
| [harness/state.md](harness/state.md) | where harness state and product Work live, how a project is found, the bootstrap an app carries |
| [harness/decisions.md](harness/decisions.md) | the owner's harness decisions, each naming the file that implements it |
| [harness/cli-sections.md](harness/cli-sections.md) | generated by `starci contexts anatomy --execute`: every section of cli/README.md with its anchor, the index a harness task reads instead of the whole file |
| [harness/questions.md](harness/questions.md) | the open questions awaiting the owner |

## Authority

| file | holds |
|---|---|
| [authority/README.md](authority/README.md) | the role table (edit, commit, merge to main, push, publish, check tier) and the three tiers, for `inline` and `orca` alike |
| [authority/branch.md](authority/branch.md) | tier 1: what any branch or worktree runs, and never runs |
| [authority/wave.md](authority/wave.md) | tier 2: one scoped round on a merged tree, the scope decision first, reuse and repair |
| [authority/ci.md](authority/ci.md) | tier 3: CI's full suite, the npm publish of new versions, a red CI |
| [authority/packages.md](authority/packages.md) | package edits by apps, and Grammar edits as content only |

## The boundary model: four owners, one app

How app code is written: what an agent needs to decide how an app is built, and the data the gates and generators read
to hold it. It is product-agnostic and English only; a product's own records (requirements, brand direction, screen
records, worked examples) live in that product's `.starciwork`. Policy (which gates run, loosening, secrets, coverage)
is `policy/`, not this tree.

```
grammar package     a package that implements the grammar contract (grammars/contract.*): components, props,
  (code)            anatomy, variants, sizes, tokens and their values, the intent x placement map, root and overlay
                    mechanics. Grammars: `core` and `offset-pop`; an app picks one in hfs.json (sides.fe.grammar).
contexts            decision rules: WHEN and WHY. ui/ decides which component, rank, step, state; code/ decides
  (this tree)       where code lives and how it is shaped; hfs/ and stack/ are the shape and library data.
lint and gates      enforcement: the canon lint (universal), the grammar lint (the contract's API), the HFS checks,
  (code)            the parity gate. A context file cites a rule id; it never restates what a rule flags.
the app             product facts, data, copy keys, routes, and layout CSS on the boundaries it owns. Nothing else.
```

Every app is built from the grammar package plus this tree and must come out the same. A visual or structural choice
an app could make two ways is a gap: it is closed by a grammar API, a ui rule or a lint rule, never left to the app.
Adding a grammar means implementing the contract; nothing in `code/` or `ui/` changes.

## Three layers decide an interface

Every interface decision belongs to exactly one of three layers, and no layer does another's job:

1. **DNA, by the machine.** The grammar package gives the components and the constraints that make a grammar what it
   is (a label outside its card, a full-bleed divider, no surface inside a surface, the control height, chip padding
   equal to the vendor's), and the gates refuse a violation. These are constraints, never judgement; which constraints
   a grammar holds and which gate enforces each is owned by [grammars/README.md](grammars/README.md).
2. **Choice, by the authoring model.** Which component, variant and spacing step goes where is chosen by reading the
   "Choose" sections of [ui/components](ui/components/README.md) and the rules of [ui/](ui/README.md), and every
   choice cites the section it followed, so a choice with no citation is a defect, not a preference.
3. **Taste, by a different reviewer.** Whether the whole screen works is judged by a `review` task on a model other
   than the author's; its findings route back to the build ([ops/routes.yaml](../ops/routes.yaml)) and never stand
   in for a gate.

A choice that the machine could decide moves down to layer 1 as a gate ([project/lint.md](project/lint.md)
PROJECT-LINT-1); a choice only taste can settle stays out of layer 2 rules.

**Generation path for a screen:** read order below → the grammar's API for each role (contract, then the grammar
file) → the rules that choose (ui composition, components, scale; `code/fe` for the code) → write → lint and gates
prove it. An agent never re-derives what lint enforces and never invents an API the grammar lacks.

## Map

| Folder / file | Holds | Read by |
|---|---|---|
| [project/](project/README.md) | the map of one StarCi project: app root and sides, Work life cycle, [anatomy](project/anatomy.md) generated from slots, where lint applies, `.starcistacks`, lite and full differences | Kernel (through [project/index.md](project/index.md)), every op through its op file; `starci contexts anatomy` (its dry run, exit 1 on drift) keeps the anatomy in step |
| [ui/](ui/README.md) | universal interface decisions: composition, presentation, the size scale, one page per component role, proof | authoring agent (spec, draw, implement), auditor; [ui/proof/thresholds.yaml](ui/proof/thresholds.yaml) by the proof gate |
| [grammars/](grammars/README.md) | the grammar contract and why each grammar looks as it does; [contract.yaml](grammars/contract.yaml) as data | authoring agent, grammar author; the conformance gate reads `contract.yaml` |
| [vendor/](vendor/README.md) | what HeroUI ships and what a grammar must keep; [parity.yaml](vendor/parity.yaml), [wrappers.yaml](vendor/wrappers.yaml) | grammar author; the parity gate reads both |
| [code/](code/README.md) | code patterns per side: [fe](code/fe/README.md), [be](code/be/README.md) | authoring agent before coding a slot; a generator reads the front matter (`slots`, `files`) |
| [hfs/](hfs/README.md) | the app shape: [slots.yaml](hfs/slots.yaml) (tree, tiers, budgets, rule parameters), [rules.yaml](hfs/rules.yaml) (one-sentence laws) | the app checks, canon lint factories, architecture machine, templates; an agent resolving `R<n>` |
| [stack/](stack/README.md) | [fe.yaml](stack/fe.yaml) one library per front-end concern, [pins.yaml](stack/pins.yaml) exact versions | canon lint, pin gate, scaffolder |
| [decisions/](decisions/README.md) | [rulings.yaml](decisions/rulings.yaml), the one log of owner rulings; `open-*.md`, the owner's review queue | every author citing a decision; the owner |

Machine-read data, each with `schema: starci/<name>@<major>`: `grammars/contract.yaml`, `vendor/parity.yaml`,
`vendor/wrappers.yaml`, `ui/proof/thresholds.yaml`, `hfs/slots.yaml`, `hfs/rules.yaml`, `stack/fe.yaml`,
`stack/pins.yaml`, `decisions/rulings.yaml`, and the front matter of the code topics. Everything else is Markdown
reasoning for an agent.

## Reading order by task

| Task | Order |
|---|---|
| FE screen on a grammar | [ui/README](ui/README.md) → [ui/composition](ui/composition.md) and the [components](ui/components/README.md) it uses → [ui/scale](ui/scale.md) → [grammars/contract](grammars/contract.md) and the app's grammar file → [code/fe/README](code/fe/README.md) (the app's limits, the status recipe) → [ui.md](code/fe/ui.md), [function.md](code/fe/function.md), the topics of the slots touched → lint |
| Code, back end or front end | [code/README "Read for a coding task"](code/README.md#read-for-a-coding-task) (each coding op's `context.base` follows it); a screen reads the row above first |
| New dependency | [stack/fe.yaml](stack/fe.yaml) (or the be topic that owns the concern) → [stack/pins.yaml](stack/pins.yaml) |
| New pattern or rule | this file's house rules → the topic that owns the concept (extend it, never add a sibling) → [hfs/rules.yaml](hfs/rules.yaml) if a machine can decide it → a ruling in [decisions/rulings.yaml](decisions/rulings.yaml) when the owner decided it |
| New grammar | [grammars/contract](grammars/contract.md) → [vendor/parity.yaml](vendor/parity.yaml) → implement; nothing else changes |

## Feedback hardens

A feedback is absorbed by making the system stricter (CONTRIBUTING.md CONTRIB-7, rewritten where its concept lives by
CONTRIB-6). In order of preference it becomes: a grammar API that removes the choice; a lint, gate or threshold; or the
general rule rewritten in its one place. Each hardening records its ruling in [decisions/rulings.yaml](decisions/rulings.yaml). Every rule therefore has exactly one
place where a hardening lands: its own section (ui, patterns), its contract role, or its threshold key.

### When a rule was missed

A miss is a brief, plan, answer or change that went against a rule the tree holds. Whoever finds it closes it in one loop,
in the change that fixes the damage:

1. **Record it** as a question of the search eval (`cli/src/core/contexts/search-eval.json`): the question the agent should
   have asked, the anchors that answer it, and `miss` with the date, what happened, the causes and the anchors of the fix.
   `starci contexts search --eval` scores every recorded miss with the rest and is red while an expected or fix anchor is
   not in the index, so a miss stays measured after it is fixed.
2. **Name its causes**: `not-looked-up` (no lookup ran, or a compaction dropped the step), `ranked-low` (the lookup ran and
   the answer sat below the top 5), `not-in-core` (the seat's fixed core lacked a rule it cannot act without),
   `no-enforcer` (nothing refused the mistake) or `brief-paraphrase` (a brief restated a rule from memory, wrongly).
3. **Fix each cause where it lives.** `ranked-low`: rewrite the owning section so its heading and opening sentence carry the
   words the question used, until the eval ranks it in the top 5 (CONTRIB-6); `not-in-core`: promote the rule into the
   fixed core that seat reads (AGENTS.md for every host, the op's `context.base`, the coordinator brief); `no-enforcer`: a
   lint rule, an hfs check or a CLI refusal (CONTRIB-10); `not-looked-up` and `brief-paraphrase`: the lookup steps and the
   brief check of "Looking a rule up", or the brief that left them out. The record is the eval question; the fix is in
   its owner, never a lessons note (CONTRIB-7).

## House rules for editing contexts

Editing this tree follows [CONTRIBUTING.md](../CONTRIBUTING.md): one owner per fact (CONTRIB-4), present tense with no
ghosts (CONTRIB-5), and every change rewritten where its concept lives, never appended beside it (CONTRIB-6). What is
specific to contexts:

1. **Cite the code owner.** A value code owns (a token, a size, a lint rule, a component) is named by its owner
   (`owner: @starci/grammar src/common/spacing.ts`), never restated. No ruling id or date inside a rule; the id lives in
   `rulings.yaml`.
2. **Product-agnostic, English only.** No product names, locales as examples, or product records; those belong to the
   product's `.starciwork`.
3. **Shortest wording that keeps the reasoning.** State the rule, then why. No generated census copies, no prose
   that restates a lint rule (link its id).
4. **Markdown for reasoning, YAML for data.** YAML only when a machine reads it, with a `schema`. Every folder has a
   short README: what it holds, who reads it, reading order.
5. **How a ruling enters.** The owner decides; the decision is written as plain present-tense law in the file that owns
   the concept, and as one entry in `decisions/rulings.yaml` (id, date, ruling, owner of the fact). An agent's own
   choice that awaits the owner goes to the area's `decisions/open-*.md` with the alternative and the reason; when the
   owner confirms it, it moves to `rulings.yaml` and its row is deleted. A spelling that knowledge stops using is
   listed under `removedVocabulary` in the same file.
6. **Open gaps are listed.** Grammars and knowledge are under test; an open gap is listed where its concept lives, never
   papered over.
