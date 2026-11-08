# The committed result cache of an app

Every StarCi app commits the results of its checks in `.starcistacks/cache/`, keyed by content, so `starci app check`
and the unit specs judge only what differs from the cache, on a developer host and in CI alike. `HFS_CHECK_CACHE_FORGED`
is an error finding; `HFS_CHECK_CACHE_STALE` and `HFS_CHECK_CACHE_MISSING` only warn in CI. Every push carries
the records of a real run, the release gate trusts them, and a nightly run proves the trust. The code is
`packages/hfs/cache/`; the slot is `app.starcistacks.cache`. Its one rule is that a reused result is always the one a full
run would produce now; whenever the cache cannot prove that, the step runs in full.

## The operating procedure

For a lane, a lead, an app session and CI alike:

1. Run `starci app check` in a fix loop and before a commit: `--env local`, the default, is the run of a developer machine. The
   run itself decides what to judge:
   - It reuses every valid cache record.
   - It reruns only what a change invalidated: a code change, or a moved pin such as hfs or a lint package. Run `npm ci` first,
     so the install matches the pins.
   - It runs everything when there is no cache, the same run GitHub CI does.

   The two environments judge the same code: hfs, format, db, wiring, lint, types, tests, coverage, build and audit are identical and
   blocking in both, and a lint, type or test error is red in both. They differ only in the findings about whether the run is fit to
   commit, push or release, which a developer iterating on locally built harness packages (`starci deps install-local`) cannot satisfy
   until `starci deps install-local --restore`. Those are the codes marked `localOnly: true` in `modules/kernel/failure-codes.yaml`, the one
   list (`packages/hfs/runtime/scripts/hfs/check-env.mts`), and only the instance a local-registry build alone causes:
   `HFS_CANON_PIN_DRIFT` of a pin whose version the lockfile resolved from the local registry, and `HFS_CHECK_CACHE_UNPORTABLE` of a local-registry install whose
   package carries no source digest ([The fingerprint](#the-fingerprint)). `--env local` lists them marked `LOCAL, REPORT ONLY`, never red, writes no
   cache for an unportable install, and ends `gate: green for local (not pushable)` when only they remain. `--env prod` blocks them like every
   other finding: the cache is portable and warm and every pin is served by npm.
2. Commit the cache as the run left it, with the code it judged. Never edit a record by hand (`HFS_CHECK_CACHE_FORGED`).
3. The managed pre-push hook, the managed CI (`ci.yml`, `cache-verify.yml`) and `starci app release gate` run `--env prod`. Push, and let
   CI judge. When CI fails, pull the failure and fix it. Don't repeat local full runs before a push.
4. A bug in `app check` itself (a false finding, wrong env, a path the gate breaks) is fixed in the harness, never worked
   around in the app.
5. `starci app check --fresh` is the escape hatch for a broken or suspect cache. It ignores the cache, judges everything
   again and rewrites the records. It is not for routine use.

Release with `starci app release gate`: the `app-check` row is `app check --env prod`, diff-only against the warm cache (`--full` runs it as `app check --env prod --fresh`), and a red
nightly run refuses the gate (`HFS_CHECK_CACHE_VERIFY_LOCKED`) until a green `cache-verify.yml` run. The gate judges the work once, in that row:

- **Reused rows.** A row `app check` already judges runs no command when the `app-check` row of the same run is green: `audit`, `format-check`, `typecheck`, `build-be`, `build-fe`, `lint`,
  `db-lint`, `test` (the unit specs, their merged coverage and its per-file threshold) and `db-drift`. The row carries that verdict for the same sha: its report line is
  `REUSED <row> (reused from app-check ...)`, and its L4 record entry holds `reused: true` and `reusedFrom` (the gate, the head, the `app-check` command, its log and the log's sha256). A row is reused
  only under its default command (`npm run <script>`, `npm audit`, `npx starci app db drift`); a row an app declares under the same name with another command runs. The drift row is also
  judged by `app check` only on a host with a database, so when the `app-check` log carries `CI_PARITY_DB_SKIPPED` it runs. A red `app-check` row stops the gate before any other row; `--full` changes only how that row runs.
- **Real rows.** What `app check` does not judge stays a row: the world layers (`test-integration`, `test-e2e`, `test-contract`), every row an app declares of its own, and Sonar on the main project key
  (`app check` scans the derived `<projectKey>-local`; [Sonar and Codecov](#sonar-and-codecov)), then the L4 record and the annotated tag.
- **Governed rows.** A real row that runs a heavy command (an npm script, a test runner, the Sonar scanner) is admitted by the heavy-command governor, never started as a raw child: a slot of the host-wide
  semaphore, the heap cap of its kind in `NODE_OPTIONS`, and for a test row the workers and worker heap its room holds (`--maxWorkers`, `--workerIdleMemoryLimit`, [The memory plan](#the-memory-plan)).
  `starci` verbs (the `app-check` and drift rows govern their own steps) and `npm audit` are no heavy children and run plain. The printed plan states, for each row, whether it reuses the `app-check` verdict or runs, and how.

## The command surface

`starci app check` with no selector, `--side`, `--fix` or `--coverage-from` is a whole run: every family against the committed cache (diff-only), the CI-parity families
([CI parity](#ci-parity)), CI's coverage step, the Sonar scan against the app's server ([Sonar and Codecov](#sonar-and-codecov)), and the cache verdict, which is a hard error. It writes what it judged back
into the cache. A branch profile ([lint.md](lint.md) PROJECT-LINT-2) changes no cache rule: a family it reports runs and writes
its records exactly as a blocking one, and a family it turns off runs nothing and writes nothing.

`--fresh` is the escape hatch for a broken or suspect cache: the selected families (every family when none is selected)
ignore their records, are recomputed from scratch, and their records are rewritten through the same writer; the cache verdict
then says whether the committed records changed. There is no other cache mode and no environment variable.

`--env local|prod` (default `local`) says what the run is judged fit for ([The operating procedure](#the-operating-procedure)): it softens no code check and
changes no cache rule; it only decides whether the findings a local-registry loop alone causes are listed as report-only or block.

`--gate <name>` (repeatable) is a job selector for the parallel jobs of the managed CI, where each job judges one family, and for
the one-family loop a hook runs; a run with a selector judges those gates alone, with no parity families and no cache verdict.
Agents run `app check` with no selector; the hook and CI pass `--env prod`.

```text
starci app check
starci app check --env prod
starci app check --fresh
starci app check --gate hfs
starci app check --gate sonar --gate codecov
```

| selector | family (the measured steps) | records |
|---|---|---|
| `--gate hfs` | the structure: slots, tree, pins, managed files against their templates, the content rules of the app pass, the architecture machine's check surface, the contract emit | `check/hfs/` |
| `--gate format` | Prettier over every tracked file (`HFS_FORMAT`) | `check/format/` |
| `--gate db` | the database rules of `db/` (the `db:lint` script runs `app check --gate db`) | `check/db/` |
| `--gate secrets` | plaintext secrets, sealed custody, untracked secret files | `check/secrets/` |
| `--gate wiring` | the boot proof of every app (a lite back end's composition with doubles) | `check/wiring/` |
| `--gate types` | each workspace's `tsc --noEmit` through the app's TypeScript: the back end, each front-end workspace and each root workspace package (`packages/<pkg>/tsconfig.json`, as CI's `npm run typecheck` runs it) | `check/types/` |
| `--gate lint` | ESLint per side and stylelint | `lint/` |
| `--gate test` | the unit specs, their coverage merged into one report and its per-file threshold | `test-coverage/` |
| `--gate sonar`, `--gate codecov` | the combined Sonar and Codecov predictions from the merged coverage, the lint findings and the clones; either selector invokes this family, both together invoke it once. The server scan belongs to the whole run alone | `sonar-baseline/`, `codecov-baseline/` |
| `--gate build` | the CI-parity build steps ([CI parity](#ci-parity)): typecheck, `build be`, each `build fe`, the database migration checks | `check/build/` |
| `--gate audit` | the CI-parity dependency audit ([CI parity](#ci-parity)) | none |

The twelve public gate names dispatch to eleven families (`sonar` and `codecov` share one). Selecting `codecov` exposes the combined
prediction family through the CLI; it adds no server adapter, new pass condition or separate cache algorithm.

Every family reports its diagnosis on its own line, `<family>: <full|diff> (<reason>), checked <n>, reused <n>;
findings <new> new, <known> known, <fixed> fixed`, where known findings are those its records already held, so a run
always says what is wrong and whether it is new. A rule that always runs (the managed files, the tree and
untracked entries, the rules that stat or walk the work tree) still records its findings for that comparison; it never skips work on them. `--json` carries the same per family.

`--coverage-from <lcov>` judges a report produced elsewhere (the merge of a sharded unit run in CI) and records nothing.
`--staged` is the pre-commit guard alone, outside the cache. `--json` prints the one envelope.

`app check` is the one verb for app quality; there is no `lint` verb. Three flags carry the lint work. `--side be|fe|packages` limits the lint gate to one side, which reads and writes that side's records, or to the
root packages, which have none (the CI lint matrix runs one scope per job: `app check --gate lint --side <side> --out
reports/lint.<side>.sonar.json`, with `packages` in an app that has root packages). `--out <file>`
writes the merged Sonar Generic Issue Import document of every finding the run produced (the repository findings of the
gates it selected as `starci-hfs`, then ESLint and stylelint), and `--fix` runs ESLint and stylelint with `--fix` before
the check, which then judges the rewritten files like any change; `--fix` is refused unless `--gate lint` is selected.
There is no `--changed` and no `--workspace`: the cache makes a whole-app check of an unchanged tree take seconds, and
the fe workspaces carry no `lint` script, the root `lint` script being `app check --gate lint`.

## Progress and the run log

A run reports as it goes, on stderr, so stdout keeps the diagnosis (and under `--json` the one final envelope). Each step
prints a line when it starts and when it ends, and a running step prints one every 10 seconds of work or 10 percent of
its files: `[12:04:31 +3m07s 41%] lint fe 312/1840 (17%) reused 1528 checked 312`, the clock and elapsed time, the
overall percentage across the selected families (weighted by each step's file count, a whole-program step counting as
the files of its side), the family and its step, its files done of its total and its cache hits against the files it judged.
Every line names its family, and so does every line the governor
prints for a child (its label is `app check <family> ...`); the steps run one after another ([Orchestration](#orchestration)). On a terminal the running line updates in place while one step is
open; with several open, and anywhere else (CI, a run redirected to a file), only whole lines are written, never a carriage
return or spinner. `--quiet` suppresses progress and keeps the diagnosis. A family that resumes from what an
interrupted run journaled ([The journal](#the-journal)) says so in its reason, and counts the results it took from the journal among the ones it judged.

The report ends its overview with the steps table: per step, its wall time, the RAM peak its heavy children measured together (each child's process tree
reports its own peak resident set, `cli/src/harness/peak-rss.ts`, summed over the children that ran at once; a test run is its parent and its workers at the
largest worker's peak), its parallelism (a test run's workers, else the children it ran at once, or `in-process`), its family's reused and checked counts, and where
its results live; a step that failed says so, and `--json` carries the same rows as `steps`. Each run also writes its timings, per family and step (duration,
files, reused, checked, full or diff and why), to
`last-run.json` and appends them to `runs.jsonl` (the last 100 runs) in the untracked tool cache of slot
`app.tool-cache`, `${STARCI_CACHE_HOME:-%LOCALAPPDATA%/StarCi/cache}/<repo>/app-check/`, where `<repo>` is the app
folder's name and the first 12 hex digits of the sha256 of its real path. Timings change every run, so they are host
state and stay out of git; `.starcistacks/cache/` holds results only. The journal of a run in progress lives beside them, in
`journal/` of the same folder.

## When a run is full

| situation | run |
|---|---|
| no cache in the tree (a new app, first adoption) | full, and it writes the cache |
| a fingerprint part a family reads differs from the cache's | full for the families that read it, and it rewrites their records |
| `--fresh` (the escape hatch for a broken or suspect cache; `starci app release gate --full` runs its `app-check` row as `--fresh`, and the rows it covers still reuse that verdict) | full for the selected families, ignoring their records; it writes the refreshed records |
| anything else, on a host or in CI, `starci app release gate` and the CI run a release waits for included | diff-only against the trusted cache (below) |

### The nightly verify

The managed `.github/workflows/cache-verify.yml` (slot `app.ci-cache-verify`) runs `starci app check --env prod --fresh` on the default
branch every night and on dispatch: every family is recomputed from scratch, and the run fails (`HFS_CHECK_CACHE_UNWARMED`)
when the committed records are not the ones it produced, so a cache that lies is found there. Its newest finished run is the
lock of the release gate (`packages/hfs/release/cache-verify-lock.mts`): green, or none yet, leaves the gate open; red or
unreadable refuses it with `HFS_CHECK_CACHE_VERIFY_LOCKED`, naming the run, until a green run clears it. A forged record
stays an error finding. Times are printed, never stored.

## Layout and format

`.starcistacks/cache/` is one folder, committed with the code:

| folder | holds |
|---|---|
| `fingerprint.jsonl` | one line per fingerprint part: name and sha256 |
| `check/` | the per-file results of `app check` (formatter) and the input-set results of its scoped steps; `check/build/` the verdicts of the CI-parity build steps |
| `lint/<side>/` | per source file: content hash, resolved local imports with the type surface digest, ESLint results; the project-graph findings per file; stylelint results |
| `test-coverage/` | per unit spec: its closure key with the packages and files its run loaded, and the lines, branches and functions it covers in each source; per source: what is instrumented |
| `sonar-baseline/` | reference data only: the new-code base commit, the quality gate's conditions as read from their owner with that owner's digest, the analysis scope settings' digest |
| `codecov-baseline/` | reference data only: the base commit, the patch and project targets of `codecov.yml` with its digest |

Every data file is JSON Lines: one self-contained record per line, sorted by its key (path, then step), keys sorted
inside each record, LF endings, a final newline, no timestamps, durations, logs, absolute paths or host names. Two runs
over the same tree write identical bytes. Records are split into one file per area, a side's first two folders
(`lint/be/modules/billing.jsonl`, `check/fe/apps/web.jsonl`; files of the app root in `root.jsonl`), so a change
rewrites the files of the areas it touched. An area whose file would pass 32 MB is split one folder deeper, and a single folder
that still does into hash buckets (`test-coverage/be/src/~3.jsonl`), so no file nears what a git host takes; a reader reads every
`.jsonl` of a folder, and the pre-push gate refuses a cache file over `STARCI_CACHE_FILE_MAX_MB` (90) as
`HFS_CHECK_CACHE_FILE_TOO_LARGE` before anything uploads. Results are sparse: a clean file is a record with its hash and no finding.
Findings are sorted (line, column, rule, message) and their messages carry app-relative posix paths only.

The managed `.gitattributes` marks the folder `text eol=lf merge=union linguist-generated=true`. Because every record
is self-contained and keyed, a union merge of two branches never conflicts and never yields a wrong answer: the reader
takes, per key, the record whose hash matches the tree, drops the rest, and the next write leaves one record per key. A
union-merged `fingerprint.jsonl` holding two digests for one part is a mismatch, so the next run is full.

Hashes are sha256 of the bytes with CRLF normalised to LF for text files (no NUL in the first 8000 bytes, git's own
test), so a Windows checkout and a Linux CI runner hash one commit alike. The cache folder itself is outside the
content index and outside every step's file set.

## The journal

A run writes the cache folder when it ends, but it keeps what it has judged as it goes, so a run killed or crashed at any moment loses only what it had
not judged yet and the next plain run reuses the rest. The journal is host state in the untracked tool cache of slot `app.tool-cache`
(`<tool cache>/journal/<cache folder>/`, beside the run log), never committed. The code is `packages/hfs/cache/journal.mts` and `session.mts`.

- **What is journaled, and when.** A family's whole record set the moment the family finishes, written as one file by a temp file and a rename. Inside a family: the
  types family each program as its `tsc` ends; the test family each spec's coverage as the reporter writes it (every 10 seconds); the lint family each file's ESLint
  result, which each ESLint child itself appends in batches of 250 files to a journal file the family opens for that child alone. A kill therefore loses the batch in
  progress of each child, and lint at file 6000 of 9549 keeps those 6000 results.
- **Format.** One file per run, kind, content key and writer (the parallel ESLint chunks of a side each write their own part), so parallel runs and parallel
  writers never share a file and nothing is written into another writer's line.
  A header line carries the digest of the fingerprint parts the family reads (`fp`) and the family's content key (`ctx`); the lines after it are cache record
  lines or ESLint results. Each append reaches the file before the next batch starts; a line a kill cut short does not parse and is dropped, and the lines before it stand.
- **Reading.** The next run serves a journaled record like a committed one, and a record is reused only when its hash still matches the tree. A file is read only
  when its `fp` is the digest of today's parts. A lint result is also read only under today's `ctx`: the digest of the side key, every cross-file input, the
  installed packages, the base and the paths of the side, so it is equal exactly when the tree is the one the result was judged on. A family the fingerprint would run
  in full (no cache in the tree, a part it reads differs) runs against the journal instead when an earlier run journaled it under today's parts: those entries are what a
  full run computes now, so they are served and the committed records, computed under other parts, are not. `--fresh` ignores the journal and writes its own.
- **Compaction.** When the run ends, `flush` writes the committed files of each folder the run replaced (a temp file and a rename per file, so a kill leaves the old
  file, and the next flush removes a temp file it finds) and removes that folder's journal. What a folder the run did not finish keeps stays for the next run, and
  entries written under other parts are removed. What the flush wrote and removed is still what the cache verdict judges.
- **A crash in the report.** A run that throws after its families finished writes no committed cache and no run record: both describe a run that completed, and a cache flushed from a crashed report would be a verdict nobody judged. What the families judged stays in the journal, so the next plain run serves it and loses no work. A finding code with no failure-code catalog entry is an internal error naming the code (`withWhy`), never a TypeError.
- **Trust.** CI writes no journal and reads none: only the cache at the trusted base is trusted there. A run on a host trusts its journal as it trusts its working
  tree, and a record that reaches the committed cache through it is compared by CI like any other (`HFS_CHECK_CACHE_FORGED`). Proved by `cache-journal.spec.mts`.

## The fingerprint

A part is anything a step reads that is not an app source and that no record keys itself, and each part names the families that read it
(`familiesOfPart`, `packages/hfs/cache/fingerprint.mts`): a part that differs makes only those families full, the diagnosis
line names the family and the part, and the folders of the other families keep their records. A package a result loaded is no part: the
record carries it in its own key ([Which step reuses what](#which-step-reuses-what)). Invalidation is therefore rare and per family: a bump of
`@starci/hfs` re-runs the hfs-run families (hfs, secrets, wiring, db) and nothing else, a bump of the CLI re-runs nothing, a bump of a lint package
re-runs lint (and sonar), a bump of Prettier re-runs format, a bump of Jest, its transform or TypeScript re-runs the unit specs, and a bump of a
library such as `@starci/auth` re-runs only the results that loaded it. Parts are portable (equal on every host for one commit):

| part | families |
|---|---|
| the cache format version | every family |
| `hfs`: the `@starci/hfs` that runs (rules, slot manifest, failure codes, pins); `pkg:@starci/hfs`, the installed one | hfs, secrets, wiring, db |
| an installed `@starci/*` package by its source digest (else by version and recorded integrity, below): the canon and Grammar ESLint packages and `stylelint-canon`; `prettier-config`; `tsconfig`; `jest-preset` and `test-world` | lint and sonar; format; types, lint, test and sonar; test and sonar (any other `@starci` package is a library, no part) |
| `lock:<family>`: the resolved installs of that family's toolchain in `package-lock.json` (ESLint, typescript-eslint, TypeScript, stylelint and their plugins for lint; Prettier for format; Jest, its runtime and reporters, ts-jest or another transform and TypeScript for test) | that family, and sonar for lint and test |
| `node`: the Node major the unit specs run on | test, sonar |
| `hfs.json` | hfs, secrets, wiring, db (the edition and sides their rules, the secret custody and the boot proof judge by), lint, sonar |
| each `package.json` by shape (dependency versions blanked) | hfs, lint, types, test, format, sonar |
| `tsconfig*.json`; `eslint.config.mjs`, `stylelint.config.mjs`; the jest configuration | types, lint, test, sonar; lint, sonar; test, sonar |
| the Prettier configuration files, `.prettierignore`, `.editorconfig` | format |
| `sonar-project.properties`, `codecov.yml` | sonar |

A library's type surface reaches ESLint through the import graph, not the fingerprint: the graph records the installed
packages each file imports and the side keeps their install digests, so a bump dirties the files that import the package and
their dependents (ESLint, below). The types, test and wiring records and the build verdicts carry the installs they read, so a bump of a package
re-runs the programs, specs, proofs and builds that read it and keeps every other record. The root files the always-run rules read (`.gitignore`,
`.gitattributes`, `turbo.json`) are no part: those rules run every run, and a cached step that reads one keys it by its hash. The quality profile of
the policy is not a part (the verdict only counts error findings).

A harness or tool package is keyed by its source, never by the version string or integrity of one build. When a `@starci` package or
`starci-harness` is packed (`release publish` in CI and `deps publish-local` alike, `packStamped`), its manifest gets `starciSource`: the sha256 of the
tracked files of its folder, by path and content, with a changed work-tree file named by its bytes so a dirty build never claims a commit's digest
(`packages/hfs/cache/fingerprint.mts` `SOURCE_FIELD`; `cli/src/core/deps/pack-stamped.ts`). The `hfs` and `pkg:@starci/*` parts, the install digest
of every package a record's reads name (`package-closure.mts`) and the lint import graph's install digests use that digest when the installed manifest
carries one. The local-registry build of a source (published under the version committed in git) and the npm build of the same commit therefore yield identical parts and identical keys, so a run on
the local build writes records that stay valid after `starci deps install-local --restore`, and CI, which trusts the committed cache at its base
([Trust](#trust)), reruns nothing for them; a different source yields different keys.

A package without the digest (a build packed before the field existed) is keyed by version and recorded integrity. A run whose CLI or any `@starci`
package is linked or copied from a local folder (no recorded integrity), or is installed from a registry on this machine and carries no
source digest, has no portable fingerprint: it runs in full, says so, and writes nothing into `.starcistacks/cache/`, so a developer testing a
package never commits a cache CI cannot match. `--env local` lists that cache finding only for the registry install
(`HFS_CHECK_CACHE_UNPORTABLE`, `localOnly`); a linked or copied folder blocks in both environments. The platform is not a part: the tools are pinned by the lockfile, and a step whose result
differs by platform is a defect the CI verification below exposes.

## Trust

A record is only reused when its key matches the tree now: every run hashes every file again, and a file whose hash
differs from its record is judged for real. That alone does not stop a forged record, one whose hash is right and whose
findings were deleted by hand, so where the cache is trusted from depends on who runs:

- **On a host** the cache in the working tree is trusted. A local run is the developer's own view; it updates the
  folder and the developer commits it with the change. A run on a local-registry build that carries a source digest writes a cache of the same
  keys the npm build of that source has, so the commit carries it as it is; one without the digest writes none.
- **In CI** the cache is trusted only as it stands at the trusted base: the merge-base with the default branch for a pull
  request, the first parent for a push to the default branch, the merge-base with the default branch for a release candidate
  or a release tag (whose commit main's CI already verified), and the branch tip for a scheduled or dispatched run on the
  default branch (the nightly verify), read with `git show <base>:<path>` (the managed workflow fetches it). The change's own edits to the cache are never trusted: CI judges everything the base cache does not
  cover, then compares the change's committed cache with what it inherited or computed. A record whose key matches the
  tree and whose findings differ is `HFS_CHECK_CACHE_FORGED`, an error finding, whether the record was edited
  by hand or a step is not deterministic across hosts. A key the change touched with no current record is
  `HFS_CHECK_CACHE_STALE`. No trusted base (any other event, an unreadable base) is a full run.

A pull request that edits cache files directly therefore gains nothing: its records are never read in CI, a forged one
turns CI red, and a deleted or stale one costs only time. The default branch only receives a cache that a pull
request's CI compared record by record; a direct push to it is verified by its own CI run against its first parent, and
the nightly verify compares main's cache with a full run, locking releases on any difference, so a cache that bypassed
review is caught before it ships.

## Which step reuses what

This table is the one owner of what each step of `app check` reuses, on what key, and where the result is kept. The content index diffs the tree against
the trusted cache: modified, added, deleted; a rename is a deletion and an addition, and deleted paths drop every record they own. A step's result is reused
while everything its tool read to produce it is unchanged and judged again when any of it changes; a tool version it does not read never invalidates it.
Where a record carries its reads (`packages/hfs/cache/package-closure.mts`), they are the installed packages the run loaded, each by the digest of its
installs in the lockfile, and the app files outside the step's own key, each by its hash. **Where** is the committed `.starcistacks/cache/<folder>`, the
untracked tool cache of slot `app.tool-cache`, or none.

| step | class | reused when | re-run on | where |
|---|---|---|---|---|
| tracked files, content index, fingerprint, trust | always | never | every run; they decide the rest | `fingerprint.jsonl` (the parts) |
| managed files against their render | always | never | every run: cheap, and its inputs are the templates and the managed files | none |
| plaintext secrets (R06 and the lite custody L17: `--gate secrets` and `--gate hfs`), bypass markers (R303), soft file size | per file | the path's hash is unchanged, and the hash of the one other file the rule reads (a README's `.starcistacks/application-stacks.yaml`) | changed and added paths; `hfs.json` or the hfs that runs | `check/hfs/`, the secrets findings in `check/secrets/` |
| documentation freshness, script hygiene, database configuration, front-end build args | read set | every file the rule read through `readText` / `readJson` is unchanged (each recorded with the hash it had) and the tracked path list outside the cache folder and the TypeScript version are the same | any change to a file it read; a tracked path outside the cache folder added or removed | `check/hfs/` |
| recurring-work scan of the Swarm release rules (the `pg_cron` and application SQL it parses) | per file | the path's hash, the stacks manifest and the parsers are unchanged | changed and added paths | `check/hfs/` |
| slot, tree, pin and the remaining content rules of the app pass, root and sides | always | never | every run: they read untracked entries and git state the index does not hold, or stat and list the work tree, which no key holds; the boot proof, the costly part, is lifted out as its own scoped step below | `check/hfs/` (their findings, for new / known / fixed) |
| Prettier (`HFS_FORMAT`) | per file | the path's hash is unchanged | changed and added paths | `check/format/` |
| database rules (`DB_*`) | scoped | every `db/` hash and the merge-base the baseline rules compare with are unchanged | any `db/` change or a new merge-base | `check/db/` |
| contract emit | scoped | the be side key is unchanged | any be change | `check/hfs/` |
| boot proof of a lite back end | scoped, with reads | the be side key and the reads its proof workers reported (their module cache) are unchanged | any be change; a package the boot loaded; an app file outside be it loaded; a proof whose workers reported no list keys on every install and tracked file; a timeout is never stored | `check/wiring/` |
| architecture machine (check surface), per side | scoped | the side key is unchanged | any change in the side: the whole side | `check/hfs/` |
| ESLint, per side | per file, closure-scoped | the side key is unchanged, or the file is outside the dirty set | the dirty set (ESLint below) | `lint/<side>/` |
| stylelint | per file | the path's hash is unchanged and no stylesheet was added or removed | changed stylesheets; every one when the stylesheet set changed | `lint/fe/` |
| unit specs and coverage | per spec, closure-scoped, with reads | the spec's closure key and the reads its run recorded are unchanged | specs whose closure holds a changed file, or that loaded a changed package or app file (coverage below); every spec on a runner change (`lock:test`, `node`, the preset, the jest configuration, a tsconfig the transform reads) | `test-coverage/` |
| integration, e2e and contract specs | always | never | every run that runs them: they reach services, data and time a key cannot hold | none |
| `tsc` per workspace program (`--gate types`) | scoped, with reads | the program's key and the reads `tsc --listFiles` reported (the TypeScript lib files, the `@types` and every package whose declarations it loaded, the app files outside its folders) are unchanged | any change the program reads: that program | `check/types/`; its `.tsbuildinfo` in the tool cache |
| CI build steps (typecheck, `build be`, each `build fe`) | per step | the step's command and environment, the Node major, every tracked file of the folders it builds (every tracked file for the typecheck) and of the app root but the lockfile, and the lockfile installs its manifests resolve are unchanged | any of them; a step killed or timed out stores nothing | `check/build/` (the verdict, green or red with its finding; never an artifact) |
| database migration checks (`npm run db:lint`, `app db drift`) | per step | its command, the db rules' inputs and their baseline at the merge-base, the migration chain, the scratch database image, the entity list's import closure, the engine manifest, the installs the drift check loads (the closure's packages, `typeorm`, `typescript`, `pg`) and the hfs that judges are unchanged | any of them; a host without a database stores nothing | `check/build/` (the verdict) |
| production dependency audit | always | never | every run that selects it: the registry's advisories change without the tree | none |
| proofs, the gate verdict, the Sonar and Codecov predictions | always | never | every run | none |
| Sonar scan against the server | scoped | the scanned content (every tracked file outside the cache folder, the properties, the coverage and lint reports they name), the target, the scanner version and the digest of the gate as the server holds it now (its conditions, else its name when the token cannot read them; a gate neither is readable for is never kept) are unchanged | any of them; a failure is never kept | the tool cache (`sonar-scan.json`) |

A side key is the sha256 of everything the side's whole-program steps read: the hash of each tracked path of the side
(`absent` for one deleted in the work tree), its staged entries (the machine reads the index), and the untracked files
its TypeScript program reads (what its tsconfig includes or an import resolves to that git does not track, generated
code included). The key hands back the hash it took of each input (`SideKey.hashes`), and the record is stored only if every
input still has that hash when the step ends: an untracked input has no hash in the content index, so it is compared with
the one the key took, and a stable generated file keeps the record (the front end of an app with generated GraphQL
code reuses its machine). The machine and the type-aware rules read the whole program, so a scoped step re-runs the whole side:
the machine on changed owners alone (`--fast`) skips duplicate code and dead exports and is not the full result.
The `types` family keys each workspace's program like a side: an unchanged key reuses its recorded diagnostics, a
changed one runs that program's `tsc` in full. TypeScript's `.tsbuildinfo` speeds that run but is host state, not a
result (it holds versions and signatures, not findings), so it stays in the untracked tool cache of slot
`app.tool-cache` and is never committed.

### The structure pass's content rules

The content rules of the pass are kept per file and per read set, not judged over every tracked file on every run. Two declarations, both in the rule runner and proved by `check-cache-structure-rules.spec.mts`
under a file-system recorder, let the cache keep them (`check/hfs/`, records `file-rules`, `rule:<finder>` and `unit:<id>`):

- a **per-file rule** (`perFileRules` of `check.mts`) judges a file from its bytes and the files its `deps` names, and every finding carries that file's path; the record
  of a file holds each such rule's findings for it. `check/secrets/` keeps the findings of the secrets codes for the new / known / fixed comparison, and `--gate secrets` reuses the same
  per-file records, so a warm run judges nothing and a run after an edit judges that file (the contract of those records is "The secrets records" below);
- a **cross-file finder** (`KEYED_FINDERS` of `a15-findings.mts`) reaches the app only through `readText` / `readJson`. The first run records the read set, each file with its hash;
  the record is reused while every file of the set, the tracked path list outside the cache folder (the finders derive their file sets from it) and the TypeScript version are the same;
  the cache folder's own paths stay out of that list, so a commit of the cache alone stales no record (a record keyed on them would depend on its own commit and be rewritten by
  every run after a cache commit), and a finder that read a file of the cache folder is judged live. A finder that stats,
  lists or walks the work tree is never a member, and the spec fails on a member that does.

The files of the cache folder itself (tracked or not) are judged live and never keyed: every run rewrites them. The cache never changes a verdict: a finding that does not name the file a per-file rule judges makes the whole batch run uncached, and the plain `checkRepo` of every other caller runs the rules
as before. An edit during the run drops the record of the file it touched at the flush, as for every other step.

### The secrets records

The cache is committed, so the records of `check/secrets/` never hold secret material: a record is `{path, step, hash, findings}` and a finding is `{path, line, column, rule, message}` with
`rule` one of the secrets family's codes and `message` the digest `sha256:<16 hex>` of the message the run printed (the identity the new / known / fixed comparison needs; the run prints the
message itself, never the record). The writer projects every record to that form (`safeSecretRecords` of `cache/secret-records.mts`, applied by the session on `replace` and on read, so a cache
written before the digests compares like with like), and the secret judgement of R06 (`secretFileFindings`, the one judgement `starci app check` and the commit hook share) judges a file of
`.starcistacks/cache/check/secrets/` by `secretRecordFaults` (`runtime/scripts/lib/secret-records.mts`): a file that holds anything but codes, paths, positions and digests is refused
`HFS_PLAINTEXT_SECRET`, and a conforming file is accepted wherever it sits, so the `secrets/` folder name does not make the warm cache uncommittable. A cache written before the digests is migrated
by `starci app codemod secrets-cache --execute`, or rewritten by the next `starci app check --gate secrets`. Proved by `check-cache-secret-records.spec.mts` and `secrets-cache-codemod.spec.mts`.

## ESLint

ESLint's own `--cache` is not used: it keys a file on its own content and the config, and three kinds of input escape
that key.

1. **Types.** A type-aware rule's result on a file depends on the files whose types it reads. The cache records each
   file's resolved local imports (TypeScript `preProcessFile` and `resolveModuleName` under the side's tsconfig: static,
   type-only and dynamic imports, re-exports, triple-slash references, JSON) and its **type surface**: the digest of
   TypeScript's isolated declaration emit of the file (`ts.transpileDeclaration`, which reads the file alone; a script,
   a declaration file or a JSON file stands for its content hash), the local files that emit names (`refs`: a type
   imported from them, a re-export) and whether the surface is *inferred* (`open`: the emit reported a diagnostic, a type
   the compiler must infer from bodies and other files; a function whose only diagnostic is a missing return type and
   whose every return is JSX, `null` or `undefined` is not inferred, its type being the JSX namespace's). The classifier is one
   function, `declarationSurface` of the runtime (`scripts/lib/declaration-surface.mjs`), which the lint rule R368
   `explicit-export-surface` of both canons also reads: the rule reports each export that makes a file `open`, at error, so a
   lint-clean side has no inferred surface and a body edit lints that file alone. An explicit
   surface is its emit text plus the surfaces of the files it names, nothing else.
   The dirty set holds every changed, added or removed file, every file whose imports resolve elsewhere than recorded, and
   every file that imports a file whose surface changed, in the new graph and the cached one (a file that stopped
   importing it still holds a result from the old types). A dirty file's surface changed when it was added or removed,
   gained an import, its digest differs from the record, it is inferred, or it names a file whose surface changed. A
   body-only edit, a comment at the end of a file, therefore lints that file alone; a changed signature, export list or doc
   comment (`@deprecated` is read by rules) its direct importers, and on through the files that re-export or name its
   types; an inferred type carries on one more level at a time. A record from before the surface was kept, or a
   TypeScript older than 5.5 without `transpileDeclaration`, has no digest and counts as changed and inferred. Imports are
   resolved again for every file when a path of the side was added or removed, since a new file can change where an
   unchanged import resolves. A changed file that declares globals (a `.d.ts` with no import or export, `declare global`, a module
   augmentation) dirties its whole side, and so does a change to the side's untracked program inputs.
2. **The project-graph rules** (duplicate code, unused exports and files, tier direction and the other `LINT_ENFORCERS`
   of `@starci/hfs` architecture/surface.mjs) report on a file what the whole-program machine found, so an edit to one
   file can add or remove a finding on any other. When a side key changed, the cache runs the installed canon's own
   `projectGraph` once over the side and compares each file's graph findings with the recorded ones; every file whose
   graph findings differ joins the dirty set, and ESLint itself lints it again, so ESLint stays the only emitter of each
   message and its text.
3. **Rules that read files outside the import graph** (sibling and directory listings, route files, manifests,
   stylesheets). Each lint canon and grammar lint exports `crossFileInputs` beside its config (rule id, kind `content`
   or `exists`, globs relative to the linted file or the side root), proven complete by a spec that runs each rule's
   fixtures under a file-system recorder and fails on a read neither the declaration nor the import graph covers. The app root's and the side's own
   `package.json` stand in a content input by their identity (`manifestIdentity` of `cache/lint-family.mts`): every dependency's version range reduced to a workspace, file
   or link reference, an alias or a plain registry range, since a canon reads the names, the workspaces and those references of a manifest and never a registry version.
   A raised pin (`@starci/hfs`, `starci-harness`, a library) therefore dirties no file, while a new, removed or renamed dependency, a `workspaces` entry or a reference
   dirties every file that reads the manifest. A
   changed path matching a `content` input dirties the files that declare it; an added or removed path dirties its
   `exists` dependants. A canon installed without the declaration makes every change in its side a whole-side lint.

The dirty set of a side is linted by as many ESLint children as run at once, never more ([Orchestration](#orchestration)): the files make
ceil(files / `heavy.plan.lintChunk`) chunks, and the side runs as many children together as the room at the start of the lint step holds of the eslint cap and the run's CPU
lanes (all free, the step being alone) allow, at most the chunks, the files split evenly between them (`eslintParts` of `lint/run.mts`). Every child builds the side's whole
TypeScript program, so a side is never split into children that would wait for each other; on a room for one, the side is one child however long
the list. The files go to each child through a job file, not the command line (a diff of hundreds of long paths outgrows the Windows command line),
where a small runner (`lint/eslint-list.cts`) lints them once with the ESLint API of the side's own install and prints the results as the CLI's
`--format json` does. The launcher and result
validation are those of a full run, and a child that did not complete (killed, timed out) stores nothing and fails the run;
every other file of the side's canon scope (enumerated afresh) takes its record, a file of the scope with no record is
dirty, and a record outside the scope is dropped. `app check --gate lint` and a default `app check` call the same cached ESLint and the same
cached app pass on the same records, so they never hold two answers for one tree.

A run builds each side's import graph at most once, and its project graph at most once in each process: planning builds them for a diff
and the record writing reuses them; the side's scope is enumerated once and handed to the ESLint launcher; and the graph build remembers the
files and folders it probed (a side's thousands of files resolve their imports against the same few hundred folders). The ESLint child
builds the project graph for its rules, so it hands the snapshot out (the first chunk, when a side runs several): the list runner (a whole side is the list `.`) asks each installed
canon named in its job for `projectGraphSnapshot`, the findings of the graph the canon's rules already built in that process, and writes them
beside its results; the launcher reads them back and the `graph` records are written from them. A whole-side run therefore builds the project
graph once, in the child, and a diff builds it in the CLI for the plan and in the child for the rules. A child that wrote no snapshot, or a
canon without the export, leaves the CLI to build the graph itself through `projectGraph`, so the records are the canon's own answer either way.

## Unit coverage

`app check --gate test` runs the unit specs through the app's own Jest and writes the merged report the managed CI uploads. A spec's closure key is the sha256 of the spec, every module Jest resolves from it transitively (its resolver
with the project's `moduleNameMapper`, `jest.mock` targets and setup files), its snapshot file and its project's
configuration. Its record adds what its run loaded: `@starci/jest-preset`'s runtime (`spec-loaded-runtime.ts`, the unit project's `runtime` in a check-cache
run) records every file the spec's module registry read, and the record keeps each installed package among them by its lockfile digest and each app file
outside the closure by its hash, so a package bump re-runs the specs that loaded it and an hfs or CLI bump re-runs none. A warm run runs the specs whose key
changed, the way `jest --findRelatedTests` selects them but over the whole closure, and keeps the records of the rest. Jest reports each spec file's own
coverage; the preset's reporter writes it to the spec's own file the moment the spec ends and takes it off the result, so neither Jest's coverage reporter
nor the aggregated results hold it and the Jest parent's memory stays flat however many specs run. The run turns each file into the spec's record as it
appears (every 10 seconds, journaled at once) and removes it, so the record is the one copy; it records, per spec and source, the covered lines, branches and
functions (covered or not, never hit counts, so the bytes are stable), and per source what is instrumented. The total is, per source, its instrumented items with the union of what the
current spec records cover, folded one record at a time through the preset's merge. The per-file threshold is judged on that total by `@starci/hfs` (`--coverage-from` reads
the same report), never by Jest's partial run, whose threshold is switched off. A failed spec is never stored. The
lcov sent to Codecov and Sonar is the merged total, so their server-side numbers are those of the whole suite.

## Sonar and Codecov

Their baselines hold reference data only, never a server's result. From them and the merged coverage a run predicts,
and labels as a prediction: Sonar's new-code coverage and duplication on the lines changed since the base commit, and
Codecov's patch coverage and project change, the base total computed from the base commit's committed coverage records.
A prediction never passes or fails a run.

A whole run also scans for real (`cache/sonar-scan-family.mts`): the app's CI sonar job, run against the app's own Sonar
server, so a scanner crash or a red quality gate is found before the push. Nothing is stated by the harness: the project
key, sources, exclusions and coverage and lint-report paths are those of the app's `sonar-project.properties`, the server
and the token's custody those of its stack declaration (`services.sonar`, the same connection `app release gate` uses; the
token is opened from the app's sealed secrets and reaches the scanner through its environment alone, never an argument or
a message), and the quality gate is the one the server holds for the project.

- **Order.** The scan runs after every other family and the coverage step are green, as CI's sonar job needs lint and
  coverage; it first writes `reports/lint.sonar.json` from the run's own linter results, the file the properties import.
  Under a branch profile that reports sonar its findings are reported, never judged; a profile that turns sonar off skips it.
- **Target.** The analysis never overwrites the project's own. The edition is read from the server with the token
  (`api/navigation/global`). A server with branch support receives the scan as the branch `local/<user>`; a server
  without it (Community, or an edition it does not state) receives it as the derived project `<projectKey>-local`. A derived
  project the token can analyse (`api/qualitygates/project_status` answers 200, which a project analysis token may read) is scanned
  as it is, and the main project is not read at all; only a missing one is created, with the main project's visibility and bound to
  the main project's quality gate when the token may, and otherwise skipped with a warning that says to create it and bind it to the
  gate or to give the token Create Projects. The main analysis and its new-code baseline are never touched.
- **Verdict.** The scanner exits non-zero: `CI_PARITY_SONAR_SCAN_FAILED`, with the scanner's last lines. The compute-engine
  task fails or the project's gate is ERROR: `CI_PARITY_SONAR_GATE_FAILED`, naming each failed condition. Both are errors.
- **Not run.** Whenever the scan does not run, the report carries one `sonar scan:` line saying why: the run selects families
  (only a run with no selector runs the scan), the branch profile turns sonar off, another family is red, the app has no
  `sonar-project.properties` or no Sonar service in its declaration (these are report lines, never findings). No token
  (no sealed secret or age key on this host), a server that does not answer, a token without the permission the derived
  project needs, or a verdict the server does not give in time is the warning `CI_PARITY_SONAR_SKIPPED` and its line; the run is never reported
  green for the scan, and CI judges it. A scan that runs prints its start, the project key it scanned, its duration and the gate status.
- **Reuse.** A green verdict is kept in the untracked tool cache (`sonar-scan.json`, beside the run log) under the key
  [Which step reuses what](#which-step-reuses-what) names; `--fresh` scans again. The verdict is host state, never committed: it
  depends on a server, which the committed cache must not.

## CI parity

A whole `starci app check` (the pre-push hook runs it) runs what the app's managed CI runs and no other family does, so a green run is not followed by a
red CI on it (R383, R386): the `build` and `audit` families, CI's coverage step and the Sonar scan ([Sonar and Codecov](#sonar-and-codecov)). The `build` and `audit` families read their commands from the app's rendered `.github/workflows/ci.yml`,
never restate them; what each reuses is [Which step reuses what](#which-step-reuses-what)'s:

- `audit`: the fast job's production dependency audit (`npm audit --omit=dev --audit-level=high`, or what the quality declaration sets).
- `build`: the fast job's `npm run typecheck` (build:modules, codegen and tsc: the types family runs the tsc programs, not the script), the build job's
  `npm run build:be` and each `build fe` step, a `next build` per front-end app with its server prerender and route config. A build runs under the
  heavy governor at the memory plan's largest tsc heap, with its own SWC cache root (`LOCALAPPDATA` and `XDG_CACHE_HOME` under the app's tool cache):
  Windows' hardened loader refuses the SWC binary next build loads from a `%LOCALAPPDATA%\swc` the user does not own. On Windows the build also
  sets `SWC_NATIVE_BINDING_CACHE` to a short folder per app under the user profile (`<profile>\sw\<8 hex of the repo path>`) unless the caller set
  one: the addon's lock (`swc\swc-native-<SID>\v1\<128 hex>.lock`) under the tool cache is longer than MAX_PATH (`ERR_SWC_NATIVE_CACHE`, os
  error 3), and a root outside the profile (a drive-root folder) fails the addon's DACL check.
- coverage: after the test family merged its records into `be/coverage/lcov.info` and judged it, a whole run runs CI's coverage step on it
  (`starci app coverage verify`), the local proof of the merge.

- database migration checks: the build job's last step (`npm run db:lint`, and `starci app db drift` for an app with an entity list) applies the migrations to a
  scratch database and checks the entity manifest against them, so a manifest that lacks what a migration creates (`BE_ENTITY_SCHEMA_DRIFT`) is found here
  and not first by CI. The scratch database is a throwaway container (Docker) or the empty database named by `--db-url-env`; a host with neither gets
  `DB_DRIFT_NEEDS_DATABASE` from the verb, which a whole run reports as the warning `CI_PARITY_DB_SKIPPED` (CI judges the step; a warning never turns a run
  red, and the run never reports the step green).

`--gate build` and `--gate audit` run the first two alone. A failed step is `CI_PARITY_STEP_FAILED` with the step's last lines.

## Orchestration

`app check` is a set of steps, one per family plus the parts that read the results of others, run by the scheduler of `packages/hfs/cache/schedule.mts`, which
declares them once (`CHECK_GRAPH`: what each step needs and its priority). **The steps run one after another, never two at once.** The next step is the one of the highest
priority among those whose needs have ended, so the sequence is: the unit run (`test`), `lint`, the structure pass (`hfs`), `types`, `wiring`, then the rest as their needs
allow:

- `coverage` (CI's coverage step) and `sonar` (the baselines) read the coverage the `test` family merged, so they come after `test`;
- the lint ratchet reads the lint records of the run, so it comes after `lint`;
- `build` runs CI's typecheck script (build:modules, then codegen, then tsc), `build:be` and each `build fe` in CI's order: its codegen and build:modules rewrite
  the generated code and the root packages' dist that `types`, `lint`, `test` and `wiring` read, so it comes after those four;
- the Sonar scan uploads the findings and the lint report of every other step but the ratchet and runs only when they are green, so it comes last.

`app check` itself holds no heavy-command slot: it is the orchestrator. Every heavy child a step starts (each tsc program, each ESLint chunk, the jest run, each
CI build step, the boot proof, the contract compiler, the Sonar scanner) is admitted by the governor on its own, at the moment its step starts it, from the RAM free
then ([The memory plan](#the-memory-plan)). Because a step starts only when the one before it has ended, it finds the whole room the host has at that moment and sizes
itself on all of it: the jest run takes the workers the room and the cores hold, with no share of a lane pool; the ESLint chunks of a side and the tsc programs of the
types step run together as many as the room holds of their caps and the run's cores - 1 CPU lanes allow (a single-process child holds one lane for its run), at most the
chunks or programs to run; the build and the other steps likewise. A step that reuses all its work from the cache ends with no child and costs about no time. A step
starts when the one before it has ended, whatever its verdict: a red or failed family never stops another, and one run reports every finding. A step that throws (a
child the host held, `HOST_HELD` or `HEAVY_DEFERRED`, a refused or incomplete execution, a crash) reached no measurement: once every other step has ended, the run ends
with its error (a hold of the host first), as a run of that step alone would.

Each step writes only its family's own records and journal files ([The journal](#the-journal); the parallel ESLint chunks of a side each their own file); the
fingerprint is taken once when the session opens, before the steps, and the session is flushed once, after every step ended, followed by the cache verdict. Findings,
report lines and family reports are folded in graph and family order.

## The memory plan

Before its families run, `app check` measures the cache folder of the app (the MB of every record) and takes the check's own heap and the files of one lint chunk
from it and the constants of `ops/liveness.yaml` `heavy.plan` (`cli/src/harness/memory-plan.ts`; the check re-executes itself under its heap when
node's limit is lower). Every heavy command then sizes itself from the live RAM at its admission, never from an earlier run (`withHeavySlot` of
`cli/src/harness/heavy.ts`; the caps and the one reserve are in `heavy.caps`, `heavy.testRun` and `heavy.reserveMb`, which also hold every number below):

- The room is the free RAM now less the one reserve and what the commands admitted in the last `heavy.plannedSeconds` planned; free RAM already excludes
  what running commands use.
- A test run takes `clamp(floor((room - parent cap) / worker cap), 1, min(cores - 1, heavy.testWorkers))` workers from the room at its admission, the start of the test step, whatever steps ran before it and with no cap per step: the jest parent is held to its cap,
  each worker to its cap by `--workerIdleMemoryLimit` and a `--max-old-space-size` a preload of the parent's `NODE_OPTIONS` gives every forked worker.
  One worker is the floor, and an estimate never lowers a count the room holds.
- Any other node tool runs under the smaller of its cap and the room, never under its minimum. A side of the lint family runs as many ESLint chunks at once as
  floor(room / eslint cap) and the free lanes allow, at most its chunks ([ESLint](#eslint)); the programs of the types step run together as
  floor(room / tsc cap) and the free lanes allow, at most the programs to run, the room read when the step starts (the CLI hands the caps over as `STARCI_ESLINT_HEAP_MB` and `STARCI_TSC_HEAP_MB`).
- A command whose room is under its least need waits, first come, first served, and starts when RAM frees; with nothing running it starts anyway with one
  worker and a warning that names the shortfall. A command that runs out of memory names the heap cap it hit and the RAM free at its admission.
  ([cli/README.md](../../cli/README.md) "Heavy-command governor"). `--explain` prints the plan and the test run the RAM free now would get.

The per-spec coverage records are held as their lines and parsed one at a time (a lazy record, `cache/jsonl.mts`), and their union folds through the
preset's merge one record at a time, so the parent holds about three times the records' MB, not the seven times their parsed tree took.

## The slot, the templates and adoption

- **Slot.** `app.starcistacks.cache` (both editions): `.starcistacks/cache/`, tracked, presence optional, admitting
  `fingerprint.jsonl`, `check/**`, `lint/**`, `test-coverage/**`, `sonar-baseline/**` and `codecov-baseline/**` and
  nothing else. It is app-owned and written only by `app check`; `app sync` never renders,
  overwrites or judges its content, and managed-file drift does not cover it. `cache` is a reserved name that
  `.starcistacks/application-stacks.yaml` refuses as an environment.
- **Templates.** The managed `.gitignore` block re-includes `!.starcistacks/cache/**` after its `.starcistacks/**` deny;
  `.gitattributes` gains the line above; `.prettierignore` skips the folder. The managed CI workflow fetches the trusted
  base and runs its jobs diff-only against it: CI runs the families as parallel jobs, so each job selects its family
  (`app check --gate format`, the `lint` job `--gate lint` per side), the unit run is sharded (`--gate test --shard <i>/<n>` per
  job records nothing) and the merge job judges the merged report with `--coverage-from`. The selectors are job selectors of CI and never
  `--fresh`: one plain run would serialize the families that CI runs in parallel. Every `app check` of the managed workflows and of the hook
  carries `--env prod`: `cache-verify.yml` runs `app check --env prod --fresh` nightly, the managed pre-push hook runs `app check --env prod`, and
  the release gate runs its `app-check` row diff-only against the warm cache unless `--full` is given, and the rows `app check` covers reuse that row's verdict ([The operating procedure](#the-operating-procedure)).
- **Scaffold.** `app scaffold` writes the templates above and no cache; the app's first check builds it in full.
- **Adoption.** `app sync --execute` and `app upgrade` bring an existing app the same templates and never create,
  move or delete cache records; its first run after them is full and writes the folder, which the developer commits.

## The law

`R343`, enforcer `hfs` (R340 to R342 are taken by the grammar and entity-base lint rules): an app's committed check cache is trusted in CI only as it stands at the trusted base;
a record whose key matches the tree and whose findings differ from the inherited or computed result is
`HFS_CHECK_CACHE_FORGED` (an error finding), a touched key without a current record is `HFS_CHECK_CACHE_STALE`, and a
missing cache is `HFS_CHECK_CACHE_MISSING`. Why: CI trusts a committed artifact only where review and CI already
judged it, so a hand edit can cost time but never pass a file. Enforcement:
forged fails the run; stale and missing warn in CI (report-only, the run is full or wider and still correct); a push
whose cache a real run on its tree changes is refused at the pre-push hook (`HFS_CHECK_CACHE_UNWARMED`,
`HFS_CHECK_CACHE_UNPORTABLE`, `packages/hfs/cache/freshness.mts`), so CI never goes cold and past its ESLint budget; and a red
or unreadable nightly verify refuses the release gate (`HFS_CHECK_CACHE_VERIFY_LOCKED`).

## Edge cases

- **An edit during the run.** The content index is hashed again before writing; a file whose hash changed while the run
  read it gets no record, and a scoped step or side whose inputs include it is not stored (an untracked input, generated
  code, is held to the hash the side key took of it). The ESLint and stylelint records of a side are the exception to "or
  side": only the files the run judged and whose hash moved lose their records (every step), the other records are written,
  and the next run finds the edited file without a recorded graph entry, so it and everything that imports it are judged
  again.
- **A step that throws or a linter that cannot complete** stores no record of that step; what a family journaled while it ran stays in its journal for the next run.
- **A killed run** leaves the committed cache as it was and its journal behind: the next plain run reuses every family it finished and the part of the running one it
  judged ([The journal](#the-journal)).
- **Branch switches and merges** are content changes like any edit; a union-merged folder is normalised by the next
  write.
- **A cache from another hfs** differs in the hfs part, so the records of the hfs-run families are replaced, never read; the other families keep theirs. Another CLI changes no part.
- **A disk error writing the cache** is a warning in the cache line and never changes the exit code.

## As built

- `--fix` runs the linters with `--fix` before the check reads the cache, so the rewritten files are the dirty set of that same run.
- `--quiet` mutes progress and keeps the diagnosis on stdout for `check`; other verbs still mute stdout.
- The managed CI keeps its triggers (push to main, release candidates, tags) and adds the nightly `cache-verify.yml`; a push to main is
  trusted against its first parent, a candidate or tag run against its merge-base with main. The `format` step runs `app check --gate format`.
- Side keys take the untracked program inputs from the side's tsconfig `include` (generated code), not from import resolution of files outside it.

## Read with

[lint.md](lint.md) (which machine judges what and where it runs), [stacks.md](stacks.md) (the `.starcistacks/` shape),
the `app check` usage of `@starci/hfs`, and [policy/quality.yaml](../../policy/quality.yaml)
for the profiles the verdict runs under.
