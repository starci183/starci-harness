import {
    CreateBucketCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutBucketPolicyCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from "./errors.ts"
import { resolveOptions, revealed } from "./options.ts"
import type { ObjectStorageOptions, ResolvedOptions } from "./options.ts"
import type { ListedObject, ObjectHead, StoredObject } from "./port.ts"
import type { S3Transport, SignRequest } from "./transport.ts"

const NOT_FOUND = new Set(["NoSuchKey", "NotFound", "NoSuchBucket"])

const nameOf = (failure: unknown): string => (failure instanceof Error ? failure.name : "")

const unavailable = (failure: unknown, operation: string, bucket: string): ObjectStorageError =>
    failure instanceof ObjectStorageError
        ? failure
        : new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.Unavailable, { cause: failure, context: { operation, bucket } })

const readPolicy = (bucket: string): string =>
    JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${bucket}/*`] }],
    })

/** Runs one call, turning any failure into an UNAVAILABLE error that keeps the cause. */
const guarded = async <T>(call: Promise<T>, operation: string, bucket: string): Promise<T> => {
    try {
        return await call
    } catch (failure) {
        throw unavailable(failure, operation, bucket)
    }
}

/**
 * The S3 transport over the AWS SDK: the one file of an app's dependency tree that imports it. Calls go to the internal
 * endpoint; presigned requests are signed by a second client for the public origin, so the signature covers the host a
 * browser will send the request to.
 */
export class AwsS3Transport implements S3Transport {
    readonly #options: ResolvedOptions
    readonly #calls: S3Client
    readonly #signer: S3Client

    constructor(options: ObjectStorageOptions) {
        this.#options = resolveOptions(options)
        const credentials = { accessKeyId: revealed(options.accessKeyId), secretAccessKey: revealed(options.secretAccessKey) }
        const client = (endpoint: string): S3Client =>
            new S3Client({ endpoint, region: this.#options.region, credentials, forcePathStyle: this.#options.forcePathStyle, maxAttempts: 2 })
        this.#calls = client(this.#options.endpoint)
        this.#signer = this.#options.publicEndpoint === this.#options.endpoint ? this.#calls : client(this.#options.publicEndpoint)
    }

    async put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        await guarded(this.#calls.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }), this.#abort()), "put", bucket)
    }

    async get(bucket: string, key: string): Promise<StoredObject | null> {
        try {
            const found = await this.#calls.send(new GetObjectCommand({ Bucket: bucket, Key: key }), this.#abort())
            const bytes = (await found.Body?.transformToByteArray()) ?? new Uint8Array()
            return { bytes, contentType: found.ContentType ?? "application/octet-stream" }
        } catch (failure) {
            if (NOT_FOUND.has(nameOf(failure))) return null
            throw unavailable(failure, "get", bucket)
        }
    }

    async head(bucket: string, key: string): Promise<ObjectHead | null> {
        try {
            const found = await this.#calls.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), this.#abort())
            return {
                size: found.ContentLength ?? 0,
                contentType: found.ContentType ?? "application/octet-stream",
                lastModified: found.LastModified?.toISOString() ?? null,
                etag: found.ETag ?? null,
            }
        } catch (failure) {
            if (NOT_FOUND.has(nameOf(failure))) return null
            throw unavailable(failure, "head", bucket)
        }
    }

    async removeMany(bucket: string, keys: readonly string[]): Promise<number> {
        if (keys.length === 0) return 0
        const answer = await guarded(
            this.#calls.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }), this.#abort()),
            "remove",
            bucket,
        )
        return answer.Deleted?.length ?? 0
    }

    async list(bucket: string, prefix: string): Promise<readonly ListedObject[]> {
        const found: ListedObject[] = []
        let token: string | undefined
        do {
            const page = await guarded(
                this.#calls.send(
                    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/", ...(token === undefined ? {} : { ContinuationToken: token }) }),
                    this.#abort(),
                ),
                "list",
                bucket,
            )
            for (const entry of page.Contents ?? []) {
                if (entry.Key === undefined || entry.Key === prefix) continue
                found.push({ name: entry.Key.slice(prefix.length), lastModified: entry.LastModified?.toISOString() ?? null })
            }
            token = page.IsTruncated === true ? page.NextContinuationToken : undefined
        } while (token !== undefined)
        return found
    }

    async sign(request: SignRequest): Promise<string> {
        const command =
            request.method === "PUT"
                ? new PutObjectCommand({
                      Bucket: request.bucket,
                      Key: request.key,
                      ...(request.contentType === undefined ? {} : { ContentType: request.contentType }),
                      ...(request.contentLength === undefined ? {} : { ContentLength: request.contentLength }),
                  })
                : new GetObjectCommand({
                      Bucket: request.bucket,
                      Key: request.key,
                      ...(request.downloadName === undefined
                          ? {}
                          : { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(request.downloadName)}"` }),
                  })
        try {
            return await getSignedUrl(this.#signer, command, {
                expiresIn: request.expiresIn,
                signingDate: request.signingDate,
                // content-type is not signed by default; signing it makes the store refuse an upload of another type
                signableHeaders: new Set(["content-type"]),
            })
        } catch (failure) {
            throw unavailable(failure, "sign", request.bucket)
        }
    }

    async ensureBucket(bucket: string, publicRead: boolean): Promise<void> {
        try {
            await this.#calls.send(new HeadBucketCommand({ Bucket: bucket }), this.#abort())
        } catch (failure) {
            if (!NOT_FOUND.has(nameOf(failure))) throw unavailable(failure, "ensureBucket", bucket)
            await guarded(this.#calls.send(new CreateBucketCommand({ Bucket: bucket }), this.#abort()), "ensureBucket", bucket)
        }
        if (publicRead) {
            await guarded(this.#calls.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: readPolicy(bucket) }), this.#abort()), "ensureBucket", bucket)
        }
    }

    destroy(): void {
        this.#calls.destroy()
        this.#signer.destroy()
    }

    #abort(): { readonly abortSignal: AbortSignal } {
        return { abortSignal: AbortSignal.timeout(this.#options.timeoutMs) }
    }
}
