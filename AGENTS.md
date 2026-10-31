# StarCi harness bootstrap

Before planning, reading source or running a verb, read [contexts/README.md](contexts/README.md) and follow its load order. It names
what to read for your task, where state lives, how a project is found and the hard rules.

This checkout is the runtime root: the `starci` CLI is `node cli/dist/main.js` after `npm ci` in `cli/`, and harness
state lives in `.runtime/` here, never in a product repository. When you delegate or change directory, pass this
checkout's path and the project root on explicitly.

## Look it up before you act

The tree is too large to hold in context, and a context compaction drops what you read earlier. Before answering, planning,
or writing a brief, translate the request into English (keep rule ids and names as written), run
`node cli/dist/main.js contexts search "<question>"` ([contexts/README.md](contexts/README.md) "Two layers of context"),
open the hit's file and quote its rule id and path. A brief never states "never", "must" or "wait for" without that
source; a half-remembered rule is how a wrong one spreads to every lane.

Rules that are easy to forget:

- A package change is usable in an app the moment it is coded: `starci deps source --local`; only a deploy waits for npm
  ([CONTRIBUTING.md](CONTRIBUTING.md) CONTRIB-20).
- Before `git worktree remove`, unlink any `node_modules` junction inside the worktree (`rmdir` on the link itself);
  removing through a junction empties the target.
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
