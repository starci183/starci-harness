# Package edits

An app session, or a worker whose input names a `@starci` package (the Supervisor dispatches one for a package defect),
fixes that package, never a shim in the app. The edit is a tier 1 branch ([branch.md](branch.md)) of the harness repository:

1. `starci pkg branch <topic>` cuts `pkg/<app>-<topic>` into a worktree under the harness's `.claude/worktrees/`.
2. Edit and commit there. Bump only the package you changed, with its CHANGELOG entry, in the commit that changes it; a
   package that requires it moves only when it needs the new API.
3. Build the changed package, the one build a branch takes, so the app can link it: `starci deps source --local --from
   <worktree>/packages` as `pkg branch` prints it.
4. `starci pkg handoff` (`--urgent` when a deploy waits on it: Debug lands it on main first).

Debug alone merges a package edit branch and pushes harness main; CI publishes the bumped version as soon as main is
green ([ci.md](ci.md)). Nobody asks Debug to publish: a change already on harness main is published by CI and is no handoff at all, and an app that deploys waits until npm serves the version it pins (`starci deps check` says so), working locally meanwhile. Only the edited package is bumped and re-pinned: the app that consumes it pins the new version,
and no other package or app moves.

## Grammar edits are content only

A Grammar edit changes content: a component, its CSS, its props, and a story for a state it newly renders. Its proof is
the package's `typecheck` and `build` (`npm test` runs exactly those). It adds no spec suite, test helper or test config;
it runs no Storybook plays and no DNA measurement locally; it bumps and re-pins only `@starci/grammar`. The plays and the DNA gate are
CI's ([ci.md](ci.md)), and a defect is fixed in the component and recorded as an owner ruling. Apps on the Grammar keep no
front-end tests either (`SHARED-TEST-1`).

Other packages keep their specs ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-2): a rule change is written with the
spec that holds it, and CI runs it.
