import { AwsS3Transport } from "./aws.ts"
import type { ObjectStorageOptions } from "./options.ts"
import type { ObjectStorage } from "./port.ts"
import { ObjectStorageService } from "./service.ts"

/** The port over the AWS SDK for plain Node (a script, a worker); a Nest app registers `ObjectStorageModule` instead. */
export const createObjectStorage = (options: ObjectStorageOptions): ObjectStorage & { onModuleDestroy(): void } =>
    new ObjectStorageService(new AwsS3Transport(options), options)

export { ObjectStorageModule } from "./object-storage.module.ts"
export type { ObjectStorageModuleExtras, ObjectStorageRegisterAsyncOptions, ObjectStorageRegisterOptions } from "./object-storage.module.ts"
export { OBJECT_STORAGE } from "./tokens.ts"
export { OBJECT_STORAGE_ERROR_CODES, OBJECT_STORAGE_ERROR_KINDS, ObjectStorageError } from "./errors.ts"
export type { ObjectStorageErrorCode, ObjectStorageErrorKind } from "./errors.ts"
export { DEFAULT_EXPIRES_IN_SECONDS, DEFAULT_TIMEOUT_MS, MAX_EXPIRES_IN_SECONDS } from "./options.ts"
export type { ObjectStorageOptions, SecretInput, StorageClock, UploadLimits } from "./options.ts"
export { admitsContentType, isValidBucketName, isValidObjectKey } from "./policy.ts"
export type {
    ListedObject,
    ObjectHead,
    ObjectStorage,
    PresignGetRequest,
    PresignPutRequest,
    PresignedRequest,
    StoredObject,
} from "./port.ts"
export { ObjectStorageService } from "./service.ts"
export type { S3Transport, SignRequest } from "./transport.ts"
