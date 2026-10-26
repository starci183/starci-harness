# Where state lives and how a project is found

## Where state lives

- **Harness state** lives under the runtime root (this checkout) in `.runtime/`, git-ignored: `machine.sqlite` for the
  host and `projects/<ledger_id>/` for each project's `runtime.sqlite`, briefs, contracts, outputs and preserved work.
  `STARCI_LOCAL_ROOT` replaces the whole state base and `STARCI_PROJECTS_ROOT` only `projects/`.
  `cli/src/harness/ledger.ts` owns every one of these paths; [cli/README.md](../../cli/README.md) "The harness inside the
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
of each kind). This repository's own [hfs.json](../../hfs.json) declares the runtime.

An app driven by the harness points its agents here from its own `AGENTS.md` or `CLAUDE.md`, with the absolute path of
this checkout:

```text
Before planning or editing, read <harness>/contexts/README.md and follow its load order. Run the harness as
`node <harness>/cli/dist/main.js` (or `starci` when linked). Harness state lives under <harness>/.runtime,
never in this repository; this repository's .starciwork/ is product Work only.
```

When you delegate or change directory, pass the harness path and the project root on explicitly: a task opened in
another folder does not inherit them.
