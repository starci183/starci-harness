# StarCi harness

[![CI](https://github.com/starci183/starci-harness/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/starci183/starci-harness/actions/workflows/ci.yml)
[![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=starci183_starci-harness&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=starci183_starci-harness)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=starci183_starci-harness&metric=coverage)](https://sonarcloud.io/summary/new_code?id=starci183_starci-harness)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=starci183_starci-harness&metric=bugs)](https://sonarcloud.io/project/issues?id=starci183_starci-harness&types=BUG)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=starci183_starci-harness&metric=vulnerabilities)](https://sonarcloud.io/project/issues?id=starci183_starci-harness&types=VULNERABILITY)
[![npm (alpha)](https://img.shields.io/npm/v/starci-harness/alpha?label=npm%40alpha)](https://www.npmjs.com/package/starci-harness)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

AI agents write code fast and check it badly. The StarCi harness gives every piece of agent work a contract of
machine checks, verifies the result itself on a clean checkout, and only then commits it. The agent that does the work
never judges it. It is one command line, `starci`, that records every task and workflow in SQLite ledgers outside
your repositories, dispatches the work to agent seats or to the chat agent in front of you, and carries the contexts
(how StarCi app code and UI are written) that every brief and `contexts search` read.

This repository is public: it tracks no secret, and CI reads its tokens from GitHub secrets only.

Agents start at [contexts/README.md](contexts/README.md), the load order; the owner's harness decisions and open questions are in
[contexts/harness/](contexts/harness/decisions.md), and the rules for changing this repository are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Tải về / Download

The desktop app is on [GitHub Releases](https://github.com/starci183/starci-harness/releases/latest). Pick one file:

- Windows, managed install (all users, deployable by policy): the `.msi`.
- Windows, per-user install without admin rights: the `-setup.exe`.
- macOS (Intel and Apple silicon): the `.dmg`.

The builds are unsigned unless signing is configured, so Windows SmartScreen warns on the installer: choose "More info",
then "Run anyway". Check the file against `SHA256SUMS.txt` on the release.

## Packages

Every package is published to [npm](https://www.npmjs.com/org/starci) by CI when its jobs on main are green (the repository's GitHub Packages list stays empty by design). The badges read the version npm serves now.

| Package | Version | What it is |
|---|---|---|
| [`starci-harness`](https://www.npmjs.com/package/starci-harness) | [![npm](https://img.shields.io/npm/v/starci-harness/alpha)](https://www.npmjs.com/package/starci-harness) | the `starci` CLI (dist-tag `alpha`) |
| [`@starci/grammar`](https://www.npmjs.com/package/@starci/grammar) | [![npm](https://img.shields.io/npm/v/@starci/grammar)](https://www.npmjs.com/package/@starci/grammar) | React components and compositions with packaged visual DNA |
| [`@starci/eslint-grammar-core`](https://www.npmjs.com/package/@starci/eslint-grammar-core) | [![npm](https://img.shields.io/npm/v/@starci/eslint-grammar-core)](https://www.npmjs.com/package/@starci/eslint-grammar-core) | lint rules for the core Grammar contracts |
| [`@starci/eslint-grammar-offset-pop`](https://www.npmjs.com/package/@starci/eslint-grammar-offset-pop) | [![npm](https://img.shields.io/npm/v/@starci/eslint-grammar-offset-pop)](https://www.npmjs.com/package/@starci/eslint-grammar-offset-pop) | lint rules for the Offset Pop Grammar |
| [`@starci/eslint-canon-fe`](https://www.npmjs.com/package/@starci/eslint-canon-fe) | [![npm](https://img.shields.io/npm/v/@starci/eslint-canon-fe)](https://www.npmjs.com/package/@starci/eslint-canon-fe) | front-end lint canon (TypeScript, Next.js) |
| [`@starci/eslint-canon-be`](https://www.npmjs.com/package/@starci/eslint-canon-be) | [![npm](https://img.shields.io/npm/v/@starci/eslint-canon-be)](https://www.npmjs.com/package/@starci/eslint-canon-be) | back-end lint canon |
| [`@starci/stylelint-canon`](https://www.npmjs.com/package/@starci/stylelint-canon) | [![npm](https://img.shields.io/npm/v/@starci/stylelint-canon)](https://www.npmjs.com/package/@starci/stylelint-canon) | CSS lint canon |
| [`@starci/hfs`](https://www.npmjs.com/package/@starci/hfs) | [![npm](https://img.shields.io/npm/v/@starci/hfs)](https://www.npmjs.com/package/@starci/hfs) | the app command: scaffold, lint, check, sync |
| [`@starci/ai-router`](https://www.npmjs.com/package/@starci/ai-router) | [![npm](https://img.shields.io/npm/v/@starci/ai-router)](https://www.npmjs.com/package/@starci/ai-router) | router for OpenAI-compatible calls across keys, models, providers |
| [`@starci/event-stream`](https://www.npmjs.com/package/@starci/event-stream) | [![npm](https://img.shields.io/npm/v/@starci/event-stream)](https://www.npmjs.com/package/@starci/event-stream) | Server-Sent Events client for browsers and Node |
| [`@starci/heroicons`](https://www.npmjs.com/package/@starci/heroicons) | [![npm](https://img.shields.io/npm/v/@starci/heroicons)](https://www.npmjs.com/package/@starci/heroicons) | custom Heroicons-compatible icons |
| [`@starci/jest-preset`](https://www.npmjs.com/package/@starci/jest-preset) | [![npm](https://img.shields.io/npm/v/@starci/jest-preset)](https://www.npmjs.com/package/@starci/jest-preset) | jest config for Nest back ends |
| [`@starci/test-world`](https://www.npmjs.com/package/@starci/test-world) | [![npm](https://img.shields.io/npm/v/@starci/test-world)](https://www.npmjs.com/package/@starci/test-world) | shared e2e library for back ends |
| [`@starci/tsconfig`](https://www.npmjs.com/package/@starci/tsconfig) | [![npm](https://img.shields.io/npm/v/@starci/tsconfig)](https://www.npmjs.com/package/@starci/tsconfig) | TypeScript configs |
| [`@starci/prettier-config`](https://www.npmjs.com/package/@starci/prettier-config) | [![npm](https://img.shields.io/npm/v/@starci/prettier-config)](https://www.npmjs.com/package/@starci/prettier-config) | the Prettier config |

## Install

Node 24 and git. Orca is needed only for the `orca` runner; `gh` only for `release ci-status` and `check ci`; a
Docker engine only for `uat run`.

```sh
npx starci-harness explain        # run it once, nothing installed
npm i -g starci-harness@alpha     # or put `starci` and `starci-harness` on the PATH
```

The npm package `starci-harness` carries the built CLI with its `ops/`, `policy/`, `contexts/` and the search index.
Harness state goes to the package's own `.runtime/` unless `STARCI_LOCAL_ROOT` names a state base
([contexts/harness/state.md](contexts/harness/state.md)); under `npx`, whose package folder is a cache, set it.

## Quick start

```sh
npx starci-harness doctor                               # Node, git, npm, gh and Orca on this host; the tree and its state base
npx starci-harness explain task                  # the verbs about one task, with their flags and json schema
npx starci-harness contexts search "how is a back-end exception mapped"
```

Inside a repository, `starci contract new` writes a task's contract, `starci task send` queues it, the worker files
`starci task result`, and `starci task verify` replays the checks on a clean checkout and commits on green; "How it
works" below says what each step guarantees, and `skills/starci/SKILL.md` is the agent's operating guide.

## How it works

A task is a contract: its context (where it works, which paths it may write and read), its input (what to do), its
output keys and its checks, a list a machine can run, with a budget of minutes and tries. Each part is the base its
label's op file holds ([ops/ops/README.md](ops/ops/README.md)) plus the Kernel's extend. Each task of a workflow works in a
git worktree of its own, cut from the workflow's branch, so two live tasks may write the same paths at once. A worker does
the task, dry-replays the contract with `starci task verify --contract` until it is green, and files one result: `done`,
`blocked` (with the reason), `mismatch` (the contract itself is wrong) or `failed`. The harness then rebases the task's
paths onto the workflow branch's head and replays the checks on a clean checkout of that: green lands it on the branch, red
preserves and resets its paths, and a textual conflict returns the task `conflict` with its work preserved. Only that
verify settles a task, and the task's worktree is removed once it settled.

A workflow is a graph of such tasks, written by the Kernel (an agent) as a workflow file. The harness validates and
records it, never invents a task, and dispatches each task once its dependencies are done: under the `orca` runner to
worker seats launched through Orca, routed to an agent and model by [ops/routing.yaml](ops/routing.yaml); under the
`inline` runner to the chat agent, one task at a time. A running workflow is changed by an amend, which keeps the done
work and redoes only what the change reaches. Everything is recorded in SQLite ledgers outside the product
repositories, so a run survives a closed chat or a dead agent. [contexts/harness/roles.md](contexts/harness/roles.md) names the roles and
[axes.md](contexts/harness/axes.md) the two axes (edition and runner); [cli/README.md](cli/README.md) says how the CLI implements the rest.

## The parts

| folder | holds |
|---|---|
| [cli/](cli/README.md) | the `starci` command (npm `starci-harness`), one TypeScript source: core verbs, the harness verbs and the edition verbs |
| [ops/](ops/) | the work as data: the worker brief, the worker labels, the lanes and repair routes, the check presets, routing and budgets, liveness, the uat image |
| [policy/](policy/README.md) | the gates: tiers and profiles, canon packages, banned loosening markers, the secret scan |
| [contexts/](contexts/README.md) | how StarCi app code and UI are written: app shape, stack, code patterns, grammars, UI rules, vendor parity |
| [packages/](packages/README.md) | the packages apps install from npm: the canon (ESLint fe and be, stylelint, tsconfig, prettier, jest), the Grammar and its lint families, `hfs`, the shared libraries (heroicons, event-stream, test-world) and the AI pool router |
| [app/](app/README.md) | the StarCi Harness desktop app (Tauri, Windows and macOS) over `starci ui`, drawn in the local Grammar |
| `skills/` | the agent entry for operating the harness (`skills/starci/SKILL.md`) |

## Build from source

```sh
cd cli
npm ci              # installs and builds cli/dist
node dist/main.js doctor
```

Run the CLI as `node <checkout>/cli/dist/main.js`, or `npm link` inside `cli/` to put `starci` on the PATH. Harness
state goes to `<checkout>/.runtime/` (git-ignored).

## Verbs

`starci explain` lists the verbs of the working directory with their flags, effect and json schema (`--json` for
machines); `starci explain <word>` filters them. An app shows the core verbs plus its edition's; the runtime and
a folder outside any StarCi tree show every verb. The groups:

| group | for |
|---|---|
| (top), `check`, `release` | the host and the tree, the local API the desktop app reads (`ui`), the scoped gates, push, tag, publish and CI status |
| `contract`, `task` | one task: write and judge its contract, send, file the result, verify, cancel |
| `workflow`, `plan` | a graph of tasks: define, run, step, pause, amend, stop; show and diff its versions |
| `needs` | the shared needs Ops reported (`task result --needs`): list and show them with their owner and waiters, merge two spellings of one |
| `worktree` | the harness's own worktrees: `gc` removes those whose owner ended, preserving their uncommitted work first |
| `seat`, `route`, `provider`, `budget` | the `orca` runner: worker seats, the router, provider circuits, workflow budgets |
| `project` | a project's ledger in the host registry: retire an abandoned one so no sweep, tick or pool count reads it |
| `config` | the harness settings: list, get and set a key of the ops/ yaml that owns it, validated before it is written |
| `host` | the services of [ops/host.yaml](ops/host.yaml) this machine runs for the harness: status, up, install, uninstall |
| `connect` | the owner's outside channel, Telegram ([ops/telegram.yaml](ops/telegram.yaml)): store the owner's chat, report it, send the notices due; `supervisor telegram-bridge` runs it as a host service |
| `uat`, `test` | a Playwright script in the pinned image of [ops/uat.yaml](ops/uat.yaml); a worker's run of a live-provider suite, its custody keys handed to that run unseen (`test live`) |
| `app` | one product repository: what a lite app declares, its Sonar scope, and the app commands of `@starci/hfs` (scaffold, sync, check, lint, add, new, emit, explain, hygiene, coverage, codemod, ci, db, secret, stack, release, upgrade), run in-process; a product pins `starci-harness` as its devDependency and its hooks and CI run `npx --no-install starci app ...` |

Not built yet: the host daemon (seat liveness, sweeps), `msg`, `debug`, `task wait`,
`check unit`, `git`, `release notes`, and shell completion.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request to main and checks only what the
change affects. Its `plan` job measures a pull request from its base and a push to main from the last main commit whose run
succeeded (else its parent), and `starci release affected` names the packages to test, each with the siblings it needs
(the ones it requires, its `file:` dependencies, the ones its files read by relative path), and whether the harness and app
jobs run. Then, in parallel: one `gates` job per light gate over the whole tree (anatomy, anchor and search-index checks of
`contexts/`, the loosening, secret and shape gates, and `check pins`: the CLI's `@starci` packages at their pins), one `package` job per affected package (install and build its siblings
and itself, its declarations name `.js`, its specs), the `harness` job when `cli/`, `contexts/`, `ops/`, `policy/`
or a package the CLI requires changed (the CLI's typecheck, lint and build), the `app` job when the desktop
app is affected, and the Sonar new-code gate; a change under `.github/`, a manual run or an unreadable base checks
everything. The `ci` job is the one required check, green when every job the plan needed passed. On a push to main that
affects a package or the CLI, the `publish-packages` and `publish-cli` jobs publish every version not yet on npm once its
own jobs are green, without waiting for `ci` ([CONTRIBUTING.md](CONTRIBUTING.md) CONTRIB-20). [.github/workflows/app.yml](.github/workflows/app.yml) builds the desktop app's bundles on an `app-v*` tag (which must equal the
app's version) and publishes them, with `SHA256SUMS.txt`, on a GitHub Release; a manual run only builds them.

## License

[MIT](LICENSE). Security reports go through [SECURITY.md](SECURITY.md); changes are listed in [CHANGELOG.md](CHANGELOG.md).
