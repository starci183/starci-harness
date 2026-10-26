# StarCi harness

AI agents write code fast and check it badly. The StarCi harness gives every piece of agent work a contract of
machine checks, verifies the result itself on a clean checkout, and only then commits it. The agent that does the work
never judges it.

This repository is public: it tracks no secret, and CI reads its tokens from GitHub secrets only.

Agents start at [CONTEXT.md](CONTEXT.md), which also holds the owner's decisions and the open questions; the rules for
changing this repository are in [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

A task is a contract: its context (where it works, which paths it may write and read), its input (what to do), its
output keys and its checks, a list a machine can run, with a budget of minutes and tries. Each part is the base its
label's op file holds ([ops/ops/README.md](ops/ops/README.md)) plus the Kernel's extend. Sending a task leases its
`allowPaths`, so two live tasks never write the same paths. A worker does the task, dry-replays the contract with
`starci task verify --contract` until it is green, and files one result: `done`, `blocked` (with the reason),
`mismatch` (the contract itself is wrong) or `failed`. The harness then replays the checks on a clean checkout of HEAD
plus the task's paths: green commits those paths, red preserves and resets them. Only that verify settles a task.

A workflow is a graph of such tasks, written by the Kernel (an agent) as a workflow file. The harness validates and
records it, never invents a task, and dispatches each task once its dependencies are done: under the `orca` runner to
worker seats launched through Orca, routed to an agent and model by [ops/routing.yaml](ops/routing.yaml); under the
`inline` runner to the chat agent, one task at a time. A running workflow is changed by an amend, which keeps the done
work and redoes only what the change reaches. Everything is recorded in SQLite ledgers outside the product
repositories, so a run survives a closed chat or a dead agent. [CONTEXT.md](CONTEXT.md) names the roles and the two
axes (edition and runner); [cli/README.md](cli/README.md) says how the CLI implements the rest.

## The parts

| folder | holds |
|---|---|
| [cli/](cli/README.md) | the `starci` command, one TypeScript source: core verbs, the harness verbs and the edition verbs |
| [ops/](ops/) | the work as data: the worker brief, the seven worker labels, the check presets, routing and budgets, liveness, the uat image |
| [policy/](policy/README.md) | the gates: tiers and profiles, canon packages, banned loosening markers, the secret scan |
| [knowledge/](knowledge/README.md) | how StarCi app code and UI are written: app shape, stack, code patterns, grammars, UI rules, vendor parity |
| [packages/](packages/README.md) | the canon packages apps install from npm: ESLint (fe, be), stylelint, tsconfig, prettier, jest |
| `skills/` | the agent entry for operating the harness (`skills/starci/SKILL.md`) |

## Install and build

Node 24 and git. Orca is needed only for the `orca` runner; `gh` only for `release ci-status` and `check ci`; a
Docker engine only for `uat run`.

```sh
cd cli
npm ci              # installs and builds cli/dist
node dist/main.js doctor
```

Run the CLI as `node <checkout>/cli/dist/main.js`, or `npm link` inside `cli/` to put `starci` on the PATH. Harness
state goes to `<checkout>/.runtime/` (git-ignored).

## Verbs

`starci explain` lists the verbs of the working directory with their flags, effect and json schema (`--json` for
machines); `starci explain --term <word>` filters them. An app shows the core verbs plus its edition's; the runtime and
a folder outside any StarCi tree show every verb. The groups:

| group | for |
|---|---|
| (top), `check`, `release` | the host and the tree, the scoped gates, push, tag, publish and CI status |
| `contract`, `task` | one task: write and judge its contract, send, file the result, verify, cancel |
| `workflow`, `plan` | a graph of tasks: define, run, step, pause, amend, stop; show and diff its versions |
| `seat`, `route`, `provider`, `budget` | the `orca` runner: worker seats, the router, provider circuits, workflow budgets |
| `uat` | a Playwright script in the pinned image of [ops/uat.yaml](ops/uat.yaml) |
| `app` | what a lite app declares |

Not built yet: the Supervisor, the host daemon (seat liveness, sweeps), `msg`, `debug`, `task wait`, `lease list`,
`check unit`, `git`, `release notes`, and the app verbs (`app scaffold|sync|check|emit|db|secret`, `pattern`,
`supabase`, `stack`, `docker`, and the full edition's `app add`).

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request to main: the CLI's typecheck,
lint and build, the loosening and secret gates, every package's specs, and the Sonar new-code gate. A `v*` tag also
publishes every package under `packages/` whose version is not yet on npm.
