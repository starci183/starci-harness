# Lanes

A lane is one session (a chat agent or an Orca seat) working one branch `lane/<lane>` in its own worktree of an app, cut from the
app's integration branch (`dev`, [project/branches.md](../project/branches.md) PROJECT-BRANCH-1). Many lanes share one host and one
lanes folder. A lane brief is this file plus the task: read it, then call the verbs below. A lane never writes its own lock,
slot or landing script; every step that coordinates with other lanes is a verb.

## The lane's name and its folder

- **Name.** Set `STARCI_LANE=<lane>`, or work on the branch `lane/<lane>`; every verb below reads it from there (`--lane` overrides).
  A verb that cannot tell the lane refuses `SLOT_LANE_UNSET`, so no slot names a lane that does not exist.
- **The slot root and lanes folder** are one folder: `--dir`, else `STARCI_LANES_DIR`, else `slots.root` of `ops/slots.yaml`
  (`starci config set slots.root <dir>`), else `<harness state>/slots`. The coordinator sets it once per host.
- **The CLI** is the worktree's own, `node_modules/.bin/starci` after its install, so the judge is the harness the app pins. A
  global or another checkout's CLI reports false pin drift. `HFS_CLI_HFS_SKEW` means reinstall, never `STARCI_ALLOW_CLI_SKEW`.

## Slots

The heavy-command governor ([cli/README.md](../../cli/README.md) "Heavy-command governor") admits by RAM inside one harness
state, and a CLI installed in an app's `node_modules` has a state of its own. The machine-wide slots of `ops/slots.yaml` are
what bound heavy work across worktrees: `npm` (an install), `gate` (a full `app check` or a push), `shoot` (a web dev server
for shots), `stack` (the shared stack and its main checkout). Each kind has a count, and some a burst opened only with free RAM.

| verb | does |
|---|---|
| `starci slot run <kind> -- <command...>` | holds a slot for exactly the command's life, recording this process; npm and npx run through the governor |
| `starci slot take <kind> [--pid <pid>]` | holds a slot until released; `--pid` names the long-lived process it belongs to (in Git Bash, `$(cat /proc/$$/winpid)`) |
| `starci slot release <kind>` | releases the lane's own slots, each only once read and found to name the lane |
| `starci slot list [kind]` | every slot with its lane, age, whether the holder is alive (yes, no, unknown), whether it is reclaimable, pid and state |
| `starci slot release <kind\|all> --stale` | reclaims every slot whose holder is proven gone |

- **Prefer `slot run`.** A slot held by a command cannot outlive it; `slot take` is for a step that spans several commands.
- **Release only your own.** A slot is removed only after it is read and names your lane; another lane's slot is never deleted by hand.
- **Reclaim only on evidence.** A slot line is `<lane> <taken> pid=<pid> start=<pid start> boot=<host boot> host=<host>`. A take,
  or `slot release --stale`, reclaims a slot only when its holder is proven gone: its pid is not alive, its pid runs a process
  started at another time, or the host booted after it was taken. Each reclaim is logged with its evidence in `<root>/_slots.log`.
  Age is never evidence: a slot past its kind's `warnMinutes` is listed `old`, and the coordinator asks its holder.
- **One slot per lane per kind.** `slot take`, `slot run` and `lane gate` return the slot the lane already holds, whoever wrote its file (the old
  `_gate-slot-N.lock` helper too), so a retried gate never takes a second one; a leaked duplicate of the lane written by the old helper is released
  on the way. A slot held by `slot run` or `lane gate` is released in a `finally`, on SIGINT, SIGBREAK, SIGHUP and SIGTERM and on `process.exit`.
  On Windows a process killed outright (`taskkill /F`, `process.kill`, a dead parent) runs nothing: its slot records its pid, and the next take reclaims it as `dead`.
- **Locks with no pid** (the old helper writes `<lane> <time>` alone) cannot be probed. They are reclaimable (`gone`) once their lane has no worktree: no
  worktree of the repositories under the slot root exists on disk whose folder ends in `/<lane>` or which has `lane/<lane>` checked out (where the slot root
  holds no repository, `_land-status/<lane>.json` saying `landed` or `rejected` stands in), or taken before this boot (`rebooted`). Otherwise they are
  only reported, `old` past `warnMinutes`. Name the lane after its worktree folder or its `lane/<lane>` branch, or its old-format lock can be reclaimed.
- **A lane lets go of its slots.** The batch lander releases every slot a lane holds, of any kind, once it lands or is rejected, and `starci lane remove`
  does so as part of the removal (its dry run lists them; `--dir` names the slot root). Each release is logged in `_slots.log`.
- **Never hold a slot while you wait** for a review, an audit or another lane; take it for the run, then let it go.

## The shared stack

The shared stack of an app (its dev database, its running api, its main checkout) belongs to the coordinator and the dev refresh.
A lane never runs `stack up`, never applies a migration to the shared database, never edits or installs the main checkout, and
never starts a second api against the shared database. Whoever is allowed to touch it holds the `stack` slot for the whole of it
(`starci slot run stack -- <command>`), leaves the main checkout fast-forwarded to the remote integration branch, never to an
unpushed lane commit, and releases. A migration a lane adds is additive and applied by the refresh once landed.

## Gate and land

The owner's rules for the gate of a lane, in his words:

> "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn"

> "dồn!!! nhiều changes thì gộp 1 commit duy nhất và ci làm kiểu nếu push commit mới thì cancel lun commit cũ"

A lane lands on dev, so every gate of this section is the FAST level, `app check --env prod --level dev`, once per push: the deps
check (local-registry pins allowed where hfs.json declares `deps.devAllowsLocalRegistry`), types with its package builds and codegen,
the lane's own tests (the unit specs its diff touches and the ones whose closure reaches a changed file), db and the owner's design
approval (HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED still blocks). The hfs rule sweep, the rule-188 first audits, the ui-audit
stale and missing blocks, the nivoos package checks, the whole test suite, sonar and coverage run once at the main cut
(`--level full`); a red full run is fixed in a hardening lane before the cut. screen.yaml and audit records may be completed there.

One verb runs the local gate, one registers, one lander lands (PROJECT-BRANCH-2):

1. `starci lane gate --push --ready` in the worktree, tree committed: it merges `origin/dev`, runs `npm ci` under an `npm` slot when
   the merge changed a manifest or lockfile (`--install` forces it), runs `codegen` (and `build:modules` after an install), then
   under a `gate` slot the app's own `app push origin HEAD:lane/<lane>`, whose pre-push hook runs the fast level once, and
   registers the pushed sha with the lander. Without `--push` it runs `app check --env prod --level dev` only and reports the
   findings. A new `lane gate` of the same lane first cancels the lane's running gate: its process tree is killed, its slot
   released and its status says `superseded by <sha>`. A merge conflict refuses `LANE_GATE_CONFLICT` with its files: resolve, commit, run it again.
2. Monitor `<lanes>/_land-status/<lane>.json` (`starci lane status <lane>`): `queued`, `landed` (`sha`, `migrations`), `conflict`
   (`requeued: true` means wait for the next batch), `rejected` (`findings`; `LANE_LAND_PREPARE` when the lane alone fails the batch's
   npm ci, codegen or `build:modules`) or `parked` (out of memory, register again).
   A rejection or a conflict with `origin/dev` is fixed in the lane, gated again and registered again.
3. `starci lane withdraw <lane>` takes the lane out, also while a batch has it: status `withdrawn` (`fromBatch`), and that batch aborts
   (the lander re-reads the ready set before each gate run, after it and right before the push) and re-forms without it; the other
   lanes read `re-formed` and are gated again. A withdrawn lane never lands. A lane registered again with a new sha does the same to
   its old batch: the running batch gate is cancelled (its process tree killed), the batch re-forms, and the lane's status reads
   `queued` at the new sha with `supersededBy`.
4. The lander lands a batch as ONE commit on `dev`: the merges it gated become one commit with the same tree and `origin/dev` as
   its parent, whose message lists every lane with its branch and sha and carries one `Landed-lane: <lane> <sha>` trailer each.
   Every landed lane's status points at that commit. The lander (`starci lane land`) is one process per repository and
   lanes folder that the coordinator starts; a lane never starts it, never pushes `dev` and never takes the dev lock.

**A harness lane** (a worktree of the harness repository itself, [project/branches.md](../project/branches.md) PROJECT-BRANCH-3) runs the same three
verbs. `lane gate` picks the harness profile there (or `--profile harness`): it merges `origin/dev`, installs nothing at the root, runs under the
gate slot the harness FAST gate `starci release gate --level dev` (the build, typecheck and tests of the packages the lane changed and of their
dependents, the CLI and the desktop app when affected) and with `--push` pushes `lane/<lane>` with git once it is green. The harness lander
(`starci lane land` started in the harness checkout) takes only the harness's lanes from the shared lanes folder, gates the batch the same way and
pushes `dev` with `git push origin HEAD:dev`; the squash, the cancel on a newer registration and the status files are the app lander's. With
`devSync.publishLocal` it publishes the landed packages to the local registry (`deps publish-dev`) and the app's dev sync installs them.

A lane never adds an hfs exception (that needs the owner: stop and report), never uses `--no-verify` and never force-pushes; the
pre-push hook needs `.husky/_` present. Before every commit run `git diff --cached --stat`.

## Shots

`starci gallery shoot --serve "<web dev server, {port}>" --port <n> [--ready-url <api health>] -- <the app's capture command,
{url}>` waits for the api and a `shoot` slot (which waits for the kind's free RAM), starts the server, waits until it listens,
runs the capture, then kills the server by the pid it started and releases the slot. Shoot every screen you need in one go.
Screens, sizes (1440 and 390) and what a shot records are the app's gallery rules ([project/gallery.md](../project/gallery.md)).

## Processes and cleanup

- Kill only processes you started, by the pid you recorded; never by a command-line pattern (`node`, `next`, a script name),
  which other lanes run too. The verbs above stop what they start.
- Code first: no new unit specs, existing specs stay green; integration and e2e suites run only when asked (R12).
- At the end stop every process you started and remove the worktree as [README.md](README.md) "Worktrees" says (unlink each
  install link first, never delete through it); keep the branch. Report what landed (the dev sha), what is open, and what needs
  the owner.
