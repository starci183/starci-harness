/**
 * The closed vocabulary of the data standard (PROJECT-STACKS-14). A new store kind or driver is a harness change: this
 * file, the rule that lists it (R426, R427) and the stack manifest's parser move together, never an app's choice.
 */

/** What must be kept: the relational database, or the object store (its buckets and their binaries). */
export type StoreKind = "database" | "storage"

/** Where a copy is kept: a sealed git repository now, an S3 bucket when the project outgrows git. */
export type DriverKind = "git" | "s3"

/**
 * The two kinds of seed, which differ only in who writes them and when they are read:
 * `seed-standard`: curated by people, pinned by commit, loaded by default when an environment or workspace is created;
 * `seed-backup`: written only by the scheduled backup job, read back only by an explicit `sync`, never loaded by default.
 */
export type DataPurpose = "seed-standard" | "seed-backup"

/**
 * `logical`: records by natural key, read and written through the app's own doors (portable, idempotent, partial).
 * `physical`: the engine's own dump; restored whole only, and only from a `seed-backup`.
 */
export type StoreLevel = "logical" | "physical"

/** `record`: one canonical JSON object. `blob`: opaque bytes (a stored file, a part of a dump). */
export type EntryForm = "record" | "blob"

/** The store kinds, in the order the manifest lists them. */
export const STORE_KINDS: readonly StoreKind[] = Object.freeze(["database", "storage"])

/** The drivers, in the order the manifest lists them. */
export const DRIVER_KINDS: readonly DriverKind[] = Object.freeze(["git", "s3"])

/** The purposes. */
export const DATA_PURPOSES: readonly DataPurpose[] = Object.freeze(["seed-standard", "seed-backup"])

/** The whole sealed snapshot one git copy may hold: 100 MiB, history not counted. */
export const GIT_CAP_BYTES = 104_857_600

/** The size at which a git copy warns that it nears its cap: 80 MiB. */
export const GIT_WARN_BYTES = 83_886_080

/** The largest sealed shard or blob chunk the git driver writes: 4 MiB. */
export const GIT_SHARD_BYTES = 4_194_304
