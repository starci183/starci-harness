import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from "./errors.ts"
import { resolveOptions } from "./options.ts"
import type { ObjectStorageOptions, ResolvedOptions, UploadLimits } from "./options.ts"
import { bucketOf, checkContentType, checkSize, expiryOf, keyOf, limitsOf, prefixOf, publicAddressOf } from "./policy.ts"
import type { ListedObject, ObjectHead, ObjectStorage, PresignGetRequest, PresignPutRequest, PresignedRequest, StoredObject } from "./port.ts"
import type { S3Transport } from "./transport.ts"

const DELETE_BATCH = 1000

/** The port over a transport: names, expiry and limits are checked here, the wire is the transport's. */
export class ObjectStorageService implements ObjectStorage {
    readonly #transport: S3Transport
    readonly #options: ResolvedOptions

    constructor(transport: S3Transport, options: ObjectStorageOptions) {
        this.#transport = transport
        this.#options = resolveOptions(options)
    }

    async presignPut(bucket: string, key: string, request: PresignPutRequest): Promise<PresignedRequest> {
        const name = bucketOf(bucket)
        const path = keyOf(key)
        const limits = limitsOf(this.#options.limits, request.limits)
        checkContentType(limits, request.contentType)
        if (request.contentLength !== undefined) {
            if (!Number.isInteger(request.contentLength) || request.contentLength < 0) {
                throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.SizeExceeded, { context: { size: request.contentLength } })
            }
            checkSize(limits, request.contentLength)
        } else if (limits.maxBytes !== undefined) {
            throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.SizeRequired, { context: { maxBytes: limits.maxBytes } })
        }
        const expiresIn = expiryOf(request.expiresIn, this.#options.defaultExpiresIn, this.#options.maxExpiresIn)
        const signingDate = this.#options.clock.now()
        const url = await this.#transport.sign({
            method: "PUT",
            bucket: name,
            key: path,
            contentType: request.contentType,
            ...(request.contentLength === undefined ? {} : { contentLength: request.contentLength }),
            expiresIn,
            signingDate,
        })
        const headers: Record<string, string> = { "Content-Type": request.contentType }
        if (request.contentLength !== undefined) headers["Content-Length"] = String(request.contentLength)
        return this.#presigned("PUT", url, headers, expiresIn, signingDate)
    }

    async presignGet(bucket: string, key: string, request: PresignGetRequest = {}): Promise<PresignedRequest> {
        const name = bucketOf(bucket)
        const path = keyOf(key)
        const expiresIn = expiryOf(request.expiresIn, this.#options.defaultExpiresIn, this.#options.maxExpiresIn)
        const signingDate = this.#options.clock.now()
        const url = await this.#transport.sign({
            method: "GET",
            bucket: name,
            key: path,
            ...(request.downloadName === undefined ? {} : { downloadName: request.downloadName }),
            expiresIn,
            signingDate,
        })
        return this.#presigned("GET", url, {}, expiresIn, signingDate)
    }

    async head(bucket: string, key: string): Promise<ObjectHead | null> {
        return await this.#transport.head(bucketOf(bucket), keyOf(key))
    }

    async confirmUpload(bucket: string, key: string, limits?: UploadLimits): Promise<ObjectHead> {
        const found = await this.head(bucket, key)
        if (found === null) throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.ObjectNotFound, { context: { bucket, key } })
        const inForce = limitsOf(this.#options.limits, limits)
        checkSize(inForce, found.size)
        checkContentType(inForce, found.contentType)
        return found
    }

    async get(bucket: string, key: string): Promise<StoredObject | null> {
        return await this.#transport.get(bucketOf(bucket), keyOf(key))
    }

    async put(bucket: string, key: string, body: Uint8Array, contentType: string, limits?: UploadLimits): Promise<void> {
        const name = bucketOf(bucket)
        const path = keyOf(key)
        const inForce = limitsOf(this.#options.limits, limits)
        checkContentType(inForce, contentType)
        checkSize(inForce, body.byteLength)
        await this.#transport.put(name, path, body, contentType)
    }

    async remove(bucket: string, key: string): Promise<void> {
        await this.#transport.removeMany(bucketOf(bucket), [keyOf(key)])
    }

    async removeMany(bucket: string, keys: readonly string[]): Promise<number> {
        const name = bucketOf(bucket)
        const valid = keys.map(keyOf)
        let removed = 0
        for (let start = 0; start < valid.length; start += DELETE_BATCH) {
            removed += await this.#transport.removeMany(name, valid.slice(start, start + DELETE_BATCH))
        }
        return removed
    }

    async list(bucket: string, folder: string, limit: number): Promise<readonly ListedObject[]> {
        const found = await this.#transport.list(bucketOf(bucket), prefixOf(folder))
        const stamp = (entry: ListedObject): number => (entry.lastModified === null ? 0 : Date.parse(entry.lastModified))
        return found.toSorted((left, right) => stamp(right) - stamp(left)).slice(0, Math.max(0, limit))
    }

    async ensureBucket(bucket: string, options: { readonly publicRead?: boolean } = {}): Promise<void> {
        await this.#transport.ensureBucket(bucketOf(bucket), options.publicRead === true)
    }

    publicUrl(bucket: string, key: string): string {
        return publicAddressOf(this.#options.publicEndpoint, bucketOf(bucket), keyOf(key), this.#options.forcePathStyle)
    }

    /** Releases the transport's connections; Nest calls it on shutdown. */
    onModuleDestroy(): void {
        this.#transport.destroy()
    }

    #presigned(method: "GET" | "PUT", url: string, headers: Readonly<Record<string, string>>, expiresIn: number, from: Date): PresignedRequest {
        return { method, url, headers, expiresIn, expiresAt: new Date(from.getTime() + expiresIn * 1000).toISOString() }
    }
}
