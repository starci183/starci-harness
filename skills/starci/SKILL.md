---
name: starci
description: >-
  Drive the StarCi harness only through an explicit /starci request or explicit native skill selection.
  Resolve the runtime root and the product repository, draft and define workflows with the owner's OK,
  run and watch them (orca or inline), work an inline task, author UI on a grammar, read routing and
  providers, debug a stuck workflow, and release authorized work.
disable-model-invocation: true
triggers: [user]
---

# StarCi

Invocation selects these instructions. It approves nothing: no workflow, task, seat, amend, stop, budget
raise, push or publish. Act only within the owner's recorded scope. A plain chat request that says
workflow, task or debug does not enroll into StarCi.

## Resolve once, carry everywhere

- **Runtime root**: the harness checkout that holds this skill, two folders up from this file (it holds
  `cli/`, `ops/`, `policy/`, `contexts/`). The harness keeps its state under `<runtime root>/.runtime/`
  (git-ignored): `machine.sqlite` and `projects/<ledger_id>/` with `runtime.sqlite`, `contracts/`,
  `briefs/`, `outputs/`, `preserved/`.
- **CLI**: `starci` in these files means `node <runtime root>/cli/dist/main.js`. If `cli/dist` is missing,
  build it in `<runtime root>/cli` with `npm ci` then `npm run build`. This CLI is the npm package `starci-harness`
  and carries `starci app`; a product pins it as its devDependency, so `npx starci app ...` there runs the product's
  pinned copy. `@starci/cli` is retired (a machine may still hold its 1.7.x, which has no `starci-harness` bin), and a
  PATH copy serves only when it resolves to this root. The state base follows
  the CLI's location, so a CLI built in another worktree reads another ledger: always run the runtime root's.
- **Product repository**: the git repository the work lands in. Its ledger is found from its git common dir,
  so every worktree of it shares one ledger. Run verbs from inside it, or pass `--cwd <repo>`.
- **Product content** (specs, architecture, `features/...`) lives in the app's `.starciwork/` and is
  committed. Never put harness state there; never put product content under `.runtime/`.
- **Edition and runner are independent.** The edition (`lite` or `full`, in the app's `hfs.json`) says what
  the app is. The runner (`orca` or `inline`) says how a workflow runs its tasks and is chosen per workflow.
- When you delegate or change directory, pass the absolute runtime root, the absolute product repository,
  the workflow id and the task id. A task opened elsewhere gets them explicitly.

Run `starci explain` (or `starci explain --term <word>`) for the exact flags of a verb. Add `--json` to any
verb for one `{schema, ok, data}` envelope. Exit 0 is done, 1 is refused or red (nothing moved), 2 is bad
usage. Read every refusal code; never retry blindly.

## Seats and the chat

The host: owner runs `starci host install` once, `starci host status` to check ([ops/host.yaml](../../ops/host.yaml)).
The owner starts a project's Supervisor once (`starci supervisor start` from any checkout of the project, or a scheduled
`starci supervisor tick` for every project) and then talks to its `[Supervisor] <project>` terminal, hands it a request
from anywhere with `starci supervisor ask "<request>"`, or answers on Telegram once the bridge runs (`starci connect
telegram`, `starci supervisor telegram-bridge`; [cli/README.md](../../cli/README.md) "The owner's Telegram channel"): it turns a request
into a workflow of its project, starts it from its own terminal, and answers its Kernels' escalations. Each orca workflow's `[Kernel]` plans (every contract and the workflow file) and drives
it with `kernel next` / `kernel submit`; Ops run their label's op file ([ops/ops/](../../ops/ops/README.md)) on one
contract. [cli/README.md](../../cli/README.md) "Seats as a tree" owns the verbs and the command file.

A chat agent outside Orca is Debug: it diagnoses the harness, changes nothing but a harness setting (`starci config set`),
and hands the Supervisor a repair contract or the owner's words (`starci supervisor ask`); it
never starts an orca workflow (that refuses `SUPERVISOR_REQUIRED`). Under the `inline` runner the chat is the Kernel and
the worker, one task at a time, without seats.

## Approvals

Get the owner's OK on the exact artefact before each effect, and reuse it only while scope stays the same:

| Effect | The owner approves |
| --- | --- |
| `workflow define`, `workflow start` | the workflow file: goal, runner, tasks, allowPaths, checks, risk |
| `task send`, `seat start` outside a workflow | the contract |
| `workflow amend` that adds, removes or widens work | the `plan diff` output |
| `workflow stop`, `task cancel`, `budget raise` | the target and the reason |
| `config set` | the key and the value |
| `release push`, `release cut` | the repository, commit and version (a harness push publishes the package versions it raises) |
| `release publish --publish` | every package and version in the plan, each time (npm is public) |

Silence, a question or "handle it" is not an OK. A retry or a contract fix inside an accepted goal is the
Kernel's own call; report it. Never decide for the owner, enter a credential or print a secret.

## Load only the reference you need

| Request | Read |
| --- | --- |
| Turn an owner goal into a workflow and define it | [references/define-workflow.md](references/define-workflow.md) |
| Start, step, watch, amend or stop a workflow | [references/run-workflow.md](references/run-workflow.md) |
| Do one task yourself in this chat (inline runner) | [references/inline-task.md](references/inline-task.md) |
| Know what an Orca worker sees and does | [references/worker.md](references/worker.md) |
| Write or review front-end UI on a grammar | [references/ui-on-grammar.md](references/ui-on-grammar.md) |
| Walk flows in a browser with evidence (a `uat` task) | [references/uat.md](references/uat.md) |
| Router picks, provider circuits, budgets | [references/routing-and-providers.md](references/routing-and-providers.md) |
| Push, cut, publish, read CI | [references/release.md](references/release.md) |
| A workflow or task is stuck | [references/debug.md](references/debug.md) |

Load order: [contexts/README.md](../../contexts/README.md); decisions, roles and open questions: [contexts/harness/](../../contexts/harness/decisions.md). Gates and profiles: [policy/](../../policy/quality.yaml).
