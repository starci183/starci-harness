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
  [README.md](../../README.md) "How it works"; a docs task leases a scope inside `.starciwork`, never the
  whole tree. A project whose clean checkout lacks generated code (GraphQL types, Supabase row types, catalogs)
  declares the commands that produce it in the contract's `context.setup`; the clean verify runs them after install
  and before the checks, so a green never depends on a file only the worker's checkout had.
- **Op and verify.** The worker brief is the worker procedure of [ops/ops/README.md](../../ops/ops/README.md) followed
  by the label's op file; checks cover only what the task
  changed, and the full suite is CI's after the push ([contexts/harness/decisions.md](../harness/decisions.md)).
- **Settle and state.** Who writes a record's state and what counts as evidence is PROJECT-WORK-5 and PROJECT-WORK-6
  in [work.md](work.md).

## Where to read for a task

| task | read, in order |
|---|---|
| write code (be or fe) | [code/README.md "Read for a coding task"](../code/README.md#read-for-a-coding-task), which starts with this file, the anatomy slice of the side and edition (`anatomy-<edition>-<side>.md`) and [lint.md](lint.md) → the records the contract names |
| change UI | [contexts/ui](../ui/README.md) and the app's grammar ([grammars](../grammars/README.md)) → the `ui` record of the screen ([work.md](work.md)) → [code/fe](../code/fe/README.md) → [lint.md](lint.md) |
| write or change product records | [work.md](work.md) → the feature's `index.yaml` and the records it cites |
| run, stand up or deploy an environment | [stacks.md](stacks.md) → the edition file ([lite.md](lite.md) or [full.md](full.md)) |
| run UAT | the flow record (`features/<f>/uat/<flow>/index.yaml`) and [work.md](work.md) PROJECT-WORK-6 → [stacks.md](stacks.md) for the environment it names → `starci explain --term uat` |
| add a gate or a rule | [lint.md](lint.md) PROJECT-LINT-1 → [packages/README.md](../../packages/README.md) or [policy/](../../policy/) |

## Files

| file | holds |
|---|---|
| [README.md](README.md) | this map: what a project is, the life cycle, where to read |
| [anatomy.md](anatomy.md) | the tree of an app root and its sides, and what each part is for; its generated slices `anatomy-<edition>-<side>.md` (the app root and one side of one edition) are what a task of that side reads |
| [index.md](index.md) | generated: every file of `contexts/` with its size, first sentence, sections and ids, which a Kernel reads instead of the whole tree |
| [lint.md](lint.md) | each canon package and gate: where it applies and what kind of fact it enforces; the facts no machine checks yet |
| [stacks.md](stacks.md) | how an app runs: the `.starcistacks/` shape against project values, the dev and vps environments, ingress, sealed custody, the operations with their safety rules, local-run rules |
| [work.md](work.md) | the `.starciwork` record families, their state, who writes what, UAT flows and evidence |
| [lite.md](lite.md) | only what the lite edition does differently (backing services, patterns, infrastructure, deploy targets, CI, Work), each linked to its owner |
| [full.md](full.md) | only what the full edition does differently, in the same sections, each linked to its owner |
