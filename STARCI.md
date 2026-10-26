# STARCI.md: the starci CLI rewrite (1.0.0-alpha.40)

Owner: the owner. This is the working design of the rewritten CLI in `D:\.claude`. It records the owner's decisions and the verb set under discussion. The old CLI in `starci-academy-backend/.claude` keeps running until the new one reaches parity.

## Decisions taken (owner, 2026-10-27)

- **One CLI written in TypeScript with `commander`**, no Nest. It is built with `tsc` into `cli/dist`. npm ships `dist/` only, and git never commits it. `prepare` builds on install and `prepublishOnly` gates on typecheck, lint and build.
- **The CLI source passes ESLint** at typescript-eslint `strictTypeChecked` plus `stylisticTypeChecked`, with `noInlineConfig`. Nothing is disabled inline.
- **One shared standard (`cli/src/shared`):**
  - `defineVerb` is the one definition of a verb: path, summary, editions, effect, roles, json schema, typed flags and the handler. Help, `starci explain`, docs and completions all come from it, with no YAML beside the code.
  - Every verb prints one json envelope with `--json`: `{schema, ok, data}`, or `{schema: "starci/refusal@1", ok: false, code, message}`.
  - Exit codes: 0 done, 1 refused (nothing moved), 2 bad usage.
  - Host tools run without a shell (`runTool`, and `runNpm` goes through the running Node), so no quoting breaks on Windows.
  - `locateTree` reads the nearest `hfs.json`. A lite app sees core plus lite verbs, a full app sees core plus full verbs, and the runtime or a bare folder sees everything.
- **Edition model:**
  - The **full** edition runs its workflows in Orca: the Kernel, ops, workers and the Supervisor.
  - The **lite** edition runs inside a Claude or Codex chat and puts the canonical patterns first. The agent codes directly, and the CLI gives it the patterns, checks and app operations.

## Layout

```
cli/
  src/
    main.ts                    builds the commander program for the tree of the working directory
    registry.ts                every verb, core first, then each edition
    shared/                    verb, errors, output, tree, exec
    core/<group>/<verb>.ts     verbs of both editions
    lite/<group>/<verb>.ts     verbs of lite apps
    full/<group>/<verb>.ts     verbs of full apps and their Orca workflows
  dist/                        build output, not committed
```

## Verbs written so far

| command | edition | effect | what it does |
|---|---|---|---|
|  | core | read | CLI and Node versions |
|  | core | read | the verbs available here, from their definitions |
|  | core | read | node, git, npm and gh on the host; the StarCi tree of the folder |
|  | core | read | the scope decision from the diff, then typecheck and lint of exactly that scope |
|  /  | core | read | one step of the same scope, using each package's own ESLint or tsconfig |
|  | core | remote | the light gate (on main, clean, fast-forward, no secret in the pushed range), then git push with hooks |
|  | core | remote | tag v<version> on a commit already on origin/main with its CHANGELOG section; pushes the tag alone |
|  | core | publish | the plan of package versions missing from npm; --publish publishes them from main and reads each back |
|  | core | read | the GitHub Actions verdict of a commit |
|  | lite | read | the lite app's be/fe apps, canonical patterns and backing services |

Parity gaps with the old CLI, by design for now:
- The secret scan carries the provider shapes, forbidden paths and the quoted keyword assignment. It does not carry the unquoted dotenv form, SQL role passwords or badge-token exemptions.
-  has no clean-install proof, canon rebind or example re-pin. Those belong to the runtime's canon packages, not to a product.
- Roles are declared on every verb but not yet enforced. Enforcement needs the caller's role, from the seat or an env var.

## Proposed verb set (for the owner's review)

The old CLI has 268 verbs in 30 groups (see the inventory in `starci-academy-backend/.claude/STARCI.md`). The proposal keeps what each edition needs and folds the rest.

### Core (both editions)
- `version`, `explain`, `doctor`
- `check` holds run (scoped), lint, typecheck and unit. It replaces the one-verb groups check, lint and typecheck, and gate unit.
- `git` holds commit, sync and backup.
- `release` holds push (light gate), cut (tag only), publish, ci-status and notes.
- `pattern` holds list, show and add. It covers the canonical capabilities (old `app add` and `app new`), and the lite edition leads with it.
- `app` holds scaffold, sync, check, emit, db, secret, coverage and hygiene. The `--edition` given at scaffold is fixed.

### Lite (agent in chat, pattern first)
- `app info`
- `supabase` holds start, stop, status and cloud.
- `stack` holds deploy, verify and rollback (Swarm, one api).
- `docker` holds build, up and down.

### Full (workflows in Orca)
- `workflow` holds define, start, status, stop and archive.
- `kernel` goes from 55 verbs to about 20.
  - Kept: status, survey, dispatch, report, consume, settle, decide, inbox, reply, nudge, observe, reconcile, incident, plan, enqueue, log, lifecycle, usage, verify-proofs.
  - Folded: decisions into decide, questions into reply, logs into log, revision-ack into kernel-ack-rev, messages into survey.
- `lane` holds workers and worktrees (old worker, machine worktrees and supervisor gc).
- `supervisor` is slimmed to status, decide, tell, start, stop and actions.
- `work` collects the drawing steps under one `work draw <step>`, plus brand, graph and validate.
- `uat` holds record and slots.
- `app add reactor|saga|projection` and `test-world`.
- `stack` keeps the full infra (Kafka, Keycloak, test world).

### Removed or hidden
- Removed:
  - `supervisor push`, which still says "run full suites then push", against ruling push-main-after-scoped-check;
  - the 21 verbs nothing references, unless the owner keeps one.
- Hidden, still callable by hooks and seats: `guard *`, `orca terminal-*`, `reconciler once`, `supervisor watchdog`.

## Open questions

1. Is the kernel slim list above right, or should the full kernel be audited verb by verb?
2. Does `pattern` become its own group, or stay inside `app`?
3. Package naming: keep `@starci/cli` at 2.0.0, or a new name while both CLIs coexist?
