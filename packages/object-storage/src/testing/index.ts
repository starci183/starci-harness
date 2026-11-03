import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from "../errors.ts"
import type { ObjectStorageOptions, StorageClock } from "../options.ts"
import { admitsContentType } from "../policy.ts"
import type { ListedObject, ObjectHead, StoredObject } from "../port.ts"
import { ObjectStorageService } from "../service.ts"
import { OBJECT_STORAGE } from "../tokens.ts"
import type { S3Transport, SignRequest } from "../transport.ts"

/** A clock the test moves by hand. */
export class FakeStorageClock implements StorageClock {
    #at: number

    constructor(start: Date | number = Date.UTC(2026, 0, 1)) {
        this.#at = typeof start === "number" ? start : start.getTime()
    }

    now(): Date {
        return new Date(this.#at)
    }

    /** Moves time forward. */
    advance(milliseconds: number): void {
        this.#at += milliseconds
    }
}

interface Entry {
    bytes: Uint8Array
    contentType: string
    at: number
}

/** The origin the in-memory store signs its addresses for. */
export const FAKE_STORAGE_ORIGIN = "https://storage.test"

/** An in-memory `S3Transport`: buckets are maps, a signed address is a readable URL, a "browser" is `upload`. */
export class MemoryTransport implements S3Transport {
    readonly buckets = new Map<string, Map<string, Entry>>()
    readonly publicBuckets = new Set<string>()
    /** Every address signed, in order. */
    readonly signed: SignRequest[] = []
    /** When set, every call rejects with UNAVAILABLE, as a store that is down does. */
    down = false
    destroyed = false
    readonly #clock: StorageClock

    constructor(clock: StorageClock) {
        this.#clock = clock
    }

    put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        return this.#run(() => {
            this.#bucket(bucket).set(key, { bytes: body.slice(), contentType, at: this.#clock.now().getTime() })
        })
    }

    get(bucket: string, key: string): Promise<StoredObject | null> {
        return this.#run(() => {
            const found = this.buckets.get(bucket)?.get(key)
            return found === undefined ? null : { bytes: found.bytes.slice(), contentType: found.contentType }
        })
    }

    head(bucket: string, key: string): Promise<ObjectHead | null> {
        return this.#run(() => {
            const found = this.buckets.get(bucket)?.get(key)
            return found === undefined
                ? null
                : { size: found.bytes.byteLength, contentType: found.contentType, lastModified: new Date(found.at).toISOString(), etag: `"${String(found.bytes.byteLength)}"` }
        })
    }

    removeMany(bucket: string, keys: readonly string[]): Promise<number> {
        return this.#run(() => {
            const objects = this.buckets.get(bucket)
            return keys.filter((key) => objects?.delete(key) === true).length
        })
    }

    list(bucket: string, prefix: string): Promise<readonly ListedObject[]> {
        return this.#run(() =>
            [...(this.buckets.get(bucket) ?? [])]
                .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
                .map(([key, entry]) => ({ name: key.slice(prefix.length), lastModified: new Date(entry.at).toISOString() })),
        )
    }

    sign(request: SignRequest): Promise<string> {
        return this.#run(() => {
            this.signed.push(request)
            const url = new URL(`${FAKE_STORAGE_ORIGIN}/${request.bucket}/${request.key.split("/").map(encodeURIComponent).join("/")}`)
            url.searchParams.set("X-Test-Method", request.method)
            url.searchParams.set("X-Test-Expires", String(request.expiresIn))
            url.searchParams.set("X-Test-Date", request.signingDate.toISOString())
            if (request.contentType !== undefined) url.searchParams.set("X-Test-Content-Type", request.contentType)
            if (request.contentLength !== undefined) url.searchParams.set("X-Test-Content-Length", String(request.contentLength))
            return url.toString()
        })
    }

    ensureBucket(bucket: string, publicRead: boolean): Promise<void> {
        return this.#run(() => {
            this.#bucket(bucket)
            if (publicRead) this.publicBuckets.add(bucket)
        })
    }

    destroy(): void {
        this.destroyed = true
    }

    #bucket(name: string): Map<string, Entry> {
        const existing = this.buckets.get(name)
        if (existing !== undefined) return existing
        const created = new Map<string, Entry>()
        this.buckets.set(name, created)
        return created
    }

    #run<T>(work: () => T): Promise<T> {
        if (this.down) return Promise.reject(new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.Unavailable, { context: { operation: "fake" } }))
        return Promise.resolve(work())
    }
}

/** The options a spec registers with: a fixed clock, a dummy endpoint and no limit. */
export const testObjectStorageOptions = (overrides: Partial<ObjectStorageOptions> = {}): ObjectStorageOptions => ({
    endpoint: FAKE_STORAGE_ORIGIN,
    region: "us-east-1",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    clock: new FakeStorageClock(),
    ...overrides,
})

/** The real service (names, expiry, limits, errors) over an in-memory store. */
export interface MemoryObjectStorage extends ObjectStorageService {
    /** The store behind the service: inspect `buckets` and `signed`, or set `down`. */
    readonly store: MemoryTransport
    /** Seeds an object as if it had been uploaded. */
    seed(bucket: string, key: string, body: Uint8Array | string, contentType: string): void
    /**
     * What the browser does with a presigned PUT: the store accepts the body only when the content type and the size match what
     * was signed. Answers the HTTP status the store would (200, or 403 when a signed header does not match).
     */
    upload(presignedUrl: string, body: Uint8Array, contentType: string): Promise<200 | 403>
}

/** Builds the port over memory with the same checks the real one makes; nothing leaves the process. */
export const createMemoryObjectStorage = (overrides: Partial<ObjectStorageOptions> = {}): MemoryObjectStorage => {
    const options = testObjectStorageOptions(overrides)
    const store = new MemoryTransport(options.clock ?? new FakeStorageClock())
    const service = new ObjectStorageService(store, options)
    const seed = (bucket: string, key: string, body: Uint8Array | string, contentType: string): void => {
        void store.put(bucket, key, typeof body === "string" ? new TextEncoder().encode(body) : body, contentType)
    }
    const upload = async (presignedUrl: string, body: Uint8Array, contentType: string): Promise<200 | 403> => {
        const url = new URL(presignedUrl)
        const [bucket = "", ...rest] = url.pathname.slice(1).split("/")
        const wantedType = url.searchParams.get("X-Test-Content-Type")
        const wantedLength = url.searchParams.get("X-Test-Content-Length")
        const signedAt = Date.parse(url.searchParams.get("X-Test-Date") ?? "")
        const expired = (options.clock ?? new FakeStorageClock()).now().getTime() > signedAt + Number(url.searchParams.get("X-Test-Expires")) * 1000
        const mismatch =
            expired ||
            (wantedType !== null && !admitsContentType([wantedType], contentType)) ||
            (wantedLength !== null && Number(wantedLength) !== body.byteLength)
        if (mismatch) return 403
        await store.put(bucket, rest.map(decodeURIComponent).join("/"), body, contentType)
        return 200
    }
    return Object.assign(service, { store, seed, upload })
}

/** A Nest module that provides the in-memory port under `OBJECT_STORAGE`, for a spec that composes real modules. */
export const objectStorageTestingModule = (storage: MemoryObjectStorage = createMemoryObjectStorage()): DynamicModule => {
    class ObjectStorageTestingModule {
        readonly storage = storage
    }
    Module({})(ObjectStorageTestingModule)
    return { module: ObjectStorageTestingModule, global: true, providers: [{ provide: OBJECT_STORAGE, useValue: storage }], exports: [OBJECT_STORAGE] }
}
