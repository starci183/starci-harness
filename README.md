# StarCi harness

AI agents write code fast and check it badly. The StarCi harness gives every piece of agent work a contract of
machine checks, verifies the result itself on a clean checkout, and only then commits it. The agent that does the work
never judges it.

This repository is public: it tracks no secret, and CI reads its tokens from GitHub secrets only.

Agents start at [CONTEXT.md](CONTEXT.md). The design and the owner's decisions are in [STARCI.md](STARCI.md); the rules
for changing this repository are in [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

A task is a contract: its context (where it works, which paths it may write), its input (what to do) and its
`expectedOutput`, a list of checks a machine can run. A worker does the task, proves it with `starci task verify`, and
files one result. The harness replays the checks on a clean checkout of HEAD plus the task's paths: green commits those
paths, red preserves and resets them. A workflow is a graph of such tasks; the harness dispatches each task once its
dependencies are done. Everything is recorded in SQLite ledgers outside the product repositories, so a run survives a
closed chat or a dead agent.

## The parts

| folder | holds |
|---|---|
| `cli/` | the `starci` command, one TypeScript source: core verbs, the harness verbs and the edition verbs |
| [ops/](ops/) | the work as data: the worker brief, the seven worker labels, the check presets, routing and budgets |
| [policy/](policy/) | the gates: tiers and profiles, canon packages, banned loosening markers, the secret scan |
| `knowledge/` | how StarCi app code and UI are written: grammars, UI rules, vendor parity |
| [packages/](packages/README.md) | the canon packages apps install from npm: ESLint (fe, be), stylelint, tsconfig, prettier, jest |
| `skills/` | the agent entry for operating the harness (`skills/starci/SKILL.md`) |

## Two axes

- **Edition**, `lite` or `full`, is what an app is, fixed at scaffold in its `hfs.json`. Lite is stateless on Postgres
  with the canonical patterns first; full adds the reactor, saga and projection patterns and its own infrastructure.
- **Runner**, `orca` or `inline`, is how a task runs. `orca` launches a worker seat through Orca, so tasks run in
  parallel; `inline` means the open Claude or Codex session does the task itself, one at a time. Both editions use both
  runners, with the same contracts, leases, clean verify and harness commit.

## Install and build

Node 24 and git. Orca is needed only for the `orca` runner; `gh` only for `release ci-status` and `check ci`.

```sh
cd cli
npm ci              # installs and builds cli/dist
node dist/main.js doctor
```

Run the CLI as `node <checkout>/cli/dist/main.js`, or `npm link` inside `cli/` to put `starci` on the PATH. Harness
state goes to `<checkout>/.runtime/` (git-ignored).

## Verbs

`starci explain` lists the verbs of the working directory with their flags, effect and json schema (`--json` for
machines); `starci explain --term <word>` filters them. Every verb prints one json envelope with `--json` and exits 0
done, 1 refused or red, 2 bad usage. The groups today:

| group | verbs | editions | effects |
|---|---|---|---|
| (top) | `version`, `explain`, `doctor` | lite, full | read |
| `check` | `run`, `lint`, `typecheck`, `loosening`, `secrets`, `ci` | lite, full | read |
| `release` | `push`, `cut`, `publish`, `ci-status` | lite, full | remote, publish, read |
| `contract` | `new`, `check` | lite, full | local-write, read |
| `task` | `send`, `result`, `status`, `verify`, `cancel` | lite, full | host, local-write, read |
| `workflow` | `define`, `start`, `step`, `status`, `list`, `amend`, `stop` | lite, full | local-write, host, read |
| `plan` | `show`, `diff` | lite, full | read |
| `seat` | `start`, `list`, `stop` | lite, full | host, read |
| `route` | `explain` | lite, full | read |
| `provider` | `status`, `recover`, `report` | lite, full | read, local-write |
| `budget` | `show`, `raise` | lite, full | read, local-write |
| `app` | `info` | lite | read |

An app shows the core verbs plus its edition's; the runtime and a folder outside any StarCi tree show every verb.
[STARCI.md](STARCI.md) "Final lists" names the verbs still to come.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request to main: the CLI's typecheck,
lint and build, the loosening and secret gates, every package's specs, and the Sonar new-code gate. A `v*` tag also
publishes every package under `packages/` whose version is not yet on npm.
