# StarCi harness bootstrap

Before planning, reading source or running a verb, read [contexts/README.md](contexts/README.md) and follow its load order. It names
what to read for your task, where state lives, how a project is found and the hard rules.

This checkout is the runtime root: the `starci` CLI is `node cli/dist/main.js` after `npm ci` in `cli/`, and harness
state lives in `.runtime/` here, never in a product repository. When you delegate or change directory, pass this
checkout's path and the project root on explicitly.

## Environment gotchas

- `ACP_BACKEND=windsurf` leaks into shells spawned from Devin Desktop and makes the `devin` CLI take the Windsurf auth
  branch, rejecting valid Devin credentials. Before spawning `devin`: `Remove-Item Env:ACP_BACKEND` (PowerShell) or
  `env -u ACP_BACKEND` (POSIX).
- On Windows a `.cmd` or `.bat` shim (`npm.cmd`, `npx.cmd`) cannot run without a shell. Run `node.exe` with the tool's
  script instead; the CLI does this for npm and refuses a `.cmd` with that hint.
- `robocopy /MIR` follows directory junctions and can delete through them. Always add `/XJ`.
- PowerShell `Set-Content` and `Add-Content` write the ANSI code page and can corrupt UTF-8 text. Edit files with the
  editor tools, or pass `-Encoding utf8`.
