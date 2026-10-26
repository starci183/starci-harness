# Contributing to the harness

These rules hold for every edit of this repository: `cli/`, `ops/`, `policy/`, `knowledge/`, `packages/`, `skills/`
and the root documents. Read [CONTEXT.md](CONTEXT.md) first.

## Setup and the checks you run

Node 24 (`node:sqlite` unflagged). The CLI builds with `tsc` into `cli/dist`, which git never tracks.

```sh
cd cli
npm ci                  # also builds cli/dist (prepare)
npm run typecheck
npm run lint
npm run build
cd ..
node cli/dist/main.js check loosening
node cli/dist/main.js check secrets
```

`starci check run` runs the runtime tier of this repository's profile (`runtime`, declared in [hfs.json](hfs.json))
over the scope of your diff: secrets, loosening, typecheck and lint. A package under `packages/` is installed and
tested inside its own folder ([packages/README.md](packages/README.md) says how, including the two ESLint canons that
must be installed together).

## How a change is proved

- **The CLI keeps no spec suite.** A CLI change is proved by running the built CLI (`node cli/dist/main.js ...`)
  against a scratch git repository created under a temp directory, with `STARCI_LOCAL_ROOT` pointed at a temp state
  base. The proof is scoped to what the change touches; never run it inside a real project or this checkout's
  `.runtime/`. Do not add a test framework to `cli/`.
- **Packages keep their specs.** Each package under `packages/` proves itself with its own `node:test` specs
  (`npm test` in its folder). A rule change in a canon comes with the spec that holds it.
- **Test only what you changed.** The full suite is CI's, after the push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## One owner per fact

A fact, number, path, name or rule has exactly one owner; everything else reads it, cites it or is generated from it.
A second copy is a defect even while both agree.

| fact | owner |
|---|---|
| a verb: path, flags, effect, roles, json schema | its one `defineVerb({...})` file, listed in `cli/src/registry.ts`; `starci explain` prints it |
| worker labels, check presets, routing, failure bounds, budgets, liveness thresholds, the uat image | `ops/labels.yaml`, `ops/checks.yaml`, `ops/routing.yaml`, `ops/liveness.yaml`, `ops/uat.yaml` |
| the worker brief | [ops/worker.md](ops/worker.md) |
| gate tiers, profiles, project overlays, banned markers, the secret scan's configuration | the files of [policy/](policy/README.md), mapped by its README |
| what each gate and marker detects | `cli/src/core/check/` and `cli/src/shared/secrets.ts` |
| every state path | `cli/src/harness/ledger.ts` |
| task states and their transitions | `TRANSITIONS` in `cli/src/harness/tasks.ts`, changed only through `setStatus` |
| how the CLI is built, the verb standard, how the harness inside it works (ledgers, settling, graph, seat launch) | [cli/README.md](cli/README.md), naming the code that implements each |
| load order, binding, roles, hard rules, the owner's harness decisions, open questions | [CONTEXT.md](CONTEXT.md) |
| what the harness is, how it works, the verb groups, CI | [README.md](README.md) |
| how app code is written | [knowledge/](knowledge/README.md) |
| a knowledge ruling | [knowledge/decisions/rulings.yaml](knowledge/decisions/rulings.yaml) |

When you find a copy, keep the owner, make the other site read or cite it, and delete the copy in the same commit. If
no owner exists yet, create it first. Never answer a duplicate with an allowlist, a baseline or a suppression.

## Writing rules and prose

1. **Present tense, no ghosts.** Describe the tree as it is. Do not define something by the state it replaced; history
   lives in git.
2. **Replace, never append.** An edit rewrites the sentence that holds the rule. One concept has one paragraph, and it
   is the latest version.
3. **Feedback hardens.** Owner feedback becomes the rule rewritten in its owning file, a check, or a code change. It never
   becomes a case note beside a rule or a "lessons" section. The decision itself is recorded once: a harness decision in
   [CONTEXT.md](CONTEXT.md) "Decisions", a knowledge ruling in [knowledge/decisions/rulings.yaml](knowledge/decisions/rulings.yaml).
   No design document sits beside the owners: plans, phases and history live in git, not in a file.
4. **Claims execute.** A sentence that says something refuses, validates or is enforced names code that does it. If the
   code does not, fix the code or remove the claim.
5. **Data is data.** `ops/` and `policy/` hold declarative YAML the CLI validates; a key no code reads is deleted.
   Numbers live there once and are never repeated in prose.
6. **Gates before rules.** Prefer a check that refuses the mistake over a sentence that forbids it; a rule with no gate
   says it is held by review.

## Code rules

- ESLint `strictTypeChecked` plus `stylisticTypeChecked` with `noInlineConfig`. Never `eslint-disable`, `ts-ignore`,
  `as any`, `NOSONAR`, a skipped check, `|| true` or `--no-verify`. Change the code, not the gate; an unavoidable marker
  is an exception in `policy/loosening.yaml` with its reason, never inline.
- A verb is one `defineVerb` in its own file. Refusals throw `Refusal(code, message)`; a red verdict returns exit code 1.
- Host processes run without a shell through `cli/src/shared/exec.ts`; git goes through `cli/src/shared/git.ts`.
- Style: 4-space indent, no semicolons, double quotes, a one-line JSDoc on every export, comments only where they carry a
  rule. No new dependency without a reason the owner accepts.
- Line endings are LF (`.gitattributes`).

## Removed vocabulary

These legacy terms do not reappear in source, data or documents. The list is held by review; the legacy runtime's
analysis notes under `docs/knowledge-analysis/` may quote them.

| removed | instead |
|---|---|
| op manifests, op kinds (`request.analyze`, `review.verify`, `code.fix`, ...), `route op`, the ops registry | one worker brief; the Kernel writes each contract; a label is a routing hint |
| ops as planners (an op that analyses, scopes or decides) | planning and decisions are the Kernel's own work |
| the Critic role, independent reviewers | machine checks in `expectedOutput`; taste goes to the owner ("CI is the critic" names CI after a push) |
| `observe`, `nudge`, `redesign`, Kernel verbs that watch an op's terminal | the task protocol: contract, result, `task verify`; liveness by ping and pong |
| `starci kernel <command>`, `driver-loop`, `settle` as a verb | `task send/result/verify`, `workflow step` |
| the reconciler and its controllers | one host daemon for seat liveness and sweeps (not built yet) |
| the `starci` grammar family, `heritage` | grammars `core` and `offset-pop` |
| `examples/`, example apps, example re-pins | scratch-repository proofs; packages keep their specs |
| the ledger in the app at `<app>/.starciwork/runtime.sqlite` | `<runtime root>/.runtime/projects/<ledger_id>/runtime.sqlite` |
| `.workspaces/projects/<project>/work.json` binding, `<Source>` host binding | the git common dir looked up in `machine.sqlite` `ledgers` |
| `define-goal`, `start-kernel` skills | `workflow define` and `workflow start` |
| `runtime verify`, `gate run`, `release clean-test`, `scaffold-e2e` | `check run` before a push; CI runs the suites |
| the edition decides who codes (lite by chat, full by ops) | the runner (`orca` or `inline`) is chosen per workflow or task |
| the qualification and probation store, admission reason codes | the router of `ops/routing.yaml` |
| `STARCI.md`, a design document of decisions, plans and phases | each fact in its owner ("One owner per fact"); decisions in CONTEXT.md "Decisions" |

## Commit and push

- Work in your own worktree on your own branch. Never stash, reset, force or switch branches in a checkout holding
  someone else's work; two agents never write the same files.
- Commit with hooks, in small commits whose message says what the change does.
- Main is pushed right after a green scoped check: run `starci check run` on your diff, then `starci release push`
  (it refuses a dirty tree, a non fast-forward and a secret in the pushed range). CI judges everything else.
- A red CI is fixed by the next commit, scoped to the red checks (`starci release ci-status` names them). It does not
  block the next push.
- Publishing packages happens in CI on a `v*` tag, with the owner's approval.
