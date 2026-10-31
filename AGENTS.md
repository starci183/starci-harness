# StarCi harness bootstrap

Before planning, reading source or running a verb, read [contexts/README.md](contexts/README.md) and follow its load order. It names
what to read for your task, where state lives, how a project is found and the hard rules.

This checkout is the runtime root: the `starci` CLI is `node cli/dist/main.js` after `npm ci` in `cli/`, and harness
state lives in `.runtime/` here, never in a product repository. When you delegate or change directory, pass this
checkout's path and the project root on explicitly.

## Look it up before you act

The tree is too large to hold in context, and a context compaction or a resumed session drops what you read: after one,
start again here. Before answering, planning, or writing a brief, translate the request into English (keep rule ids and
names as written) and look it up ([contexts/README.md](contexts/README.md) "Looking a rule up"):

```sh
node cli/dist/main.js contexts search "<request>" --also "<action>" --also "<artifact or rule id>" --scope <area> --limit 10
```

Open each hit you rely on and cite its rule id and path. A brief states every "never", "must" or "wait for" with that
citation, in the rule's words, and tells its reader (a subagent of any host knows only its brief) to look up the same way.
A rule found missed is recorded in the search eval and hardened where it lives (contexts/README.md "When a rule was
missed"). This holds for every agent host (Claude Code, Codex, Devin): it is part of the bootstrap every host reads, not a
feature of one runtime ([contexts/harness/rules.md](contexts/harness/rules.md) rule 7).

Rules that are easy to forget:

- A package change is usable in an app the moment it is coded: `starci deps source --local`; only a deploy waits for npm
  ([contexts/authority/packages.md](contexts/authority/packages.md) "An app uses the edit before npm serves it", CONTRIB-20).
- No role removes a harness worktree by hand: `starci worktree gc --execute` unlinks its `node_modules` junctions as links
  first, while `git worktree remove` or a recursive delete through a junction empties its target
  ([contexts/authority/README.md](contexts/authority/README.md) "Worktrees").
- In a shared checkout, commit only your paths through a temporary index (`GIT_INDEX_FILE`), never the shared index.

## Environment gotchas

- `ACP_BACKEND=windsurf` leaks into shells spawned from Devin Desktop and makes the `devin` CLI take the Windsurf auth
  branch, rejecting valid Devin credentials. Before spawning `devin`: `Remove-Item Env:ACP_BACKEND` (PowerShell) or
  `env -u ACP_BACKEND` (POSIX).
- On Windows a `.cmd` or `.bat` shim (`npm.cmd`, `npx.cmd`) cannot run without a shell. Run `node.exe` with the tool's
  script instead; the CLI does this for npm and refuses a `.cmd` with that hint.
- `robocopy /MIR` follows directory junctions and can delete through them. Always add `/XJ`.
- PowerShell `Set-Content` and `Add-Content` write the ANSI code page and can corrupt UTF-8 text. Edit files with the
  editor tools, or pass `-Encoding utf8`.
