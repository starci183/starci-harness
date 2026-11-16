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
| `@starci/seed/postgres` | `postgresStore` (the whole relational database as deterministic per-table rows behind `StoreAdapter`; the app hands a `PostgresRunner` and no SQL), see below |
| `@starci/seed/git` | `createGitDriver` (the `git` driver over a local working copy), `pinRepository` (a copy repository at one pinned commit, read in place) and `openReviewTree` (writes and seals into a tree a person reviews), for a kind a project defines on top of the standard; `renderStandard` and `runStandardAdapter`, the adapter of a standard that keeps its authored material in `raw/` (below) |

## The git driver's layout

`manifest.json` (schema `starci/data-manifest@1`: the sets with counts and digests, the file index, the shard widths, the sealing and its public recipients; no value), record shards `data/<store>/<set>/<shard>.json` (hash-prefix shards, the width only grows), object chunks `blobs/<store>/<set>/<aa>/<id>[.<n>].bin` and `index/<store>/<set>.json`. `.gitattributes` holds `* -text` so line endings never touch a file. A file whose plaintext did not change is never rewritten, and an unchanged export commits nothing.

## The adapter of a standard

A standard whose content is awkward as JSON records keeps what people author in `raw/` and an `adapter/` (PROJECT-STACKS-13, R434). `adapter/convert.ts` exports `convert(rawDir)`, answering `{format, project, entries}` (each entry `{store, entry}` from `recordEntry` or `blobEntry`); `adapter/main.ts` is `process.exitCode = await runStandardAdapter(convert, process.argv.slice(2))`. `renderStandard` writes the entries through `createGitDriver` into a scratch working copy and replaces `manifest.json`, `data/`, `blobs/` and `index/` of the output folder, nothing else. Its output is deterministic: sets and keys sorted, canonical JSON, `takenAt` fixed at `STANDARD_TAKEN_AT` and `source.environment` at `STANDARD_ENVIRONMENT`; the adapter brings no clock or random id. The copy repository's hook and CI re-run it and refuse a committed output that differs (`HFS_DATA_ADAPTER_DRIFT`); `starci data standard init --adapter` scaffolds it.

## Sealing by purpose

The purpose decides: a `seed-standard` is plaintext (readable for review), a `seed-backup` is sealed with sops in binary mode to the age recipients of its environment, every file as `*.sops.json`. `verify` checks the manifest, the sealing policy, stray, missing and unsealed files, envelopes, the cap and, with an identity (or for a plaintext copy), every digest.

## Size limits

No file exceeds 4 MiB (`GIT_SHARD_BYTES`). The whole snapshot (the data files of the working tree, history not counted) is at most 500 MiB (`GIT_CAP_BYTES`) and warned past 400 MiB (`GIT_WARN_BYTES`): past the cap the driver refuses `DATA_GIT_CAP_EXCEEDED`, a configuration refusal that means the set needs the `s3` driver.

## The postgres store

`postgresStore({ id, run, schemas?, exclude?, pageRows? })` (`@starci/seed/postgres`, kind `database`, level `physical`, purpose `seed-backup` only) copies the whole relational database behind the same `StoreAdapter` port. The app hands one thing, a `PostgresRunner` (`query` with positional parameters, `transaction` with an isolation level); it writes no SQL. The schema comes from the app's migrations: the copy holds DATA only.

**The decision, and why.** A per-table row export through SQL owned by THIS package, not an opaque `pg_dump` archive (a dump file changes bytes on every run and is one blob, so an unchanged database would still be a changed copy and nothing could be skipped, sharded or compared per table), and not the app's entity layer (it covers only the entities the app models and runs under the app role, which row level security and grants restrict, so it would silently miss data). The SQL is built from the catalog with quoted identifiers only; a value never enters a statement's text.

- **Sets.** One per ordinary or partitioned-parent table (`relkind r|p`, never a partition), named `<schema>.<table>`, schema id `postgres/<schema>.<table>@1`, form record. A row is the JSON object of its non-generated columns, every value as text or null, the entry key the primary key (one column: its text; several: a JSON array text).
- **Deterministic.** The export is one REPEATABLE READ transaction (one snapshot of every table) under fixed session settings (UTC, ISO dates and intervals, hex bytea, shortest floats), keyset-paged. Order is the UTF-8 byte order of the key **in SQL** (`ORDER BY convert_to(<key>, 'UTF8')`), not the database collation, so memory stays flat (one page plus one prefetched); a page is re-sorted in the store too. The price: a page cannot use the primary key index, so the cost is rows x pages, fine at the size a git copy may hold. An unchanged database yields the same entries, the same digests, and so the git driver commits nothing.
- **Values.** Every column is cast to text on the way out and back to its own type (`format_type`) on the way in, so a number never passes through a JS number and a timestamp never depends on a session zone. Proven against PostgreSQL 17 in the real spec: numeric(40,10), bigint extremes, double precision (NaN, 1e300), date and timestamptz (also infinity), interval, bytea, json (its spacing kept), jsonb (exact text), arrays with quotes and NULL, enums, text with quotes, backslashes and newlines, composite primary keys, partitioned tables, identity and serial columns, generated columns (not held, recomputed). Not proven: `money` (its text follows `lc_monetary`, set to C for the transaction), user-defined base types, `char(n)` (its trailing blanks are not kept by the text cast, equal under comparison).
- **Import.** One READ COMMITTED transaction for the whole import with `SET LOCAL session_replication_role = replica` (foreign keys and triggers stay quiet so the copy is consistent as a whole, which **needs the owner role**: a role without it fails `DATA_STORE_FAILED` with SQLSTATE 42501 and nothing is written). Each entry is an upsert by primary key (`INSERT ... SELECT ... FROM json_to_record(...) ON CONFLICT (pk) DO UPDATE`); the stored row is compared first, so `unchanged` writes nothing and an update keeps the row. `mirror` deletes the keys of the sets the entries name that the entries lack (a table with no entry at all is not touched: restore into a freshly migrated database). Sequences owned by a column of an imported table are set to the column maximum (left alone for an empty table). A dry run does every write, counts it, and rolls back (so it moves no sequence: `setval` is not transactional and is skipped). A row whose columns are not exactly the table's non-generated columns (a migration since the copy) is a refused key `DATA_ROW_INVALID`; a set of an excluded or unknown table is `DATA_TABLE_NOT_HELD`; neither throws. `identityOf(set, key)` is the key itself when the row exists (the primary key is the identity).
- **Cannot.** `describe().cannot` lists every excluded table with its reason and every table without a primary key (it cannot keep identity, so it is neither exported nor imported), and a table whose primary key holds a generated column or whose name a set name cannot carry. A GENERATED ALWAYS identity column that is not the primary key cannot be updated in place: PostgreSQL refuses and the refusal surfaces as `DATA_STORE_FAILED`.
- **Exclusions are the app's declaration.** Queues, caches, vectors, finished checkpoints and raw data past retention are rebuildable: the app lists each in `exclude: [{ table: "<schema>.<table>", reason }]` with its reason, which `describe().cannot` shows.
- **Failures.** Every SQL failure is `DataRefusal("DATA_STORE_FAILED", "configuration", { store, table, cause })`, the cause the SQLSTATE or the error class, never the message (it may quote a value).

## Tools

The postgres store needs no tool; its real spec needs a PostgreSQL (`STARCI_SEED_PG_URL` of a throwaway server, else Docker with the harness-pinned `postgres` image, else it skips with the reason) and the dev-only `pg` client. The git driver runs `git`, `sops` and `age` (`age-keygen` in the specs); all three must be on `PATH`, for the driver and for the package's real-tool specs, which generate a throwaway age key inside the test and never read a real secret.

## Tests

`npm test` typechecks, lints and runs `src/**/*.spec.ts` with Node's runner, and fails under 100% line, branch and function coverage.
