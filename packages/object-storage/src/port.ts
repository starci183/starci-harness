import type { UploadLimits } from "./options.ts"

/** What a browser or worker needs to call a presigned address. */
export interface PresignedRequest {
    /** The HTTP method the address is signed for. */
    readonly method: "GET" | "PUT"
    /** The presigned address, signed for the public origin. */
    readonly url: string
    /** The headers the caller must send unchanged (a PUT carries the signed `Content-Type`, and `Content-Length` when one was signed). */
    readonly headers: Readonly<Record<string, string>>
    /** How long the address works, in seconds. */
    readonly expiresIn: number
    /** The instant it stops working, ISO-8601. */
    readonly expiresAt: string
}

/** What `presignPut` is asked for. */
export interface PresignPutRequest {
    /** The content type the upload must carry; it is part of the signature. */
    readonly contentType: string
    /** The exact size in bytes; it is part of the signature, so an upload of another size is refused by the store. Required while a size limit is in force. */
    readonly contentLength?: number
    /** The lifetime in seconds; the options' default when left out. */
    readonly expiresIn?: number
    /** Limits for this upload; a field named here replaces the options' limit of the same field. */
    readonly limits?: UploadLimits
}

/** What `presignGet` is asked for. */
export interface PresignGetRequest {
    /** The lifetime in seconds; the options' default when left out. */
    readonly expiresIn?: number
    /** When set, the browser saves the object under this file name (`Content-Disposition: attachment`). */
    readonly downloadName?: string
}

/** What the store records about one object, read without its bytes. */
export interface ObjectHead {
    /** The size in bytes. */
    readonly size: number
    /** The content type the store recorded. */
    readonly contentType: string
    /** When the object was last written, ISO-8601, when the store says. */
    readonly lastModified: string | null
    /** The entity tag, when the store says. */
    readonly etag: string | null
}

/** One stored object read back. */
export interface StoredObject {
    /** The bytes. */
    readonly bytes: Uint8Array
    /** The content type the store recorded. */
    readonly contentType: string
}

/** One file listed in a folder. */
export interface ListedObject {
    /** The file name relative to the listed folder. */
    readonly name: string
    /** When the object was last written, ISO-8601, when the store says. */
    readonly lastModified: string | null
}

/**
 * The object storage port of a back end. Buckets and key layout are the app's; every call validates the bucket and key, a
 * missing object answers `null` (never a throw), and every other failure rejects with an `ObjectStorageError`.
 */
export interface ObjectStorage {
    /** A presigned PUT of `key`: the content type (and size, when given) are signed, and the limits in force are checked first. */
    presignPut(bucket: string, key: string, request: PresignPutRequest): Promise<PresignedRequest>
    /** A presigned GET of `key`. The object is not looked up. */
    presignGet(bucket: string, key: string, request?: PresignGetRequest): Promise<PresignedRequest>
    /** What the store records about `key`, or null when it is not there. */
    head(bucket: string, key: string): Promise<ObjectHead | null>
    /** `head`, then the limits: NOT_FOUND when absent, SIZE_EXCEEDED or CONTENT_TYPE_NOT_ALLOWED when the stored object breaks them. It removes nothing. */
    confirmUpload(bucket: string, key: string, limits?: UploadLimits): Promise<ObjectHead>
    /** The bytes of `key`, or null when it is not there. */
    get(bucket: string, key: string): Promise<StoredObject | null>
    /** Writes `body` at `key`, replacing an earlier object; the limits in force are checked first. */
    put(bucket: string, key: string, body: Uint8Array, contentType: string, limits?: UploadLimits): Promise<void>
    /** Deletes `key`; a missing key is not an error. */
    remove(bucket: string, key: string): Promise<void>
    /** Deletes the keys in batches of a thousand; answers how many the store reports deleted. */
    removeMany(bucket: string, keys: readonly string[]): Promise<number>
    /** The files directly under `folder` (subfolders are omitted), newest first, up to `limit`. */
    list(bucket: string, folder: string, limit: number): Promise<readonly ListedObject[]>
    /** Creates the bucket when it is missing; a public one gets an anonymous read policy. Safe to run again. */
    ensureBucket(bucket: string, options?: { readonly publicRead?: boolean }): Promise<void>
    /** The address anyone reads `key` of a public bucket at; no request is made. */
    publicUrl(bucket: string, key: string): string
}
