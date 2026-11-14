# @starci/seed

The data standard of a StarCi project: what an app or a harness job needs to keep a project's data in more than one place, with no knowledge of any database or S3 client. ESM only; its one dependency is `@starci/common` (`DomainError`, pinned exactly).

## Why the name

In the owner's standard everything this package does is one of the two kinds of seed: `seed-standard` (loaded once by the bring-up) and `seed-backup` (written by the scheduled job, brought back by a sync); sync is only one verb of the backup kind.

The law is [contexts/project/stacks.md](../../contexts/project/stacks.md), PROJECT-STACKS-13 (what a copy holds, the two purposes, sealing, the size limits) and PROJECT-STACKS-14 (every store has an adapter, every copy goes through a driver).

## Entries

| entry | holds |
|---|---|
| `@starci/seed` | the ports and the copy contract: `StoreAdapter` (a thing that must be kept: a database or a storage bucket; describes its sets, exports entries in (set, key) byte order, imports them by natural key keeping each row's identity, `merge` or `mirror`, dry run, `identityOf`), `DriverAdapter` (where a copy is kept: git now, s3 later; plans, writes, lists, reads, verifies, refuses with the coded `DataRefusal`), `DataManifest` with `ManifestBuilder`, `exportOnce`, `writeEverywhere` (each driver an isolated leg), `compareCopies`, `chooseCopy`, `restoreFrom`, and the line protocol `starci/data-entries@1` (`serveStore`, `commandStore`) that carries a store through an app's own command |
| `@starci/seed/testing` | `memoryStore`, `memoryDriver` (with failure and corruption switches), `memorySpool`, and the contract suites `storeContract` and `driverContract`: a real adapter runs them against its fakes (each case throws when a promise is broken, in any test runner) |
| `@starci/seed/git` | `createGitDriver` (the `git` driver over a local working copy), `pinRepository` (a copy repository at one pinned commit, read in place) and `openReviewTree` (writes and seals into a tree a person reviews), for a kind a project defines on top of the standard |

## The git driver's layout

`manifest.json` (schema `starci/data-manifest@1`: the sets with counts and digests, the file index, the shard widths, the sealing and its public recipients; no value), record shards `data/<store>/<set>/<shard>.json` (hash-prefix shards, the width only grows), object chunks `blobs/<store>/<set>/<aa>/<id>[.<n>].bin` and `index/<store>/<set>.json`. `.gitattributes` holds `* -text` so line endings never touch a file. A file whose plaintext did not change is never rewritten, and an unchanged export commits nothing.

## Sealing by purpose

The purpose decides: a `seed-standard` is plaintext (readable for review), a `seed-backup` is sealed with sops in binary mode to the age recipients of its environment, every file as `*.sops.json`. `verify` checks the manifest, the sealing policy, stray, missing and unsealed files, envelopes, the cap and, with an identity (or for a plaintext copy), every digest.

## Size limits

No file exceeds 4 MiB (`GIT_SHARD_BYTES`). The whole snapshot (the data files of the working tree, history not counted) is at most 500 MiB (`GIT_CAP_BYTES`) and warned past 400 MiB (`GIT_WARN_BYTES`): past the cap the driver refuses `DATA_GIT_CAP_EXCEEDED`, a configuration refusal that means the set needs the `s3` driver.

## Tools

The git driver runs `git`, `sops` and `age` (`age-keygen` in the specs); all three must be on `PATH`, for the driver and for the package's real-tool specs, which generate a throwaway age key inside the test and never read a real secret.

## Tests

`npm test` typechecks, lints and runs `src/**/*.spec.ts` with Node's runner, and fails under 100% line, branch and function coverage.
