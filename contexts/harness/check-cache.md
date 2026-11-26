# The committed check cache of the harness

The harness repository commits the verdicts of its own per-package checks in `.cache/`, keyed by content, the way an app commits its results in
`.starcistacks/cache/` ([project/check-cache.md](../project/check-cache.md)). The harness gate (`starci check`, both levels; `starci release gate` is its deprecated spelling), the lane gate that runs
it, and CI's plan reuse a green verdict whose key the tree computes now, and run everything else. Its one rule is the app cache's: a reused verdict is the
one a real run would produce now, and whenever the cache cannot prove that, the step runs. The code is `cli/src/core/release/check-cache.ts`; the record
writer, parser and hash combiner are `@starci/hfs`'s own (`packages/hfs/cache/jsonl.mts`, `hash.mts`), so both caches share one format. The slot is
`cache.check` of [hfs/harness.yaml](../hfs/harness.yaml).

## Layout and format

`.cache/check/<step>/<node slug>.jsonl`: one file per CI node and step, holding the green record of the last real run, one canonical JSON line in the app
record shape. A node is a CI node of `release affected`: a package folder (`packages/hfs` is `packages-hfs.jsonl`), `cli` or `app`. The steps are exactly
the per-node steps the harness gate and CI's `package (...)` job run:

| step folder | the gate step (core/release/gate.ts) | CI |
|---|---|---|
| `build` | `npm run build` | the package job's install and build |
| `declarations` | a built declaration names `.js` only | "Declarations name .js" |
| `types` | `npm run typecheck` | the harness job's typecheck |
| `bundles` | `npm run bundles:check` | "Bundle copies match the hfs build" |
| `lint` | `npm run lint` (the full level) | the harness job's lint (main) |
| `test` | `npm test`; the CLI's `node --test` over its build (the full level) | "Test" of the package job |

```json
{"data":{"parts":{"format":"harness-check@1","reads":"…","source":"…","steps":"1","tool":"node24 npm11"},"verdict":"green"},"findings":[],"hash":"…","path":"packages/hfs","step":"test"}
```

Only green verdicts are written: a red step writes nothing and runs again next time. The install and the light gates of the full level (anatomy,
loosening, secrets, shape, pins, heavy sites, anchors, search index) keep no record: an install is preparation, and a light gate judges the whole tree.
`.gitattributes` marks `.cache/**` `merge=union`: two lanes that rewrote one file merge to two lines, the reader takes the one its key matches, and the
next write leaves one.

## The key

The key of a node's step is `combineHashes` over its parts, the node and the step:

- **source**: the tracked tree of the node and of every node in its closure, each file by git's blob id (the bytes a commit carries, alike on every host
  whatever its line endings; a file the work tree changed or git does not track yet by the id `git hash-object` gives it). The closure is every sibling
  the node can read, transitively and through cycles: what it requires, installs by `file:`, reads by relative path (`release affected`'s needs), or
  names by repository path. Files under `node_modules`, `dist` or `.cache` never join a key. Each node's lockfile lies in its own folder, so its slice of
  the pins and the version of every tool a step runs are in its source.
- **reads**: the tracked trees outside `packages/` the closure reads: a top-level entry a node's own files name by a path that climbs to the root
  (`../../../ops/vps/recipients.yaml` in an hfs spec), and for the CLI every tree its verbs and tests open from the root (`CLI_READS` of
  `core/release/affected.ts`: contexts, ops, policy, skills, `.github` and the root documents).
- **tool**: the Node and npm majors the step runs on.
- **steps**: `STEPS_VERSION` of `check-cache.ts`, bumped in the change that alters what a cached step runs or how its verdict is read, so every record
  misses once. **format**: the record format.

A change to a package therefore reruns its steps and those of every node whose closure holds it, and keeps every other record.

## Who reuses what

- **The lane gate.** `starci lane gate` of a harness lane runs `starci check --level dev`, which trusts the work tree's records, as an app's host run
  does: a step with a green record under its key reports `reused`, and the installs and builds no running step needs are skipped with it, so a lane that
  touched one leaf package runs that package's steps alone. With `--push` a green gate commits the records it wrote (`chore(cache): harness check records
  (lane gate)`, `commitCacheRecords` of `cli/src/harness/lane-generated.ts`) before it pushes, so the lane lands its records with its code. A lane never
  edits a record by hand; `trackedWorkChanges` and the landing's cleanup count `.cache/` as records, never work.
- **The full gate.** `starci check --release` (`--level full`) trusts the committed records only while the newest finished `cache-verify.yml` run of `main`, or of the
  gated sha, is green or none has run; a red or unreadable verify runs every step, and the report's `cache:` line says why. `--fresh` ignores the cache
  at either level and rewrites the records.
- **A hotfix** (`starci hotfix land`) runs no gate ([authority/lanes.md](../authority/lanes.md) "Hotfix"), so it neither reuses nor writes a record: its
  change is a miss the next gate or CI runs, never a wrong verdict, since every key is content.
- **GitHub CI.** On the FAST level (a push of `dev`, a pull request into it) the plan job runs `release affected --cache-base <base>`, the base the run
  is measured from: a package whose every job step has a green record **at that base** under the key this commit computes gets `cached: "true"`, and its
  `package (...)` job runs no step. The commit's own records are a claim no CI has judged, so they are never reused there; they are checked, and a forged
  one fails the plan. The reuse pays where the plan widens beyond the diff (a change under `.github/`, a workflow change, a base that cannot be read):
  every package whose source is unchanged since a gate wrote its record is reused. The FULL level (`main`) runs every package job, since that job packs
  the tarball publish.yml ships.

## Forged records

`HARNESS_CHECK_CACHE_FORGED` is an error finding wherever a record is read (the gate, CI's plan, the nightly verify), and a forged record is never
reused:

- a line that is no record, a record whose node or step is not that of its file, one that is not green or carries a finding, or one whose hash its
  own parts do not make (an edit by hand);
- a record that says green under the key the tree computes while its step, run for real (`--fresh`, the nightly verify), ran red: it is removed.

## The nightly verify

`.github/workflows/cache-verify.yml` runs every night on the default branch and on `workflow_dispatch` on any branch: the full gate without the cache
(`starci check --release --fresh`). Every verdict is recomputed, a contradicted or edited record turns the run red, and the records the run writes that
the commit lacks are listed, never a failure (a hotfix lands without records). Its newest finished run is what the full gate's trust reads.
