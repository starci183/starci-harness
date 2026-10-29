import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { ObjectStorage, PresignedRequest, StorageOptions } from "./storage.options"

/** The one S3 client of the app over S3-compatible storage (path-style, as MinIO serves it). */
export const createObjectStorage = (options: StorageOptions, now: () => Date = () => new Date()): ObjectStorage => {
    const client = new S3Client({
        endpoint: options.endpoint,
        region: options.region,
        forcePathStyle: true,
        credentials: { accessKeyId: options.accessKeyId.reveal(), secretAccessKey: options.secretAccessKey.reveal() },
    })
    const expiresAt = (): string => new Date(now().getTime() + options.presignTtlSeconds * 1000).toISOString()
    const presign = async (command: PutObjectCommand | GetObjectCommand): Promise<PresignedRequest> => ({
        url: await getSignedUrl(client, command, { expiresIn: options.presignTtlSeconds }),
        expiresAt: expiresAt(),
    })
    return {
        presignPut: (key, contentType) => presign(new PutObjectCommand({ Bucket: options.bucket, Key: key, ContentType: contentType })),
        presignGet: (key) => presign(new GetObjectCommand({ Bucket: options.bucket, Key: key })),
        remove: async (key) => {
            await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
        },
    }
}
