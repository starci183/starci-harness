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

- **A long-lived dev process is started outside the desktop app.** A process started from an agent's shell inside a
  desktop agent app (a dev stack, a dev server, a watcher, a tunnel) is a child of that app and dies when the app
  updates or restarts, mid-session and without a message. Start anything that must outlive the session through a launcher
  of the operating system, such as a scheduled task that runs once and at once (`schtasks /Create /SC ONCE ... /F`, then
  `schtasks /Run /TN <name>`, on Windows; `systemd-run --user` or `nohup setsid` elsewhere), with its output sent to a
  log file, and read its state from the stack's own status verb and that log, never from the shell that started it.
  A short command, a check or a build stays in the agent's shell. Why: a stack that vanishes with the app looks like a
  crash of the stack, and the session that follows debugs a failure that never happened. Held by review.

## The host stack

- **One compose stack, defined in the harness.** The containers the harness itself needs on a host (the shared SonarQube, its
  database, its admin bootstrap, its public tunnel, and the local npm registry on 127.0.0.1:4873) are one Compose project,
  `starci`, whose files are [ops/host/stack/](../../ops/host/stack/) and nowhere else; [ops/host.yaml](../../ops/host.yaml)
  declares each as a service with `stack: starci`. Bring it up with `starci host up --stack starci`, read it with
  `starci host status --stack starci`: both are idempotent and neither recreates a running container. Never start one of these
  containers by hand with `docker run` or from a compose file of another folder: a container compose did not create blocks the
  stack's own, and one loaded from another path keeps running a definition nobody maintains.
- **Data lives in named volumes.** The stack's volumes (`starci-sonarqube-*`, `starci-local-registry-storage`) outlive their
  containers. `host down` stops containers and removes nothing; never run `docker compose down -v` or `docker volume rm` on them
  without the owner's yes ([rules.md](rules.md) rule 2).
- **A full disk makes Docker read-only.** When the drive that holds Docker Desktop's data is full, every write to the Docker
  store fails with `read-only file system` (a build, a container removal) and stays so after space is freed, until Docker
  Desktop restarts. Free space first, then ask the owner to restart it: a restart stops every stack on the host.

## Dependencies through a link

A package manager command that writes `node_modules` never runs through a link. npm, pnpm and yarn rewrite the folder they install into:
through a junction or a symlink that folder is another checkout's install or the harness install cache, and an `npm ci` there empties the
install every checkout linked to it uses. The writing commands are `ci`, `install` (`i`, `add`), `uninstall` (`remove`, `rm`), `update`,
`prune`, `dedupe`, `rebuild`, `link`, `unlink` and their aliases, of npm, pnpm and yarn (a bare `yarn` installs). A command is refused when
its target's `node_modules` is a junction or symlink, or is a real folder another worktree of the same repository links its own
`node_modules` to. It is judged wherever it hides: chained (`&&`, `||`, `;`, `|`), sent to the background (`&`, `start /b`, a host's
background run), wrapped (`cmd /c`, `sh -c`, `powershell -Command`), after a `cd`, or aimed with `--prefix`, `-C`, `--dir` or `--cwd`. To
install a linked checkout, remove only the link (a plain unlink, never a recursive delete through it) and install its own lockfile.

The judge is one: `installRefusals` of `cli/src/harness/install-guard.ts`. The CLI's own installs ask it before npm runs
(`DEPS_INSTALL_LINKED`, `DEPS_INSTALL_SHARED`, `cli/src/core/deps/packages.ts`), and every agent host asks it before a shell command
through `starci host guard --hook`, its pre-tool hook (Claude Code: a `PreToolUse` hook on the shell tool running
`node <runtime root>/cli/dist/main.js host guard --hook`; the verb answers the deny decision on stdout). `starci host guard <line>` judges a
line by hand. Why: one `npm ci` in a lane whose `node_modules` was a junction emptied the install every other lane ran on.

## Files and folders

- **`robocopy /MIR` follows junctions.** It can delete through a directory junction (a worktree's `node_modules`). Always
  add `/XJ`.
- **PowerShell writes the ANSI code page.** `Set-Content` and `Add-Content` default to it and corrupt UTF-8 text. Edit
  files with the editor tools, or pass `-Encoding utf8`.
