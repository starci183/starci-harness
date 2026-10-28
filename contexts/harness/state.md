# Where state lives and how a project is found

## Where state lives

- **Harness state** lives under the runtime root (this checkout, or the folder of an installed `starci-harness`
  package) in `.runtime/`, git-ignored: `machine.sqlite` for the
  host (the ledger registry, provider health, every project's Supervisor and the package edits handed to Debug) and
  `projects/<ledger_id>/` for each repository's `runtime.sqlite`, coordinator briefs, contracts, outputs, preserved work,
  the prior-work store (`prior/<sha256>.patch`) and, while the repository takes `@starci` packages from a local folder,
  `deps-local.json` (`starci deps source --local`). Package edit branches live in worktrees under the harness checkout's
  `.claude/worktrees/` (`starci pkg branch`), never in its main checkout.
  `STARCI_LOCAL_ROOT` replaces the whole state base and `STARCI_PROJECTS_ROOT` only `projects/`; under `npx`, whose
  package folder is a cache, `STARCI_LOCAL_ROOT` is what keeps the ledgers.
  `cli/src/harness/ledger.ts` owns every one of these paths; [cli/README.md](../../cli/README.md) "The harness inside the
  CLI" lists their tables.
- **Product Work** lives in the app repository's `.starciwork/` (Business/SRS, Architecture/SDS, `features/`,
  `workspace.yaml`), committed with the app. The harness never writes its state there, never ignores it and never
  strips it from a candidate: a docs task leases a scope inside it (`.starciwork/features/<f>`), and only the whole
  tree as an `allowPaths` entry is refused, as `.` is.

## How a project is found

A ledger belongs to a git repository, identified by its git common dir (`git rev-parse --git-common-dir`), so every
linked worktree of one repository shares one ledger. The host registry, `machine.sqlite` table `ledgers`, maps the
common dir to a `ledger_id` (`<main checkout name>-<hash>`), minted on the first writing verb; read verbs create
nothing. A folder outside git has a ledger of its own, keyed by its path.

A project is the repository that owns the Work (`.starciwork`) together with the side repositories whose `hfs.json`
names it as `work.root` (the sides its `workspace.yaml` lists); a repository with no Work that names none is a project
of its own. `projectOf` in `cli/src/harness/work.ts` is the one rule, read from the folder's main checkout through
`locateWorkRoot`, so any checkout or workflow worktree of any of its repositories resolves to the same project. A
project's key is the Work-root repository's `ledger_id`, and the project has one Supervisor (cli/README.md "Seats as a
tree"). No binding file is read: an app carries no copy of the harness, no `.workspaces` mapping and no ledger.

The nearest `hfs.json` (searched up to the repository root) says what the tree is: `kind` (`runtime` or an app), the
app's `edition`, and the `policy` profile its gates run under (`policy/quality.yaml` owns the profiles and the default
of each kind). This repository's own [hfs.json](../../hfs.json) declares the runtime.

An app driven by the harness points its agents here from its own `AGENTS.md` or `CLAUDE.md`, with the absolute path of
this checkout; a machine with no checkout runs the published package instead:

```text
Before planning or editing, read <harness>/contexts/README.md and follow its load order. Run the harness as
`node <harness>/cli/dist/main.js` (or `starci` when linked); with no checkout on this machine, run
`npx starci-harness <verb>` with STARCI_LOCAL_ROOT set, and read the contexts through `npx starci-harness contexts search`.
Harness state lives under <harness>/.runtime (or STARCI_LOCAL_ROOT), never in this repository; this repository's
.starciwork/ is product Work only.
```

When you delegate or change directory, pass the harness path and the project root on explicitly: a task opened in
another folder does not inherit them.
