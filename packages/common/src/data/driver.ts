import { DomainError } from "../error.ts"
import type { ErrorParams } from "../error.ts"
import type { DataEntry, DataManifest, DataSetSummary, Selection } from "./manifest.ts"
import type { DriverKind, EntryForm } from "./words.ts"

/** What a driver can hold, measured on the SEALED bytes it writes. */
export interface DriverLimits {
    /** The entry forms it holds. */
    readonly forms: readonly EntryForm[]
    /** The largest file or object it writes, or null for no limit. */
    readonly maxFileBytes: number | null
    /** The largest whole copy it keeps, or null (git: 500 MiB of the snapshot, history not counted). */
    readonly maxCopyBytes: number | null
    /** The size at which a write warns that the copy nears `maxCopyBytes`, or null. */
    readonly warnCopyBytes: number | null
}

/** A set a driver leaves out of a copy, and why. */
export interface OmittedSet {
    /** The store. */
    readonly store: string
    /** The set. */
    readonly set: string
    /** Why it is left out. */
    readonly reason: string
}

/** What a driver holds of an export. A subset names every set it leaves out and why; never silent. */
export interface Holding {
    /** The export it is a copy of. */
    readonly exportDigest: string
    /** `all`, or `subset` when `omitted` is not empty. */
    readonly holds: "all" | "subset"
    /** The sets it holds. */
    readonly sets: readonly DataSetSummary[]
    /** The sets it leaves out. */
    readonly omitted: readonly OmittedSet[]
}

/** Where one copy is: a commit of a git copy, an object version prefix of s3. */
export interface CopyRef {
    /** The driver id the stack manifest declares. */
    readonly driver: string
    /** Its kind. */
    readonly kind: DriverKind
    /** The commit, or the object prefix and version. */
    readonly locator: string
    /** The export it holds. */
    readonly exportDigest: string
    /** When the export was taken. */
    readonly takenAt: string
}

/** The public age recipients a write seals to: the target environment's rule of `.sops.yaml` (PROJECT-STACKS-5). */
export interface WriteContext {
    /** Public age recipients, never an identity. */
    readonly recipients: readonly string[]
    /** Plan and measure, write nothing. */
    readonly dryRun: boolean
}

/**
 * The identity a read or a full verify opens copies with, as a handle the harness resolved through its one lookup
 * (PROJECT-STACKS-5). The key itself never travels through a port: the driver passes the handle to the sealing tool.
 */
export interface OpenContext {
    /** An opaque handle; a driver that opens nothing ignores it. */
    readonly identity: { readonly kind: "age-identity"; readonly env: Readonly<Record<string, string>> }
}

/** One export, readable more than once: what every driver writes from, and what a read gives back. */
export interface ExportSource {
    /** Its manifest. */
    readonly manifest: DataManifest
    /** Its entries in (store, set, key) order, narrowed by `selection`; each comes with the store it was read from. */
    entries(selection?: Selection): AsyncIterable<{ readonly store: string; readonly entry: DataEntry }>
}

/** A driver's receipt of one write. */
export interface CopyReceipt {
    /** The schema of this record. */
    readonly schema: "starci/data-copy@1"
    /** Where the copy is. */
    readonly ref: CopyRef
    /** What it holds. */
    readonly holding: Holding
    /** The sealed bytes of the whole copy after the write. */
    readonly bytes: number
    /** Files or objects the write changed; 0 when the export was already held. */
    readonly changed: number
    /** Warnings the write raised (a copy near its cap), by code. */
    readonly warnings: readonly string[]
    /** When it was written. */
    readonly at: string
}

/** One named check of a verify. */
export interface VerifyCheck {
    /** e.g. `sealed`, `manifest`, `counts`, `digests`, `cap`. */
    readonly name: string
    /** Whether it passed. */
    readonly ok: boolean
    /** What it found; never a value. */
    readonly detail: string
}

/** A driver's verdict on one copy. */
export interface CopyVerdict {
    /** The copy. */
    readonly ref: CopyRef
    /** True when every check passed. */
    readonly healthy: boolean
    /** The checks, in the order they ran. */
    readonly checks: readonly VerifyCheck[]
    /** The manifest the copy carries, when it could be read. */
    readonly manifest: DataManifest | null
}

/** The codes a data copy is refused with. */
export type DataRefusalCode =
    | "DATA_GIT_CAP_EXCEEDED"
    | "DATA_FORM_REFUSED"
    | "DATA_COPY_MISSING"
    | "DATA_COPY_CORRUPT"
    | "DATA_SEAL_FAILED"
    | "DATA_DRIVER_UNAVAILABLE"
    | "DATA_STORE_FAILED"

/**
 * A refusal with a retry class: `configuration` is never retried (one item for a person: e.g. a copy that outgrew git
 * and needs s3), `transient` is retried on the job's ladder (a network or remote failure).
 */
export class DataRefusal extends DomainError<DataRefusalCode> {
    /** Whether a retry can help. */
    readonly retry: "configuration" | "transient"

    constructor(code: DataRefusalCode, retry: "configuration" | "transient", params?: ErrorParams, cause?: unknown) {
        super({ code, params, cause })
        this.retry = retry
    }
}

/** Where a copy is kept: one per declared driver of `application-stacks.yaml` `data.drivers`. */
export interface DriverAdapter {
    /** The driver id the stack manifest declares. */
    readonly id: string
    /** Its kind, from the closed list. */
    readonly kind: DriverKind
    /** What it can hold. */
    limits(): DriverLimits
    /** Pure: what this driver will hold of the export. */
    plan(manifest: DataManifest): Holding
    /** Writes the export; an export already held changes nothing. Refuses with a DataRefusal. */
    write(source: ExportSource, context: WriteContext): Promise<CopyReceipt>
    /** Every copy it keeps, newest first. */
    list(): Promise<readonly CopyRef[]>
    /** Opens one copy. */
    read(ref: CopyRef, context: OpenContext): Promise<ExportSource>
    /** Without an identity: structure, sealing, counts and cap only (what a commit hook proves); with one, every digest too. */
    verify(ref: CopyRef, context: OpenContext | null): Promise<CopyVerdict>
}

/** The holding of `manifest` by a driver that holds only `forms`: every set of another form is named as omitted. */
export function holdingFor(manifest: DataManifest, forms: readonly EntryForm[]): Holding {
    const sets = manifest.sets.filter((set) => forms.includes(set.form))
    const omitted = manifest.sets
        .filter((set) => !forms.includes(set.form))
        .map((set): OmittedSet => ({ store: set.store, set: set.set, reason: `the driver holds no ${set.form} entries` }))
    return { exportDigest: manifest.exportDigest, holds: omitted.length === 0 ? "all" : "subset", sets, omitted }
}
