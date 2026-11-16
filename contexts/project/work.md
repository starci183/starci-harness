# Work: the product context of a project

`.starciwork/` at the app root holds the product's Work: the concepts the owner ruled, the brand, and what a run of the
product resolves. It is product content, committed with the app; harness state never lives there
([contexts/harness/state.md](../harness/state.md)). Which paths the tree may hold is slot `app.starciwork` of
[hfs/slots.yaml](../hfs/slots.yaml); the edition decides how much of it exists ([lite.md](lite.md), [full.md](full.md)).
This file owns the tree, the concepts and who writes what.

## The tree

| path | schema | holds |
|---|---|---|
| `workspace.yaml` | `work/workspace@1` | the project id and its repositories as `{role, name}` (`be`, `fe`); the one place a side repository is named |
| `concepts/README.md` | Markdown, no schema | the concept catalog: one table row per concept, with the folders it is read for (PROJECT-WORK-7) |
| `concepts/<topic>.md` | Markdown, no schema | one concept: a topic of the product's persistent shared context (PROJECT-WORK-7) |
| `brand/index.yaml`, `brand/assets/**` | `work/brand@1` | the product's brand direction over its grammar's token names |
| `shell/index.yaml` | `work/layout-tree@1` | the app shell every screen sits in (full) |
| `_resources/{environments,identities,fixtures}/<name>/resource.yaml` | `work/resource@1` | what a run resolves: an environment's origins and allowed effects, an identity's provider and sealed custody (never a secret value), a fixture's seed (full) |

The tree keeps no per-feature documents and no catalog of features: what stays true across the product is a concept,
what one task must do is its contract ([README.md](README.md) PROJECT-2), and what was built is the code and its git
history. Slot `app.starciwork` admits no `features/` and no root `index.yaml` in either edition; a lite app that keeps
one is refused `HFS_STARCIWORK_LITE_FORBIDDEN` (R212), a full app's is held by review.

## PROJECT-WORK-4 An integration is designed from the provider's current documentation

Before an integration (BE-INFRA-3) is designed, its author reads the provider's current official documentation for the
intended use: the authentication, account, scope and lifecycle limits the provider supports, the callback or webhook
setup it needs (BE-WEBHOOK-1 … 4 build it), which prerequisites only the owner can provide, and the live verification
plan that proves the integration against the provider itself. What stays true of the provider goes into its concept
(PROJECT-WORK-7); the primary sources and the date they were read go into the contract of the task that builds it and
into that task's result. Missing research sends the work back to its author, never to the owner as a bare credential
request, and a credential that exists proves nothing about the provider; the live proof runs only when it is asked for
or before a release.

Why: a provider's behaviour changes under its own release cycle; a design from memory or an old example fails where
the current limits differ, and only a dated source shows when the design must be read again.

## PROJECT-WORK-5 Each writer writes only its part

| writer | writes |
|---|---|
| the Kernel (its own reasoning) or a `docs` task it sends; an app session outside a workflow | a concept and its catalog line once the owner ruled (PROJECT-WORK-7), the brand record, the shell, a resource |
| a `code` or `test` task | code, never Work; what it learned goes into its result for the Kernel to record |
| a `draw` or `image` task | a drawing or an image the brand record cites; never the record's direction |
| the owner | the rulings a concept records, and taste; the Kernel records them |

The harness writes nothing in `.starciwork`. A `docs` task names a scope inside the tree as its allowPaths
(`.starciwork/concepts`, `.starciwork/brand`), never the whole tree, held by review.

## PROJECT-WORK-7 A product's concepts hold its persistent shared context and are read before its code

A concept is one topic of what stays true across the whole source of a product: the words it defines, the shapes of its data, how
its things are named, the business rules it keeps, and the folders that hold them. It holds across the whole product.
Both editions keep them, as Markdown with no schema, in `.starciwork/concepts/`:

- `README.md` is the catalog: a table `| Concept | Read when you touch (folders) | One line |`, one row per concept. Every app's catalog
  lists a `conventions` concept, `conventions.md`: the app's own naming, keys and foreign key names, error classes and how it proves
  behaviour, the part of the generic rules it narrows (BE-PERSISTENCE-20, BE-RESILIENCE-2) in its own words. The scaffold renders it,
  and R433 (`HFS_CONCEPT_CONVENTIONS_MISSING`) refuses an app whose tree lacks it or whose catalog does not link it. A concept no
  row links, or a row whose concept is not tracked, is `HFS_CONCEPT_UNCATALOGUED` (R433; reported in `--env local`, blocking in
  `--env prod`): a reader finds concepts through the catalog, so an unlisted concept is never read. A passing catalog has one row per
  `<topic>.md`; a violating one leaves `payments.md` tracked with no row, or keeps the row of a deleted `billing.md`.
- `<topic>.md` is one concept, at most about sixty lines, under fixed headings in this order:

| heading | holds |
|---|---|
| `# <name>` | the topic's name and a summary of one or two lines |
| `## Terms` | each term and its one meaning, with *not to confuse with* where a nearby word misleads |
| `## Data` | the shapes, keys and life cycle of the things the topic defines, by name (when it has any) |
| `## Naming` | the patterns names follow, each with examples (when it has any) |
| `## Rules` | numbered: what must hold, and *why* |
| `## Example` | a few lines: an input and its result |
| `## Don't / Instead` | what is not done, and what is done in its place |
| `## Where` | the FOLDERS that hold the topic, never files |
| `Related:` | links to the concepts it reads |

- **Read first.** Before a requirement, a design, a contract, a plan or code of the product is written or changed, its author reads
  `.starcistacks/application-stacks.yaml` whole and the `.starcistacks/<env>/README.md` of each environment the work touches, then
  `concepts/README.md`, the `conventions` concept and the concept of every folder the work touches, and only then the code; a Kernel
  names them in the contract's `context.extend`, and a task that contradicts a declaration stops and asks the owner.
- **Only what persists.** A concept holds no history, decision log, progress, status or file path: those go stale with every commit
  and bury what stays true. History lives in git, a question that awaits the owner in [harness/questions.md](../harness/questions.md) or in the
  task's result until the owner rules.
- **Edited to the current truth.** When that shared context changes (a term gains a meaning, a shape a key, a rule a new must), the
  concept is edited to say what holds now, in the change that makes it so; nothing is appended beside the old sentence.
- **A contradiction is raised.** A request, a design, a note or code that contradicts a concept is put to the owner with the
  concept's name and both statements, and the contradicting part waits for the answer; nobody applies it silently.

Why: an agent that opens the code first rebuilds the product's words and rules from whatever files it happened to read, and two
agents rebuild them differently; a short page per topic, read first, gives every reader the same frame, and it stays short only
while it holds nothing that changes with each commit. The paths are admitted by slot `app.starciwork` (R212 holds the lite
boundary). No gate reads a concept's content: it and the reading before code are held by review; R433 checks only that the
`conventions` concept exists, the catalog links it and the catalog has one row per tracked concept. A `work/concept@1` record
(`concepts/index.yaml`, `concepts/<name>/index.yaml`) an app still keeps stays admitted; the app rewrites it as Markdown itself.

## Lanes

The brand and each environment resource walk a lane of steps, each a label ([ops/lanes.yaml](../../ops/lanes.yaml)):
the brand is decided once by `docs`, and an environment is delivered and reviewed. A step the record's evidence already
satisfies (its file exists, a green task over it) is skipped, and a workflow covering the record carries every other step
([cli/src/harness/lanes.ts](../../cli/src/harness/lanes.ts)).

## Read with

[README.md](README.md) (the life cycle this Work feeds), [anatomy.md](anatomy.md) (where `.starciwork` sits in the
tree), [stacks.md](stacks.md) (the environments a resource names), [lite.md](lite.md) and [full.md](full.md)
(how much of the tree an edition keeps), [lint.md](lint.md) (which of these facts a machine checks).
