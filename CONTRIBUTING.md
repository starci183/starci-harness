# Contributing to the harness

These rules hold for every edit of this repository: `cli/`, `ops/`, `policy/`, `contexts/`, `packages/`, `skills/`
and the root documents. Read [contexts/README.md](contexts/README.md) first. Each rule is a heading with a stable id (`CONTRIB-<n>`), so
a task on the harness itself cites the ids it applied in its `rulesApplied`.

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

### CONTRIB-1 The CLI keeps no spec suite

A CLI change is proved by running the built CLI (`node cli/dist/main.js ...`) against a scratch git repository created
under a temp directory, with `STARCI_LOCAL_ROOT` pointed at a temp state base. The proof is scoped to what the change
touches; never run it inside a real project or this checkout's `.runtime/`. Do not add a test framework to `cli/`.

### CONTRIB-2 Packages keep their specs

Each package under `packages/` proves itself with its own `node:test` specs (`npm test` in its folder). A rule change
in a canon comes with the spec that holds it.

### CONTRIB-3 Test only what you changed

The full suite is CI's, after the push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## CONTRIB-4 One owner per fact

A fact, number, path, name or rule has exactly one owner; everything else reads it, cites it or is generated from it.
A second copy is a defect even while both agree.

| fact | owner |
|---|---|
| a verb: path, flags, effect, roles, json schema | its one `defineVerb({...})` file, listed in `cli/src/registry.ts`; `starci explain` prints it |
| a label: its base context, inputs, output keys and checks, floor, host tools and procedure | its op file `ops/ops/<label>.md` |
| the op pattern (base and extend) and the worker procedure common to every brief | [ops/ops/README.md](ops/ops/README.md) |
| check presets, routing, failure bounds, budgets, liveness thresholds, the uat image | `ops/checks.yaml`, `ops/routing.yaml`, `ops/liveness.yaml`, `ops/uat.yaml` |
| the map of ops/, the router's steps, failure classes and their accounting | [ops/README.md](ops/README.md) |
| gate tiers, profiles, project overlays, banned markers, the secret scan's configuration | the files of [policy/](policy/README.md), mapped by its README |
| what each gate and marker detects | `cli/src/core/check/` and `cli/src/shared/secrets.ts` |
| every state path | `cli/src/harness/ledger.ts` |
| task states and their transitions | `TRANSITIONS` in `cli/src/harness/tasks.ts`, changed only through `setStatus` |
| how the CLI is built, the verb standard, how the harness inside it works (ledgers, settling, graph, seat launch) | [cli/README.md](cli/README.md), naming the code that implements each |
| load order | [contexts/README.md](contexts/README.md) |
| axes, roles, where state lives and how a project is found, hard rules, the owner's harness decisions, open questions | one file each in [contexts/harness/](contexts/README.md#harness) |
| what the harness is, how it works, how to install it, the verb groups, CI | [README.md](README.md) |
| how a release is published and the secret it needs | CONTRIB-20 below |
| what each CLI release changed | [CHANGELOG.md](CHANGELOG.md); a package's, its own `CHANGELOG.md` |
| how to report a vulnerability; the conduct expected | [SECURITY.md](SECURITY.md); [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| how app code is written | [contexts/](contexts/README.md) |
| a knowledge ruling | [contexts/decisions/rulings.yaml](contexts/decisions/rulings.yaml) |

When you find a copy, keep the owner, make the other site read or cite it, and delete the copy in the same commit. If
no owner exists yet, create it first. Never answer a duplicate with an allowlist, a baseline or a suppression.

## Writing rules and prose

### CONTRIB-5 Present tense, no ghosts

Describe the tree as it is. Do not define something by the state it replaced; history lives in git.

### CONTRIB-6 Rewrite the concept where it lives

A change is a change to a concept, never a line added beside the rules that already hold it. Before editing, read the
harness for that concept, then:

1. **Name it.** Write down the concept the change touches and every term, rule id and synonym it goes by.
2. **Find every place it lives.** Search the whole tree for those terms (`contexts/`, `ops/`, `policy/`, `skills/`,
   `cli/src/`, `cli/README.md`, the root documents) and read each hit in its paragraph, not as a line.
3. **Rewrite those places.** Rules A, B, C and D that the change touches become A', B', C' and D', so the general rule is
   true with the change. A new sentence is written only when the concept had no home, and then in its owner (CONTRIB-4).
4. **No case notes.** Never answer a change with an exception beside the old rule: "if E then E'", "except", "note",
   "also", a bullet that narrows or contradicts an existing one, or a second section for the same concept. A carve-out the
   owner rules is written into the general sentence itself.
5. **Code the same way.** A fix lands in the function that owns the behaviour, not as a guard at a caller that patches one
   symptom, and the path it makes dead is deleted in the same commit.
6. **Show the search.** The commit message lists the places found and how each changed, or why it stays.

Appended cases contradict silently: a reader takes the first sentence and never meets the second, and the tree grows
without becoming truer. Held by review.

### CONTRIB-7 Feedback hardens

Owner feedback becomes the rule rewritten in its owning file, a check, or a code change. It never becomes a case note
beside a rule or a "lessons" section. The decision itself is recorded once: a harness decision in
[contexts/harness/decisions.md](contexts/harness/decisions.md), a knowledge ruling in [contexts/decisions/rulings.yaml](contexts/decisions/rulings.yaml). No design
document sits beside the owners: plans, phases and history live in git, not in a file.

### CONTRIB-8 Claims execute

A sentence that says something refuses, validates or is enforced names code that does it. If the code does not, fix the
code or remove the claim.

### CONTRIB-9 Data is data

`ops/` and `policy/` hold declarative YAML (and the op files' front matter) the CLI validates; a key no code reads is
deleted. Numbers live there once and are never repeated in prose.

### CONTRIB-10 Gates before rules

Prefer a check that refuses the mistake over a sentence that forbids it; a rule with no gate says it is held by review.

## Code rules

### CONTRIB-11 No loosening

ESLint `strictTypeChecked` plus `stylisticTypeChecked` with `noInlineConfig`. Never `eslint-disable`, `ts-ignore`,
`as any`, `NOSONAR`, a skipped check, `|| true` or `--no-verify`. Change the code, not the gate; an unavoidable marker
is an exception in `policy/loosening.yaml` with its reason, never inline.

### CONTRIB-12 One verb, one file

A verb is one `defineVerb` in its own file. Refusals throw `Refusal(code, message)`; a red verdict returns exit code 1.

### CONTRIB-13 No shell

Host processes run without a shell through `cli/src/shared/exec.ts`; git goes through the one runner in `cli/src/shared/git.ts`.

### CONTRIB-14 House style

4-space indent, no semicolons, double quotes, a one-line JSDoc on every export, comments only where they carry a rule.
No new dependency without a reason the owner accepts. Line endings are LF (`.gitattributes`).

## CONTRIB-15 Removed vocabulary

These legacy terms do not reappear in source, data or documents. The list is held by review; the legacy runtime's
analysis notes under `docs/knowledge-analysis/` may quote them.

| removed | instead |
|---|---|
| op manifests, op kinds (`request.analyze`, `review.verify`, `code.fix`, ...), `route op`, the ops registry | one op file per label, `ops/ops/<label>.md`, owning the base; the Kernel's contract extends it |
| `ops/labels.yaml`, `ops/worker.md`, a contract's `expectedOutput` and `readPaths` | the op files and their README; a contract@2's checks and context, base ∪ extend (the contract@1 reader in `cli/src/harness/contract.ts` still names them) |
| ops as planners (an op that analyses, scopes or decides) | planning and decisions are the Kernel's own work |
| the Critic role, independent reviewers | the contract's machine checks (base ∪ extend); taste goes to the owner ("CI is the critic" names CI after a push) |
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
| the qualification and probation store, admission reason codes | qualification the router derives from member outcomes (`qualification` of `ops/routing.yaml`) |
| a workflow or task pin (`agent`, `model`, `effort`), a routing bias (`only`, `avoid`, `prefer`), `ROUTE_BIAS_EMPTY` | the router alone picks, from a task's label, `difficulty` and `risk` |
| one Supervisor per host, a `[Supervisor]` title with no project | one `[Supervisor] <project>` per project (`project_supervisors`); a version-2 host store's `supervisors` table is read only to adopt its workflows |
| `STARCI.md`, a design document of decisions, plans and phases | each fact in its owner ("One owner per fact"); decisions in contexts/harness/decisions.md |

## Commit and push

### CONTRIB-16 Your own worktree

Work in your own worktree on your own branch. Never stash, reset, force or switch branches in a checkout holding someone
else's work; two agents never write the same files.

### CONTRIB-17 Small commits with hooks

Commit with hooks, in small commits whose message says what the change does.

### CONTRIB-18 Push after a green scoped check

Main is pushed right after a green scoped check: run `starci check run` on your diff, then `starci release push` (it
refuses a dirty tree, a non fast-forward and a secret in the pushed range). CI judges everything else.

### CONTRIB-19 A red CI is the next commit

A red CI is fixed by the next commit, scoped to the red checks (`starci release ci-status` names them). It does not
block the next push.

### CONTRIB-20 Publishing is CI's

Nothing is published from a workstation. A `v*` tag, pushed with the owner's approval, runs the `publish` job of
[.github/workflows/ci.yml](.github/workflows/ci.yml): it publishes the CLI (`starci-harness`, from `cli/`) and every
package under `packages/` whose version is not on npm yet, skipping a private one, with npm provenance, under the
dist-tag a prerelease version names (`1.0.0-alpha.1` goes to `alpha`, a plain version to `latest`). A release raises
the version in the package's `package.json` and adds its entry to its CHANGELOG (the CLI's is
[CHANGELOG.md](CHANGELOG.md)) before the tag.

The job reads one repository secret, `NPM_TOKEN`: an npm granular access token with read and write on the
`starci-harness` package and the `@starci` scope (or an automation token of the publishing account). The owner adds it
once, and again when it expires, with `gh secret set NPM_TOKEN --repo starci183/starci-harness`, pasting the token at
the prompt; it is never written to a file, a command line or this repository.
