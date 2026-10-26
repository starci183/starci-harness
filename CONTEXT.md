# StarCi harness context

Read this file first, in this repository or in any app the harness drives. It names what to read for the task in
hand, where state lives, how a project is found, the rules no task may bend, the owner's harness decisions and the
open questions. Each fact it cites has its owner file; this file points at the owner and never restates it.

The harness is one TypeScript CLI (`cli/`, the `starci` command) plus the data it reads: `ops/` (worker labels,
check presets, routing), `policy/` (gates and profiles), `knowledge/` (how app code is written), `packages/` (the
canon packages apps install) and `skills/starci/` (the agent entry for operating the harness). [README.md](README.md)
is the overview and says how it works.

## Load order

Read the files of your task's row, in order, before planning or editing. A task that spans rows reads each row.

| task | read |
|---|---|
| operate the harness: send a task, run a workflow, verify, push | `skills/starci/SKILL.md`, then `starci explain --term <group>` for the verbs you call |
| work as a worker on one task | the brief the harness rendered for the task ([ops/worker.md](ops/worker.md) is its template), then the contract it names |
| edit the harness itself (`cli/`, `ops/`, `policy/`, these documents) | [CONTRIBUTING.md](CONTRIBUTING.md), then the owner of your surface: [cli/README.md](cli/README.md), [policy/README.md](policy/README.md), the header of the `ops/` file you change, and "Decisions" below |
| author app code or UI | [knowledge/README.md](knowledge/README.md) and the knowledge files it routes you to; the app's own `hfs.json` and `.starciwork/` |
| change a gate, a profile, a banned marker or the secret scan | [policy/README.md](policy/README.md) and the file it names; the code of the gate is under `cli/src/core/check/` |
| change a canon package (lint, tsconfig, prettier, stylelint, jest) | [packages/README.md](packages/README.md), then the package's own README |

The verbs available in the working directory, with flags, effect and json schema, come from `starci explain`
(`--json` for machines). It is generated from the verb definitions and is the one list of commands.

## Two axes

- **Edition** (`lite` or `full`) is what an app is. It is fixed at scaffold in the app's `hfs.json` and selects the
  app verbs the CLI shows there. Lite is stateless on Postgres and puts the canonical patterns first; full adds the
  reactor, saga and projection patterns and its own infrastructure.
- **Runner** (`orca` or `inline`) is how a task runs, chosen per workflow or task, never by edition. `orca` launches a
  worker seat through Orca, so tasks run in parallel. `inline` means the Claude or Codex session that is open does the
  task itself, one at a time.

Both editions get both runners, with the same contracts, leases, clean verify and harness commit. Inline, the agent is
both Kernel and worker, so its contract is sent (and its hash fixed) before it edits code, and the harness verify on a
clean checkout decides green; liveness applies only to the `orca` runner. `starci doctor` reports the tree the working
directory belongs to (`runtime`, `lite`, `full` or `none`).

## Roles

The Kernel never reads a worker's terminal: it sends work as a contract (context, input, `expectedOutput`) and judges
the result with `starci task verify`. A role's rights come from each verb's `effect` and `roles`
([cli/README.md](cli/README.md) "The verb standard" says when they are enforced).

| role | job | never | escalates to |
|---|---|---|---|
| worker (an Orca seat, or the inline chat agent) | one task, until its output meets `expectedOutput`, writing only its `allowPaths` | commit, push, merge into main, change its contract, ask the owner | Kernel: `blocked` or `mismatch` |
| Kernel, one per workflow | plan (analyze the request, bound the scope, write every contract and the workflow file), make provisional business and architecture choices, send, step, verify, amend, and finish with a handover for owner acceptance | write product code under the `orca` runner, read a worker's terminal, push main | Supervisor: a task beyond a worker |
| Supervisor, one per host (seat not built yet) | the owner channel, tasks beyond a worker, owner asks (credentials, accounts), host and runtime operation, scope amends, landing on main with `release push`, turning a red CI into a scoped `code` contract | write product code, bend a gate, publish without the owner | Owner |
| Debug (seat not built yet) | diagnose a harness or environment failure, read-only, never task content | edit code, change rules, run a writing verb | Supervisor: the diagnosis and a repair contract |
| Owner | taste and UX acceptance, decisions, approval of public actions | | |

## Where state lives

- **Harness state** lives under the runtime root (this checkout) in `.runtime/`, git-ignored: `machine.sqlite` for the
  host and `projects/<ledger_id>/` for each project's `runtime.sqlite`, briefs, contracts, outputs and preserved work.
  `STARCI_LOCAL_ROOT` replaces the whole state base and `STARCI_PROJECTS_ROOT` only `projects/`.
  `cli/src/harness/ledger.ts` owns every one of these paths; [cli/README.md](cli/README.md) "The harness inside the
  CLI" lists their tables.
- **Product Work** lives in the app repository's `.starciwork/` (Business/SRS, Architecture/SDS, `features/`,
  `workspace.yaml`), committed with the app. The harness never writes its state there, never ignores it and never
  strips it from a candidate: a docs task leases a scope inside it (`.starciwork/features/<f>`), and only the whole
  tree as an `allowPaths` entry is refused, as `.` is.

## How a project is found

A project is a git repository, identified by its git common dir (`git rev-parse --git-common-dir`), so every linked
worktree of one repository shares one ledger. The host registry, `machine.sqlite` table `ledgers`, maps the common dir
to a `ledger_id` (`<main checkout name>-<hash>`), minted on the first writing verb; read verbs create nothing. A
folder outside git is a project of its own, keyed by its path. No binding file is read: an app carries no copy of the
harness, no `.workspaces` mapping and no ledger.

The nearest `hfs.json` (searched up to the repository root) says what the tree is: `kind` (`runtime` or an app), the
app's `edition`, and the `policy` profile its gates run under (`policy/quality.yaml` owns the profiles and the default
of each kind). This repository's own [hfs.json](hfs.json) declares the runtime.

An app driven by the harness points its agents here from its own `AGENTS.md` or `CLAUDE.md`, with the absolute path of
this checkout:

```text
Before planning or editing, read <harness>/CONTEXT.md and follow its load order. Run the harness as
`node <harness>/cli/dist/main.js` (or `starci` when linked). Harness state lives under <harness>/.runtime,
never in this repository; this repository's .starciwork/ is product Work only.
```

When you delegate or change directory, pass the harness path and the project root on explicitly: a task opened in
another folder does not inherit them.

## Hard rules

These hold for every role and every task. A rule with a gate names it; the others are held by review.

1. **No secret is read, printed or committed.** Never open a file that `policy/security.yaml` `neverRead` lists
   (`.env`, keys, credentials); judge it by name. Never echo a token. `starci check secrets` and `release push` scan
   for leaks; this repository is public and tracks no secret envelope.
2. **No loosening.** No inline disable, `ts-ignore`, `NOSONAR`, skipped or focused test, `|| true`, `--no-verify` or
   widened allowlist. Change the code, not the gate. `starci check loosening` reads the tree as it stands; an
   exception lives only in `policy/loosening.yaml`, one file, one marker and the reason.
3. **No stash, force or reset in a dirty tree.** Never `git stash`, `reset --hard`, `checkout -- .`, `clean -f`, a
   force push or a branch switch in a checkout that holds someone's uncommitted work. Work in your own worktree.
4. **Two tools never touch the same files.** Parallel agents, seats or tools write disjoint paths; the harness enforces
   it for tasks with path leases (`LEASE_CONFLICT`). A defect found outside your paths goes into your report.
5. **Public actions need the owner's approval.** Publishing a package (`release publish --publish`), deploying, and
   anything posted outside the repository wait for the owner's yes. Pushing main after a green scoped check follows
   [CONTRIBUTING.md](CONTRIBUTING.md).
6. **No examples.** The harness ships no example apps and no `examples/` tree. A behaviour is proved by running the
   built CLI against a scratch repository; a package keeps its own specs.
7. **Machine actions are the harness's.** An agent never installs Playwright or browsers, or runs Docker by hand: a
   `uat` worker writes a short Playwright script and calls `starci uat run`, which runs it in the image pinned in
   [ops/uat.yaml](ops/uat.yaml) and keeps the playwright package inside that image, never in the product.

## Decisions

The owner's harness decisions, as present-tense rulings, each naming the file that implements it. A knowledge ruling
goes to [knowledge/decisions/rulings.yaml](knowledge/decisions/rulings.yaml) instead.

- **One CLI.** The harness is one TypeScript CLI on `commander`, with no framework; `starci explain`, generated from
  the verb definitions, is the one list of commands ([cli/README.md](cli/README.md)).
- **Ops are plain workers.** Every task runs the one brief, [ops/worker.md](ops/worker.md); there is no catalog of op
  kinds. The Kernel writes each contract, and a label of [ops/labels.yaml](ops/labels.yaml) is a routing hint plus
  default checks, composed from the presets of [ops/checks.yaml](ops/checks.yaml).
- **Op pattern: `base` and `extend`.** Each label has one op file, `ops/ops/<label>.md`, owning the base of a task's
  context, input, output and checks; the Kernel's contract only extends it, and the output carries the trace of what
  the op read. [ops/ops/README.md](ops/ops/README.md) owns the mechanics and names the code that enforces them.
- **Project pattern.** `knowledge/project/` is the map of a StarCi project: the app root owning `.starciwork`, its
  sides, the `hfs.json` choices, the Work life cycle, the anatomy generated from slots, where lint applies, the
  `.starcistacks` shape and the lite and full differences. It links each fact to its owner and restates none.
- **Machine checks only.** A contract's `expectedOutput` holds only checks a machine runs (`command`, `starci`,
  `files`, `json`, `probe`), and a label with `requireBehavioural` refuses a contract without a behavioural check.
  Anything no machine can judge (taste, UX) is an owner review step, never part of a contract.
- **Tests stay inside the task; CI judges the rest.** A contract's checks cover only what the task changed: the scoped
  `check run`, the tests related to the changed files (never a whole suite) and `paths-only`. A `verify` worker runs a
  heavy suite only when the goal itself is that suite. CI runs the full suite on main after the push; a red CI becomes
  a `code` contract scoped to the red checks and never blocks the next push.
- **Policy selects; code and canon enforce.** [policy/](policy/README.md) picks the gates and configures them; every
  rule lives once, in the CLI or a canon package.
- **One CI workflow.** [.github/workflows/ci.yml](.github/workflows/ci.yml) gates every push and pull request to main
  and publishes on a `v*` tag ([README.md](README.md) "CI"); its tokens live only in GitHub secrets.

## Open questions

1. **Worktree model.** Built: one workflow worktree, path leases keep parallel tasks disjoint, and the harness commits
   a task's paths when its verify is green. A lane per task isolates better but needs an install and a merge per lane.
   Does the owner confirm the shared worktree?
2. **`pattern` verbs:** their own group, or inside `app`?
3. **Package name:** keep `@starci/cli` at 2.x, or a new name while the legacy CLI still runs?
4. **Who pushes.** A worker never pushes, yet `release push` is a core verb of both editions (roles today: owner,
   release, coordinator, lead). Does pushing stay a core verb a role may be granted, or move to the Supervisor, and
   then how does a lite chat agent (role `agent`) push?
5. **Secret scan reach.** The scan carries the provider shapes, forbidden paths and the quoted keyword assignment, not
   the unquoted dotenv form, SQL role passwords or badge-token exemptions. Add them, or accept the gap?
6. **Replan owner gate.** When a replan drops or redoes more than a threshold, should the Kernel hold it for the
   owner's yes before resuming, and at what threshold?
7. **A lingering red CI.** Fix forward only, as today, or revert the red commit automatically after N minutes?
8. **Worker guard.** A worker has full Bash: should a PreToolUse guard refuse dangerous commands, beside the
   `allowPaths` diff at settle and the secret scan at push?
9. **Placing a feature across running workflows.** Should the Supervisor place it by a path-ownership map kept as data,
   amending only the workflows that own the touched paths, with the model deciding only what the map cannot place?
