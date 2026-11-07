# Package edits

An app session, or a worker whose input names a `@starci` package (the Supervisor dispatches one for a package defect),
fixes that package, never a shim in the app. The edit is a tier 1 branch ([branch.md](branch.md)) of the harness repository:

1. `starci pkg branch <topic>` cuts `pkg/<app>-<topic>` into a worktree under the harness's `.claude/worktrees/`.
2. Edit and commit there. Bump only the package you changed, with its CHANGELOG entry, in the commit that changes it; a
   package that requires it moves only when it needs the new API.
3. Build the changed package, the one build a branch takes, and link it into the app (below).
4. `starci pkg handoff` (`--urgent` when a deploy waits on it: Debug lands it on main first).

The edit's proof is the package's own gates where the edit is: `starci pkg test <package>` runs its typecheck, lint and
specs in `packages/<name>` of the package edit worktree. The editor runs none of it (a branch runs no tests); a Supervisor
worker's contract carries it as its `package-specs` check, which the harness runs when the worker is accepted.

Debug alone merges a package edit branch and pushes harness main; once its handed-off head is on main, the worktree goes
(the collector of [README.md](README.md) "Worktrees"); CI publishes the bumped version as soon as main is
green ([ci.md](ci.md)). Nobody asks Debug to publish: a change already on harness main is published by CI and is no handoff at all. Only the edited package is bumped and re-pinned: the app that consumes it pins the new version,
and no other package or app moves.

## An app uses the edit before npm serves it

A package change is usable in the app the moment it is coded, long before it reaches npm: `starci deps source --local --cwd
<worktree>/packages`, as `pkg branch` prints it, links the built package into the app ([cli/README.md](../../cli/README.md)
"Package sources"), and the app's checks, verifies and walks run on that local build. Nothing waits for npm but a deploy:
an app that deploys pins the version once npm serves it (`starci deps check` says so), and CI publishes it as soon as main
is green ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20).

### Or install it like npm

When the app should install the edit instead of receiving a copy, `starci deps publish-local --execute` (`--cwd <worktree>`) builds the packages and publishes the versions npm lacks to the registry on 127.0.0.1:4873. That registry is the compose host service `local-registry` of [ops/host.yaml](../../ops/host.yaml) (compose file and config in [ops/host/registry/](../../ops/host/registry/), storage in `local-registry/storage` of the shared state base): `starci host up local-registry` starts it, `starci host status` reports it, `starci host down local-registry` stops it, and `deps publish-local --execute` runs that same `host up` when it does not answer. A registry that answers is left as it is, and there is no other way to run it. An app in `deps source --local` mode first runs `deps source --npm` to clear its recorded overlay, then runs `npm install @starci/<package>@<version> --@starci:registry=http://127.0.0.1:4873/ --replace-registry-host=never` with the pin raised ([cli/README.md](../../cli/README.md) "A local registry"). It is no publication ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20): the lockfile it writes is restored before a commit, and `DEPS_LOCAL_REGISTRY_COMMITTED` refuses a push that keeps it.

## Grammar edits are content only

A Grammar edit changes content: a component, its CSS, its props, and a story for a state it newly renders. Its proof is
the package's `typecheck`, its literal lint and `build` (`npm test` runs exactly those). The lint is ESLint and Stylelint config
(`eslint.config.ts`, `stylelint.config.ts`): a component or stylesheet holds no hardcoded colour, radius, type size, shadow,
motion, opacity or off-scale spacing, and reads a token or a ramp of `src/common/ramps.css`. It adds no spec suite or test helper;
it runs no Storybook plays and no DNA measurement locally; it bumps and re-pins only `@starci/grammar`. The plays and the DNA gate are
CI's ([ci.md](ci.md)), and a defect is fixed in the component and hardens the rule it broke. Apps on the Grammar keep no
front-end tests either (`SHARED-TEST-1`).

Other packages keep their specs ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-2): a rule change is written with the
spec that holds it, and CI runs it.
