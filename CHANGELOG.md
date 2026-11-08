# Changelog

## 1.1.0-alpha.101 - 2026-11-09

- Changed: the CLI requires `@starci/hfs` 6.4.0 once npm serves it (cli-follow). In it: `local.basePort` and R389, the role table of the native dev ports (front end base, api base+1, AI gateway base+2, the rest above, within base..base+99), with the doctor rows for the role table, an overlap with another app on the machine and the reserved 3900..3999 UI preview range; `starci app add queue|job` in a full app renders the one persisted Redis (manifest component, swarm and dev compose services, `QUEUE_REDIS_HOST`/`QUEUE_REDIS_PORT`, keys, images lock) and refuses `HFS_ADD_PLATFORM_MISSING` before writing when the platform capabilities its tree imports are missing; `@starci/eslint-canon-be` 3.20.2, `@starci/eslint-canon-fe` 9.16.9 and the Grammar lint family 0.27.1 peer `@starci/hfs ~6.4.0`.

## 1.1.0-alpha.100 - 2026-11-09

- Added: `yaml` 2.9.1 in contexts/stack/pins.yaml (framework, back end): the YAML and front-matter parser of a back end's content importers, the version the harness packages already resolve.
- Changed: this alpha carries alpha.99 and the next batch together (alpha.99 never reached npm: its CI was red on a committed `.cli-build.log`, the `packages/<name>/scripts/*.ts` build files and a lint error in a CLI test). The CLI's own `@starci/hfs` dependency stays at what npm serves (6.2.10); cli-follow moves it to 6.3.1 once npm serves it. `.cli-build.log` is no longer tracked, `packages/<name>/scripts/*.ts` belong to the `packages.build-config` slot, and the `hfs-command-runner` test doubles are typed without assertions.
- Changed: `@starci/hfs` 6.3.1 (with the 6.3.0 it carries: the sharded cache verify and the same-sha lock clearing, the single judgement of the release gate, `@starci/common`; and in 6.3.1 `starci app codemod common-base` deletes the specs of the re-exports it writes and re-exports only imported names, `HFS_EMPTY_DIR` skips git-ignored directories, `STACKS_PORT_PUBLISHED` accepts a host-mode ingress on 80/443 with a placement or global deploy), `@starci/common` 1.0.1 (CommonJS and ESM over one class identity, `params` and `cause` accept `undefined`, `ErrorParams` a named interface), `@starci/eslint-canon-be` 3.20.1 and the Grammar family 0.27.0 (card inset 16, `EmptyNotice actionIntent`; 0.26.0 never reached npm).

## 1.1.0-alpha.99 - 2026-11-08

- Changed: the CLI requires `@starci/hfs` 6.3.0 once npm serves it (cli-follow). In it `starci app release gate` reuses the verdict of its `app-check` row for the rows that command already judges (typecheck, build, lint, test and coverage, audit, format, db lint and drift) and runs no child for them, and a row that still runs a heavy command goes through the governor. `hfsCommandRunner` takes the `test` kind: the command runs under the jest parent's heap, the worker heap preload and the workers the room holds, an `npm run <script>` getting `--maxWorkers` and `--workerIdleMemoryLimit` after `--` (`sizedTestArgv`), and an out-of-memory exit names the heap cap it hit (`withOomNote`) as it already does for the node tools. Docs: `contexts/project/check-cache.md` "Release with starci app release gate", `cli/README.md` "Heavy-command governor". Spec: `core/app/hfs-command-runner.test.ts`. It also shards the managed `cache-verify.yml` into one job per family, lets a green verify of a release's own sha (dispatched on `dev`) clear the verify lock, and makes `@starci/common` the shared error base. Docs: `contexts/project/check-cache.md` "The nightly verify".
- Changed: `starci app <verb> --json` streams the verb's stderr as it prints it (an app check's progress lines) and keeps the one envelope on stdout; the progress of a `--json` run no longer arrives only at its end.

## 1.1.0-alpha.98 - 2026-11-08

- Changed: the CLI requires `@starci/hfs` 6.2.10 once npm serves it (cli-follow). In it, FE_WORLD_OWNER_RENDER_BOUNDARY and FE_CONNECTED_BLOCK_RENDER_PAIR accept a pure component that returns a ReactNode prop as is (`(props) => (props.active ? props.candidate : null)`), the form the canon's `no-useless-fragment` (Sonar S6749) leaves once the wrapping fragment goes; a module constant, a hook value or a call result still fails.

## 1.1.0-alpha.97 - 2026-11-08

- Changed: `starci app check` runs its steps one after another and sizes each on the RAM and cores free when it starts (`@starci/hfs` 6.2.9): the unit run no longer shares a lane pool with lint, hfs, tsc and wiring, so it takes the workers its room holds (`testRunSizing`) instead of `--maxWorkers=1`. `maxWorkers` and `options.workers` of the governor remain a cap a caller names (the jest discovery asks for one worker); the app check test step names none.
- Added: `hfsLimitsEnv` hands the tsc heap cap to `@starci/hfs` as `STARCI_TSC_HEAP_MB`, with the ESLint one, so the types step sizes its programs by the room. The docs of the sequential run are `contexts/project/check-cache.md` "Orchestration" and "The memory plan", `cli/README.md` "Heavy-command governor" and `ops/liveness.yaml` `heavy`. The pin of `@starci/hfs` in `contexts/stack/pins.yaml` and `canon-pins.yaml` is 6.2.9; the CLI's own dependency on it follows once npm serves 6.2.9 (cli-follow).

## 1.1.0-alpha.96 - 2026-11-08

- Fixed: the lint of every app ended in `ESLint tool error: eslint source scope is unavailable ... unsupported canon ignores selectors`, because the canons' new test-scope Sonar way block used a negated `ignores` selector that the lint scope refuses. `@starci/eslint-canon-fe` 9.16.7 and `@starci/eslint-canon-be` 3.19.7 select the specs with a positive selector, and `@starci/hfs` 6.2.7 pins them and holds a spec that runs `canonScope` over the built config of both canons.
- Fixed: the harness CI gates of the previous release: `starci check heavy-sites` counts `npm unpublish` and `npm install --package-lock-only` as light npm calls (they withdraw or resolve metadata and build nothing), and the generated `contexts/project/index.md` is regenerated (`starci contexts anatomy --execute`).

## 1.1.0-alpha.95 - 2026-11-08

- Changed: `deps publish-local` publishes each package under the version committed in git (`@starci/hfs` 6.2.3 stays 6.2.3), never a `-local` one, so the pins, a canon's `~6.2.0` peer and the check cache keys are the ones the npm build has and an install needs no `--legacy-peer-deps`. A version npm does not serve is published, one npm serves only when npm's `starciSource` equals this source's, and any other is refused `PUBLISH_LOCAL_VERSION_TAKEN` (in the plan and on the source as built); a rebuild of a version replaces the registry's copy (unpublish, then publish). The row schema is `starci/deps-publish-local@3`.
- Changed: `deps install-local` installs the version the last publish gave a package (its `local` dist-tag, or `@<version>`), drops that package's lock entries so npm resolves it again, and names the registry per command: `--@starci:registry` always and, for `starci-harness` (which npm routes only by `--registry`), `--registry` too; it is never npm's default and never written to an `.npmrc`. A package that did not resolve from the registry refuses `INSTALL_LOCAL_NOT_RESOLVED`; the removed `INSTALL_LOCAL_NOT_LOCAL` no longer applies.
- Fixed: `deps install-local --restore` ended in ETARGET (the lockfile kept the local build) and, for a version the local build shared with npm, kept the local tarball's integrity. It puts the recorded pins back, drops every lock entry resolved on this machine, installs from npmjs with the registry named on the command, and refuses `INSTALL_LOCAL_RESTORE_INCOMPLETE` while the lockfile names the registry or holds a harness package whose integrity is not npm's.
- Added: `DEPS_LOCK_INTEGRITY`, run by the push gate (`deps check`, `release push`, `release cut`, `app release`) beside `DEPS_LOCAL_REGISTRY_COMMITTED`: a committed lockfile that holds a `@starci` package or `starci-harness` at a version npm serves with another integrity.
- Removed: `core/deps/local-version.ts` (the `-local.<n>` series) and `localManifest`. The catalog of `@starci/hfs` 6.2.4 carries the new verb texts.

## 1.1.0-alpha.94 - 2026-11-08

- Fixed: `starci app check` on a host with no Docker and no `--db-url-env` database reports the warning `CI_PARITY_DB_SKIPPED` instead of crashing with `HFS_MANIFEST_INVALID`; the fix is in `@starci/hfs` 6.2.5, which the CLI requires once npm serves it (`cli-follow`).
- Changed: the CLI requires `@starci/hfs` 6.2.5, whose canon pins are `@starci/eslint-canon-fe` 9.16.6, `@starci/eslint-canon-be` 3.19.6 and `@starci/jest-preset` 2.8.1: `starci app check` lint now finds what the Sonar way profile finds (run `starci app check --fix` once after the upgrade), and the merged lcov is read by Sonar for root workspace packages. `FE_CONNECTED_BLOCK_RENDER_PAIR` and `FE_WORLD_OWNER_RENDER_BOUNDARY` accept children nested in the pure component.

## 1.1.0-alpha.92 - 2026-11-08

- Fixed: the local Sonar scan of `starci app check` runs against a derived project the token can analyse without reading the main project; the fix is in `@starci/hfs` 6.2.3, which the CLI requires once npm serves it (`cli-follow`).

## 1.1.0-alpha.91 - 2026-11-08

- Added: `starci app check --env local|prod` is forwarded to `@starci/hfs` 6.2.2, which the CLI requires once npm serves it (`cli-follow`); the managed hook, CI and release gate templates run `--env prod`.
- Changed: `deps publish-local` and `release publish` pack each package in its folder and stamp `starciSource` (the digest of its tracked source files; `gitHead` too for the release) into the tarball's manifest (`core/deps/pack-stamped.ts`), so the local-registry build and the npm build of one commit carry one digest and the check cache keys on it. `release publish` publishes the stamped tarball.
- Fixed: `deps install-local` kept its record in `.starciwork/install-local.json`, which a lite app refuses (`HFS_STARCIWORK_LITE_FORBIDDEN`); the record is `install-local.json` in the untracked tool cache of the checkout (slot `app.tool-cache`).
- Fixed: `deps install-local` looked up `@starci/<name>` for every package and missed the unscoped `starci-harness`; a package name resolves by the real names of the harness (the `@starci` scope and the CLI's own manifest name), and the app's `starci-harness` requirement is raised like any other.

## 1.1.0-alpha.90 - 2026-11-08

- Changed: `starci app check` starts the unit run first: its steps carry a priority and ask the governor in that order (`@starci/hfs` 6.2.1, which the CLI requires once npm serves it, `cli-follow`), so jest is sized on the whole room. Spec `heavy-governor.test.ts`: a finished command's row is gone at once and the next admission sees the full room.
## 1.1.0-alpha.89 - 2026-11-08

- Fixed: a whole `starci app check` no longer crashes on a skipped Sonar scan; the fix is in `@starci/hfs` 6.2.0, which the CLI requires once npm serves it (`cli-follow`).
- Changed: the heavy-command governor sizes every command greedily to the live RAM. The room is the free RAM now less `heavy.reserveMb` (4096, the one headroom) and what the commands admitted in the last `heavy.plannedSeconds` planned; free RAM already excludes what running commands use, so no estimate, reservation or earlier run is read. A test run takes `clamp(floor((room - parent cap) / worker cap), 1, min(cores - 1, testWorkers))` workers (`testRunSizing`, caps `heavy.testRun`): a free 22 GB on 28 cores gives 10, a free 7 GB gives 1. Any other node tool runs under the smaller of its cap and the room (`heavy.caps`, `heapFor`).
- Changed: admissions are serialised by the machine store's lock and served first come, first served: a command whose room is under its least need waits, holding nothing, only the head may start, and it prints its place, its need and the running commands every minute (`waitLine`). With nothing running it starts on the room there is. A row of a process that is gone is dropped at the next admission. A command under a held command, and any command on a CI runner (`CI` set), uses the RAM free now with no queue.
- Changed: a command cannot take more than it planned. Each node tool runs under its heap cap; each test worker is held to `heavy.testRun.workerMb` by `--workerIdleMemoryLimit` and a `--require` preload of the parent that gives every forked worker `--max-old-space-size` at it (`STARCI_WORKER_HEAP_MB`). A command that runs out of memory fails with a line naming the heap cap it hit and the RAM free at its admission (`oomNote`).
- Changed: `heavy.estimateMb`, `heavy.memoryMb`, `heavy.testWorkerMb`, `heavy.projectSlots`, the test worker's own `reserveMb` and the plan's `testParent`, `testWorker` and `types` constants are replaced by `heavy.caps`, `heavy.testRun` and `heavy.plannedSeconds`; the queue no longer rotates between projects, and the memory plan holds the check's own heap and the lint chunk.
- Removed: the learned memory factors (`memory-factors.json`, `learnPeak`, `readFactors`, the sampling of a child's peak) and every per-file and per-spec estimate of a heap or a worker count.
- Changed: a heavy command a running one starts is admitted on its own: every child inherits `STARCI_HEAVY_PARENTS`, the slot ids it runs under, and an admission leaves those ancestors' rows out of its count, plan and room, so it never waits on them (`harness/heavy.ts`). `starci app check` holds no slot: each heavy child of its steps is admitted on its own.
- Added: `RunOptions.workers` caps a test run's workers at what its caller can use (`testRunSizing`); `heavyRoomMb` reads the room the next command would get, which `starci app check` sizes its parallel ESLint chunks by (`heavyRoom` of the hfs io).
- Added: the hfs runners pass a test run's most workers, tell the step what it was admitted with (`onAdmit`), and return the measured RAM peak of the child's process tree (`harness/peak-rss.ts`: a preload writes each node process's peak resident set at exit).
- Removed: `STARCI_HEAVY_HELD` and the path by which a child of a held command used its parent's admission with no row of its own.
- Changed: `heavy.testRun.parentMb` is 2048: the jest parent keeps no coverage (`@starci/jest-preset` 2.8 streams each spec's coverage into its record), about 0.4 MB a spec beyond its base.
- Changed: `withOomNote` (`harness/heavy.ts`) appends the out-of-memory line to a failed run's stderr for both runners of a heavy child (`heavyCommand`, the hfs node port), so each spawn sits on its `withHeavySlot` line and `check heavy-sites` is green.
- Fixed: `deps publish-local` reads the `npm pack --json` report after what a package's lifecycle scripts print (the Grammar's build stamp line), so a package whose `prepack` writes to stdout publishes (`packedFilename`, spec `publish-local.test.ts`).

## 1.1.0-alpha.88 - 2026-11-07

- Added: `RELEASE_PEER_RANGE_EXCLUDES_PIN` refuses a plan in which a package to publish, or a package a stack pin names at the version its folder holds, declares a `peerDependencies` range that excludes the version a sibling is pinned at or published at (a canon peering `@starci/hfs` `~6.0.0` against the pinned hfs 6.1.x), because an app cannot `npm ci` the pinned set. `release publish` and `release push` judge it (`cli/src/core/release/peer-range.ts`, spec `peer-range.test.ts`); `WorkspacePackage` carries `peers`.

## 1.1.0-alpha.87 - 2026-11-07

- Changed: `starci app check` is green only with zero error findings, so `gate.errorLimit` is removed from policy/quality.yaml, its schema field is gone and the CLI no longer hands `STARCI_GATE_ERROR_LIMIT` to `@starci/hfs`. quality.yaml is now a strict schema: a `gate` key (or any other unknown key) is refused `POLICY_INVALID`, and for `gate` the message says there is no error limit to set. Spec: `src/harness/policy-gate.test.ts`. The hfs requirement follows the pin once npm serves `@starci/hfs` 6.1.0 (`cli-follow`).
- Fixed: the learned memory factors are host state in the app's untracked tool cache (`memory-factors.json` in `${STARCI_CACHE_HOME:-%LOCALAPPDATA%/StarCi/cache}/<repo>/app-check/`, `factorsPath` in `src/harness/memory-plan.ts`), no longer `.starciwork/memory-factors.json` in the app. A plain `starci app check` in a lite app writes nothing into its `.starciwork`, so the same run's hfs structure family no longer reports `HFS_STARCIWORK_LITE_FORBIDDEN`. Spec: `src/harness/memory-plan.test.ts`.

## 1.1.0-alpha.86 - 2026-11-07

- Removed: the package overlay. `starci deps source` (`--local`, `--npm`, `--sync`), the packages it copied into an app's `node_modules`, its record `deps-local.json`, `reapplyLocal` at seat start, task verify and the install a check gives its checkout, the heal of the record by `worktree gc`, the copy of a whole install cache entry for a repository in local mode, and the push gate's `DEPS_LOCAL_AHEAD` (it compared local copies with the published tarball) are gone. A project whose state folder still records an overlay is refused `DEPS_OVERLAY_REMOVED` by `deps install-local`, `deps check` and the install a check gives its checkout, with one message naming the registry flow.
- Added: `starci deps install-local <package>[@version]... --execute`, the app side of the local registry: it raises every requirement of each named package in the app's manifests to its latest local version (an `overrides` entry for a package only another package requires), runs `npm install` with `@starci` resolving from the registry on 127.0.0.1 and `--replace-registry-host=never`, and records the replaced pins in `.starciwork/install-local.json`. `deps install-local --restore` puts them back, installs them from npm and clears a record of the removed overlay (`INSTALL_LOCAL_NONE`, `INSTALL_LOCAL_NOT_LOCAL`, `INSTALL_LOCAL_NO_RECORD`, `INSTALL_LOCAL_RESTORE_INCOMPLETE`).
- Changed: `starci deps publish-local` publishes each package under a version of its own, `X.Y.(Z+1)-local.<n>` (`<prerelease>.local.<n>` for a prerelease), by rewriting the manifest of the packed tarball in memory; the version in git is never written and a requirement of a sibling published in the same run points at its local version. It publishes the packages the checkout changed since its branch base, or those `--package` names; `--force`, the `on-npm` and `in-registry` actions and the install npmrc are gone. `DEPS_LOCAL_REGISTRY_COMMITTED` names `deps install-local --restore`; `pkg branch` prints the publish command.
- Fixed: `starci release publish` and `starci release push` plan `publish` for every package whose `package.json` version npm does not serve, whatever its content. The `unchanged` action (a raised version whose shipped files equalled the served version's) is removed: it skipped `@starci/heroicons@0.3.6`, `@starci/test-world@1.3.5` and `@starci/tsconfig@2.1.1`, which the stack pins name, so apps could not install the pinned set (E404).
- Added: `RELEASE_PIN_UNPUBLISHED` refuses a plan in which a stack pin names a version that npm does not serve and the run does not publish (`cli/src/core/release/pin-served.ts`, spec `pin-served.test.ts`).

## 1.1.0-alpha.85 - 2026-11-07

- Fixed: the heavy-command governor never waits for memory no running command will release. A coverage run whose plan the learned worker factor had grown past the free RAM (a plan of 30 GB on a host with 23.5 GB free less the 8 GB reserve) waited for ever with nothing running. While nothing runs a command is now admitted whatever its estimate, on the room free RAM leaves: a test run takes the workers whose planned heaps fit the room (`plannedWorkerCount`, its parent heap holding the parent and the first worker), one worker when not even the parent fits, and a warning line names the shortfall. A command still waits for memory a running command holds.
- Changed: a learned memory factor is bounded and decays. It is at most twofold (`MAX_FACTOR`), a run that peaks under 75% of its plan eases a raised factor back toward 1, and no worker heap is planned above the room free RAM leaves. The factors stay in the app's untracked `.starciwork/memory-factors.json`, so they are per checkout and machine.

## 1.1.0-alpha.76 - 2026-11-05

- Added: `starci app check` plans its memory from the app it judges (`cli/src/harness/memory-plan.ts`, constants in `ops/liveness.yaml` `heavy.plan`, fitted on Nivo). It measures the scope from the git index and file sizes (specs and sources per side, the MB of the coverage records and of every cache record) and sizes the check's parent heap, re-executing itself under that heap when node's limit is lower. It also sizes each side's coverage parent, worker heap and worker count, each tsc program's heap, the CI build steps' heap and the lint ratchet's chunk. `--explain` prints the plan, and @starci/hfs receives it as `STARCI_MEMORY_PLAN`.
- Changed: admission holds a planned child at its planned MB (a `mb` column on `heavy_slots`) instead of its kind's estimate. A child's sampled peak resident memory more than `learnAbovePercent` (20%) over its plan raises that kind's factor for the app's next run (`.starciwork/memory-factors.json`), with a warning.
- Fixed: the DNA contract loader accepts a `set` check without a value and a per-metric value list (`metric: [width, height], value: [113px, 40px]`), which the Grammar's laws DNA-COMMON-TONE-CUSTOM-COMPLETE and DNA-COMMON-LINK-MEDIA-KEEPS-BOX use. Since those laws landed, the loader had refused the whole contract.
- Changed (CI): the harness job runs the CLI's tests, so a red CLI test blocks publishing.

## 1.1.0-alpha.75 - 2026-11-05

- Added: `starci release publish` and `starci release push` skip a raised package whose shipped files differ from the version npm serves only by its CHANGELOG, lockfile and version field (`unchanged` in the plan, `shipsTheSame` in `cli/src/core/release/publish.ts`, test `unchanged.test.ts`), and refuse `RELEASE_DEPENDENCY_UNPUBLISHED` when a raised dependent requires such a skipped sibling at its raised version. The CLI keeps its exact `@starci/hfs` requirement.
- Changed: the release tests run git through the shared `captureGitSync`.

## 1.1.0-alpha.74 - 2026-11-05

- Added: `starci release publish` and `starci release push` refuse `RELEASE_GRAMMAR_MINOR_REQUIRED` when `@starci/grammar` is due at a patch of the version npm serves while the diff since that version holds a minor's change (a lint rule of the family, a removed export or readonly prop, a removed DNA law id, a deprecated or forbidden entry), `cli/src/core/release/grammar-bump.ts`. The sibling judgement of the publish plan and `starci check pins` read a same-minor range (`~x.y.z`) as met by any patch of it (`cli/src/core/release/pin-range.ts`). Tests: `grammar-bump.test.ts`.

## 1.1.0-alpha.73 - 2026-11-05

- Fixed: `starci deps source --local` no longer fails with DEPS_MANIFEST_UNREADABLE on the handlebars `package.json` templates of `@starci/hfs` (`templates/**`): a `package.json` under `templates/` is a template, not a manifest (`cli/src/core/deps/packages.ts`, spec `packages.test.ts`).

## 1.1.0-alpha.72 - 2026-11-05

- Changed: a test run's parent heap and what admission holds for it (`ops/liveness.yaml` `heavy.memoryMb.test` and `heavy.estimateMb.test`, kept equal) are 12288 MB, up from 8192: a 1,832-spec back-end coverage run (`app check --fresh` on Nivo) died with JEST_RUNNER_DIED after 1,236 specs, about 6.6 MB of coverage a spec held until the run ends. `heavy-test-heap.test.ts` holds the number against the largest suite.

## 1.1.0-alpha.69 - 2026-11-05

- Changed: `policy/loosening.yaml` `branchProfiles.branches` may hold a branch pattern of `@starci/hfs` (`ui/*`: a literal first segment, `*` any characters but `/`, never `release/...`), so a profile covers dev's feature branches; the runtime allows `[dev, ui/*]`. The CLI hands the list to `@starci/hfs` as before (`STARCI_PROFILE_BRANCHES`), which refuses an entry that names or matches the default branch.

## 1.1.0-alpha.68 - 2026-11-05

- Added: `policy/loosening.yaml` `branchProfiles` (branches `[dev]`, gates `[lint, sonar, codecov]`), validated against a live ruling; an app overlay may narrow it, never widen it. The CLI hands it to `@starci/hfs` (`STARCI_PROFILE_BRANCHES`, `STARCI_PROFILE_GATES`), and `starci explain` says how `app check` picks the branch profile.

## 1.1.0-alpha.67 - 2026-11-04

- Changed: `@starci/hfs` gets the ESLint child's liveness budget (`STARCI_ESLINT_TIMEOUT_MINUTES`, `STARCI_ESLINT_MINUTES_PER_1000_FILES`, from `heavy.timeoutMinutes.eslint` and `heavy.timeoutMinutesPer1000Files.eslint`), so the CI it renders gives the lint job a timeout above that budget.

## 1.1.0-alpha.66 - 2026-11-04

- Changed: the contexts search eval asks for the self-recovering flows (BE-RESILIENCE-2) of release 7b+8.

## 1.1.0-alpha.65 - 2026-11-04

- Fixed: a test run's parent gets `heavy.memoryMb.test` 8192 MB of heap (a back-end coverage run holds every spec's coverage and outgrew 4 GB), and admission holds a test run at that same number: `estimateMb.test` equals it, and the loader refuses them apart (`OPS_INVALID`). Its workers are the parent's estimate plus one per `heavy.testWorkerMb` (1536) of further room, from 1 to `heavy.testWorkers`. While nothing runs, a command whose estimate is more than half the host's memory starts once half of it is free, so a small CI runner still runs it.

## 1.1.0-alpha.63 - 2026-11-04

- Fixed: the heavy governor gives a jest or vitest run `--maxWorkers` from the RAM room its admission measured (free RAM less `heavy.reserveMb` and the running estimates): its own test estimate holds the first worker and every further test estimate of room one more, from 1 up to `heavy.testWorkers` (`testWorkerCount`). It gave 1 whenever fewer commands were admitted than the slot cap, so a 28-core host with 21 GB free ran every unit run on one worker. `pressure` in `host load` now means the host cannot admit the next command.

## 1.1.0-alpha.59 - 2026-11-04

- Changed: the contexts search eval asks for the warm-cache push rule and the nightly verify lock.

## 1.1.0-alpha.57 - 2026-11-04

- Fixed: `deps source --local` and `--sync` stage each copy beside the installed one and swap it in by renames, carrying over the state an older `@starci/hfs` copy kept inside itself; a copy a running process holds refuses `DEPS_TARGET_HELD` and is left whole, never half deleted, and `uat run` and verify name the refusal.

## 1.1.0-alpha.55 - 2026-11-03

- Changed: the contexts search eval records the seed-levels rule (PROJECT-STACKS-12, R375) among its questions, so the eval holds the seed rules the index carries.

## 1.1.0-alpha.53 - 2026-11-03

- Added: a lane step is satisfied only by work on the tree being judged (`task-green`): a done task of another workflow counts when its landed commit is an ancestor of the workflow's `base`, so a stopped workflow's tasks on an archive branch no longer satisfy `workflow define --check`.
- Added: `workflow start` forks the workflow branch from the header's `base` (HEAD by default) and refuses a base that names no commit, `WORKFLOW_BASE_MISSING`.
- Added: host services of the `starci` compose group (`sonar-postgres`, `sonar`, `sonar-bootstrap`, `sonar-tunnel`) and the local registry in `ops/host.yaml`, http checks, `host down`, `deps registry-up`, the secret keys `SONARQUBE_DB_PASSWORD`, `SONARQUBE_ADMIN_PASSWORD` and `CLOUDFLARE_TUNNEL_TOKEN`.
- Changed: the seat start's hook heal is one function, `healWorktreeHooks`, with a spec that a commit in a healed worktree runs the product's gate. The served `@starci/hfs` requirement stays until CI follows package publication.

## 1.1.0-alpha.46

- Changed: Admit each actual app-check child through the host governor, apply test worker limits and refuse incomplete tool capture. Keep the served HFS requirement until CI follows package publication.

## 1.1.0-alpha.45

- Changed: Bundle the reviewed route Page/children context and search-eval repair with coherent package pins. The CLI keeps its served HFS requirement until CI follows package publication.

## 1.1.0-alpha.44

- Changed: Bundled contexts name the builder-provenance canon cohort. Installed CLI dependencies stay on served npm pins until CI follows package publication.

## 1.1.0-alpha.43

- Changed: Package contexts name the aligned Grammar and canon cohort; installed CLI dependencies remain on served npm pins until CI follows the package publication.

All notable changes to the `starci-harness` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each package under `packages/` keeps its own CHANGELOG.

## [Unreleased]

## [1.1.0-alpha.101] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.4.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.100] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.3.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.98] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.2.10, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.97] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.2.9, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.96] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.2.7, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.95] - 2026-11-08

### Changed

- The CLI requires @starci/hfs@6.2.6, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.92] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.2.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.91] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.2.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.90] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.2.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.88] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.1.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.87] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.1.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.86] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.0.5, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The local npm registry is a compose host service like Sonar: `ops/host/registry/compose.yaml` (Verdaccio pinned by digest, container `starci-local-registry`, published on 127.0.0.1:4873 only, `restart: unless-stopped`, its config in `ops/host/registry/config.yaml`, its storage bind-mounted from `local-registry/storage` of the shared state base), started by `host up local-registry` with `docker compose up -d --no-recreate` and stopped by `host down local-registry`. `ops/host.yaml` start `env` values expand the tokens, and a new `{shared-state}` token is the state base every checkout shares (the main checkout's `.runtime`, or `STARCI_LOCAL_ROOT`). A container of that name that compose did not create is removed once by the owner (`docker rm -f starci-local-registry`); its storage stays.
- `deps publish-local --execute` starts the registry through that host service (`ensureRegistry` runs `host up local-registry` when the ping does not answer and runs no docker itself), and its port is fixed at 4873: the `--port` flag is gone. `registryState` in its data is `up` or `down`. Specs hold the state, an idempotent start and the refusal `LOCAL_REGISTRY_NOT_READY` with the ping and the host start replaced (`RegistryIo`, `local-registry.test.ts`), and the compose file and the service entry (`host.test.ts`).
- `contexts/authority/packages.md` "Or install it like npm" names the registry as the compose host service and its commands.

### Removed

- `starci deps registry-up` and the `docker run` start path of the CLI code, with `LOCAL_REGISTRY_EXPOSED` and `LOCAL_REGISTRY_PORT` (the compose file publishes on 127.0.0.1 and the port is fixed): `host up local-registry` is the one start.

## [1.1.0-alpha.85] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.0.4, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.84] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.0.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.83] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@6.0.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- One rule book. A policy exception that rests on a rule is `kind: rule` with `cites: <rule id>`, and `branchProfiles` cites its rule the same way; the id is resolved against the rule book (every heading id and yaml `id:` of `contexts/` and `CONTRIBUTING.md`, `cli/src/harness/rule-book.ts`), else `EXCEPTION_RULE_UNKNOWN`. The removed form (`kind: ruling`, `decision:`) is refused `POLICY_INVALID` with the form that replaces it. App migration: an app's `policy/loosening.yaml` writes `kind: rule` and `cites:`.
- `starci contexts anatomy` keeps no pending list: a rule judged only by planned enforcers is listed, never red (`ANATOMY_PENDING_UNRULED` and `ANATOMY_PENDING_STALE` are gone). The removed Grammar names come from `@starci/hfs` `modules/kernel/removed-vocabulary.yaml` (kind `grammar`), the wrappers digest from `contexts/vendor/pins.yaml`, and a wrapper override gives its reason and cites `rule:` when a rule decides it (`ANATOMY_WRAPPER_RULE_UNKNOWN`).
- `starci contexts anatomy` refuses `ANATOMY_RULING_HISTORY`: a line of `contexts/`, `policy/` or a package's source, runtime, knowledge or docs that cites an owner ruling, a decision id or its date instead of the rule. The rule-doc gate reads every hand-written page of the contexts, the generated ones aside.
- `ANATOMY_RULING_HISTORY` also reads `cli/src` and every line of a source file in the forms no code spells, so a printed message is judged too; `RELEASE_GRAMMAR_MINOR_REQUIRED` cites `contexts/grammars/contributing.md` "Patch or minor", and the owner's inbox answer is recorded as `owner answer:` (prefix `owner-answer-`).
- `starci contexts search` has no `decisions` scope (`CHUNKER_VERSION` 5): the decision logs are folded into their owner files and deleted, and the search eval cites the rules that hold them.

## [1.1.0-alpha.82] - 2026-11-07

### Changed

- The CLI requires @starci/hfs@5.13.10, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The CLI requires @starci/hfs@5.13.9, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.81] - 2026-11-06

### Changed

- The CLI requires @starci/hfs@5.13.8, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The CLI requires @starci/hfs@5.13.7, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.80] - 2026-11-06

### Changed

- The CLI requires @starci/hfs@5.13.5, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.79] - 2026-11-06

### Changed

- The CLI requires @starci/hfs@5.13.4, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.78] - 2026-11-06

### Changed

- The CLI requires @starci/hfs@5.13.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.77] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.13.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.76] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.13.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.75] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.13.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.74] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.12.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.73] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.11.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.72] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.11.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The CLI requires @starci/hfs@5.11.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.71] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.10.4, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.70] - 2026-11-05

### Changed

- The CLI requires @starci/hfs@5.10.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.69] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.10.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.68] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.10.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.66] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.9.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.65] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.8.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.64] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.8.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.62] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.8.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.61] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.8.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.60] - 2026-11-04

### Changed

- The CLI requires @starci/hfs@5.7.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.59] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.7.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.58] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.6.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.57] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.6.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.56] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.5.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.55] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.5.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.54] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.4.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.53] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.3.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.52] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.2.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

### Added

- `starci app remove module <name>` (a new verb file, `core/app/remove.ts`) reverses `starci app add module <name>`; both are implemented by @starci/hfs.
- The dev verbs of `starci app stack` (`prepare|doctor|up|status|logs|down|verify --env <env>`, `starci app secret init --env <dev env>`) run a docker-compose environment under the governor; they are carried by @starci/hfs 5.2.0.
- The seat start heals the product's git hooks in the worker's checkout (`materialiseHooks`) and refuses `WORKTREE_HOOKS_MISSING` before it claims the task when the checkout still has none.

### Changed

- `release publish --package` can be repeated, and CI publishes its due packages in one call. Each package is still published in dependency order, but they are then read back from the registry together against one deadline, so the registry's delay is paid once per batch instead of once per package. A refused package still holds back only itself, and the refusal names every one.
- `contexts anatomy --execute` renders the contexts index after it writes anatomy.md, so one run settles. The index sizes each file from its LF text.
- The dev verbs of `starci app stack` get the heavy-command governor: `npm ci`, a compose build and a compose up of `up` and `prepare` wait for a slot of the host-wide semaphore like every other heavy command (`stackIo.heavy`, handed to the @starci/hfs release that carries the dev verbs).

## [1.1.0-alpha.51] - 2026-11-03

### Changed

- The CLI requires @starci/hfs@5.1.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.50] - 2026-11-03

### Changed

- The CLI source clears the SonarCloud code smells of `starci183_starci-harness` (nested templates and ternaries, cognitive complexity, awaits in loops, backtracking regular expressions and one-off rules) by refactoring with unchanged output; `inOrder` lives in `shared/sequential.ts`.

## [1.1.0-alpha.49] - 2026-11-03

### Removed

- `starci app lint`. `starci app check` is the one verb for app quality and takes `--side`, `--out` and `--fix`; with them it writes, so it is a local-write verb for the writing roles.

### Changed

- The CLI requires @starci/hfs@5.0.8, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The eslint heavy budget scales with the files the child judges: `heavy.timeoutMinutesPer1000Files` of ops/liveness.yaml raises it above `timeoutMinutes` (never below), so a large side on a slow runner is not ended as hung; it is a liveness bound, not a quality threshold. A request from an @starci/hfs after 5.0.7 names its file count; an older one keeps the flat budget.

## [1.1.0-alpha.48] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.7, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.47] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.6, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.46] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.5, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.45] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.4, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.44] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.43] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@5.0.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.42] - 2026-11-02

- Refreshed the generated contexts index before packaging the canonical app-check surface. HFS callable-provenance fixes ship through the new package cohort; the CLI's HFS dependency follows public npm publication separately.

## [1.1.0-alpha.41] - 2026-11-02

- Bundled app-check knowledge uses repeatable `--gate` selectors and `--no-cache` for the existing refresh mode. Check engines, cache trust, quality predictions and server-owned CI verdicts retain their existing behavior.

## [1.1.0-alpha.40] - 2026-11-02

### Changed

- The CLI requires @starci/hfs@4.17.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

- Bundled knowledge documents the consolidated Grammar preservation roles, headless figure ownership and native pending/message/date semantics.
- Explicit worktree collection quarantines proven project remnants without Git metadata, retaining every regular file and unlinking dependency links while protecting live workers and changed custody.
- Local dependency installation preserves the shared-install refusal within governor callbacks recognized by the heavy-command gate.

## [1.1.0-alpha.39] - 2026-11-02

### Fixed

- Local package builds refuse dependency installation through a shared `node_modules` junction or symlink before npm runs, including after a wait for the heavy-command governor; the refusal names the private-install remediation and preserves the shared target.

## [1.1.0-alpha.38] - 2026-11-02

### Added

- `starci deps publish-local` builds the harness packages and the CLI in dependency order and publishes the versions npm lacks to a Verdaccio registry on this machine (container `starci-local-registry`, 127.0.0.1 only, no login, npmjs as uplink), dry until `--execute`; an app then installs them for one command with `--@starci:registry` (or a user npmrc), with no worktree of the package and no copy into `node_modules`. An executed run starts the registry before checking its existing versions. A version already in the registry is kept, `--force` replaces it, a version npm serves stays npm's. Existing locks and npm caches retain a forced version's old tarball: prefer a new version, or prove the replacement in a fresh scratch app with a fresh cache. An app switching from `deps source --local` first uses `deps source --npm` to clear its recorded overlay.

### Fixed

- Worktree collection scopes package and retired-project records to the caller's Git repository. Repeated `--path` selections preserve working bytes, index patches, ignored files, link metadata and HEAD refs before link-aware removal, and protect primary, caller, foreign and live checkouts.

- A committed `package-lock.json`, `npm-shrinkwrap.json` or `.npmrc` that names a registry on this machine (a `resolved` URL on localhost, 127.0.0.1, `*.localhost`, `[::1]`) is refused `DEPS_LOCAL_REGISTRY_COMMITTED` by `deps check`, `release push`, `release cut` and an executed `app release`, in an app or the harness alike. Every resolved URL is checked, including compact and JSON-escaped lockfiles. Every npm question those gates and `release publish` ask (`npm view`, `npm pack`, `npm publish`) is pinned to registry.npmjs.org, so a `@starci:registry` set in the environment or a user npmrc can no longer make an unpublished pin look installable.

## [1.1.0-alpha.37] - 2026-11-02

- `starci dna check` measures a scoped count inside the grammar root it scopes (a Tabs, a PageHeader, a Toaster counted 0 for every scope that is not the root itself), names a menu popover through the `aria-label` of the trigger it points at, and reads a size as the box the layout gives, not the one a press scale paints. `contexts anatomy` refuses a removed spelling marked `shipped: true` in rulings.yaml anywhere in `packages/hfs/runtime`.

## [1.1.0-alpha.36] - 2026-11-01

### Fixed

- A workflow worktree of a product that declares husky (a tracked `.husky` hook or a `prepare` that runs husky) gets husky installed even when `core.hooksPath` was never set: without `node_modules` of its own the worktree installs it from the main checkout's husky, and `assertWorktreeHooks` refuses WORKTREE_HOOKS_MISSING when the setting is still absent, so the product's pre-commit gate never silently skips (harvest item 5).

## [1.1.0-alpha.35] - 2026-11-01

### Changed

- The CLI requires @starci/hfs@4.16.5, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.34] - 2026-11-01

### Changed

- The CLI requires @starci/hfs@4.16.4, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.33] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.16.3, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.32] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.16.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.31] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.16.1, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

### Changed

- Knowledge: `contexts/ui/components/diagram.md` and the diagram role of `grammars/contract.yaml` name the FlowGraph `orbit` layout, the bubble form, the status fills and ring (grammar 0.19.0); the API awaits the owner as D-16 of `decisions/open-grammar.md`.

## [1.1.0-alpha.30] - 2026-10-31

### Added

- `release push` (dry run included) in the harness repository runs the plan judgement of CI's publish step against the base CI would use (the head of the last successful CI run on main, else the remote tip): `RELEASE_VERSION_NOT_BUMPED`, `RELEASE_DEPENDENCY_SKEW`, `RELEASE_DEPENDENCY_UNPUBLISHED`, and the contexts anchors (`PUSH_ANCHORS_RED`, as `contexts anchor` with no id). `release publish` and `release push` share `judgePlan` (`core/release/push-gate.ts`). Package specs stay CI's.
- `policy/quality.yaml` `runtime.compilerLint`: package folders with no ESLint config (`packages/grammar`) are linted by `tsc --noEmit --noUnusedLocals --noUnusedParameters` over each of their tsconfigs.
- Specs for the tsconfig lookup and the push gate (`tsconfigs.test.ts`, `push-gate.test.ts`).

### Fixed

- `check run` judged `packages/grammar` red `TYPECHECK_CONFIG_MISSING` and `LINT_CONFIG_MISSING` because it holds `tsconfig.build.json`, `tsconfig.scripts.json` and `tsconfig.stories.json` but no `tsconfig.json`: a folder with no `tsconfig.json` is now typechecked through every `tsconfig.*.json` it holds. Source under no tsconfig or no ESLint config was counted and passed when nothing else was judged; it is now red.

## [1.1.0-alpha.29] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.16.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- Knowledge: the spacing doctrine: one scale 0 4 8 12 24 32 with no 16, gap roles (identity, inline, row, section, region), four inset levels (every container 12, a box in a card 8, a low-density region 24, the page gutter 12 / 24 / 32), the laws P1-P8, G1-G5, R1-R3, M1-M2, the text edge (tabs are the underline bar everywhere) and the per-component table in `ui/presentation.md` Space; `grammars/common.md`, `grammars/contract.md` and `contract.yaml` (spacing tokens, `DNA-COMMON-TABS-BY-LAYER`), `ui/components/tabs.md`, `ui/components/pane-grid.md`, `code/fe/naming.md`, `vendor/wrappers.yaml`. R350 (`FE_SPACING_UTILITY`, `FE_SPACING_OFF_SCALE`) joins the rule catalog; the stack pins name @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.18.0, eslint-canon-fe 9.8.0, stylelint-canon 2.4.0 and hfs 4.16.0, which the CLI follows once npm serves them.

## [1.1.0-alpha.28] - 2026-10-31

### Added

- `starci contexts search "<question>" --also "<phrasing>"` (repeatable): each phrasing is ranked and the rankings are fused by reciprocal rank, each hit counting the phrasings that found it (`phrasings` in `--json`, `found by n/m` in text), so a rule written in other words than the request still surfaces.
- The search eval (`core/contexts/search-eval.json`) records the rules agents missed: a question carrying `miss` (`on`, `what`, `cause` among `not-looked-up`, `ranked-low`, `not-in-core`, `no-enforcer`, `brief-paraphrase`, and the `fix` anchors) is scored with the rest, and `--eval` is red while a fix anchor is not in the index. Four misses of 2026-10-31 are recorded (a brief that told an app to wait for npm, PaneGrid dropping a wrapper child, a worktree removed through its junctions, a lookup forgotten after a compaction), with two more phrasings of the first.
- Knowledge: contexts/README.md "Looking a rule up" (several phrasings, the area's scope, `--limit 10` when the answer decides, the section index, open then cite; a brief cites each constraint and tells its reader to look up the same way; the brief check) and "When a rule was missed" (record, name the causes, fix each where it lives); hard rule 7, AGENTS.md, the worker procedure, the Kernel and Supervisor briefs, the starci skill and the minimal-core search point at them.

### Changed

- Knowledge: contexts/authority/packages.md "An app uses the edit before npm serves it" states on its own that a package change is linked into the app with `deps source --local` the moment it is coded and only a deploy waits for npm; contexts/authority/README.md "Worktrees" names the `node_modules` junctions a removal unlinks first. Search eval 95 questions: lexical recall@5 0.937 (MRR 0.749), hybrid 0.968 (MRR 0.797), from 0.933 (0.732) and 0.966 (0.787) on 89.

## [1.1.0-alpha.27] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.15.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- Knowledge: one padding system for everything placed in a `PaneGrid` (rulings pane-inset and page-panes-frame): a `Pane` owns its content inset and every band in it is a `PaneSection` whose boxes align to that edge, and a tabbed app page whose body is panes is `Page chrome="panes"`, the grid attached flush under the tab line. `ui/components/pane-grid.md` (Job, Choose `pane-grid.choose.page` and `pane-grid.choose.band`, Variants, Owner split), `ui/presentation.md` Space laws 3, 4 and 7, `ui/composition.md` LAYOUT-1 and FE-APP-SHELL-7, `ui/components/page-header.md`, `ui/components/list-table.md`, `grammars/contract.md` and `contract.yaml` (PaneGrid, PaneSection, Page chrome `panes`, `DNA-COMMON-PAGE-PANES-FLUSH`). R345 to R349 (`FE_PANE_GRID_CHILD_NOT_PANE`, `FE_PANE_CHILD_NOT_SECTION`, `FE_PANE_SECTION_PADDING`, `FE_PANE_GRID_FRAME`, `FE_HAND_BUILT_PANES`) join the rule catalog; the stack pins name @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.17.0, eslint-canon-fe 9.7.0 and hfs 4.15.0, which the CLI follows once npm serves them.
## [1.1.0-alpha.26] - 2026-10-31

### Changed

- Knowledge: R334 `BE_PERSISTENCE_NO_RAW_SQL` is one style: lite TypeScript holds no SQL text outside the test world. A table goes through its entity, anything else is a listed database function called through `callDbFunction`, `platform/database/database.client.ts` alone composes the call statement and LISTEN (`advisoryXactLock` and `notify` are `callDbFunction` calls of pg built-ins), and the only other `.query(` is the pass-through of a file listed in `ruleParams.be.sqlPassThrough` (the canon lists the seed runner) or hfs.json `sides.be.sqlPassThrough` with a reason. The test world keeps raw SQL for probes only; plain CRUD and application function calls there go through entities and `callDbFunction`. contexts: persistence.md BE-PERSISTENCE-4, test.md BE-TEST-1, rules R334 and R68, lite.md, slots (`ruleParams.be.sqlPassThrough`, `be.tests.world` allows `<name>.sql.ts`). Packages: `@starci/eslint-canon-be` 3.11.0 (`query`, `template`, `sqlFile`, `sqlTagImport`, `worldCallHelper`, `worldTableWrite`), `@starci/hfs` 4.14.0 (the `sqlPassThrough` key and its shape checks, the skeleton's `database.client.ts`), `@starci/eslint-canon-fe` 9.6.7, `@starci/grammar`, `@starci/eslint-grammar-core` and `@starci/eslint-grammar-offset-pop` 0.16.6 (bundled copies and pins follow). This CLI follows to the new hfs once npm serves it.

## [1.1.0-alpha.25] - 2026-10-31

### Changed

- The CLI requires @starci/hfs@4.13.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

### Added

- Knowledge: contexts/code/be/ai.md BE-AI-1's pool paragraph says how the pool is declared and kept, as @starci/ai-router 0.5.0 builds it: `poolFromEnv` in the custody owner, providers by kind with keys under the canonical `<PREFIX>_API_KEY`, `<PREFIX>_API_KEY_<n>` names and their `_FILE` twins, a key blacklisted for a spent quota or a refused secret in a durable state store, and a 503 with `Retry-After` when a profile has no key left.
- Knowledge: contexts/code/be/ai.md BE-AI-1, 2, 3 and 6 lock the AI key architecture: below the ai-router gateway a pool of providers, each with an array of keys, rotated, failed over and blacklisted, the `embed` profile pinned to one model; above it one random virtual key `STARCI_AI_KEY` per app and environment, used by `integrations/ai` and the agent runtime alike, with no admin API and no admin token. R344 `BE_AI_VIRTUAL_KEY` holds it (`@starci/eslint-canon-be` 3.10.0 `ai-virtual-key-name`: `integrations/ai` reads exactly `STARCI_AI_KEY`, the custody owner passes no admin token; the rule catalog of `@starci/hfs` 4.13.2); the pins name the cohort hfs 4.13.2, eslint-canon-be 3.10.0, eslint-canon-fe 9.6.5, @starci/grammar, eslint-grammar-core and eslint-grammar-offset-pop 0.16.5 (the Grammar moves with its lint family, which the grammar-core spec holds) (this CLI follows to the new hfs once npm serves it).

### Fixed

- A CLI an app installs (`<app>/node_modules/starci-harness`, which carries no secret.env) now finds the host's age identity: `hostAgeIdentity` looks in its own secret.env, then in the harness home's (`harnessHomeOf` of the verb's directory: the nearest ancestor that is a harness checkout or whose `.claude` is one), so `starci app secret`, `stack`, `release`, `db` and the CLI's custody open sealed members from inside an app as every stack's `keyCustody` says ("SOPS_AGE_KEY in the harness secret.env"). The label names the files looked in and, once read, the one that held the key; never the value.

## [1.1.0-alpha.24] - 2026-10-31

### Added

- Knowledge: `list-table.choose.role` gains the `step` row (a few choices or facts inside a first-run step card are a `SurfaceListCard` of `ListRow`, label outside), placed before `entity`, as the second exception to "a list is never wrapped in a card" beside the rail list.
- Knowledge: contexts/project/cicd.md "As built" records the `starci-ssh-gate` forced command, `deploy.notify` and the `--data-acknowledged` guard of a manual rollback, which ship in @starci/hfs 4.13.1 (the pins name it; this CLI follows to it once npm serves it).

## [1.1.0-alpha.23] - 2026-10-31

### Added

- `starci app stack deploy --ci-run <id>` checks the CI run evidence of the commit before it deploys (`cli/src/core/check/ci-evidence.ts`) and forwards `--ci-run` to @starci/hfs once the evidence is accepted; `npm test` in cli/ runs the built specs, which the published package leaves out.

### Changed

- The CLI requires @starci/hfs@4.13.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- The cohort of 2026-10-31 pins @starci/hfs 4.13.0 (delivery pipeline, committed check cache), the Grammar family 0.16.3, eslint-canon-fe 9.6.3, eslint-canon-be 3.9.3, stylelint-canon 2.3.0 and jest-preset 2.6.0 in contexts/stack/pins.yaml. The CLI keeps @starci/hfs 4.12.2 until npm serves 4.13.0; cli-follow then raises it.

### Fixed

- `starci release affected` orders a package's build after the `file:` and required siblings it needs, builds the siblings whose `dist/` its specs import before it, and still installs the siblings its specs only read before the test step, so a cycle between canons no longer leaves a sibling unbuilt or uninstalled on a clean runner.

## [1.1.0-alpha.22] - 2026-10-30

### Changed

- The CLI requires @starci/hfs@4.12.2, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).

## [1.1.0-alpha.21] - 2026-10-30

### Changed

- The CLI requires @starci/hfs@4.12.0, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- One canonical CLI (contexts/harness/cli-canonical.md): every effect is dry until `--execute`; `--json`, `--timeout <s>`, `--sha`, `--cwd`, `--reason` and `--status` are the one spelling of their meaning; `check ci` absorbs `release ci-status`, `workflow step --loop` and `workflow amend --goal` absorb run and regoal, `supervisor tick --loop` absorbs watch, `connect telegram bridge` holds the bridge, `route show` replaces route explain, `ticket --kind feedback` absorbs feedback; `check stories` and `check typecheck` are dropped. An old spelling is an unknown verb or flag (CONTRIB-15).
- `starci app <verb>` hands its arguments to @starci/hfs as typed, so hfs owns every app flag and its help; `app slot` and `app world` are new verbs, `app explain`, `app hygiene`, `app new` and `app sonar` are gone with their hfs verbs.
- `explain <term>` takes the term positionally and prints each matching verb's flags.
- policy/quality.yaml `gate.errorLimit` (default 20): the CLI hands it to @starci/hfs as STARCI_GATE_ERROR_LIMIT, the number of error findings under which `app check` and `app lint` stay green when none is a hard blocker (hfs 4.11.22).
- The CLI keeps @starci/hfs 4.11.21 until npm serves 4.11.22; cli-follow then raises it.

## [1.1.0-alpha.20] - 2026-10-30

### Changed

- The CLI requires @starci/hfs@4.11.21, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- `app stack deploy --urgent` takes `--reason` and `--remote`: without `--image` and `--source-sha` it is the one-command urgent release (hfs 4.11.21): release HEAD, build and push its images on this machine, deploy their digests under the floor. The stack verb hands @starci/hfs the caller role the urgent record names.
- `app release push --urgent` runs typecheck and the build only; `--lint-baseline` is retired and refused.
- The CLI keeps @starci/hfs 4.11.20 until npm serves 4.11.21; cli-follow then raises it.

## [1.1.0-alpha.19] - 2026-10-30

### Changed

- The CLI requires @starci/hfs@4.11.20, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2, by the cli-follow job of ci.yml).
- `app sonar` leaves out of `sonar.coverage.exclusions` the files a slot declares as logic (hfs 4.11.20 `logic`), so Sonar measures what jest measures (`core/check/sonar-scope.ts`).
- The CLI keeps @starci/hfs 4.11.17 until npm serves 4.11.20; cli-follow then raises the requirement and lockfile to the pin.

## [1.1.0-alpha.18] - 2026-10-30

### Changed

- The CLI requires @starci/hfs 4.11.17, its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2).
- `starci check pins` is `pending` (exit 0), not red, when every CLI_PIN_SKEW pins a version of this repository's own package
  that npm does not serve yet (a 404): between the two phases of a release the CLI cannot require it, so the gate no longer turns
  CI red until `publish-packages` brings it. A skew to a version npm serves, or a registry that cannot be asked, is still red, and
  `release publish` still holds the CLI on any skew.

## [1.1.0-alpha.17] - 2026-10-30

### Changed

- The CLI requires @starci/hfs 4.11.16 (was 4.11.15), its pin in contexts/stack/pins.yaml: the OriginGuard requires an actual
  Origin for cookie mutations and the GraphQL platform template specs pass the app canon gates (CONTRIB-20 step 2).

## [1.1.0-alpha.16] - 2026-10-29

### Added

- `starci app stack deploy --urgent --first-start --db-service <service>`: the first start of a self-hosted database the release
  starts itself (@starci/hfs 4.11.15): the floor proves the database empty instead of backing it
  up and migrates it inside its container before converge.
- `starci app release push --urgent --lint-baseline <tag>`: the lint of an urgent release judged against a release tag's findings:
  only a finding new since the tag is red.

### Changed

- The CLI requires @starci/hfs 4.11.15 (was 4.11.13), its pin in contexts/stack/pins.yaml (CONTRIB-20 step 2).

### Removed

- **The stress bench.** `bench/` (scenarios, fixtures, stand-ins,
  README), the verbs `starci bench run` and `starci bench list` (`cli/src/core/bench/`) and the `harness` CI job's bench step
  with the sops and age install it needed are deleted. `feedback close --kind bench` is no longer a closing kind, and the
  environment overrides that existed only for the bench's stand-ins are gone: `STARCI_SECRET_ENV`, `STARCI_TELEGRAM_API`,
  `STARCI_DOCKER_BIN`, `STARCI_CONTEXTS_DIR` and `STARCI_FEEDBACK_REPO`. `bench/` no longer triggers the `harness` job
  (`release affected`). Orchestration proof is to come from real test results in Orca.

### Fixed

- **A relay node's command check that is red exactly as at the relayed source's head is the source's red.** The relay of
  capability:platform.http carries its source's skeleton parity check, which the relay's own later commit (the exported
  port in `index.ts`) makes red at the source's head too, so no relay of it could pass unchanged. A red command check of a
  relay node is now run again, same argv and folder, in a clean checkout of the last relayed commit with the install linked
  (`judgeAtRelayHead`, `harness/run-checks.ts`, reading findings as `core/check/base-findings.ts` does for a scoped check):
  red there with every finding the node printed, the check is green with its detail saying the red is the source's, and the
  inherited findings are a `baseline-findings` event (step `command`, at the head) in the verify and the wave; a finding the
  head lacks, or a head that is green, keeps it red, naming how many. Bench: `needs-relay-command-baseline` (and its
  `own-finding` fault).
- **A shared need's release never runs a key a hold keeps (tk-2607eb9c7960).** platform-http-ca was parked on
  config:root-package and held on open ticket tk-50ca764c5426; when the need resolved, its release retried the key as
  t-07e4bcc3 past the hold, and cancelling that retry discarded the key's kept patch. The release (`release` in
  `core/needs/tend.ts`) now leaves a waiter that a hold in force keeps (`holdOf`, `harness/holds.ts`) or a live ticket's
  `task:<id>` waiter holds (`ticketHoldingTask`, `harness/tickets.ts`) parked, its row unreleased, with a `wait` action
  naming why; once the hold or ticket ends, the next pass retries it once from its kept work. A Kernel's `workflow-change`
  with no change may carry a hold alone: `hold: {tasks: [<key>...], ticket: <id>}` with `answers: []` is admitted, so a key
  is held on an open ticket with no decision of its own open. Bench: `needs-release-respects-hold` (held: no dispatch on
  two steps; ticket closed: one retry, its kept work applied).
- **A skeleton parity judges the skeleton of the hfs the app pins, never the CLI's own (tk-a46c4d69c675).** The relay
  `relay.capability-platform.http.r3` carried its source's check `git diff --no-index --exit-code
  <harness>/packages/hfs/templates/be/skeleton/src/modules/platform/http be/src/modules/platform/http`, which read the CLI's
  hfs 4.11.11 (trusted CA, pool lifecycle, `http.config.ts`) while the relayed commits and the app's pinned hfs predate them,
  so the relay could not meet its own contract. A command check now reads every path it names inside the CLI's own hfs (the
  harness checkout's `packages/hfs`, or the copy the CLI installs) inside the app's pinned hfs (`toPinnedHfs`,
  `harness/pinned-hfs.ts`): the version the checkout's lockfile resolves for `node_modules/@starci/hfs` (else an exact
  package.json pin), from an installed copy at that version or else the exact published version unpacked once into
  `<state base>/cache/hfs/<version>`; a pin it cannot read is a red naming why, and the check's detail names the version it
  read. A skeleton change reaches an app only when the app raises its hfs. The same mistake in hfs R253
  (`HFS_CANON_COPY_DRIFT`) is fixed in @starci/hfs 4.11.14 (canon pins: eslint-canon-be 3.8.13, eslint-canon-fe 9.5.15,
  Grammar family 0.15.26). Bench: `verify-skeleton-parity-pinned-hfs` (a copy of the pinned 4.9.3 skeleton green, a drift
  from it red).

## [1.1.0-alpha.15] - 2026-10-29

### Changed

- The CLI requires @starci/hfs 4.11.13 (was 4.11.8), its pin in contexts/stack/pins.yaml: an app's pre-commit hook run by
  this CLI no longer reports `HFS_SYNC_DRIFT` against an app on the 4.11.13 cohort (CONTRIB-20 step 2).
- Every `starci app` verb hands @starci/hfs the harness secret.env's age identity (`runHfs` defaults `hostIdentity` to `hostAgeIdentity`), not `app secret` alone: `app stack`, `app release` and `app db` open sealed members through the same lookup as `app secret` (@starci/hfs `decryptionIdentity`).
### Added

- **`project park` and `project unpark`.** `starci project park [--project <checkout>] [--dry-run]`
  pauses every running, blocked or paused workflow of the project (reason `parked: was <status>`), stops each live Op or
  `[Worker]` seat with its task cancelled as parked (`task-parked`, revive.ts cause `parked`: its work settles KEEP as one
  patch and its key comes back at the same try, outside `reviveMax`), closes each workflow's Kernel terminal (`workflow-parked`;
  worktree and graph untouched), stops the Supervisor (`ended_by` `parked`), then closes every Orca terminal of the project by
  Orca's list and force-closes its worktrees (`closeFolderTerminals`, shared with the reap), and records it all on a
  `project-parked` host event; exit 1 while Orca still lists one. Orca itself is left running. While parked,
  `ensureSupervisor` starts nothing and the Kernel sweep skips parked workflows, so no tick relaunches anything.
  `starci project unpark [--project] [--wait <seconds>]` starts the Supervisor and, once it attached, relaunches each Kernel on
  its worktree, resumes the workflow, which re-dispatches the parked tasks from their patches, and retries a parked worker's
  task; a Supervisor that attaches later has the rest finished by `supervisor tick`. Bench: `project-park-unpark-resumes`.

### Fixed

- **An owner's pause and Supervisor stop hold.** On 2026-10-29 the owner paused every starci-next-app workflow and stopped its
  Supervisor; the next `supervisor tick` started a new one 14 s later (`projectsWithWorkflows` counted paused workflows as
  needing a Supervisor), which ran `workflow resume` on two of them. A paused workflow now brings no Supervisor back (only a
  running or blocked one does); `workflow pause` records who paused (`by`: STARCI_ROLE, else the coordinator whose terminal
  runs it, else the owner), and `workflow resume` refuses `WORKFLOW_HELD` from a Supervisor or Kernel while the owner or Debug
  paused it, and `WORKFLOW_PARKED` to anyone on a parked workflow. Bench: `supervisor-stop-paused-project-stays-down`,
  `workflow-pause-owner-held`.

## [1.1.0-alpha.14] - 2026-10-29

### Added

- **A workflow near its budget is asked ahead, not after the stop.** lesson-ai reached 67/70 tries and 929/1000 minutes with
  8 tasks left before anyone was asked. A workflow with tasks left is now `near` once its minutes or tries reach
  `budgets.nearPercent` (85) of its ceiling in `ops/routing.yaml`, or fewer tries are left than tasks to run (`budgetOutlooks`
  in `harness/budget-warn.ts`). `budget show` adds the tasks left and the state `near` with the raise it proposes, sized to the
  remaining tasks at the done tasks' pace; `supervisor tick` opens one `question:business` ticket per ceiling (opened as the
  Supervisor's, so the owner's answer wakes it), each later tick a repeat that bumps occurrences, and a workflow-wide
  `budget raise` answers it. A ticket opener may name its episode (`TicketInput.key`, `keyedFingerprint` in
  `harness/tickets.ts`) to be deduped by it. Bench: `budget-near-asks-once`, `budget-near-tries-below-tasks`.
- `check loosening` bans `tls-unverified`: the `NODE_TLS_REJECT_UNAUTHORIZED` switch set to 0 (assigned in code or a spec, an
  env object key, a shell script, a workflow env entry, a Dockerfile `ENV`, a `package.json` script, an env template the
  security policy lets it read) and a client's `rejectUnauthorized: false`; reading or comparing the switch is no finding.
  Env templates (`*.env.example`, `*.env.tpl`, ...) are a scanned kind for it; `.env` and `.env.*` stay `neverRead`. Bench:
  `security-loosening-tls-unverified` (each form red, the test-world https fake path green).

### Changed

- **An Op's attempt is settled before anything of it goes, and a key keeps at most one patch.**
  Each ended attempt settles once: MERGE (its green verify landed it), DISCARD, REPAIR (its
  Kernel's `settle: repair`, a new field of a command answering a red, question, check-premise or conflict decision; discard
  is the default) or KEEP (a stop the harness caused, custody, a verify the host held, a waiter parked on a shared need). Its
  Op worktree, branch (landed or not) and preserve folders go only after that settle; KEEP and REPAIR store one patch, which
  the next attempt applies and its own settle deletes. The store no longer collects every preserve and settle commit
  (`storeCommitted`, `collectPriorWork` are gone), and `worktree gc` drops every older or unkept patch with a
  `prior-dropped` event (`harness/prior.ts`, `harness/land.ts`, `core/kernel/driver.ts`). Bench: `op-settle-*`.

### Fixed

- **The CLI runs @starci/hfs 4.11.8** (app secret members, migrate/split/audit, `--into-existing`), moved once npm served it
  (CONTRIB-20).
- **A green task lands over stale dirt in the checkout it lands on.** starci-next-app lesson-ai `lesson-content-grading`
  (t-12055865, and auth-sign-in t-2184122d before it) verified green and failed its settle three times on `SETTLE_REF_FAILED`
  (`git merge --ff-only` would overwrite local changes), then waited on the owner: the workflow's worktree held leftovers on
  paths the commit writes, CRLF copies of LF files that `git diff` shows clean and the merge still refuses, so `land-escaped`
  saw nothing to preserve. A green settle now clears, under the land lock and before the fast-forward, every dirty path the
  fast-forward writes or the task's `allowPaths` hold (modified, staged, line-ending-only or untracked): a path whose work-tree
  and index content are the head's or the candidate's is dropped, the rest is preserved first into `preserved/land-<task>`
  (a changes patch, a staged patch, untracked copies; no settle deletes it), and one `land-stale` event names both (`clearStale`
  in `harness/preserve.ts`, run by `settle` in `harness/settle.ts`, sharing `preserveScope` with the task preserve). A preserve
  that fails reaches no verdict and spends no try. A green ending no longer files the target's dirt as the task's own preserve,
  which its merge settle deleted. Bench: `land-stale-target-dirty-settles`, `land-stale-escape-cleared-then-lands`.

- **A walk serves the app with the project's local package sources, as the wave judged it (tk-aa27c447e9e5).**
  starci-next-app's fe-sign-in-audit (t-a2824c1c) walked an Op worktree whose install was copied from the cache at the registry
  pin `@starci/grammar` 0.15.3, which lacks `Page` from `/common`, so SignInPage answered 500 on all 13 pages; its seat start's
  copy of the local sources had failed in the heavy queue, and `uat run` never applied them. The wave judged the same app green
  with grammar 0.15.4+ from the local packages. The wave's install and its local copies are now one function,
  `installCheckout` (`harness/install-cache.ts`), which the clean verify and the wave call and `uat run` calls through
  `prepareWorkspace` for each install its checkout holds, before its workspace dependencies are built; a copy that cannot be
  made refuses `UAT_APP_SETUP_FAILED`. Bench: `audit-walk-serves-local-package-mode`.
- **A waiter parked on several shared needs gets every one of them relayed (tk-afbe3f7152a7).** subscription-premium's
  `relay.capability-identity.session-principal.r3` (t-95b710de) waited on `capability:platform.cqrs` and
  `capability:platform.http-security` (round 2, resolved by auth-sign-in's http-security-store, origin-strict and
  origin-require-form: a8ccad16, b83b797c, ca785edd). The cqrs need's release relayed its one commit (a20f48934) and marked the
  waiter's rows of both needs released, so the http-security need found no waiter and never relayed; the retry t-1242f3d6 met
  no RequireOrigin (TS2305). A release now marks only its own need's row, carrying that need's relay, and retries the waiter
  once the last of its rows is released (`release` in `core/needs/tend.ts`). The relay judges "already held" by content: the
  branch holds the resolving commits when every file they change reads as at the last of them (`holdsFinal`), and otherwise
  replays every one that is not an ancestor of its head, skipping only a commit whose merge changes nothing, never one judged
  by an equal patch in the branch's history (`git cherry` is gone), so an older copy of the folder never stands for the
  resolver's work. `RELAY_VERSION` is 3. Bench: `needs-relay-every-commit-over-older-copy`.
- **The secret scan reads a key's name and a contract spec's inputs as what they are.** starci-next-app auth-sign-in
  `keycloak-contract-spec` (t-15237b2c) failed verify on `secrets` for two lines of `keycloak.contract-spec.ts`: a const holding
  the custody key name `IDENTITY_KEYCLOAK_CLIENT_SECRET`, and the deliberately wrong password of its invalid-credentials case.
  `assigned-secret` now takes a value that is a key's name (capital words joined by underscores) for no credential, beside a
  self-named stand-in (`notCredential` in `shared/secrets.ts`), and every spec suffix of the jest projects
  (`*.contract-spec.ts` among them) is one pattern, `shared/spec-file.ts`, read by the secret scan, the loosening markers, the
  scoped coverage and the release plan, which each kept a copy, the three outside coverage narrower. A credential assigned to a secret-worded name, and a
  provider-shaped one in any spec, are still caught; the three `HFS_PLAINTEXT_SECRET` exceptions of `policy/security.yaml`
  covered nothing any more and are gone. Bench: `security-secret-key-names`.
- **A test run that names test paths also runs the specs of what the task changed, so coverage judges each changed logic file
  by its own specs** (ticket tk-0e5cb72b4285). starci-next-app's `relay.capability-platform.http.r3` (t-ad40127f) relayed
  `platform/http`, `primitives` and `http-security` byte-identical, but its tests-pass, inherited from its source's node, named
  only `src/modules/platform/http` and `primitives`, while `coverage: changed` judged every relayed logic file under its
  allowPaths: `origin.guard.ts` and `rate-limit.guard.ts` read 0% because their specs never ran, and every re-dispatch burned
  a try. `scopedTests` (`harness/coverage-scope.ts`) now runs, beside the specs under the named paths, each changed spec file
  under allowPaths and each spec named after a changed source file, so a relay node runs the specs of every folder it relays
  and the run and its coverage scope read the same change. Bench: `needs-relay-tests-every-relayed-folder`.
- **A live suite whose keys the app's custody lacks waits on the owner, never a findings red, however the harness meets
  them.** A failed test run reporting as `TEST_WORLD_NOT_DECLARED` keys custody holds none of was let stand as the task's red
  (`assertKeysHanded` returned when no sealed member held them), so a wave whose spec custody did not catch before the run
  failed the task, set the worker's report aside and spent a try (starci-next-app subscription-premium payos-live, with
  PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY sealed nowhere). Such a run now refuses `CUSTODY_KEY_MISSING`
  naming the keys, the same owner block a declaration naming them gives before the run (`harness/custody.ts`): the task
  ends `awaiting_owner` with no try spent and no red verdict, in its verify and in the wave alike. A key custody holds is
  still `VERIFY_INFRA`. Bench: `wave-live-custody-missing-owner-blocked`.
- **A walk serves the app the wave built: `starci uat run` prepares the app's workspace first.** starci-next-app's
  fe-sign-in-audit (t-eac0bcc9, ticket tk-900481687ea8) walked 16 captures of the sign-in screen and every route answered
  HTTP 500, as Next.js could not resolve `@starci-next/i18n/proxy`: the walk's Op worktree held the app's workspace packages
  unbuilt (their `dist/` is git-ignored), while the wave's check run builds them before its typecheck. `uat run`, the verb
  every audit and uat walk runs, now gives its checkout the same preparation through the same code before any container
  starts (`prepareWorkspace` over `buildWorkspaceDependencies` in `core/check/workspace-deps.ts`: every in-repository
  workspace dependency any package imports, found from the manifests' workspaces for npm, yarn and pnpm, restored from the
  build cache or built with `npm run build` under the heavy governor); a dependency that does not build refuses
  `UAT_APP_SETUP_FAILED`. Bench: `audit-walk-prepares-workspace-and-unserved-is-infra`.
- **A walk where every page answered 5xx is the harness's failure, never a finding.** The container's relay
  (`harness/uat-preamble.ts`) reads the HTTP/1.x framing it pipes and tallies the pages the walk opened (the browser's
  document requests, redirects aside) and how many answered 5xx, kept in the run's receipt as `pages`. A run whose every
  page answered 5xx is refused `UAT_APP_UNSERVED` with its receipt kept, and the result a worker files on that attempt,
  whatever its status, fails the task with a `walk-unserved` event (`unservedWalk` in `harness/uat.ts`, `core/task/result.ts`):
  a harness cause (`harness/revive.ts`), so its workflow dispatches it again at the same try, up to `reviveMax`. The bench
  runs `uat run` against a Docker stand-in (`STARCI_DOCKER_BIN`, `bench/stub/docker-stub.mjs`) that plays the container
  with the real relay, and an app stand-in (`bench/stub/app-stub.mjs`).
- **A deregistered worktree folder that kept its `.git` file is removed once nothing holds it.** Git deletes a worktree's
  admin folder whatever its delete of the work tree did, and that delete stops at the first entry it cannot remove, so a
  held file listed before `.git` leaves a `.git` file naming a git dir that is gone. Removal (`removeWorktreeFolder` in
  `harness/land.ts`) refused every such folder as "still holds files" forever; it now refuses only a live checkout
  (`holdsLiveCheckout`: a `.git` folder, or a `.git` file whose git dir exists). The bench's folder holder makes the held
  folder itself read-only off Windows instead of its parent, so its siblings can still be made, and
  `supervisor-tick-sweeps-terminals` counts the reap's forced workspace close beside the tab close. Bench (Linux and
  Windows): `worktree-gc-now-reaps-orphan-holder`, `worktree-reap-busy-unlisted-now`, `worktree-remove-busy-gc-retries`,
  `worktree-reap-op-processes`, `supervisor-tick-sweeps-terminals`.
- **A cancel of an attempt whose worktree was removed out of band settles it at once.** It has nothing to preserve, so it ends
  cancelled with a `task-discarded` event (worktree gone) and its redo spends no try, instead of every step refusing
  `TASK_WORKTREE_GONE` (ticket tk-cb03efd533f1: `auth-sign-in`'s superseded t-2184122d). Bench: `op-settle-worktree-gone-discards`.
- **A verify-only live suite gets its custody keys in the wave from the branch it runs.** starci-next-app's `ai-router-live`
  burned five tries (the last t-503b105d) red `own: true` on TEST_WORLD_NOT_DECLARED for OPENROUTER_API_KEY. Its spec calls
  `useSandbox<LessonAi>({ keys: CUSTODY_KEYS })`, and the live-spec test (`LIVE` in `harness/coverage-scope.ts`) matched only
  `useSandbox(`, so the run held no live spec and nothing was handed; it now reads a call with type arguments too. Custody was
  also read in the app's main checkout, which lacks `.starcistacks/dev/secrets/ai.enc` sealed on the workflow's branch only:
  `holdersOf` (`harness/custody.ts`) now reads the sealed members in the checkout the run executes (a wave's branch head, a
  verify's candidate, a worker's worktree) and takes only the age identity from the main checkout, so `custodyFor` hands what
  the branch seals and `assertKeysHanded` turns a run that still lacks a key the branch holds into `VERIFY_INFRA`, never the
  task's red. A key sealed blank is `CUSTODY_KEY_MISSING` like an empty one. A bench `starci` step takes `stdin` (`input` of
  `shared/exec.ts`). Bench: `wave-verify-live-custody-branch`.
- **`starci app secret set` works in a terminal and on an existing member.** It prompts for each key with masked input instead of
  refusing without redirected stdin, takes several keys (`set <env> <member> K1 K2 K3`) sealed in one write, and every `app secret`
  verb (and `harness/custody.ts`) hands @starci/hfs the harness secret.env's `SOPS_AGE_KEY` (`hostAgeIdentity`,
  `harness/secret-env.ts`; `SOPS_AGE_KEY` joins `secretKeys` of policy/security.yaml) as its last age identity source, so adding a
  key to a member no longer fails `identity-not-supplied` when the identity lives there. The `key` and `new-key` operands become one
  `keys` rest operand; `--from-host` names exactly one key.
  The verb also carries the app secrets standard of @starci/hfs 4.11.5: actions
  `recipients`, `migrate`, `split` and `audit`, flags `--from-file`, `--to`, `--add` and `--remove`.
  Bench: `app-secret-identity-from-harness`, `app-secret-provider-members`.

## [1.1.0-alpha.13] - 2026-10-29

### Fixed

- **The CLI runs @starci/hfs 4.11.0** (official postgres image, platform/jobs scheduler, db baseline archive), moved once npm served it.
- **A relay node's own lint holds a finding its source already held, whichever ESLint report printed it.** A check that
  defers composition rules reads ESLint's json report, where a canon message keeps its closing period; the run at the relayed
  source's head has no deferral and reads the stylish report, which drops it, so the two keys never met and the finding was
  charged to the relay node. `judgeDeferred` (`core/check/composition.ts`) prints a json finding's message as the stylish report
  does. starci-next-app's `relay.capability-domain.entitlement.r4` (t-aec4712a) was red on `BE_PUBLIC_CONTRACT_FORM` in
  `entitlement.service.ts`, byte-identical to its source 759c46a, and its worker asked its Kernel what to do. Bench:
  `needs-relay-baseline-message-form`.
- **A replan judges the lanes on the workflow branch's head.** `buildReplan` read the Work records in the checkout the amend
  was asked from: the Supervisor's submit and the shared-need tender ask from the main checkout, where records written on the
  workflow's branch are absent, so every replan of starci-next-app's lesson-ai was refused `FLOW_INCOMPLETE` for its lessons
  records while the Kernel's digest showed them satisfied. The replan, the Kernel's `lanes` digest and `starci ui`'s graph
  read one tree, the workflow's worktree (`flowCheckoutOf` in `harness/lanes.ts`). Bench: `flow-replan-reads-branch-records`.
- **An admitted contract is never refused for a context that grew under it.** The op's context budget is judged when a
  contract is admitted (`task send`, `supervisor dispatch`, `workflow define`, a workflow change that adds or edits it). Its
  verify, settle, relaunch and a resend or retry of the same contract hash keep the budget it passed then (`isAdmitted` in
  `harness/tasks.ts`: a task or graph node of the ledger carries the hash; `task verify` judges a task's own contract
  without it). starci-next-app's `be-purchase` was refused `CONTRACT_UNFIT` at its verify (24564 tokens against 24000) after
  its worker had done the work. Bench: `admitted-contract-settles-after-context-grows`.
- **Every seat loads a minimal core and searches the rest**. Canon growth had taken
  the code op's `be`/`fe` base to about 20.7k of its 24000 tokens, so a contract with more than about 3.3k tokens of its own
  context was unfit. The anatomy slices name each rule by id alone (its enforcers stay in anatomy.md's full tree);
  project/README.md, project/lint.md and the shared format and scripts topics leave the code and test op bases for on-demand
  reads (contexts/code/README.md "Read for a coding task", the core column of contexts/code/shared/README.md). Large documents
  a seat needs to find its way in load as a generated section index (`*-sections.md`: work.md, stacks.md, ui/composition.md,
  grammars/contract.md beside cli/README.md, listed once in `SECTIONED_DOCS` of `core/contexts/sectioned-docs.ts`), whose
  source's rule ids it stands for in the read trace. The worker procedure and both coordinator briefs say when to
  `contexts search` and `contexts anchor`; the Kernel loads roles.md and project/README.md, the rest of harness/ and
  project/index.md on demand, and the Supervisor its brief without skills/starci/SKILL.md. Measured with `contract check`
  (coordinators: brief plus launch load, bytes / 4), before → after in tokens: code full/be 21120 → 12895, lite/be 21943 →
  13643, full/fe 18720 → 11418, lite/fe 19515 → 12176, harness 13783 → 12738, package 14340 → 13293; test full 27334 →
  19109, lite 28157 → 19857; draw and audit core 17849 → 8880, offset-pop 18171 → 9203; uat 7679 → 1435; deliver 4341 →
  779; Kernel 32475 → 12668; Supervisor 11306 → 9930. No budget changed. Bench: `cited-through-section-index`.
- **An Op worktree no longer stays behind held by what the harness started.** Removal reaps the worktree first: it closes the
  Orca terminals working there (each tab, then `orca terminal close --worktree path:<folder> --all`), unlinks the install links,
  has Orca forget the worktree and waits for it (`orca worktree rm` is asynchronous; Orca's watcher holds a workspace it lists),
  then ends the processes the harness recorded starting there (`op_processes` of the host store, fed by the spawn observer of
  `shared/exec.ts` and by a seat launch, which records the seat's shell and agent by their working folder since Orca names no
  pid), the heavy commands working there, every process whose working folder is inside it (read from the process itself:
  Windows PEB, `/proc`, `lsof`) and every process under those, by pid and never by name, sparing this process, its ancestors and
  Orca; it reads again and ends what the first kill missed. A removed worktree Orca still lists as "Delete failed" is dropped.
  A folder still held records `worktree-held` with its holder, is retried and reaped again by `worktree gc`, and is listed by
  `worktree gc` and `host load` (`harness/reap.ts`, `harness/process-table.ts`, `harness/land.ts`). `worktree gc --now` tries
  a folder left busy at once all the way down: the removal itself (`removeTracked`) no longer answers it with the busy record's
  old text before its backoff runs out; and it takes a harness folder git no longer lists however recently it changed, which a
  plain gc leaves to its ten-minute quiet period. Bench: `worktree-reap-op-processes`, `worktree-reap-busy-unlisted-now` (a folder
  left busy that git no longer lists is still reaped), `worktree-gc-now-reaps-orphan-holder` (an orphan and a fresh unlisted
  folder, each with a real process and child working there); `worktree-remove-busy-gc-retries` now holds the folder from outside, as a
  process the harness never started.
- **The CLI runs @starci/hfs 4.10.1** (the entity-registry cohort), moved once npm served it (CONTRIB-20).
- **Several typed checks run at once again.** alpha.12 set the tsc and eslint `estimateMb` to their 8 GB heap ceiling, so with the
  8 GB reserve one eslint filled the host's room and 16 waited 30 min behind a run holding 0.7 GB. The estimates are what one run
  holds (tsc 3072, eslint 4096); `memoryMb` stays the 8192 heap ceiling.
- **The host's heavy queue no longer runs down a task's budget.** The budget ladder's clocks (the ask at `budget.minutes`
  and the fence `budget.graceMinutes` later) leave out the wall clock a task's heavy commands waited in the queue: those its
  verifies ran, tagged with the task by `withHeavyBound` (a baseline checkout included), and those run in its own checkout
  (`taskQueuedMs` of `harness/heavy.ts`; heavy slots carry their task). A verify of a task the host held records
  `verify-host-held` on its attempt whichever way it ran, and an attempt whose worker then filed blocked or failed is
  harness-held (`hostHeldAttempt`): its retry spends no try and the decision on it no route of `ops/routes.yaml`, so a
  host-held `be-sign-in` keeps its `blocked-answered` route. The worker procedure says the queue's time is not its own.
  Bench: `budget-queue-wait-not-counted`, `kernel-host-held-blocked-keeps-route`.
- **A relay node fits its op's context budget.** Its contract carries a lean context: its op's base, the conflicting files and
  the repository files the template reads (the Work records the commits implement), with the need's evidence (each waiter's
  rules and note) in its details, never the template's pinned base or harness topic and canon files; lesson-ai's
  `relay.capability-domain.entitlement.r4` measured 24564 tokens against the code op's 24000 and measures 21396 lean. It is held
  to the budget like any task. Bench: `needs-relay-lean-context`.
- **A CLI off its pins is refused.** `check pins` (a CI gate on every push) and `release publish` before the CLI publishes
  refuse `CLI_PIN_SKEW`, naming each package, where, the pin and the version found, when a `@starci` requirement of
  `cli/package.json` or a copy `cli/package-lock.json` resolves differs from `contexts/stack/pins.yaml`; 1.1.0-alpha.10
  shipped on @starci/hfs 4.9.5 under a 4.10.0 pin and nothing caught it. `publish-cli` publishes the CLI as committed and no
  longer moves its requirements to the siblings' folder versions. Bench: `check-pins-cli-skew`, `release-publish-plan-guard`.

## [1.1.0-alpha.12] - 2026-10-29

### Fixed

- **The CPU ceiling governs the harness's own contribution** (monitor report #12). Above `heavy.maxCpuPercent` the governor held
  every new heavy command and admitted one per `cpuStarveMinutes`, although the CPU was burned by another project's unmanaged
  eslint and tsc: holding the harness back lowered nothing and starved its workflows (an install waited 8 min, a tsc 12, each
  verify about 25, serially). Now `managedCpuPercent` (`harness/heavy.ts`) samples the share the running heavy commands and
  their process trees burn over the CPU window (`managedCpuTimes` of `harness/host-holders.ts`, Windows and Linux): under the
  new `heavy.managedCpuFloorPercent` the load is foreign and up to the new `heavy.underForeignPressureSlots` commands run under
  it, by age with the project fair share; at or above it, or unknown, the ceiling and the starve rule hold as before. RAM rules
  are unchanged and still block. `host load`, the queue's wait reasons and `workflow status` name the rule that applied. Bench:
  `heavy-foreign-cpu-admits-managed`, `heavy-own-cpu-still-waits`.
- **A governed tsc runs under the same heap as eslint** (nivo-lite lane r-4). `check typecheck` died of a node heap OOM on a
  large back end: its tsc child ran under `heavy.memoryMb.tsc` 2048, below node's default heap. `memoryMb.tsc` and
  `estimateMb.tsc` now equal eslint's, so the admission's RAM estimate matches the heap; the child gets it through
  NODE_OPTIONS of its `node <bin>` spawn (`withHeavySlot`). Bench: `heavy-heap-reaches-tsc-eslint`.
- **A change check on a branch judges the branch's own files** (nivo-lite lane r-4). `check lint`, `check typecheck`,
  `check run` and `check secrets` without `--base` compared against `origin/main`, so a lane cut from a local main that ran
  ahead of origin linted 212 files of main's unpushed merges. The default base is now the branch base (`branchBase` of
  `shared/git.ts`): `origin/main` on main, else the newest fork point of the branch from main or origin/main. `--all` and the
  app-root widening are unchanged. Bench: `check-lint-branch-base`.

## [1.1.0-alpha.11] - 2026-10-29

### Fixed

- **The CLI runs @starci/hfs 4.10.0.** `cli/package.json` still pinned 4.9.5, so every `starci app` verb (sync, lint, check, db) ran the
  3.7.0 slot manifest even after the lite cohort landed: `app sync` refused an app's `sides.be.dbFunctions`
  (`HFS_DECLARATION_INVALID`), and a local link of hfs could not reach the CLI's own nested copy.

## [1.1.0-alpha.10] - 2026-10-29

### Changed

- **`starci app db` on a self-hosted PostgreSQL**: the verb takes `new`, `baseline`, `restamp`, `plan`, `migrate`, `post-cutover`, `dump` and `drift` with `--url-env <NAME>` (default `DATABASE_URL`); `reset`, `--linked`, `--local`, `--target-binding`, `--auth`, `--storage` and `--backup` are gone (`cli/src/core/app/db.ts`), and `app add` has no `--no-types` (`cli/src/core/app/add.ts`). It runs with @starci/hfs 4.10.0.

## [1.1.0-alpha.9] - 2026-10-29

### Fixed

- **A ledger open waits 30 s for another process's write lock** (`LEDGER_BUSY_MS` in `harness/ledger.ts`, every open). At 5 s a
  host at 97% CPU answered `kernel next` with `CLI_UNEXPECTED: database is locked` while a governor or worker held the write.
- **A relay node is judged as the transport of work its source already settled** (ticket tk-405c2bb94dbd). lesson-ai's relay of
  `capability:domain.entitlement` applied every commit byte-identical to subscription-premium's landed state and still filed
  BLOCKED on two reds that were the source's: rules-cited could not read the source's Work record its context names (it lives on
  the source's branch alone; the relay carries code commits), and check-run-green flagged exports only its waiter consumes
  (dead-exports) and a form the source had settled (public-contract-form), so the waiter and the workflow's tail stayed blocked.
  Now a relay node is composed by its first waiter (the first node that depends on it, `composerOf` in `harness/graph.ts`, so
  a relay node added before this fix is judged so too), and the composition rules on the relayed files defer to that waiter,
  which judges them in full; its read trace and its brief read a context file the checkout lacks at the last relayed commit, as
  data (`relayHeadOf`), never copying the source's records onto the branch; and a finding the relayed files already held at that
  head (rule, file and message, line-insensitive) is the source's baseline in `check run`, whether judged as the relay node, its
  composer or the final verify (`core/check/relay-baseline.ts`, `judgeAgainstRuns` in `core/check/base-findings.ts`), recorded
  as `baseline-findings` evidence, except a composition rule, which stays the composer's. Bench:
  `needs-relay-node-judged-as-transport`.

## [1.1.0-alpha.8] - 2026-10-29

### Fixed

- **A live suite's verify is no longer settled red by a worker that ran it without custody.** The `verify` worker of
  starci-next-app's `ai-router-live` ran `npm run test:e2e` itself, met `TEST_WORLD_NOT_DECLARED` for `OPENROUTER_API_KEY` and
  filed `failed`, which failed the task with no harness run: four tries spent while custody held the key, since custody was
  handed only inside the harness's own command checks. Workers now run a live suite through `starci test live <spec...>
  [--run <suite>]` (`cli/src/core/test/live.ts`), the same `prepareSuite` the command check uses: the declared keys reach that
  one child process from custody under a heavy-command slot, every value scrubbed, refusing `CUSTODY_KEY_MISSING`,
  `CUSTODY_UNREADABLE` and `CUSTODY_KEYS_UNRESOLVED` before it runs. A `failed` or `blocked` result whose output shows
  `TEST_WORLD_NOT_DECLARED` or a custody refusal leaves the task `reported` with a `custody-recheck` event and spends no try;
  its verify runs the suite with custody and judges by that run's exit, the worker's verdict set aside (the task's verify and
  the wave alike), and a key custody lacks ends it `awaiting_owner` on the credentials question. The verify op, the worker
  procedure and SHARED-TEST-2 say a `useSandbox` suite runs only through that verb. Bench: `verify-worker-custody-recheck`,
  `test-live-custody`.
- **`verify-host-held-no-try` holds on an idle CI runner.** It serves the busy stand-in, as the CPU-starve scenarios do, because an idle runner reads 0% CPU, under even a 0.0001 ceiling.
- **A workflow change is never blocked by a done node's context growing.** A replan measured every node's contract against the
  context files as they are now, so a canon file that grew put a done task past its op's budget (subscription-premium's
  `deps-grammar` at 24022 of 24000 tokens) and refused every change to the workflow `WORKFLOW_INVALID`. `buildGraph` now judges
  the context budget only on a contract the change adds or edits; a contract the current graph holds (done, unchanged or
  retried) keeps the budget it was admitted under. Bench: `change-retry-beside-done-node-over-budget`.
- **A need rejected because its relay failed is relayed once the relay is fixed.** `capability:domain.entitlement` was rejected
  as unrelayable before the complete-commit relay landed, so the fixed relay never ran for lesson-ai. Relays are versioned
  (`RELAY_VERSION`, recorded on every relay event and waiter release); the need router reopens a rejected need whose relay
  conflicted under an older version once per version, parking the waiters its rejection released again and resolving it
  through its last resolver, so the next step relays every commit it landed. New verb `needs reopen <key> --reason <why>`
  (Supervisor, Debug) takes back any rejection the same way; each reopen is a `need-reopened` event naming who did it. Bench:
  `needs-reopen-rejected-under-older-relay`.
- **A Kernel's escalation reaches a replaced Supervisor by mail.** A Kernel stays the Dispatch of the Run that launched it, so
  after its Supervisor was replaced every escalation mail from its terminal was refused `dispatch_run_mismatch` and fell back to
  a typed prompt. `wakeSupervisor` now picks the sender at send time: the caller's terminal when its seat's Run is the current
  Supervisor's, else the Supervisor's own terminal; the typed prompt stays the fallback for any other refusal. The bench Orca
  stand-in refuses a cross-Run Dispatch sender as Orca does. Bench: `orca-kernel-mail-after-supervisor-replaced`.
- **A task's new dependency resolves in its own install** (monitor report 8, tickets tk-508a33c34756 and tk-15a70700fb46: a task
  adding jose to package.json and the lockfile failed TS2307 and its suites in its Op worktree, which held the install of the
  branch it was cut from). The install cache key covers every install input (the lockfile, manifest and .npmrc of the install
  folder and of each workspace member, `installKey` in `cli/src/harness/install-cache.ts`), so a changed lockfile or manifest is
  never served the base's entry; an Op worktree whose install no longer satisfies its own lockfile (`installSatisfies`, read
  from npm's record of the install) gets the install of its own inputs at seat start and before the worker's dry replay
  (`refreshOpInstall` in `cli/src/harness/land.ts`), from the cache or by `npm ci` under the heavy governor, one fill per key,
  local package sources reapplied after it. Bench: `verify-new-dependency-own-install`.
- **A verify the host holds is no verdict** (tk-15a70700fb46: a task verify sat 413 s queued on a tsc check at CPU 100% and was
  stopped with nothing judged). A `task verify`'s heavy commands, those of the processes it starts included, wait in the queue at
  most its contract budget and are then refused `HOST_HELD` (exit 75, `withHeavyBound` in `cli/src/harness/heavy.ts`); a settling
  verify so stopped returns its task to reported with no try spent and no count toward `settleNoVerdictMax` (`verify-host-held`),
  and the next step verifies it again (`workflow step` reads it as a wait). The verify deadline counts only the time a verify's
  commands ran, never their queue wait (`queuedSince`, stamped into the lock's beat in `cli/src/harness/settle.ts`). Bench:
  `verify-host-held-no-try`.

## [1.1.0-alpha.7] - 2026-10-29

### Added

- **The urgent release**. `starci app release
  push --urgent --reason "<text>"` ships an app after its fast local checks alone and writes an URGENT record (role, reason, checks,
  commit); `starci app release gate --backfill <tag>` runs the full gate on that commit later, promoting the record to L4 when green
  and opening a blocking `verify` ticket when red (`cli/src/core/app/release.ts` hands @starci/hfs 4.9.10 the caller's role and the
  ticket queue). `requireCi` of `deploy.prod` and `release.cut` accepts the commit's pushed urgent record when the caller passes
  `--urgent` (`cli/src/core/check/ci.ts`), and `starci app stack deploy --env production --execute` now holds `deploy.prod` itself
  (`cli/src/core/app/stack.ts`); with `--urgent` the deploy's safety floor runs first and is never skipped. Bench:
  `release-urgent-push-deploy-accepted`, `release-urgent-backfill-green-promotes`, `release-urgent-backfill-red-opens-ticket`,
  `app-lint-eslint-heap-flag`; the boot proof timeout is held by `packages/hfs/src/hfs-boot-proof.spec.mjs` on a real worker.

### Changed

- **The release gate's load defects.** The eslint memory of ops/liveness.yaml `heavy` is 8192 MB, its admission estimate matches,
  and the CLI hands it to the ESLint child of an app lint or app check as its heap; `heavy.bootProofTimeoutSeconds` (300) is the
  lite boot proof's own budget from its spawn, a timeout retried once and then reported `BOOT_PROOF_TIMEOUT`, not as a failed proof
  (`hfsLimitsEnv` in `cli/src/harness/heavy.ts`).

### Fixed

- **A dispatch left pasted in a composer is submitted, and the step never dies on it.** The composer re-submit sent a bare
  Enter with `--retry-request`, which Orca refuses (`invalid_argument: --retry-request and --wait-submit require --text with
  --enter and without --interrupt`); the refusal escaped `kernel next`, so every call failed (lesson-ai from 00:49Z) and a Devin
  dispatch sat pasted unsent. `terminalSubmit` now sends a bare Enter with no request id, the recorded resubmit count bounds the
  replays, and a refused Enter returns no action instead of throwing. The bench Orca stand-in refuses the same flag set, so the
  composer scenarios now prove it.
- **Sonar S1529 in custody.ts:** the top-level const check reads the declaration list's first token (`const`) instead of masking `NodeFlags` with a bitwise `&`.
- **A yaml key's comment is searched with that key.** `contexts search` cut a yaml file at each key line, so the comment written
  above a key landed in the chunk of the key before it (`neverRead`'s "files no agent opens" sat in `sopsEnvelopes`); a cut now
  starts at the comment block directly above its key, the file's leading comment staying its header (chunker 4,
  `cli/src/core/contexts/search-corpus.ts`). The hybrid recall@5 of the search eval is 0.978 on a fresh index.
- **A served bench stand-in ends on SIGTERM.** `Serving.stop` (`cli/src/shared/exec.ts`) sends the served tree a SIGTERM, waits up
  to 5 s, then kills what is left, so the hold stand-in gives its folder's parent its mode back; a SIGKILL left `.runtime/bench`
  read-only on Linux and the next scenario failed EACCES. A scenario whose run cannot be set up is that scenario's error, and the
  bench goes on. A `busy` stand-in (`bench/stub/busy-stub.mjs`) keeps a core busy for the scenarios that need a hot CPU on an idle
  host; `heavy-project-fair-share` runs on two slots, one per project, and checks the host has them before it queues.
- **A shared need's relay is never a dead end** (monitor report 7, ticket tk-069fd4d52ad3: lesson-ai waited forever on
  `capability:domain.entitlement`). A need resolved by a workflow's keys records every commit those keys landed, each attempt and
  round of each key in branch order (`keyCommits` in `cli/src/core/needs/tend.ts`), not only each key's last task, so a relay no
  longer carries a rework commit without the commits it stands on; a need resolved with the short list is completed at its next
  relay (`need-commits-completed`). The relay merges each commit three-way against its parent and skips one whose change the
  branch holds already (an equal patch, or a merge that changes nothing). A relay that still conflicts becomes work of the waiting
  workflow: a generated `relay.<need>.r<round>` node owned by its Kernel, built on the resolver's node, allowed the conflicting
  files and the commits' files, whose contract applies exactly those commits preserving both sides' intent (`relayTask` in
  `cli/src/harness/reconcile.ts`, added by `amendWithRelays`, its commits pre-applied up to the first conflict by the engine's
  `applyGenerated`); every waiter depends on it and spends no try until it lands, and a `need-relay-conflict` event names the node
  and files. Only a relay node its Kernel removed raises the Supervisor's `conflict`. Relay keys are the harness's own like revert
  keys (no file adds or edits one) and sit outside the goal's scope paths, the lanes and the foreign-source rule. Bench:
  `needs-relay-conflict` (rewritten to the relay node), `needs-relay-three-way`.
- **A package need gets its package-fix worker** (ticket tk-3d5e1c4da017: every code-label `supervisor dispatch` was refused
  `CONTRACT_UNFIT`, so `package:@starci/eslint-canon-be` could never be fixed). A package fix's worker contract carries its
  behavioural check itself, the new `package-specs` preset: `starci pkg test <package>` (`cli/src/core/pkg/test.ts`) runs the
  package's typecheck and lint scripts its `test` does not run already, then `npm test`, in `packages/<name>` of the app's
  package edit worktree, each under a heavy-command slot. It reads `side: package` of the code op (CONTRIBUTING.md,
  packages/README.md, contexts/authority/packages.md: about 14k of the op's 24k tokens) instead of `side: harness`, whose
  cli/README.md put it at 29.6k; `side=package` and `edition=harness` are filled when the dispatch names neither.
  `supervisor dispatch --check <preset>` adds any preset of ops/checks.yaml to a worker's contract (an unknown one is refused
  `CONTRACT_UNKNOWN_PRESET`), and its `CONTRACT_UNFIT` refusal names the fix in `fix:` lines (`workerChecks` and
  `unfitRemedies` in `cli/src/core/supervisor/workers.ts`). Bench: `needs-package-worker-specs-check`,
  `supervisor-dispatch-check-preset-fixes-unfit`.
- **A live suite whose keys sit in a `const` gets them from custody** (starci-next-app `ai-router-live` burned three tries
  on TEST_WORLD_NOT_DECLARED while custody held OPENROUTER_API_KEY). `declaredKeys` (`cli/src/harness/custody.ts`) reads
  each `useSandbox(...)` call's `keys` with the TypeScript compiler: a literal array, or a `const` of the spec or of a
  relative module it imports (`as const`, a type annotation or `ReadonlyArray` alike), spreads included, never an object
  element (`{ alias, resolve }`). A declaration it cannot reduce to string literals refuses `CUSTODY_KEYS_UNRESOLVED` naming
  `spec:line` before the suite runs, the task awaiting the owner with no try spent and one deduped `harness-defect` ticket; a
  key sealed empty is `CUSTODY_KEY_MISSING`; a failed run that still reports a key custody holds as `TEST_WORLD_NOT_DECLARED`
  is `VERIFY_INFRA` (no verdict, no try) with one `harness-defect` ticket deduped by `CUSTODY_KEY_NOT_HANDED`. Bench:
  `verify-live-suite-custody-const`.
- **An opt-in slot no task may enable is enabled by the harness** (ticket tk-3ea0b331b3df: be-purchase's webhook doors red
  `HFS_SLOT_NOT_ENABLED`, since only the app-root `hfs.json`, which no task writes, switches on `sides.be.patterns`). The harness
  reads which slots a task's paths lie in through @starci/hfs's classifier and declares each missing pattern itself: before the
  task's Op worktree is cut, before its verify, and when a red of its verify or wave names an `HFS_SLOT_NOT_ENABLED` slot, after
  which the verify or wave runs again on the new head and no try is spent. The declaration is an additive edit of that one list
  (every other byte of `hfs.json` kept, proved by parsing), a commit of its own on the workflow's branch under its land lock
  (`Starci-Harness: hfs-pattern`), an `hfs-pattern-enabled` event and a resolved shared need `config:hfs.<side>.patterns.<name>`
  whose later declarations on other branches are its relays; no task's diff carries `hfs.json`, so none is judged app-wide for it
  (`cli/src/harness/hfs-patterns.ts`, `cli/src/shared/json-edit.ts`). `contract check` names the patterns a contract needs.
- **Findings already on the branch fail no task when a config change widens the check** (ticket tk-25adb43e8e76:
  hfs-webhooks-pattern's one-line hfs.json edit was red on BE_PUBLIC_CONTRACT_FORM, HFS_UNUSED_EXPORT and
  route-page-is-one-page findings already at its base). `starci check run`, widened to whole packages by an app-wide configuration
  file, runs the same tier at its base in a clean checkout and judges each red typecheck, lint or canon step by its findings,
  keyed by rule, file and message with line numbers dropped: a step whose findings the base already holds turns green and they are
  recorded as `baseline-findings` evidence (data.baseline, a `baseline-findings` ledger event of the task), and only a new finding
  stays red (`cli/src/core/check/base-findings.ts`). Bench: `verify-hfs-pattern-declared-by-harness`,
  `verify-widened-check-judged-against-base` (fault `new-finding`).
- **A harness-side code worker fits the code budget** (every `side=harness` worker was refused `CONTRACT_UNFIT` at about 30.3k of
  the code op's 24k tokens, 72 KB of it cli/README.md loaded whole). cli/README.md's harness part is split into `###` sections
  (each opened by `starci contexts anchor cli/README.md#<slug>`), and `starci contexts anatomy --write` generates their index,
  `contexts/harness/cli-sections.md` (anchor, size and first sentence per section; `--check` fails on drift;
  `cli/src/core/contexts/sections-render.ts`). `side: harness` of the code op reads CONTRIBUTING.md, that index and
  contexts/authority/branch.md (about 13.5k tokens) and opens the README's sections on demand. The 24000 budget is unchanged.
  The generated files that repeat another file are one list (`repeatingFiles` in `cli/src/core/contexts/index-render.ts`) that
  the contexts index and the search corpus both skip. Bench: `supervisor-dispatch-harness-side-fits-budget`.
- **A hot CPU slows the heavy queue and never freezes it** (monitor report 5: 0 admissions for 2 h 33 with 23.7 GB free). Once
  the queue admitted nothing for `heavy.cpuStarveMinutes`, its first command RAM admits starts despite the CPU ceiling, one at a
  time. The queue is served by age, a project with fewer commands running first, and a project running `heavy.projectSlots`
  commands is passed over while another project's command waits, so one gate cannot starve another project's small typecheck.
  `kernel next`, `kernel submit`, `supervisor next` and `supervisor tick` never wait in the queue: their step starts a heavy task
  verify, the wave and the final verify as detached jobs (`harness/jobs.ts`; `workflow wave --final` runs a final verify), and
  any other heavy command in their turn is refused `HEAVY_DEFERRED` at once. A `kernel submit` hung 25 min and a `kernel next
  --wait 30` over 8 min because the step they run verified reported tasks inline, under the heavy queue. Two settlers deleting
  the same landed Op branch no longer fail the second. Bench: `heavy-cpu-starved-queue-admits`, `heavy-project-fair-share`,
  `kernel-next-never-waits-on-heavy`.
- **A Supervisor idle past its lease is stalled, never alive.** The tick's stall ladder fired only while a decision or owner
  request waited, so a Supervisor that ended its turn with nothing waiting sat at its prompt with an expired lease for 50 min
  and was never typed its loop prompt; an expired lease now counts as a stall on its own, and `supervisor status` says
  `stalled (lease expired at ...)`. Bench: `supervisor-lease-expired-nudged`.
- **A wake-up mail Orca refuses is typed instead.** A Kernel a replaced Supervisor dispatched stays a Dispatch of the old
  Supervisor's Run, and Orca refused its mail to the new one's Run (`ORCA_FAILED` all evening, with only the code kept). The
  Kernel's wake of its Supervisor and the Supervisor's wake of a Kernel now type the target's loop prompt into its terminal when
  the mail fails, and record Orca's own words. Bench: `orca-wake-mail-refused-typed`.
- **One task out of tries has a way out.** `budget raise <workflow> --task <key> --tries <n>` raises that node's try budget over
  its contract's `budget.tries` (its Kernel, the Supervisor or the owner); a workflow-wide `--tries`, which the briefs named,
  never freed a `TRIES_EXHAUSTED` retry. The Kernel and Supervisor briefs name it for a harness-caused exhaustion. Bench:
  `budget-task-tries-raised`.
- **`host load` names Defender burning CPU.** On Windows it reads the CPU of the real-time scan (MsMpEng) and, at
  `heavy.scannerCpuPercent` or more, prints the owner's `Add-MpPreference -ExclusionPath` command for the state base and every
  registered repository; it never runs it, since security settings are the owner's.
- **A vanished local package folder no longer burns tries.** A project's local package record (`deps-local.json`) that named a
  package edit worktree Debug had landed and removed made every Op launch log `deps-local-sync-failed`, the wave's install red,
  and both landed tasks come back as wave-foreign revivals at the same try. Every reader of the record now heals it first
  (`healRecord` in `cli/src/core/deps/packages.ts`): an entry whose folder no longer holds its package is repointed to the
  harness's own `packages/<name>` (of its main checkout, also the `deps source --local` default), or dropped so the package
  resolves from npm, with a `deps-local-healed` event; `worktree gc` heals every project's record once it removed a package
  edit worktree. An install red although the work changed no file an install reads is now the harness's failure
  (`assertNoInfraFailure` in `cli/src/harness/clean-verify.ts`): the verify or wave reaches no verdict, spends no try, fails
  and revives no task (`wave-infra`), opens one harness-defect ticket (`INSTALL_RED_HARNESS`), and the next step verifies
  again. Bench: `deps-local-vanished-folder-heals-on-launch`, `wave-install-red-harness-stop`.

- **A held worktree no longer loops or fails a settle.** Removing a harness worktree first closes every Orca terminal whose
  worktree it is (a seat's or a plain shell's; the caller's own aside), since Windows refuses to remove a folder a process works
  in (EBUSY). A folder git emptied and deregistered but whose rmdir was refused is removed as the empty folder it is, instead of
  `git worktree remove` answering "is not a working tree" on every workflow step; one git deregistered but could not empty (a
  file named `nul`, which Windows' own delete refuses) has its remaining files deleted, links unlinked first and never
  entered, and the collector finds such remnants under a project's state worktrees folder once they sit quiet for ten
  minutes. A removal still refused as busy (EBUSY,
  EPERM, EACCES) is recorded `worktree-remove-busy` in the ledger and left: the task settles, the step reports a wait, and
  `worktree gc` retries it with backoff (1 min doubling to 1 h), opening one `harness-defect` ticket at the sixth attempt that
  names the holding process when `handle`, `openfiles` or `lsof` can (`cli/src/harness/worktree-busy.ts`). `worktree gc` also
  removes the harness worktrees a retired project still holds, and `project retire` closes the main checkout's terminals and
  saved workspace details (`orca terminal close --all`) before detaching it, so a forced delete leaves no "Unknown" project in
  Orca. Bench: `worktree-remove-closes-terminal`, `worktree-remove-busy-gc-retries`, `worktree-gc-retired-leftovers`; a new
  `hold` stand-in holds its working folder, and the Orca stand-in lists each terminal's worktree and ends a holder whose
  terminal is closed.
### Changed

- **The Supervisor rules what a Kernel leaves undecided**. A Kernel decision (a red task, a failed or
  returned one answered without moving it, a question, check-premise or shared-need) still undecided past
  `decisionStallMinutes`, though the Kernel was woken, is no longer a `harness` escalation ticketed for Debug: the tick hands it
  to the Supervisor as a `kernel-undecided` decision carrying the decision in full and the task's evidence, superseded if the
  Kernel decides it first. The Supervisor rules it in the Kernel's place with the Kernel's own `workflow-change` (under its
  route and need checks; its route counts toward the limit) or an `escalation`, through `supervisor submit`; the ruling is
  recorded `ruled-by-supervisor`, closes the Kernel's decision, and `kernel next` tells the Kernel seat once on its next turn
  (`rulings`). Only a ruling escalation becomes a ticket, and only of kind `owner` (a question to the owner) or `harness` (a
  defect for Debug); any other is refused `RULING_WITHIN_AUTHORITY`. The Kernel brief and the `decisionIdle` prompt say a
  woken decision is answered in that turn: never leave a decision open across a wake. Bench:
  `supervisor-tick-wakes-kernel-on-undecided`, `supervisor-rules-kernel-undecided`.
- **A hold names what releases it.** A `workflow-change` that answers a decision on a task without moving it (no change, no
  need) carries `hold: {ticket | commit | need | time}`, else it is refused `HOLD_UNCONDITIONED`. The hold is recorded on the
  task (`task-held`), keeps the task out of the undecided wakes, and is released by the harness once its condition is met (the
  ticket closed or answered, harness main contains the commit, the need ended, the time passed), from every workflow step and
  tick and from the ticket's close or answer: a task the harness ended comes back at the same try, any other returns to its
  reopened Kernel decision (`cli/src/harness/holds.ts`). A hold with no release condition held a dead task for hours.
  Bench: `kernel-hold-released-by-ticket`.
- **Telegram carries only what needs the owner's answer**. ops/telegram.yaml `notices` lists the notice
  kinds that go out, `question` alone by default: a question ticket awaiting the owner is sent once as its card, reminded at
  most once per `reminderHours` (24) while it stays open as a reply to the card with its buttons, and an answer is acknowledged
  with one short line. Workflow done, blocked or stopped, owner requests taken up and defect tickets opened or fixed are no
  longer sent (`workflow`, `request`, `defect` switch them back on); they stay on `/status`, `/tickets`, the harness UI and the
  monitor's report. Bench: `telegram-owner-decisions-only`; `ticket-telegram-card-buttons` switches `defect` on.

### Added

- **Host starvation is visible, and ticketed once.** `starci host load` adds who holds the memory: the top processes by working
  set, managed (a recorded heavy command or seat, a process under one, one working in the harness's state folder) or unmanaged
  (other node, WSL and Docker, IDEs, agents), each command line clipped and redacted, with totals per group; each queued heavy
  command shows how long it waited and why ("free RAM 2.6 GB below reserve 8 GB"), and the seat holds are listed
  (`harness/host-holders.ts`). `seat start` records a `SEAT_RAM_LOW` hold (since when, on what memory) and `workflow status`
  names it instead of a bare `queued` ("held: free RAM 2.6 GB below seat floor 6 GB (since 21:02Z)"), as it names a verify
  waiting for a heavy slot and a task awaiting the owner. When admission or a seat launch has been held past
  `heavy.starvedTicketMinutes` (ops/liveness.yaml, 45), `supervisor tick` opens one `harness-defect` ticket per episode
  (`HOST_STARVED`) listing the top unmanaged holders; the governor's rules are unchanged. Bench: `host-starvation-visibility`.
- **Custody into an opt-in live suite.** A command check whose run holds a `useSandbox` spec reads the keys its world declares
  from the app's sealed `.starcistacks/<env>` members, with the code `app secret materialize` uses, into that test run's child
  environment only, and scrubs every handed value from the output before it becomes evidence (`harness/custody.ts`). A key
  custody lacks is `CUSTODY_KEY_MISSING` ("custody lacks OPENROUTER_API_KEY in dev"): the task ends `awaiting_owner`, in its
  verify or in the wave that runs its deferred tests, spends no try and is filed as the owner's question on credentials, where
  it used to fail red with TEST_WORLD_NOT_DECLARED. Bench: `verify-live-suite-custody`, whose fake value appears in no output,
  check row, event or ticket. A bench verb step that fails inside `starci app` now shows @starci/hfs's stderr.
- **`/status` on Telegram.** One message summing up the workflows of every registered ledger: counts by status per project,
  each blocked workflow with its reason, each running or paused one, the questions awaiting the owner and the open defects.

### Fixed

- **A workflow notice is sent once per state.** Its key held the goal and graph versions, which a Kernel amending a blocked
  workflow bumps every minute, so "workflow lesson-ai is blocked" went out at 2:59, 3:00 and 3:02; it is now keyed by status and
  a hash of the reason (`workflowNoticeKey`). Bench: `telegram-workflow-notice-once-per-state`.

## [1.1.0-alpha.6] - 2026-10-29

- **Desktop app 0.2.0, released as latest.** The app-v* release is no longer a pre-release, so the repository sidebar shows it; README gains a Packages section with every published package, its npm link and a live version badge.

### Added

- **Atomic landing.** A worker's brief names its own Op worktree as its repository (it named the workflow's worktree, so
  workers wrote there and their tasks settled done with nothing landed). `lands` is red when a result names files under
  allowPaths while the candidate changes none, and every ending of an Op's task preserves whatever sits dirty under its
  allowPaths in the checkout it lands on as the task's work and puts that checkout back under the land lock (`land-escaped`),
  so a green task is on its branch or returned with its work preserved, and a stale leaked copy no longer refuses the
  fast-forward (`SETTLE_REF_FAILED` to awaiting_owner). `task verify --recover` returns a done task whose named files never
  landed: its work preserved, failed `land-orphaned`, a harness cause that revives it at the same try, its workflow reopened
  when it had ended done. Bench: `land-escaped-work-returns-preserved`, `land-stale-escape-cleared-then-lands`,
  `land-orphan-recover-returns-task`.
- **Test runs scoped to the task's own specs.** A jest command check (tests-pass, suite-verdict) runs the spec files it names
  by `--runTestsByPath`, which no array option of the script (`--selectProjects e2e`) can swallow; an integration, e2e or
  contract run naming none runs the task's changed specs, else every spec of its kinds; a live-provider spec (`useSandbox`)
  runs only when its file or folder is named (`scopedTests` in `cli/src/harness/coverage-scope.ts`). Bench:
  `verify-e2e-scoped-to-own-specs`.
- **check-premise decisions.** A failed task whose only reds are command checks its contract wrote, each output stating an
  expectation the otherwise green result contradicts, reaches the Kernel as `check-premise` with each check's command and
  output; route `check-premise-amends-checks` takes only an edit that sets the task's checks (`cli/src/harness/check-premise.ts`,
  ops/coordinators/kernel.md). Bench: `kernel-check-premise-amends-checks`.
- **Undecided work wakes the Kernel.** The tick types a live Kernel `prompts.decisionIdle` naming each open Kernel decision, and
  each failed or returned task whose last decision was answered without moving it, past `decisionIdleMinutes`; past
  `decisionStallMinutes` it escalates the item to the Supervisor (kind harness, ticketed) (`decisionIdle`, `stall` of
  ops/liveness.yaml). Bench: `supervisor-tick-wakes-kernel-on-undecided`.
- **Every owner wait is ticketed.** A task left awaiting_owner becomes a blocking `verify` ticket naming its verify's last
  reason, beside the escalations (with or without a topic) already ticketed, and `supervisor next` sends the owner's Telegram
  notices in the round that filed them. Bench: `ticket-legacy-owner-escalation-and-awaiting-task`.

- **Ticket cards on Telegram.** Every ticket notice is the one banner `ops/telegram/ticket-banner.png` (generated once with
  Codex's image generation; `banner` of `ops/telegram.yaml`), uploaded once and then reused by its Telegram file id, captioned
  in Vietnamese with the ticket's facts and carrying inline buttons: a defect's details, hand to Debug, the ticket list and a
  one-hour mute (`muteMinutes`); a question's accept the default, its listed options (`ticket open --option`) and another
  answer; a fix's commit link (`commitUrl`) and reopen. The bridge reads button presses (`callback_query`) from the owner's chat
  only, acts through the ticket functions, answers the press and edits the card's keyboard; `/tickets` lists the open tickets
  with a button each and "Đã đóng hôm nay", `/ticket <id>` shows one in full, redacted. Bench: `ticket-telegram-card-buttons`;
  the Telegram stand-in answers `sendPhoto` (json or multipart), `answerCallbackQuery` and `editMessageReplyMarkup` and takes
  presses at `/__callback`.

- **Tickets.** What the Supervisor cannot resolve within its authority becomes one ticket in machine.sqlite (`tickets`,
  `ticket_waiters`): a defect (`harness-defect`, `package`, `launch`, `verify`, `routing`, `other`) for Debug's queue, or a
  question (`question:business`, `question:code`, `question:spec`) for the owner, with severity, evidence (task, attempt, seat,
  decision, redacted red tail), what was tried, a proposed default, and who opened and reported it. A repeat of the same defect
  (kind, error code, module) or question bumps `occurrences` instead of opening a second, and reopens a fixed defect. New verbs:
  `ticket open` (supervisor, owner, debug), `ticket list [--state] [--project]` (blocking first, then by occurrences),
  `ticket show`, `ticket take` and `ticket close --fixed-by | --wontfix --reason | --duplicate` (debug, owner), `ticket answer
  --answer | --accept-default` (owner). `supervisor next`, `supervisor tick` and every notice sweep file each open `owner`
  escalation the owner rules as a question ticket (its topic and `default` kept) and each `harness` escalation as a blocking
  defect ticket, the escalation waiting on it. Telegram puts each question to the owner once, whose reply (or `/answer <ticket>`,
  `default` accepting the proposed default) answers it, and notices a defect's opening and close once each, below blocking
  only past `ticketOccurrences` (`ops/telegram.yaml`); the notice of an `owner` escalation is now its ticket's. An answer or
  close is recorded with who gave it and why, releases every task and escalation waiting on it, wakes the Supervisor with an
  owner request naming them, and reaches every later brief of the workflow under "Answers". The Op, Kernel and Supervisor
  briefs carry the rule: an Op stuck on an unclear rule or a harness red files `blocked` with its question and proposed
  default, the Kernel answers or escalates, the Supervisor answers or opens one ticket; nobody guesses silently. Bench:
  `ticket-op-question-kernel-answers`, `ticket-op-question-owner-answers-on-telegram`, `ticket-harness-defect-debug-closes`;
  `telegram-notify-once-per-decision` and `telegram-bridge-reply-records-owner-request` now prove the ticket notices.

- **Coordinators run on their own.** An `owner` escalation names its `topic` (`scope`, `money`, `credentials`, `legal`,
  `product`) and may propose a `default` with its `reason` (`COMMAND_INVALID` otherwise); the Supervisor's driver (`supervisor
  next` and `supervisor tick`) decides a `product` choice that carries a default on that default, answers its Kernel with an
  `escalation-answer` and records the reasoning (`escalation-defaulted`), so only scope, money, credentials, legal matters and a
  product choice with no default reach the owner and Telegram. The tick wakes a Kernel whose workflow holds ready work with no
  live Op past `stall.readyIdleMinutes` with a prompt naming the ready tasks, and gives it up to a relaunch past
  `stall.readyStallMinutes` (`ops/liveness.yaml`). A task the harness ended with no red of its own (a wave red not proven its
  own, a fenced or lost launch, a verify stopped by infrastructure or its deadline) returns to ready and is dispatched again at
  the same try, its last included (`task-revived`, at most `reviveMax` per node; past it the Kernel's red names the
  `harnessCause`). `workflow define` and every replan refuse `NEEDS_REQUIRED` a task whose input names another workflow's
  branch or landed commit as its source. Bench: `supervisor-defaulted-escalation-decided`,
  `supervisor-tick-wakes-idle-ready-kernel`, `kernel-harness-killed-task-revived`, `kernel-cross-branch-copy-refused`.

- **Shared needs.** A worker that finds a shared thing missing files `task result --status blocked --needs <key> [--rule]
  [--paths]... [--note]` (or a `needs` list in its output) instead of building it. Keys are `capability:`, `package:` or
  `config:` names, normalized, and a reported path under a shared root of the new `ops/needs.yaml` names the key. One need
  per (project, key) lives in machine.sqlite (`shared_needs`, `shared_need_waiters`); every report of the key attaches its
  task as a parked waiter, its work kept. Every workflow step, under both runners, routes a need to its workflow's Kernel
  (one workflow) or to the Supervisor (two workflows, a shared root, a config key, a `@starci` package as a package edit)
  as one `shared-need` decision; exactly one owner resolves it (`workflow-change` with `need.resolver` or `need.reject`, the
  new `need-owner` Supervisor command, `supervisor dispatch --need`), a need unowned past `needs.ownerDeadlineMinutes`
  (`ops/liveness.yaml`) climbs one router, a failed resolver or a cycle reopens it, and once the resolver lands (or its
  package handoff is merged) the waiters are retried from their kept work in each workflow's own step. A cross-branch relay
  comes first: the resolving tasks' landed commits are cherry-picked onto each waiting workflow's branch under its land lock
  (a `need-relayed` event, printed by `needs show`), and a conflict moves nothing and raises one Supervisor `conflict`
  escalation with the waiters kept parked. A `need-owner` may name tasks its owner already landed as `need.resolver`. A wrong
  answer bounces `NEED_ANSWER_INVALID` with guidance. New verbs `needs list`, `needs show`, `needs merge`. Bench group
  `needs`: ten scenarios.

### Fixed

- **A task is briefed with the rule pages of its paths.** The resolved context adds, for every allowPath, each
  `contexts/code/{be,fe}/*.md` topic whose front matter `slots` names a slot of `contexts/hfs/slots.yaml` the path lies in
  (its most specific slot, an app-kind slot matched by the app folder) or holds (`harness/rule-pages.ts`), so a worker on the
  CLI aggregate may cite `BE-CLI-*` and one on an integration `BE-INFRA-*`. The brief lists them as "Rule pages of your
  paths", citable and opened on demand, outside the op's context budget. `rules-cited` names the page that owns an id the
  task was not handed ("BE-WEBHOOK-1 is owned by contexts/code/be/webhooks.md, which the brief did not include"). Bench:
  `cited-rules-by-paths`.
- **A task in its Op worktree is judged on its own diff.** `starci check run --task` and the worker's `task verify --contract`
  replay diff from the Op worktree's fork (the workflow head it was cut from), never from `origin/main`, so lint, typecheck
  and the changed-file coverage no longer judge what earlier tasks left on the workflow branch (`LINT_CONFIG_MISSING` and
  `TYPECHECK_CONFIG_MISSING` on `.starciwork` files, whole-suite coverage thresholds). A tests-pass run that changed no source
  file judges no coverage, and coverage arguments go only to a command that runs jest (`jest`, `npx jest`, or a package
  script that calls jest); any other command, such as `git diff --no-index`, runs as named.
- **Orca lineage is re-applied on every tick.** An Op whose launch ended unknown is listed under its Kernel's worktree at
  once, and `supervisor tick` re-applies the lineage of every harness worktree Orca lists without its parent
  (`harness/orca/lineage.ts`), logging Orca's refusal with its reason (`orca-lineage-refused`). Bench:
  `orca-lineage-reapplied-on-tick`.
- **A pasted dispatch is submitted before its launch is adopted.** The paste itself prints, so a dispatch left in the
  composer read as started and was adopted unsubmitted; the screen is now read first (the marker found anywhere on a row
  or wrapped over two), and an idle Kernel or Op is resubmitted before it is nudged. Bench:
  `orca-composer-paste-printed-before-adoption`.
- **`project retire` cleans up after the project.** It removes every harness worktree of the project (work preserved,
  branches kept) and detaches the repository from Orca's project list (`orca project setup-delete`) once Orca lists no
  other worktree of it. Bench: `project-retire-removes-worktrees-detaches-orca`.
- **Concurrent starts of one task no longer race on its Op worktree.** It is made under a ledger lock per task (bench
  `orca-duplicate-step-no-double-launch` on Linux). `supervisor-dispatch-worker-report` reads the worker's branch, whose
  worktree the accept removed (`gitLog` takes `ref`), and `worker-commits-itself` commits in the Op worktree.

- **`starci app add` takes every front-end unit.** The noun names `page`, `overlay` and `layout` beside `block`,
  `composite`, `branch` and `leaf`, and the verb hands @starci/hfs `--kind modal|drawer` and `--form` (an overlay) and
  `--blocks a,b` (the blocks a page or layout composes). What each one writes is @starci/hfs 4.9.7's.

### Changed

- **A package publishes once its own CI jobs are green.** The publish no longer waits for the `ci` aggregate: `publish-packages`
  publishes each due package once the repo-wide gates and the `package` jobs of its build order are green, holding and naming
  the rest (`.github/scripts/publish-gate.mjs`), and `publish-cli` publishes the CLI after it once the harness job and every
  gate are green. A red bench, Sonar or app job no longer holds a package (CONTRIBUTING.md CONTRIB-20). `release publish
  --publish --package cli` now moves the CLI's sibling requirements to their folder versions, as a run without `--package` does.
- **Each Op runs in a worktree of its own; path leases are gone.** Every task of a workflow, under `orca` and `inline`, works
  in `<project state>/worktrees/<workflow>.ops/<task>` on branch `starci/<workflow>.ops/<task>`, cut from the workflow
  branch's head when its seat starts, with the hooks and the workflow checkout's install linked in, never a fresh install
  (`harness/land.ts`). No path is held while a task works, so a ready task dispatches whatever paths others write
  (`LEASE_CONFLICT`, `LEASE_LOST`, the `leases` table, `conflictMinutes` and lease expiry are gone). `task verify` rebases
  the candidate onto the head it lands on (`git merge-tree`) and checks that, so what is verified is what lands; it lands
  under a land lock per branch held only while integrating, verifying again under it when another task landed meanwhile.
  A textual conflict is never resolved by the harness: the work is preserved, the attempt ends `conflict`, and the Kernel
  gets a `conflict` decision to amend on the new head. In Orca each Op worktree is listed under its workflow's worktree
  (`[Op] <workflow>: <task>`) and that under the main checkout (`orca worktree set --parent-worktree`), and removed through
  `orca worktree rm`. `task status` shows a task's Op worktree instead of leases; `task send`, `cancel`, `result` and
  `verify` drop their lease fields. Bench: `plan-self-overlap-both-land`, `plan-self-overlap-conflict-returns`,
  `lifecycle-inline-chain`.
- **The harness removes every worktree it made.** An Op's worktree goes when its task settles; a workflow's when it is done
  or stopped and its Kernel closed; a Supervisor worker's when accepted or rejected; a package edit's once its head is on
  main; a clean-verify checkout after its verdict. The new verb `starci worktree gc [--dry-run]`, run by `supervisor tick`,
  `supervisor accept` and `reject` and the step of an ended workflow, finds every harness worktree whose owner ended and
  every orphan, preserves its uncommitted work, unlinks its install links (link only) and removes it; branches with work
  that never landed stay ([contexts/authority/README.md](contexts/authority/README.md) "Worktrees"). Bench:
  `worktree-gc-every-kind`.

- **CI publishes on every push to main.** Apps consume the harness packages locally (`deps source --local`); publishing is
  CI's alone. Once `ci` is green on a push to main that affects a package or the CLI, the `publish` job runs
  `release publish --publish --base <the plan's base>`: every version under `packages/` and the CLI not on npm yet, a
  dependency first, with provenance; a version already on npm is skipped and runs queue, so a re-run is safe. The `v*`
  tag path and `release publish --tag` (`RELEASE_TAG_UNKNOWN`, `RELEASE_ALREADY_PUBLISHED`) are gone. `--base` refuses
  `RELEASE_VERSION_NOT_BUMPED` for a package whose shipped files changed (specs and test folders aside) since the commit
  npm recorded for its published version, so a change never ships under an old number. The CLI is published last: its
  commit requires each sibling at a version npm serves (`RELEASE_DEPENDENCY_SKEW` otherwise), every CI job installs it with
  the commit's siblings packed over the registry copies (`.github/actions/cli-install`), and the publish job moves its
  requirements and lockfile to the siblings it just published. The workflow reads the `NPM_TOKEN` secret (CONTRIB-20).
  Bench: `release-publish-version-not-bumped`, `release-publish-plan-guard`.
- **Speed flow: per-task verify is cheap, the wave runs the heavy checks.** policy/quality.yaml `verify.tier` (default
  `wave`): `task verify` of a workflow task runs only its cheap checks (lands, secrets and loosening on its diff, paths,
  files, json, cited, cite) and no install, and records its typecheck, lint and test checks as due; `workflow step` (inline
  and orca, so `kernel next` too) runs one wave verify once the batch has landed and before any dependent starts or the
  workflow is done, its scope decision recorded first, the heavy checks once over the union of the landed tasks; a red wave
  returns the tasks whose files are red (`done → failed`). `workflow wave <id>` runs a due wave by hand. Bench:
  `wave-inline-lint-returns-owner`, `wave-orca-lint-returns-owner`.
- **Shared install cache.** A clean checkout and an Op worktree link their node_modules from `<state base>/cache/installs/<key>`
  (lockfile, Node and npm versions) instead of running `npm ci` (an Op worktree falls back to linking its target's install on a
  miss, and always in local package mode); workspace links are re-made per checkout, a clean checkout in local package mode
  gets a copy, and every link is unlinked before the checkout is removed. Bench: `verify-install-cache-reused`.
- **Host heavy-command governor.** Every tsc, eslint, test or suite command, build, npm install, setup and uat container
  the harness runs takes a slot of a machine-wide semaphore in machine.sqlite (`heavy` of ops/liveness.yaml: 2 slots, one
  under the low RAM floor, none under the critical floor or over the CPU ceiling), runs below normal priority under its
  kind's memory cap (`--max-old-space-size`, `--memory`, `--maxWorkers`), and waits, logged, never failing. A worker seat
  waits while free RAM is under the seat floor (`SEAT_RAM_LOW`). New: `host load`, and `check heavy-sites`, a CI gate
  red for a spawn site outside the governor. Bench: `heavy-third-command-waits`, `heavy-pressure-narrows-admission`,
  `seat-launch-waits-on-ram`.
- **A filed result is verified with no Kernel turn, and a hung verify is reclaimed.** `supervisor tick` and `supervisor
  next` run the settling half of a workflow step (`settleWorkflow`: recover, verify, close seats, wave) for every workflow
  the Supervisor coordinates; a reported task's worker seat is released and its tab closed. A verify holds its verifier lock
  at most `verifyDeadlineMinutes` (ops/liveness.yaml): it gives the lock up itself at the deadline, and a holder past it counts
  as gone, so `--recover` takes its task over. A tool run whose process exited ends within seconds even when a grandchild
  holds its output pipes. Bench: `verify-hung-holder-reclaimed`, `orca-tick-verifies-reported`.
- **Green rows are reused.** `check run` keys each typecheck and lint step by the digest of its inputs and reuses a green
  row of the project ledger instead of rerunning it, in a wave, Debug's scoped round and before a push. Bench:
  `check-run-green-row-reused`.
- **Host secrets come from the harness's secret.env.** One secret loader (`cli/src/harness/secret-env.ts`) reads a named key
  from the process environment, else from `secret.env` at the harness root, and only the keys policy/security.yaml
  `secretKeys` lists (`SECRET_KEY_UNLISTED` otherwise); no output carries a value. The Telegram verbs, the
  `telegram-bridge` service and `supervisor tick` read `TELEGRAM_BOT_TOKEN` through it, and `connect telegram status`
  reports its source. The committed `secret.env.example` names every key the host's secret.env holds and where to get it.
  Bench: `telegram-token-from-secret-env`, every run's `STARCI_SECRET_ENV` is its own file, and `expect.lacks`.
- **Local package sources.** `deps source --local [--from <folder>] [--package <name>]` builds each `@starci` package an
  app uses (default every one it pins or has installed, from this harness's `packages/`) and copies its publishable files
  over the app's installed copies, marked `.starci-local.json`; dependencies a local package adds are installed with
  `npm install --no-save`. package.json and package-lock.json never change. `deps source` prints each package's mode,
  `--sync` re-applies the recorded copies after an `npm ci`, `--npm` runs `npm ci`. `seat start` and clean verify apply
  the same copies to the worker's and the verify's checkout. Bench: `deps-local-verify-green`.
- **The dependency push gate.** `deps check` refuses `DEPS_PIN_UNPUBLISHED` (a committed `@starci` pin npm cannot
  install) and `DEPS_LOCAL_AHEAD` (a local copy no published version holds, compared file by file with the published
  tarball); `release push`, `release cut` and an executed `app release` run it, and the `@starci/hfs` app pre-push hook
  calls it. Bench: `deps-push-gate-pins`.
- **Package edit branches.** `pkg branch <topic>` cuts `pkg/<app>-<topic>` from harness main into a worktree under the
  harness's `.claude/worktrees/` and installs a pre-push guard; `pkg handoff [--urgent]` records the branch and head for
  Debug (`--list` is the queue); `release push`, `release publish` and the guard refuse a `pkg/` branch to every role but
  debug and owner (`PKG_EDIT_PUSH_REFUSED`). Bench: `pkg-edit-branch-handoff`.
- **The Supervisor delegates to workers.** `supervisor dispatch --brief <file|text> [--label] [--repo] [--allow] [--input]`
  hands one job to a `[Worker] <project>: <topic>` seat under the Supervisor: its own worktree on branch `starci/<worker>`, a
  task whose contract is the brief on the label's op, launched into the Supervisor's Run and routed by the worker tiers.
  `supervisor next` tends the workers and returns each one's report or end once as kind `worker`; `supervisor accept`
  settles one by `task verify`, `supervisor reject` cancels it, `supervisor workers` lists them. The Supervisor no longer
  pushes; Debug alone merges, pushes (`release push`, `release cut` now take role `debug`) and publishes. Bench:
  `supervisor-dispatch-worker-report`.
- **A project runs at most `projectMaxWorkers` worker seats** (ops/routing.yaml, 10): its Kernels' Ops and its Supervisor's
  workers together. A launch past it waits queued and starts once a seat is released, before any route is picked. Bench:
  `supervisor-worker-cap-queues`, `supervisor-worker-cap-counts-kernel-ops`.
- **A held decision no longer stops a workflow's dispatch.** `kernel next` steps the workflow before it returns an open
  decision, so a task returned and held never keeps the other ready tasks from launching; a ready task waiting on another
  task's lease names the path and its holder in `workflow status`. Bench: `workflow-blocked-keeps-dispatching`.
- **Coordinator slots are reserved.** A pool's `coordinatorReserve` (ops/routing.yaml; claude 4 of its 6) is held for
  Supervisors and Kernels: a worker pick counts it as taken, a coordinator pick takes a reserved slot whatever the workers
  hold, so a claude pool full of workers no longer pushes a Kernel relaunch onto codex. Bench:
  `coordinator-reserve-claude-full-of-workers`.
- **`supervisor next` always answers.** Its wait stops early by its longest sweep, so it returns inside the caller's shell
  timeout, and a failure no verb catches still prints its refusal (the json envelope under `--json`) with exit 1. Bench:
  `supervisor-next-always-answers`.

### Fixed

- **`check run` judges a package against its workspace dependencies built.** A package that imports a sibling exporting
  only its git-ignored build output (`exports` or `main` at `dist/`) failed its typecheck with TS2307 and its lint with
  cascaded `no-unsafe-*` errors on every clean checkout, so every `task verify` of such an app was red. Before typecheck
  and lint, `check run` now finds each target's workspace dependencies (npm, yarn or pnpm), transitively and in
  topological order, and for each whose manifest entries are missing restores its output from the build cache under its
  content key (`<state base>/cache/workspace-builds/<key>`) or runs its own `build` script and caches the output. A
  dependency that cannot be built is a red `dep-build` step with `CHECK_WORKSPACE_DEP_BUILD_FAILED` naming it, and the
  steps of the packages that need it are held. `check run` is now `local-write`. Bench: `check-run-workspace-dep-built`,
  `check-run-workspace-dep-build-failed`.
- **A task is judged only on its own work.** Another task's uncommitted files in a shared workflow worktree failed a
  task's `paths-only` and reached the lint of its `check-run-green`. When a task's work begins (its seat starts, or the
  inline step hands it out) `beginWork` records the tree of its checkout as its baseline; a dirty file unchanged since
  then is not the task's: its candidate, its stray files, `check run --task` (which `task verify` and the dry replay
  pass) and its preserve and reset leave it be, and it never widens the scope. Bench: `verify-sibling-dirt-not-judged`.
- **A staged module's composition rules wait for its composer.** A module written before the task that wires it in was
  red on `dead-exports` and `feature-not-composed`. A task's contract (or workflow task) may name its composer in
  `composedBy`; its check defers the findings of policy/quality.yaml `runtime.compositionRules` on its own allowPaths to
  that task (`deferred-to:<key>` on the lint step), the composer's check judges the module in full, and the workflow is
  done only after a green final verify (`check run --workflow`) of every deferred module; a red one blocks it. A task
  that names no composer stays red as before. The Kernel brief declares `composedBy` when it splits a module from its
  composition. Bench: `verify-composition-deferred-to-composer`.
- **Prior work is stored when the temp folder and the state base sit on two drives.** The patch was written in the temp
  folder and renamed into the store, which Windows refuses across drives (`EXDEV`, `prior-store-failed`); it is now
  written inside the store.
- **A red check's output is kept and shown.** Every check of a verify keeps the last 200 lines of its tools' output as
  its detail, with every value the secret scan recognises redacted (`redactSecrets`), and `task status <task>` prints the
  detail of the red checks of the newest verify (`checkRuns[].detail` in `--json`). Bench:
  `verify-check-run-output-in-task-status`.

## [1.1.0-alpha.5] - 2026-10-28

- **A returned task no longer holds its lease past its due time.** A task that came back to the Kernel (blocked, mismatch,
  awaiting the owner) has no worker left to write, so once its lease is due `workflow step`, `supervisor tick` and every
  lease request drop it and record `leases-expired`; a task that may still write keeps its lease however overdue. Bench:
  `lease-returned-overdue-released`, `lease-live-overdue-kept`.
- **The owner's Telegram channel.** `connect telegram discover-chat|status|notify` stores the owner's chat (after he
  messages the bot) in machine.sqlite, reports the channel and sends the notices due; `supervisor telegram-bridge
  run|status` is the host service (ops/host.yaml `telegram-bridge`, schedule `StarCi Telegram Bridge`) that sends each
  `owner` escalation, owner request taken up and workflow ended once, within ops/telegram.yaml's budget, and
  records the owner's reply to a notice, `/answer <decision-id>` or `/ask <project>` as an owner request that wakes the
  Supervisor, ignoring and logging every other chat. The bot token is `TELEGRAM_BOT_TOKEN` in the user environment
  (`TELEGRAM_NOT_CONFIGURED` otherwise). Bench: a Telegram Bot API stand-in (`serve: {stub: telegram}`) and four scenarios.

### Changed

- **Coordinators stay on Claude through a stall.** A Supervisor or Kernel the stall ladder gives up on for a plain stall is
  relaunched on the coordinator tier's first member again; a provider failure kind, or the member's
  `stall.coordinatorStallMax` plain stalls of the same seat within `stall.coordinatorStallWindowMinutes`, puts it behind,
  and the repeated stalls raise a `harness` escalation (`coordinatorRelaunch` in `harness/stall.ts`).
- **The coordinator loop holds in Claude Code.** The briefs and loop prompts run `next --wait <coordinators.nextWaitSeconds>`
  in the foreground and call it again in the same turn after every result; `nextWaitSeconds` is 540, under Claude Code's
  600 s foreground limit, and a blocking `supervisor next` renews its lease again before each wait.
- **`harness` escalations are Debug's.** The Supervisor never asks the owner about one and relays Debug's answer from
  `supervisor ask`; `supervisor next` hands an `owner` or `harness` escalation over once (`decision-relayed`), so a looping
  Supervisor waits in `next` instead of receiving it again, and neither kind makes it stalled. Bench:
  `supervisor-awaits-owner-not-stalled`, `supervisor-stall-relaunch-on-claude`.

Runs `@starci/hfs` 4.9.5 (an exact dependency).

### Changed

- **Release G.** @starci/hfs 4.9.5 bundles the canon pins of release G (Grammar family 0.15.4, which ships the fill
  Button floor, `Page`, `MermaidDiagram` and FlowGraph shapes and edge labels, with the lints `page-tabs-in-header` and
  `route-page-is-one-page`; hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4) and the rules R324 and R325, so `starci app`
  judges and scaffolds an app at those versions. `cli/package-lock.json` is refreshed once @starci/hfs 4.9.5 is on npm
  (CONTRIB-20: the packages publish first, the CLI on a second tag).

## [1.1.0-alpha.4] - 2026-10-28

Runs `@starci/hfs` 4.9.4 (an exact dependency).

### Added

- **`supervisor ask "<request>"`.** The owner (or Debug relaying the owner's words) hands a request to a project's
  Supervisor without typing in its terminal: it is recorded in the project's mailbox (machine.sqlite `owner_requests`:
  who, text, at) and the Supervisor's Run is mailed awake as a Kernel escalation does. `supervisor next` returns it as
  kind `owner-request` (after the decisions the Supervisor rules, before those awaiting the owner), the stall ladder
  counts it as the Supervisor's work, the host driver keeps a Supervisor for a project holding one, and the Supervisor
  command whose `answers` name it closes it with its cmdId (`OWNER_REQUEST_UNKNOWN`, `STALE` otherwise). Bench:
  `supervisor-owner-request-to-workflow`, `supervisor-ask-roles`.

- **`release affected --base <sha>`.** The CI plan of a diff: the packages it affects, each with its build order (the
  siblings it requires, its `file:` dependencies and the siblings its files read by relative path, deps first), and
  whether the harness job (the CLI and the trees it reads) and the app job run; a change under `.github/` or no base is
  every node. CI's `plan` job fans those packages out to one job each beside the light gates, the harness, app and Sonar
  jobs, behind one required `ci` job, and a `v*` tag on a commit whose run on main succeeded reuses that run. Bench:
  `release-affected-ci-plan`.

### Changed

- **Release F.** @starci/hfs 4.9.4 bundles the canon pins of release F (Grammar family 0.15.3, which ships
  `PageHeader` and the lint `no-hand-rolled-page-header`; hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3) and the rule
  R323, so `starci app` judges and scaffolds an app at those versions. `cli/package-lock.json` is refreshed once
  @starci/hfs 4.9.4 is on npm (CONTRIB-20: the packages publish first, the CLI on a second tag).

### Fixed

- **`route explain --label kernel|supervisor`** explains a coordinator seat's pick through `pickCoordinator` (tier from
  `coordinators`, then the same filters, circuit, quota, qualification, scoring and balance as a worker) instead of
  refusing `LABEL_UNKNOWN`; `--coordinator` is gone, the label names the seat. Bench: `route-explain-coordinator-circuit`.
- **A launch that fails at agent readiness says why.** The agent terminal Orca's failed receipt names (its effects and
  residualResources, so the tab is also closed now) is read once before the worker is released, and its last non-empty
  lines are the seat's failure facts (`seats.failure_json`, ledger version 9, shown by `seat list`) and part of the
  launch error. A screen at one of routing.yaml `blockedPrompts` (Claude Code's trust or external-import dialog, a login,
  a "Do you want to" confirmation) is a `blocked-prompt`: no provider strike, no member outcome, a free attempt with that
  pool put behind, and a `harness` escalation for the Supervisor naming the prompt and the worktree, which `supervisor
  tick` names on every pass. Every launch-failed seat, dead-on-arrival ones included, records its failure. Bench:
  `seat-launch-blocked-prompt`, `seat-launch-readiness-timeout-strikes`.

## [1.1.0-alpha.3] - 2026-10-28

Runs `@starci/hfs` 4.9.3 (an exact dependency).

### Changed

- **An app's `starci-harness` is the CLI that judges it.** `starci app` passes @starci/hfs the CLI's own version
  (`harness`), which is the `starci-harness` an app is checked (HFS_CANON_PIN_DRIFT, HFS_CI_MISSING_CANON) and
  scaffolded at; @starci/hfs 4.9.3 and the canon packages bundle no pin of the CLI, so a CLI release no longer needs a
  new @starci/hfs naming it.

- **`release publish` judges its plan.** A package due for publication that requires a sibling (`dependencies`,
  `peerDependencies`) at another version than the sibling's folder holds is refused `RELEASE_DEPENDENCY_SKEW`, one
  requiring a private sibling `RELEASE_DEPENDENCY_UNPUBLISHED`; `--tag <tag>` refuses a tag naming no package version
  (`RELEASE_TAG_UNKNOWN`) or only versions already on npm (`RELEASE_ALREADY_PUBLISHED`), and `--publish` publishes a
  dependency before its dependent. CI's publish job runs the plan with the tag before anything reaches npm and publishes
  the packages before the CLI. Bench: `release-publish-plan-guard`.

## [1.1.0-alpha.2] - 2026-10-28

Version 1.1.0-alpha.1 was published from an earlier commit of this list, on `@starci/hfs` 4.9.0; 1.1.0-alpha.2 carries
the whole list.

### Added

- **The app commands.** The CLI carries `starci app scaffold|sync|check|lint|add|new|emit|explain|hygiene|coverage|codemod|ci|db|secret|stack|release|upgrade`,
  each a verb with its typed flags, effect and roles that runs `@starci/hfs` (4.9.2, an exact dependency) in-process in
  the app: in human mode its output streams as it prints, under `--json` the envelope carries its report and exit code. A
  product pins `starci-harness` as its devDependency, its husky hooks and CI run `npx starci app ...`, and its codegen loads
  `starci-harness/input-bounds`; `@starci/cli` is retired. A verb flag may now be a `list`, given once per value.

- **`config list|get|set`.** One door to the harness settings, each kept in the ops/ yaml that owns it: `list` prints
  every setting as a dotted key (`routing.tiers.high[0].effort`) with its value and file, `get` one, and `set` writes a
  value with the file's comments and layout kept, after the file's own loaders accept the whole new file
  (`CONFIG_INVALID` and `CONFIG_KEY_UNKNOWN` leave it untouched). The Claude members of `ops/routing.yaml` name the effort
  of their tier, as Codex's do.

- **Lanes and repair routes.** `ops/lanes.yaml` is the standard build flow each Work record walks; `workflow define`,
  `amend` and every replan refuse `FLOW_INCOMPLETE` while a covered record's step is neither satisfied by evidence nor
  carried by a task of its label in order (a front-end code step held until its feature's drawings and back-end code), and
  `TASK_NOT_SPLIT` while one task of a `perRecord` label works several records; `kernel next` digests each record's lane.
  An orca workflow runs at most `workflowParallel` Ops at once (`ops/routing.yaml`); ready tasks past it wait. `ops/routes.yaml` bounds repairs:
  a red or question decision carries its legal route, `kernel submit` refuses `ROUTE_ILLEGAL` off it, and past its limit
  the Kernel escalates to the owner. The `ui` label becomes `draw`; `audit` and `review` are new, and the router never
  gives a `review` to the provider that authored the work it reads (`independentOf`). A workflow file may name
  `requires: [security, perf]`.

- **Host driver and stall ladder.** `supervisor tick` (one idempotent pass for a scheduled task) and `supervisor watch`
  (its loop) keep the seat tree alive with no LLM awake: ensure the Supervisor, sweep its Kernels and their Ops, and for an
  agent idle at its prompt with work pending (Orca's tui-idle, output and heartbeat signals) nudge it with its loop prompt,
  then relaunch (or fence) it on another member with a `stalled` outcome and a provider circuit strike of the kind Orca's
  failure words name (`capacity`, ..., else the new `stall`), then escalate through the relaunch limit.

### Changed

- **One Supervisor per project.** A project is the repository owning the Work plus the side repositories whose `hfs.json`
  names it; each has its own `[Supervisor] <project>` launched in its main checkout (`project_supervisors`, machine
  version 3), and every `supervisor` verb takes the project from the working directory or `--project`. `workflow start`
  and `kernel start` require the Supervisor of the workflow's project, a Supervisor sweeps only its project, and
  `supervisor tick` keeps and sweeps every project's Supervisor; a workflow under the version-2 host Supervisor is
  adopted by its project's Supervisor on the first tick.
- **Exceptions pin their lines.** An exception of `policy/loosening.yaml` or `policy/security.yaml` names its `kind`
  (`fixture`, `template`, `detector`, or `ruling` with the id of a live ruling of contexts/decisions/rulings.yaml in
  `decision`, else `EXCEPTION_RULING_UNKNOWN`) and the exact text of each line it covers (`match`); it covers only those lines,
  so a new occurrence in the same file is a finding. An exception on a file its kind does not qualify is refused
  `EXCEPTION_KIND_REFUSED`, a `match` that covers no finding turns the check red `EXCEPTION_STALE`, and `check loosening`
  and `check secrets` list every exception applied. `release push` honours the same exceptions.

### Fixed

- A completed launch request whose agent never started its turn is judged by its dispatch (adopted, or fenced and requeued
  with no try spent), never replayed forever.
- **The Sonar block carries the ruled cpd exclusion.** `app sonar` derives the `starci:sonar-scope` block with
  `sonar.cpd.exclusions` beside `sonar.coverage.exclusions`, its entries the `cpd-exclusions` allowances of the design
  truths of the `@starci/hfs` the CLI runs, the line the app template renders
  inside the same block; `check loosening` accepts it there and still refuses a cpd exclusion written outside the block or
  edited inside it (bench `security-loosening-sonar-block`).

## [1.0.0-alpha.1] - 2026-10-27

The first published version.

### Added

- **npm package.** The CLI publishes as `starci-harness` with the bins `starci` and `starci-harness`, so
  `npx starci-harness explain` runs it without a checkout; the package carries `ops/`, `policy/`, `contexts/`, the
  starci skill and the built search index. CI publishes it with npm provenance on a `v*` tag, under the dist-tag its
  prerelease names (`alpha`).
- **Seat tree in Orca.** One `[Supervisor]` per host, one `[Kernel] <workflow>` per running orca workflow and one
  `[Op] <task>` per attempt, each a real Orca agent; `supervisor` and `kernel` verbs with episodic `next` and `submit`
  drivers, coordinator commands admitted idempotently by `cmdId`, and one git worktree per workflow.
- **Contracts with base and extend.** One op file per label (`ops/ops/<label>.md`) owns the base of a task's context,
  input, output and checks; the Kernel's contract only extends it, and `contract check` judges fitness before
  `task send` leases its `allowPaths`.
- **Clean verify.** `task verify` stops the worker, builds a candidate from a clean checkout of HEAD plus the task's
  paths, replays every check there and commits only on green; red preserves and resets. Settles of one project run one
  at a time, task status moves by compare-and-swap, and `--recover` reconciles a crashed settle from git.
- **Replan.** Goal versions, `workflow amend` from a desired graph or a change file, per-key classification (keep,
  continue, stale, rework, redo-live, redo, add, drop) with generated reverts, early cutoff on a dependency's settled
  result, and `plan diff` to preview it.
- **Prior work.** Every attempt's patch is stored content-addressed and offered to the next attempt in its brief.
- **Trust tiers and receipted UAT.** Checks carry a trust tier by kind (harness-observed, receipted run, worker
  claim) and only the first two count as behavioural; `uat run` writes a harness receipt that `uat-flow` checks
  require.
- **Stress bench.** `bench run` and `bench list` run the stress scenarios of `bench/` in scratch repositories against an
  Orca stand-in and record a scoreboard.
- **Contexts search.** `contexts search` ranks contexts, op files, policy and harness documents by BM25 fused with a
  local embedding model when it is built, and falls back to BM25 alone; `--check` fails on a stale index and `--eval`
  measures recall.
- Gates: `check run`, `check loosening`, `check secrets`, `check lint`, `check typecheck`, `contexts anatomy --check`,
  and the release verbs `release push`, `release cut`, `release publish` and `release ci-status`.

[Unreleased]: https://github.com/starci183/starci-harness/compare/v1.1.0-alpha.2...HEAD
[1.1.0-alpha.2]: https://github.com/starci183/starci-harness/compare/v1.0.0-alpha.1...v1.1.0-alpha.2
[1.0.0-alpha.1]: https://github.com/starci183/starci-harness/releases/tag/v1.0.0-alpha.1
