export { OBJECT_STORAGE, OBJECT_STORAGE_ERROR_CODES, OBJECT_STORAGE_ERROR_KINDS, ObjectStorageError } from "@starci/object-storage"
export type {
    ListedObject,
    ObjectHead,
    ObjectStorage,
    PresignGetRequest,
    PresignPutRequest,
    PresignedRequest,
    UploadLimits,
} from "@starci/object-storage"
export { parseObjectStorageConfig } from "./object-storage.config"
export { InjectObjectStorage, InjectObjectStorageBucket, OBJECT_STORAGE_BUCKET } from "./object-storage.decorators"
export { objectStorageModule } from "./object-storage.module"
export type { ObjectStorageOptions } from "./object-storage.options"
