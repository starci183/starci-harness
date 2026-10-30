# The committed result cache of an app

Every StarCi app commits the results of its checks in `.starcistacks/cache/`, keyed by content, so `starci app check`,
`starci app lint` and the unit specs judge only what differs from the cache, on a developer host and in CI
alike. This is a design awaiting the owner's approval (ruling `app-check-cache`, status proposed): no code reads or
writes the cache yet, and the slot, law and templates named below are added by the change that builds it. Its one rule
is that a reused result is always the one a full run would produce now; whenever the cache cannot prove that, the step
runs in full.

## The command surface

`starci app check` with no selector runs every family diff-only against the committed cache and writes what it judged
back into it. `--full` runs the families it selects in full and rewrites their records. A selector runs one family, and
selectors combine:

| selector | family (the measured steps) | records |
|---|---|---|
| `--hfs` | the structure: slots, tree, pins, managed files against their templates, the content rules of the app pass, the architecture machine's check surface, the contract emit | `check/hfs/` |
| `--format` | Prettier over every tracked file (`HFS_FORMAT`) | `check/format/` |
| `--db` | the database rules of `db/` (the `db:lint` script runs `app check --db`) | `check/db/` |
| `--secrets` | plaintext secrets, sealed custody, untracked secret files | `check/secrets/` |
| `--wiring` | the boot proof of every app (a lite back end's composition with doubles) | `check/wiring/` |
| `--types` | each workspace's `tsc --noEmit` through the app's TypeScript | `check/types/` |
| `--lint` | ESLint per side and stylelint | `lint/` |
| `--test` | the unit specs, their coverage merged into one report and its per-file threshold | `test-coverage/` |
| `--sonar` | the Sonar and Codecov predictions from the merged coverage, the lint findings and the clones | `sonar-baseline/`, `codecov-baseline/` |

Every family reports its diagnosis on its own line, `<family>: <full|diff> (<reason>), checked <n>, reused <n>;
findings <new> new, <known> known, <fixed> fixed`, where known findings are those its records already held, so a run
always says what is wrong and whether it is new. A family that always runs (`--secrets`, the cheap structure rules)
still records its findings for that comparison; it never skips work on them. `--json` carries the same per family.

The flags of today reconcile as follows. `--fast` and its `--base` are removed: the default run is diff-only and, unlike `--fast`, its result equals a full run's (clones and dead
exports included), and CI derives its trusted base itself. `--wiring` becomes the family above. `--coverage-from
<lcov>` stays: it judges a report produced elsewhere (the merge of a sharded full run in CI) and records nothing.
`--staged` stays the pre-commit guard alone, outside the cache. `--json` stays.

`starci app lint` stays its own verb, since it is the `lint` script of the app and of every fe workspace and the one
writer of the Sonar import file (`--out`), with `--fix`: it runs the `--lint` family and the app findings exactly as
`app check --lint --hfs` does, on the same records under the same fingerprint, so the two never disagree. Folding it into
`app check --lint` instead (and moving every script, hook and workflow that calls it in the same change, CONTRIB-15) is
the alternative for the owner. `lint --side be|fe` reads and writes that side's records (the CI lint matrix runs one side
per job); `lint --workspace` reads records and writes none, since it judges part of a side; `lint --changed` and
`lint --fix` neither read nor write.

## Progress and the run log

A run reports as it goes, on stderr, so stdout keeps the diagnosis (and under `--json` the one final envelope). Each step
prints a line when it starts and when it ends, and a running step prints one every 10 seconds of work or 10 percent of
its files: `[12:04:31 +3m07s 41%] lint fe 312/1840 (17%) reused 1528 checked 312`, the clock and elapsed time, the
overall percentage across the selected families (weighted by each step's file count, a whole-program step counting as
the files of its side), the step, its files done of its total and its cache hits against the files it judged. On a
terminal the running line updates in place; anywhere else (CI, a run redirected to a file) only whole lines are written,
never a carriage return or spinner. `--quiet` suppresses progress and keeps the diagnosis.

Each run also writes its timings, per family and step (duration, files, reused, checked, full or diff and why), to
`last-run.json` and appends them to `runs.jsonl` (the last 100 runs) in the untracked tool cache of slot
`app.tool-cache`, `${STARCI_CACHE_HOME:-%LOCALAPPDATA%/StarCi/cache}/<repo>/app-check/`, where `<repo>` is the app
folder's name and the first 12 hex digits of the sha256 of its real path. Timings change every run, so they are host
state and stay out of git; `.starcistacks/cache/` holds results only.

## When a run is full

| situation | run |
|---|---|
| no cache in the tree (a new app, first adoption) | full, and it writes the cache |
| `--full` | full for the selected families, ignoring their records; it rewrites them |
| the fingerprint differs from the cache's | full, and it rewrites the cache |
| `starci app release gate` (every gate row, the urgent back-fill included) and the CI run a release waits for | full, never reading the cache |
| anything else, on a host or in CI | diff-only against the trusted cache (below) |

`STARCI_APP_CHECK_CACHE=verify` runs diff-only and then full and fails with exit 2 on any difference, naming family and
file; the specs use it, and it proves the cache on a real app before anyone relies on it. Times are printed, never
stored.

## Layout and format

`.starcistacks/cache/` is one folder, committed with the code:

| folder | holds |
|---|---|
| `fingerprint.jsonl` | one line per fingerprint part: name and sha256 |
| `check/` | the per-file results of `app check` (formatter) and the input-set results of its scoped steps |
| `lint/<side>/` | per source file: content hash, resolved local imports, ESLint results; the project-graph findings per file; stylelint results |
| `test-coverage/` | per unit spec: its closure key, and the lines, branches and functions it covers in each source; per source: what is instrumented |
| `sonar-baseline/` | reference data only: the new-code base commit, the quality gate's conditions as read from their owner with that owner's digest, the analysis scope settings' digest |
| `codecov-baseline/` | reference data only: the base commit, the patch and project targets of `codecov.yml` with its digest |

Every data file is JSON Lines: one self-contained record per line, sorted by its key (path, then step), keys sorted
inside each record, LF endings, a final newline, no timestamps, durations, logs, absolute paths or host names. Two runs
over the same tree write identical bytes. Records are split into one file per area, a side's first two folders
(`lint/be/modules/billing.jsonl`, `check/fe/apps/web.jsonl`; files of the app root in `root.jsonl`), so a change
rewrites the files of the areas it touched. Results are sparse: a clean file is a record with its hash and no finding.
Findings are sorted (line, column, rule, message) and their messages carry app-relative posix paths only.

The managed `.gitattributes` marks the folder `text eol=lf merge=union linguist-generated=true`. Because every record
is self-contained and keyed, a union merge of two branches never conflicts and never yields a wrong answer: the reader
takes, per key, the record whose hash matches the tree, drops the rest, and the next write leaves one record per key. A
union-merged `fingerprint.jsonl` holding two digests for one part is a mismatch, so the next run is full.

Hashes are sha256 of the bytes with CRLF normalised to LF for text files (no NUL in the first 8000 bytes, git's own
test), so a Windows checkout and a Linux CI runner hash one commit alike. The cache folder itself is outside the
content index and outside every step's file set.

## The fingerprint

A part is anything a step reads that is not an app source; any part that differs makes the whole run full, for check,
lint and coverage alike, since the three share one fingerprint. Parts are portable (equal on every host for one commit):

- the cache format version and the CLI version;
- the `@starci/hfs` that runs, which carries the slot manifest, the failure codes and the pins;
- every installed `@starci/*` package, by its version and the integrity the install recorded;
- `package-lock.json` (ESLint, typescript-eslint, TypeScript, Prettier, stylelint, Jest and their transforms, every type
  package);
- by normalised content: `hfs.json`, every `package.json` and `tsconfig*.json`, each side's `eslint.config.mjs`,
  `stylelint.config.mjs` and jest configuration, the Prettier configuration files, `.prettierignore`, `.editorconfig`,
  `.gitignore`, `.gitattributes`, `turbo.json`, `sonar-project.properties`, `codecov.yml`;
- the quality profile of the policy the CLI runs under.

A run whose CLI or any `@starci` package is linked or copied from a local folder (no recorded integrity) has no
portable fingerprint: it runs in full, says so, and writes nothing into `.starcistacks/cache/`, so a developer testing a
local package never commits a cache CI cannot match. The Node version and the platform are not parts: the tools are
pinned by the lockfile, and a step whose result differs by platform is a defect the CI verification below exposes.

## Trust

A record is only reused when its key matches the tree now: every run hashes every file again, and a file whose hash
differs from its record is judged for real. That alone does not stop a forged record, one whose hash is right and whose
findings were deleted by hand, so where the cache is trusted from depends on who runs:

- **On a host** the cache in the working tree is trusted. A local run is the developer's own view; it updates the
  folder and the developer commits it with the change.
- **In CI** the cache is trusted only as it stands at the trusted base: the merge-base with the default branch for a pull
  request, the first parent for a push to the default branch, read with `git show <base>:<path>` (the managed workflow
  fetches it). The change's own edits to the cache are never trusted: CI judges everything the base cache does not
  cover, then compares the change's committed cache with what it inherited or computed. A record whose key matches the
  tree and whose findings differ is `HFS_CHECK_CACHE_FORGED`, a hard blocker at any count, whether the record was edited
  by hand or a step is not deterministic across hosts. A key the change touched with no current record is
  `HFS_CHECK_CACHE_STALE`. No trusted base (a tag build, a schedule, an unreadable base) is a full run.

A pull request that edits cache files directly therefore gains nothing: its records are never read in CI, a forged one
turns CI red, and a deleted or stale one costs only time. The default branch only receives a cache that a pull
request's CI compared record by record; a direct push to it is verified by its own CI run against its first parent, and
the release run is full, so a cache that bypassed review is caught before it ships.

## Which step reuses what

The content index diffs the tree against the trusted cache: modified, added, deleted; a rename is a deletion and an
addition, and deleted paths drop every record they own.

| step | class | reused when | re-run on |
|---|---|---|---|
| tracked files, content index, fingerprint, trust | always | never | every run; they decide the rest |
| managed files against their render | always | never | every run: cheap, and its inputs are the templates and the managed files |
| slot, tree, pin, secret and content rules of the app pass, root and sides | always | never | every run: they read untracked entries and git state the index does not hold; the boot proof, the costly part, is lifted out as its own scoped step below, and any rule measured above a few seconds follows it |
| Prettier (`HFS_FORMAT`) | per file | the path's hash is unchanged | changed and added paths |
| database rules (`DB_*`) | scoped | every `db/` hash and the merge-base the baseline rules compare with are unchanged | any `db/` change or a new merge-base |
| contract emit | scoped | the be side key is unchanged | any be change |
| boot proof of a lite back end | scoped | the be side key is unchanged | any be change; a timeout is never stored |
| architecture machine (check surface), per side | scoped | the side key is unchanged | any change in the side: the whole side |
| ESLint, per side | per file, closure-scoped | the side key is unchanged, or the file is outside the dirty set | the dirty set (ESLint below) |
| stylelint | per file | the path's hash is unchanged and no stylesheet was added or removed | changed stylesheets; every one when the stylesheet set changed |
| unit specs and coverage | per spec, closure-scoped | the spec's closure key is unchanged | specs whose closure holds a changed file (coverage below) |
| integration, e2e and contract specs | always | never | every run that runs them: they reach services, data and time a key cannot hold |
| `tsc` per workspace program (`--types`) | scoped | the program's key is unchanged | any change the program reads: that program |
| proofs, the gate verdict, the Sonar and Codecov predictions | always | never | every run |

A side key is the sha256 of everything the side's whole-program steps read: the hash of each tracked path of the side
(`absent` for one deleted in the work tree), its staged entries (the machine reads the index), and the untracked files
its TypeScript program reads (what its tsconfig includes or an import resolves to that git does not track, generated
code included). The machine and the type-aware rules read the whole program, so a scoped step re-runs the whole side:
the machine on changed owners alone (`--fast`) skips duplicate code and dead exports and is not the full result.
The `--types` family keys each workspace's program like a side: an unchanged key reuses its recorded diagnostics, a
changed one runs that program's `tsc` in full. TypeScript's `.tsbuildinfo` speeds that run but is host state, not a
result (it holds versions and signatures, not findings), so it stays in the untracked tool cache of slot
`app.tool-cache` and is never committed.

## ESLint

ESLint's own `--cache` is not used: it keys a file on its own content and the config, and three kinds of input escape
that key.

1. **Types.** A type-aware rule's result on a file depends on the files whose types it reads. The cache records each
   file's resolved local imports (TypeScript `preProcessFile` and `resolveModuleName` under the side's tsconfig: static,
   type-only and dynamic imports, re-exports, triple-slash references, JSON). The dirty set holds every changed or added
   file and every file that reaches one through imports, in the new graph and the cached one. Imports are resolved
   again for every file when a path of the side was added or removed, since a new file can change where an unchanged
   import resolves. A changed file that declares globals (a `.d.ts` with no import or export, `declare global`, a module
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
   fixtures under a file-system recorder and fails on a read neither the declaration nor the import graph covers. A
   changed path matching a `content` input dirties the files that declare it; an added or removed path dirties its
   `exists` dependants. A canon installed without the declaration makes every change in its side a whole-side lint.

The dirty set is linted in one ESLint run per side through the launcher, chunking and result validation of a full run;
every other file of the side's canon scope (enumerated afresh) takes its record, a file of the scope with no record is
dirty, and a record outside the scope is dropped. `app check` and `app lint` call the same cached ESLint and the same
cached app pass on the same records, so the two verbs never hold two answers for one tree.

## Unit coverage

`app check --test` runs the unit specs through the app's own Jest and writes the merged report the managed CI uploads. A spec's closure key is the sha256 of the spec, every module Jest resolves from it transitively (its resolver
with the project's `moduleNameMapper`, `jest.mock` targets and setup files), its snapshot file and its project's
configuration. A warm run runs the specs whose key changed, the way `jest --findRelatedTests` selects them but over the
whole closure, and keeps the records of the rest. Jest reports each spec file's own coverage map; the run records, per
spec and source, the covered lines, branches and functions (covered or not, never hit counts, so the bytes are stable),
and per source what is instrumented. The total is, per source, its instrumented items with the union of what the
current spec records cover. The per-file threshold is judged on that total by `@starci/hfs` (`--coverage-from` reads
the same report), never by Jest's partial run, whose threshold is switched off. A failed spec is never stored. The
lcov sent to Codecov and Sonar is the merged total, so their server-side numbers are those of the whole suite.

## Sonar and Codecov

Their baselines hold reference data only, never a server's result. From them and the merged coverage a run predicts,
and labels as a prediction: Sonar's new-code coverage and duplication on the lines changed since the base commit, and
Codecov's patch coverage and project change, the base total computed from the base commit's committed coverage records.
The servers stay the judges; a prediction never passes or fails a run.

## The slot, the templates and adoption

- **Slot.** `app.starcistacks.cache` (both editions): `.starcistacks/cache/`, tracked, presence optional, admitting
  `fingerprint.jsonl`, `check/**`, `lint/**`, `test-coverage/**`, `sonar-baseline/**` and `codecov-baseline/**` and
  nothing else. It is app-owned and written only by `app check` and `app lint`; `app sync` never renders,
  overwrites or judges its content, and managed-file drift does not cover it. `cache` is a reserved name that
  `.starcistacks/application-stacks.yaml` refuses as an environment.
- **Templates.** The managed `.gitignore` block re-includes `!.starcistacks/cache/**` after its `.starcistacks/**` deny;
  `.gitattributes` gains the line above; `.prettierignore` skips the folder. The managed CI workflow fetches the trusted
  base, runs `app check` and `app lint` diff-only against it, uploads the merged lcov, and passes `--full` on the run a
  release waits for (a full unit run there is sharded: `--test --full --shard <i>/<n>` per job records nothing, and the
  merge job judges the merged report with `--coverage-from`). The release gate sets `STARCI_APP_CHECK_CACHE=full` on every gate row.
- **Scaffold.** `app scaffold` writes the templates above and no cache; the app's first check builds it in full.
- **Adoption.** `app sync --execute` and `app upgrade` bring an existing app the same templates and never create,
  move or delete cache records; its first run after them is full and writes the folder, which the developer commits.

## The law

Proposed `R341`, enforcer `hfs`: an app's committed check cache is trusted in CI only as it stands at the trusted base;
a record whose key matches the tree and whose findings differ from the inherited or computed result is
`HFS_CHECK_CACHE_FORGED` (a hard blocker), a touched key without a current record is `HFS_CHECK_CACHE_STALE`, and a
missing cache is `HFS_CHECK_CACHE_MISSING`. Why: CI trusts a committed artifact only where review and CI already
judged it, so a hand edit can cost time but never pass a file. Recommended enforcement, for the owner to decide:
forged fails at any count; stale and missing warn (report-only, the run is full or wider and still correct), so a first
adoption and a forgotten refresh never block a change.

## Edge cases

- **An edit during the run.** The content index is hashed again before writing; a file whose hash changed while the run
  read it gets no record, and a scoped step or side whose inputs include it is not stored.
- **A step that throws or a linter that cannot complete** stores nothing of that step.
- **Branch switches and merges** are content changes like any edit; a union-merged folder is normalised by the next
  write.
- **A cache from another hfs or CLI** differs in the fingerprint, so it is replaced, never read.
- **A disk error writing the cache** is a warning in the cache line and never changes the exit code.

## Read with

[lint.md](lint.md) (which machine judges what and where it runs), [stacks.md](stacks.md) (the `.starcistacks/` shape),
the `app check` and `app lint` usage of `@starci/hfs`, and [policy/quality.yaml](../../policy/quality.yaml)
for the gate threshold the verdict applies.
