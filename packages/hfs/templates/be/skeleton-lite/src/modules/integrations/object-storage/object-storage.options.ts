import type { Secret } from "@modules/platform/config"

/** S3-compatible object storage (MinIO in lite) parsed once at API boot. */
export interface ObjectStorageOptions {
    /** The S3 endpoint origin. */
    readonly endpoint: string
    /** The region the endpoint signs for. */
    readonly region: string
    /** The bucket of the app's objects. */
    readonly bucket: string
    /** The access key id. */
    readonly accessKeyId: Secret
    /** The secret access key. */
    readonly secretAccessKey: Secret
    /** The lifetime of a presigned URL in seconds. */
    readonly presignTtlSeconds: number
}

/** One presigned request: the URL the browser calls and when it stops working. */
export interface PresignedRequest {
    /** The presigned URL. */
    readonly url: string
    /** The expiry instant, ISO-8601. */
    readonly expiresAt: string
}

/** The object storage port: presigned PUT and GET of one key and a server-side delete. */
export interface ObjectStorage {
    /** A presigned PUT of `key` with its content type fixed. */
    presignPut(key: string, contentType: string): Promise<PresignedRequest>
    /** A presigned GET of `key`. */
    presignGet(key: string): Promise<PresignedRequest>
    /** Deletes `key`. */
    remove(key: string): Promise<void>
}
