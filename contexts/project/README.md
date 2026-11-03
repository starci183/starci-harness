# Project

What a StarCi project is, how a piece of product work travels from a record to a settled commit, and where to read
for each kind of task. It is product-agnostic: a product's own requirements, brand and screens are its `.starciwork`
records, never this folder. How the harness finds a project and where its state lives is [contexts/harness/state.md](../harness/state.md)
("How a project is found", "Where state lives"); this folder never restates it.

## PROJECT-1 A project is one app root that holds the Work of every side

A StarCi project is one **app root**: the git repository that owns `.starciwork/` and `hfs.json`. Its code has two
sides, the back end (`be`) and the front end (`fe`), laid out in one of two ways:

- **One repository.** `be/` and `fe/` are folders of the app root, and every root file (manifest, lockfile, CI,
  hooks, `.starciwork`, `.starcistacks`) lives once at the root ([anatomy.md](anatomy.md) owns the tree; the paths
  are slots of [hfs/slots.yaml](../hfs/slots.yaml)).
- **One repository per side.** The app root is the repository whose `.starciwork/workspace.yaml` lists the others
  by `{role, name}`; each side repository carries its own `hfs.json` and canon but no `.starciwork`.

Either way the app root holds the Work of every side: an fe screen, an fe implementation record and an fe UAT flow
are records of the app root's `.starciwork`, never of the fe repository. A side repository is still its own harness
project (its own git common dir, so its own ledger), so one task changes one repository: an fe code change and the
record change that follows it are two tasks.

`hfs.json` holds the choices an app makes once ([hfs/README.md](../hfs/README.md) owns its keys):

| choice | where | effect |
|---|---|---|
| edition | `edition`, `lite` or `full` (full when absent), fixed at scaffold | which slots and rules apply and which app verbs the CLI shows; [lite.md](lite.md), [full.md](full.md) |
| grammar | `sides.fe.grammar` | which grammar package and grammar lint the front end composes ([grammars](../grammars/README.md)) |
| module data | `modules`, `"data"` or absent | `"data"`: the agent modules are data (`.starcistacks/seeds/data/modules`); sync renders no registry package and the module verbs refuse `HFS_MODULES_ARE_DATA` |
| policy profile | `policy` | which canon stacks and gates run ([lint.md](lint.md); profiles and defaults are [policy/quality.yaml](../../policy/quality.yaml)) |

A profile left undeclared takes the default of its kind, so a side repository that is only `be` or only `fe`
declares `"policy": "be"` or `"policy": "fe"`; the key is `policy`, and any other spelling is not read.

## PROJECT-2 Work travels from a record to a settled commit

```text
Work record          .starciwork record: what must be true (fr, br, sds, contract, ui, uat ...), state todo
  -> contract        the Kernel (or the inline agent) writes one task contract per slice; a workflow file orders them
  -> op              a worker does the input inside allowPaths and dry-replays its own checks
  -> clean verify    the harness rebuilds HEAD plus allowPaths on a clean checkout and replays every check
  -> settle          green moves the branch to a harness commit of exactly those paths; red preserves and resets them
  -> Work state      the record's state, activity and evidence links follow what was settled
```

- **Record first.** A change of behaviour starts by editing the record that owns it ([work.md](work.md)); code and
  tests trace to records and never redefine them. A record's `requiresProof` names the commands that prove it; the
  Kernel carries them into the contract's `checks.extend`, beside the checks its op file holds as base.
- **Contract.** Its shape, presets and refusals are `starci explain` (`contract new`, `contract check`) and
  [README.md](../../README.md) "How it works"; a docs task names a scope inside `.starciwork` as its allowPaths, never the
  whole tree. A project whose clean checkout lacks generated code (GraphQL types, catalogs)
  declares the commands that produce it in the contract's `context.setup`; the clean verify runs them after install
  and before the checks, so a green never depends on a file only the worker's checkout had.
- **Op and verify.** The worker brief is the worker procedure of [ops/ops/README.md](../../ops/ops/README.md) followed
  by the label's op file; checks cover only what the task
  changed, and the full suite is CI's after the push ([contexts/harness/decisions.md](../harness/decisions.md)).
- **Settle and state.** Who writes a record's state and what counts as evidence is PROJECT-WORK-5 and PROJECT-WORK-6
  in [work.md](work.md).

## PROJECT-3 A product's agent modules are workspace packages

A product that builds agent modules keeps them as workspace packages at the app root, under `packages/` (root `workspaces`
lists `packages/*`): its agent SDK `packages/agent-sdk`, one package `packages/module-<name>` (`@<project>/module-<name>`) per
module, and the managed registry `packages/modules` (`@<project>/modules`) that lists them. A module package has the subpaths
`./template` and `./manifest` (React-free, for the back end), `./workbench` (drawn with Grammar alone) and `./public` (its public
face, for the front end) beside its `src/index.ts`; `starci app add module <name>` writes it and `starci app remove module <name>` reverses every step. The
registry, the root and front-end dependencies on it and the `build:modules` script are rendered by
`starci app sync`, so a hand edit is drift ([hfs/slots.yaml](../hfs/slots.yaml) slots `app.packages` and
`app.module-registry`). An app that declares `"modules": "data"` keeps its modules as seeds instead: sync renders no registry, a
`packages/modules` it still has is its own, and `add|remove module` refuse. A root package has no jest of its own: the managed `be/jest.config.js` names every root package but the registry
(a folder of `packages/` with a `package.json` and a `src/`), so the back end's unit run (`npm test`, `app check --gate test`, the CI
shards and their merged coverage proof) runs its specs and measures its logic, everything below its `src/` but its workbench, its public
face and its barrels, at 100 per file (BE-TEST-13), inside the Sonar and Codecov scope; the workbench and the public face are front ends,
judged by the front-end canon and the Grammar lint (FE-PACKAGES-2). The sides import a root package by its package name through the `exports` of its manifest and never
past them (`ARCH_INTERNAL_IMPORT_OUTSIDE`); no side config reaches `packages/`, so `starci app sync` renders the app root's
`eslint.config.mjs` (slot `app.packages-lint`) whenever a root package exists, and `starci app check --gate lint` runs it as a third
scope, on its own: a side whose linter does not complete is a tool error of that side and the packages are still judged, `--side packages`
limits the gate to them and the managed CI lints them in a job of the lint matrix beside `be` and `fe`. The scope applies the back-end canon over `packages/<pkg>/src/**` but the front-end subpaths, the front-end canon and the Grammar lint over
`src/workbench/**` (outside `src/workbench/contract/`, which is React-free and stays back end) and `src/public/**`, each with the rules of
its side over the package view of the app root. The project-graph rules judge the side folders and not the packages.

## Where to read for a task

| task | read, in order |
|---|---|
| write code (be or fe) | [code/README.md "Read for a coding task"](../code/README.md#read-for-a-coding-task), which starts with the anatomy slice of the side and edition (`anatomy-<edition>-<side>.md`) and opens this file and [lint.md](lint.md) on demand → the records the contract names |
| change UI | [contexts/ui](../ui/README.md) and the app's grammar ([grammars](../grammars/README.md)) → the `ui` record of the screen ([work.md](work.md)) → [code/fe](../code/fe/README.md) → [lint.md](lint.md) |
| write or change product records | [work.md](work.md) → the feature's `index.yaml` and the records it cites |
| run, stand up or deploy an environment | [stacks.md](stacks.md) → the edition file ([lite.md](lite.md) or [full.md](full.md)) |
| run UAT | the flow record (`features/<f>/uat/<flow>/index.yaml`) and [work.md](work.md) PROJECT-WORK-6 → [stacks.md](stacks.md) for the environment it names → `starci explain uat` |
| add a gate or a rule | [lint.md](lint.md) PROJECT-LINT-1 → [packages/README.md](../../packages/README.md) or [policy/](../../policy/) |

## Files

| file | holds |
|---|---|
| [README.md](README.md) | this map: what a project is, the life cycle, where to read |
| [anatomy.md](anatomy.md) | the tree of an app root and its sides, and what each part is for; its generated slices `anatomy-<edition>-<side>.md` (the app root and one side of one edition) are what a task of that side reads |
| [index.md](index.md) | generated: every file of `contexts/` with its size, first sentence, sections and ids, which a Kernel reads instead of the whole tree |
| [lint.md](lint.md) | each canon package and gate: where it applies and what kind of fact it enforces; the facts no machine checks yet |
| [check-cache.md](check-cache.md) | the committed result cache in `.starcistacks/cache/` (proposed): when a run is full or incremental on a host and in CI, the fingerprint, trust, which step reuses what |
| [cicd.md](cicd.md) | the delivery pipeline every app's `.github/` gets (proposed): triggers, checks, one attested image build, the automatic Swarm deploy with migrations, verification and rollback, records, gates |
| [stacks.md](stacks.md) | how an app runs: the `.starcistacks/` shape against project values, the dev and vps environments, ingress, sealed custody, the operations with their safety rules, local-run rules |
| [work.md](work.md) | the `.starciwork` record families, their state, who writes what, UAT flows and evidence |
| [lite.md](lite.md) | only what the lite edition does differently (backing services, patterns, infrastructure, deploy targets, CI, Work), each linked to its owner |
| [full.md](full.md) | only what the full edition does differently, in the same sections, each linked to its owner |
