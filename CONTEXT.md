# StarCi harness context

Read this file first, in this repository or in any app the harness drives. It names what to read for the task in
hand, where state lives, how a project is found and the rules no task may bend. Each fact it cites has its owner
file; this file points at the owner and never restates it.

The harness is one TypeScript CLI (`cli/`, the `starci` command) plus the data it reads: `ops/` (worker labels,
check presets, routing), `policy/` (gates and profiles), `knowledge/` (how app code is written), `packages/` (the
canon packages apps install) and `skills/starci/` (the agent entry for operating the harness). [STARCI.md](STARCI.md)
is the design and the owner's decisions; [README.md](README.md) is the overview.

## Load order

Read the files of your task's row, in order, before planning or editing. A task that spans rows reads each row.

| task | read |
|---|---|
| operate the harness: send a task, run a workflow, verify, push | `skills/starci/SKILL.md`, then `starci explain --term <group>` for the verbs you call |
| work as a worker on one task | the brief the harness rendered for the task ([ops/worker.md](ops/worker.md) is its template), then the contract it names |
| edit the harness itself (`cli/`, `ops/`, `policy/`, these documents) | [CONTRIBUTING.md](CONTRIBUTING.md), then the sections of [STARCI.md](STARCI.md) that own your surface |
| author app code or UI | `knowledge/README.md` and the knowledge files it routes you to; the app's own `hfs.json` and `.starciwork/` |
| change a gate, a profile, a banned marker or the secret scan | the file of [policy/](policy/) that owns it; the code of the gate is under `cli/src/core/check/` |
| change a canon package (lint, tsconfig, prettier, stylelint, jest) | [packages/README.md](packages/README.md), then the package's own README |

The verbs available in the working directory, with flags, effect and json schema, come from `starci explain`
(`--json` for machines). It is generated from the verb definitions and is the one list of commands.

## Two axes

- **Edition** (`lite` or `full`) is what an app is. It is fixed at scaffold in the app's `hfs.json` and selects the
  app verbs the CLI shows there.
- **Runner** (`orca` or `inline`) is how a task runs: an Orca worker seat, or the chat agent that is open doing the
  task itself. It is chosen per workflow or task, never by edition.

[STARCI.md](STARCI.md) "Decisions taken" owns both axes. `starci doctor` reports the tree the working directory
belongs to (`runtime`, `lite`, `full` or `none`).

## Where state lives

- **Harness state** lives under the runtime root (this checkout) in `.runtime/`, git-ignored: `machine.sqlite` for the
  host and `projects/<ledger_id>/` for each project's `runtime.sqlite`, briefs, contracts, outputs and preserved work.
  `STARCI_LOCAL_ROOT` replaces the whole state base and `STARCI_PROJECTS_ROOT` only `projects/`.
  `cli/src/harness/ledger.ts` owns every one of these paths.
- **Product Work** lives in the app repository's `.starciwork/` (Business/SRS, Architecture/SDS, `features/`,
  `workspace.yaml`), committed with the app. The harness never writes its state there.

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
