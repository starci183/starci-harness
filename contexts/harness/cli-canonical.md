# The canonical starci CLI

Owner ruling `cli-canonical-2026-10-30` ([decisions.md](decisions.md)): the flag dictionary and the command tree below are
the target surface of both layers, the harness verbs (`starci <group> <verb>`) and the app verbs (`starci app <verb>`,
run by @starci/hfs). Written by the read-only CLI audit of 2026-10-30 (127 harness verbs, 17 app verbs with 74 actions,
343 call sites) and approved by the owner as written ("Duyệt cả 6", the six decisions folded into the table: generators
dry by default, `app secret --env`, `feedback` folded into `ticket`, remote writes dry until `--execute`, the test world
as `app world`, one refused minor for every retired spelling). The table is rolled out in lanes; until a line ships, the
code is the truth and `starci explain` lists what runs today. The harness layer's lines have shipped: their retired
spellings are the rows of `cli/src/shared/retired.ts`, accepted with a notice naming the new spelling until
`REFUSE_RETIRED_SPELLINGS` turns refusal on.

Status of each line: KEEP, RENAME (the old spelling is refused for one minor with a message naming the new one, then
removed), FOLD (merged into another verb), DROP (removed), FIX (a behaviour bug).

## One flag dictionary (every verb, both layers)

| meaning | canonical | retired spellings | notes |
|---|---|---|---|
| do it for real (effects are dry by default) | `--execute` | `--publish` (release publish), `--write` (app sync, app sonar, app codemod, contexts anatomy), `--apply` (app db baseline/restamp), `--plan` (app upgrade, inverted), `--dry-run` (release push/cut, seat start, project park, supervisor tick, worktree gc, app ci local), `--dry` (host install/uninstall) | a generator's dry run reports drift and exits 1 on it, so `--check` disappears as a mode flag |
| machine output | `--json` | `--format json` (app lint, app codemod) | `--format` stays only where a non-JSON second format exists (codemod markdown report) |
| seconds to wait | `--timeout <s>` | `--timeout-ms` (task send, seat start, uat run), `--wait` in ms (dna check) | all durations in seconds; `--wait <s>` only for "block until" loops; `--retry <s>` keeps its meaning |
| exact commit | `--sha <sha>` | `--source-sha` (app stack render/deploy), `--source` (app release gate), `--head` (release affected), `--revision` (deps check) | `--base <ref>` stays the comparison base; `--ref <name>` a ref name |
| which environment of .starcistacks | `--env <env>` | positional `<env>` (every `app secret` action) | required for every effect verb (today `app stack` silently defaults to production) |
| DB URL variable | `--db-url-env <NAME>` | `--url-env` (app db *) | one name for app db and app stack deploy --urgent |
| app / checkout folder | `--cwd <dir>` | `--root` (contexts), `--harness` (pkg), `--from` (deps source), `--cwd-path` (contract new), `--into` (app scaffold), `--repo <dir>` (app upgrade, internal) | `--project <name|key>` stays for a registered project |
| output path | `--out <path>` | `--report` (codemod), `--sonar <file>` (app lint) | `--backup-out` stays (second output of deploy) |
| GitHub repository | `--repo <owner/name>` | (`--repo` as a folder) | |
| git remote | `--remote <name>` | | |
| why (justification) | `--reason "<text>"` | `--why` (ticket answer), `--detail` (provider report) | `--note` stays for free content (task result, pkg handoff) |
| status filter | `--status` | `--state` (ticket list) | `--all` widens a list |
| list of values | repeatable flag, or comma list, both accepted | `--allow` comma-only (contract new) vs list (supervisor dispatch) | one parser rule |

One parser behaviour for every hfs verb (today 7 parser families): `--x v` and `--x=v`; booleans accept `=true|false`; a
value may not start with `--`; a repeated single-value flag is refused; a flag the action does not take is refused (today
stack, release and the shared check/emit/new/add/scaffold/explain parser accept and ignore it, e.g. `stack doctor --execute`,
`check --into x`); one unknown-flag message and code. Exit codes everywhere: 0 ok, 1 findings or failed, 2 usage or refused,
3 approval missing (secret and ci return 2 for every failure today). Help is generated from the parser tables, so it can no
longer drift.

## The command tree

### Harness layer (`starci <group> <verb>`) — judges and operates the harness and its runners

| group | canonical verbs | changes |
|---|---|---|
| (top) | `version`, `explain [term]`, `doctor`, `ui` | FIX `explain`: `term` positional (today only `--term` works, `starci explain doctor` fails) |
| check | `run`, `lint`, `secrets`, `loosening`, `shape`, `pins`, `heavy-sites`, `ci` | DROP `check stories` (no caller anywhere); DROP `check typecheck` (only README/CHANGELOG; `check run` runs it). `check *` = judge the harness repository and packages; product apps use `app check`/`app lint` |
| release | `push`, `cut`, `publish`, `affected` | FOLD `release ci-status` into `check ci` (`check ci --json` prints the verdict; same `--sha`); `--dry-run`/`--publish` become dry-by-default + `--execute`; `affected --head` -> `--sha` |
| contract | `new`, `check` | flags: `--cwd-path` -> `--cwd`, `--details` -> `--note`; `--allow`/`--check` lists by the one list rule |
| task | `verify`, `send`, `status`, `result`, `cancel` | `--timeout-ms` -> `--timeout` |
| seat | `start`, `list`, `stop`, `ping` | `--dry-run` -> dry default + `--execute`; `--timeout-ms` -> `--timeout` |
| project | `retire`, `park`, `unpark` | same dry rule |
| workflow | `define`, `start`, `status`, `list`, `step [--loop]`, `wave`, `amend`, `stop`, `pause`, `resume` | FOLD `workflow run` into `workflow step --loop` (same foreground loop over the same step); FOLD `workflow regoal` into `workflow amend --goal` (supervisor submit goal-change already reaches it) |
| plan | `show`, `diff` | KEEP |
| route | `show` | RENAME `route explain` -> `route show` (`explain` reserved for the CLI help) |
| provider / budget | `provider status|recover|report|sync`, `budget show|raise` | `--detail` -> `--reason`; `budget raise --by` dropped (the caller's role says it) |
| worktree, uat, test, deps, pkg, dna | as today | `deps source --from` -> `--cwd`; `pkg --harness` -> `--cwd`; `dna check --wait` in seconds |
| contexts | `anatomy`, `anchor`, `search` | `--check`/`--write` -> dry (drift = exit 1) + `--execute`; `--root` -> `--cwd` |
| supervisor | `start`, `ensure`, `status`, `stop`, `ask`, `attach`, `next`, `dispatch`, `workers`, `accept`, `reject`, `submit`, `tick [--loop]` | FOLD `supervisor watch` into `supervisor tick --loop`; MOVE `supervisor telegram-bridge` to `connect telegram bridge` |
| kernel | `start`, `attach`, `next`, `submit` | KEEP |
| needs | `list`, `show`, `merge`, `reopen` | KEEP |
| connect | `telegram <discover-chat|status|notify|bridge>` | gains `bridge` (one Telegram home) |
| host | `status`, `load`, `up`, `install`, `uninstall` | `--dry` -> dry default + `--execute` |
| config | `list`, `get`, `set` | KEEP |
| ticket | `open`, `list`, `show`, `take`, `close`, `answer` | `--state` -> `--status`; `answer --why` -> `--reason`. FOLD `feedback add|close|list|check` into `ticket open --kind feedback` (two parallel stores with their own close and overdue checks today) |

### App layer (`starci app <verb>`) — acts on one product app (forwarded to @starci/hfs)

| verb | canonical actions | changes |
|---|---|---|
| scaffold | `scaffold <name> [--cwd] [--edition]` | `--into` -> `--cwd`; FIX the closing hint "next: starci npm ci" -> "next: npm ci" (main.mjs:416, scaffold/app.mjs:602; no `npm` group exists) |
| add | `add <noun> <name>` with nouns api, webhook, realtime, saga, job, reactor, queue, projection, cli, table, app, block, composite, branch, leaf, page, layout, overlay, **service, spec, image** | FOLD `app new service|spec|image` into `app add` (both generate into an existing app and never overwrite); options a noun does not take are refused, not ignored |
| upgrade | `upgrade [--execute]` | dry by default (today `--plan` is the dry flag and the default applies); FIX unreachable `--edition` refusal |
| sync | `sync [--execute]` | `--check` = the default dry run (exit 1 on drift), `--write` -> `--execute`; FOLD `app sonar` (one block of one managed file) into it |
| check | `check [--fast [--base]] [--staged] [--wiring] [--coverage-from] [--json]` | FOLD `app hygiene` into `app check --staged` (the pre-commit guard); gate per hfs 4.11.22: pass under 20 error findings with no hard blocker |
| lint | `lint [--changed ...|--workspace] [--side] [--fix] [--json] [--out <sonar file>]` | `--format json` -> `--json`; `--sonar <file>` -> `--out` |
| slot | `slot <path> [--json]` | RENAME `app explain` (it names the slot that owns a path) |
| emit | `emit` | drop the parsed-and-ignored `--json` |
| world | `world up|down|status` | RENAME the test-world `app stack up|down|status` out of `stack`, which is the Swarm deploy tooling; FIX template `"test:stack": "starci app stack"` (no action, fails) -> `"test:world": "starci app world status"` |
| stack | `prepare`, `connect`, `disconnect`, `build-args`, `render`, `build`, `deploy`, `accept`, `converge`, `verify`, `rollback`, `prune`, `retire`, `backup`, `jobs <action>`, `task <name>`, `ingress <action>` | FOLD `stack doctor` into `stack prepare` (its dry run is exactly doctor); `--source-sha` -> `--sha`; `--db-url-env` stays; `--env` required for effects; FIX refuse `--execute` and every action-foreign flag on read-only actions; FIX refuse `--reason`/`--remote` together with `--sha`/`--image` (today silently dropped) |
| stack deploy forms | `deploy --env E --urgent --reason "<text>" [--remote] [--execute]` (one command: release HEAD, build locally, deploy under the floor) and `deploy --env E --sha <sha> --image svc=ref [--urgent] [--execute]` | as shipped in 4.11.21 |
| release | `gate [--sha] [--backfill <tag>] [--execute]`, `push [--urgent --reason] [--remote] [--execute]` | `gate --source` -> `--sha`; DROP `gate --sonar` (added automatically when services.sonar is declared); `push --lint-baseline` stays refused one minor, then DROP |
| secret | `init`, `set`, `get`, `unset`, `rename`, `remove`, `materialize`, `list`, `verify`, `recipients`, `migrate`, `split`, `audit`, `server-key` | positional `<env>` -> `--env`; `recipients --add/--remove` become dry until `--execute` (today rewrites .sops.yaml at once); `sealed: vps` + `keys: [...]` per 4.11.21 |
| ci | `secret set`, `var set`, `var sync`, `verify`, `local` | `secret set` and `var set` dry until `--execute` (today write GitHub at once); `local --dry-run` -> dry default + `--execute`; document `ci local` |
| db | `new`, `baseline`, `restamp`, `migrate`, `post-cutover`, `dump`, `drift` | FOLD `db plan` into `db migrate` (its dry run already reads the history and prints the plan; keep plan's 0/1/2 exit codes there); `--apply` -> `--execute`; `--url-env` -> `--db-url-env`; FIX `post-cutover` refuses `--green-at` with `--owner-confirms-old-app-gone` |
| coverage | `merge --out`, `verify` | document `verify` |
| codemod | `codemod <name> [--execute] [--json] [--out]` | `--write` -> `--execute`; `--report` -> `--out` |

Overlaps kept on purpose (different object, said once in the help): `release push` (harness repo) vs `app release push`
(an app); `check lint` (harness) vs `app lint` (app); `stack backup` (volumes) vs `db dump` (database); `stack prune`
(Swarm objects) vs `stack retire` (old compose projects); the five stop verbs (task cancel, seat stop, supervisor reject,
workflow stop, project park) at five granularities; `secret migrate|recipients|server-key` (three different recipient
jobs); `doctor` / `host status` / `supervisor status` (three liveness views).

Net: harness 127 -> 120 verbs (drop check stories, check typecheck, release ci-status, workflow run, workflow regoal,
supervisor watch; move telegram-bridge); app layer 17 -> 15 verbs (new into add, hygiene into check, sonar into sync,
explain renamed slot, world split out of stack) and stack 18 -> 17 actions, db 8 -> 7.
