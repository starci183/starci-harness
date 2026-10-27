# Security policy

## Supported versions

Only the latest published version of `starci-harness` and of each package under `packages/` receives security fixes.
While the CLI is in its `1.0.0-alpha` line, a fix lands in the next alpha.

## Reporting a vulnerability

Report it privately through GitHub's security advisories: open
[a private vulnerability report](https://github.com/starci183/starci-harness/security/advisories/new) on this
repository. Do not open a public issue, pull request or discussion for it.

Say what is affected (the CLI verb, a package, CI), how to reproduce it and what an attacker gains. Never paste a live
secret: describe where it is instead. The maintainer answers in the advisory; a confirmed issue is fixed, released
and then disclosed there, with credit if you want it.

## Scope

The harness runs agents and host processes on the machine that runs it, and stores its ledgers under its state base
([contexts/harness/state.md](contexts/harness/state.md)). In scope: a verb that acts outside its stated effect, a path
lease or settle that commits outside a task's `allowPaths`, a secret that reaches a commit, a log or the repository
past `starci check secrets`, and the CI workflow's handling of its tokens. Out of scope: what an agent you launch does
with the permissions you gave it.
