import type { EnvSource } from "@modules/platform/config"
import type { StorageOptions } from "./storage.options"

/** Reads the object storage configuration with no credential or endpoint defaults; secrets read `<KEY>_FILE` first. */
export const parseStorageConfig = (env: EnvSource): StorageOptions => ({
    endpoint: env.url("STORAGE_ENDPOINT"),
    region: env.string("STORAGE_REGION"),
    bucket: env.string("STORAGE_BUCKET"),
    accessKeyId: env.secret("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: env.secret("STORAGE_SECRET_ACCESS_KEY"),
    presignTtlSeconds: env.int("STORAGE_PRESIGN_TTL_SECONDS", 300),
})
