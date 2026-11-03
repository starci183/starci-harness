import type { ObjectStorageOptions as StorageSettings } from "@starci/object-storage"

/**
 * S3-compatible object storage (MinIO in lite) parsed once at API boot: the settings of `@starci/object-storage` (its clock is
 * the app's `Clock`) and the one bucket of the app's objects. The key layout belongs to the domain that stores the object.
 */
export interface ObjectStorageOptions extends Omit<StorageSettings, "clock"> {
    /** The bucket of the app's objects. */
    readonly bucket: string
}
