# The host environment

What a shell on the harness host does differently from the textbook, and the one way to work with it. Every role and host
(Claude Code, Codex, Devin) reads it before spawning a tool on Windows or from a Devin Desktop shell.

## Spawning a process

- **Devin's backend variable.** `ACP_BACKEND=windsurf` leaks into shells spawned from Devin Desktop and makes the `devin`
  CLI take the Windsurf auth branch, which rejects valid Devin credentials. Before spawning `devin`, drop it:
  `Remove-Item Env:ACP_BACKEND` (PowerShell) or `env -u ACP_BACKEND` (POSIX).
- **No `.cmd` shim without a shell.** On Windows a `.cmd` or `.bat` shim (`npm.cmd`, `npx.cmd`) cannot run without a
  shell. Run `node.exe` with the tool's script instead; the CLI does this for npm and refuses a `.cmd` with that hint
  (`cli/src/shared/exec.ts`).

## Files and folders

- **`robocopy /MIR` follows junctions.** It can delete through a directory junction (a worktree's `node_modules`). Always
  add `/XJ`.
- **PowerShell writes the ANSI code page.** `Set-Content` and `Add-Content` default to it and corrupt UTF-8 text. Edit
  files with the editor tools, or pass `-Encoding utf8`.
