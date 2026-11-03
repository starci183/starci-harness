import type { ListedObject, ObjectHead, StoredObject } from "./port.ts"

/** What a transport is asked to sign. */
export interface SignRequest {
    readonly method: "GET" | "PUT"
    readonly bucket: string
    readonly key: string
    readonly contentType?: string
    readonly contentLength?: number
    readonly downloadName?: string
    readonly expiresIn: number
    readonly signingDate: Date
}

/**
 * The S3 operations the service is built from, on validated names. The AWS SDK implements it in one file; the in-memory
 * double of `@starci/object-storage/testing` implements it for specs. A missing object answers null; every other failure
 * rejects with an `ObjectStorageError` (UNAVAILABLE).
 */
export interface S3Transport {
    put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void>
    get(bucket: string, key: string): Promise<StoredObject | null>
    head(bucket: string, key: string): Promise<ObjectHead | null>
    removeMany(bucket: string, keys: readonly string[]): Promise<number>
    /** The files directly under `prefix` (empty or ending in `/`), in any order. */
    list(bucket: string, prefix: string): Promise<readonly ListedObject[]>
    sign(request: SignRequest): Promise<string>
    ensureBucket(bucket: string, publicRead: boolean): Promise<void>
    destroy(): void
}
