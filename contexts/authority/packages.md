# Package edits

An app session, or a worker whose input names a `@starci` package (the Supervisor dispatches one for a package defect),
fixes that package, never a shim in the app. The edit is a tier 1 branch ([branch.md](branch.md)) of the harness repository:

1. `starci pkg branch <topic>` cuts `pkg/<app>-<topic>` into a worktree under the harness's `.claude/worktrees/`.
2. Edit and commit there. Bump only the package you changed, with its CHANGELOG entry, in the commit that changes it; a
   package that requires it moves only when it needs the new API.
3. Publish the changed package to the local registry, the one build a branch takes, and install it in the app (below).
4. `starci pkg handoff` (`--urgent` when a deploy waits on it: Debug lands it on main first).

The edit's proof is the package's own gates where the edit is: `starci pkg test <package>` runs its typecheck, lint and
specs in `packages/<name>` of the package edit worktree. The editor runs none of it (a branch runs no tests); a Supervisor
worker's contract carries it as its `package-specs` check, which the harness runs when the worker is accepted.

Debug alone merges a package edit branch and pushes harness main; once its handed-off head is on main, the worktree goes
(the collector of [README.md](README.md) "Worktrees"); CI publishes the bumped version as soon as main is
green ([ci.md](ci.md)). Nobody asks Debug to publish: a change already on harness main is published by CI and is no handoff at all. Only the edited package is bumped and re-pinned: the app that consumes it pins the new version,
and no other package or app moves.

## The local registry: an urgent package change is used at once

An app uses an unreleased package edit (`@starci/hfs`, the CLI, a canon, the Grammar) at once, through one route: the npm
registry on 127.0.0.1:4873, installed like npm. There is no other way: nothing is linked or copied into an app's
`node_modules`, so every checkout, verify and walk runs the package its lockfile names. The registry is the compose host service
`local-registry` of [ops/host.yaml](../../ops/host.yaml) (compose file and config in [ops/host/registry/](../../ops/host/registry/),
storage in `local-registry/storage` of the shared state base): `starci host up local-registry` starts it, `starci host status`
reports it, `starci host down local-registry` stops it, and `deps publish-local --execute` runs that same `host up` when it does
not answer. A registry that answers is left as it is ([cli/README.md](../../cli/README.md) "A local registry").

The flow, in order:

1. In the package edit's worktree, `starci deps publish-local --execute --cwd <worktree>` builds the packages the branch changed
   (or the ones `--package` names) and publishes each under a version of its own, the next of its `-local` series (`1.2.3` as
   `1.2.4-local.<n>`). The version in git never changes; a registry version is immutable, so each publish takes a new number.
2. In the app, `starci deps install-local <package>... --execute` installs the latest local version of each named package like npm:
   every requirement of it in the app's manifests is raised to that version (an `overrides` entry for a package only another
   package requires, hfs through `starci-harness`; the CLI is named `starci-harness`), `@starci` resolves from the registry and nothing else does, and
   `install-local.json` in the untracked tool cache of the app (slot `app.tool-cache`) records the pins it replaced.
3. The app verifies the change with `starci app check` (`--env local`, the default). Each published build carries a source digest, so the
   check cache a run on it writes holds the keys of the npm build of the same source and survives step 4; the pins naming a local build are
   listed `LOCAL, REPORT ONLY` and the run ends `green for local (not pushable)` ([check-cache.md](../project/check-cache.md) "The operating procedure").
   The pre-push hook, CI and the release gate run `--env prod`, which blocks on them.
4. Before a commit, `starci deps install-local --restore` puts the recorded npm pins back and installs them from npm.
   GitHub CI cannot reach 127.0.0.1, so a lockfile or `.npmrc` that names the registry is refused
   `DEPS_LOCAL_REGISTRY_COMMITTED`, and a pin only the registry holds is refused `DEPS_PIN_UNPUBLISHED`, by `starci deps check`.
5. CI publishes the release to npm ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20); it never gates the app's verification. The
   app pins the version npm serves once it does.

It is no publication: nothing in the registry reaches npm. A project whose state folder still records a package overlay
(`deps-local.json`) is refused `DEPS_OVERLAY_REMOVED` by `deps install-local`, `deps check` and the install a check gives its
checkout; `starci deps install-local --restore` clears that record and runs `npm ci`.

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
