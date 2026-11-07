# StarCi harness bootstrap

Before planning, reading source or running a verb, read [contexts/README.md](contexts/README.md) and follow its load order. It names
what to read for your task, where state lives, how a project is found and the hard rules.

This checkout is the runtime root: the `starci` CLI is `node cli/dist/main.js` after `npm ci` in `cli/`, and harness
state lives in `.runtime/` here, never in a product repository. When you delegate or change directory, pass this
checkout's path and the project root on explicitly.

## Where the rules are

- Look a rule up before you act, in English and in several phrasings, and after every context compaction:
  [contexts/harness/rules.md](contexts/harness/rules.md) rule 7, as [contexts/README.md](contexts/README.md) "Looking a rule up" says.
- What your role may edit, commit, merge and push: [contexts/authority/README.md](contexts/authority/README.md); a branch:
  [contexts/authority/branch.md](contexts/authority/branch.md); a package edit and its local build:
  [contexts/authority/packages.md](contexts/authority/packages.md); removing a worktree: [contexts/authority/README.md](contexts/authority/README.md) "Worktrees".
- Run plain `starci app check` with no flags, everywhere
  ([contexts/project/check-cache.md](contexts/project/check-cache.md) "The operating procedure").
- An app's branches, `main` and `dev`: [contexts/project/branches.md](contexts/project/branches.md) PROJECT-BRANCH-1; the `dev` branch profile: [contexts/project/lint.md](contexts/project/lint.md) PROJECT-LINT-2.
- The host environment (Windows shims, Devin's `ACP_BACKEND`, `robocopy`, PowerShell encodings):
  [contexts/harness/host.md](contexts/harness/host.md).
