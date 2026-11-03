import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from "./errors.ts"
import type { UploadLimits } from "./options.ts"

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u
const FORBIDDEN_IN_KEY = /[\p{Cc}\\]/u
const MAX_KEY_LENGTH = 1024

/** True when `bucket` is a name S3-compatible stores accept (3 to 63 lowercase letters, digits, dots and hyphens, edges alphanumeric). */
export const isValidBucketName = (bucket: string): boolean => BUCKET_NAME.test(bucket) && !bucket.includes("..")

/** True when `key` is a relative path of clean segments: no empty, `.` or `..` segment, no control character or backslash, at most 1024 characters. */
export const isValidObjectKey = (key: string): boolean =>
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    !FORBIDDEN_IN_KEY.test(key) &&
    key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")

/** The bucket, or a BUCKET_INVALID error. */
export const bucketOf = (bucket: string): string => {
    if (!isValidBucketName(bucket)) throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.BucketInvalid, { context: { bucket } })
    return bucket
}

/** The key, or a KEY_INVALID error. */
export const keyOf = (key: string): string => {
    if (!isValidObjectKey(key)) throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.KeyInvalid, { context: { key } })
    return key
}

/** The folder as a listing prefix: empty for the root, else the folder with exactly one trailing slash; its segments are validated. */
export const prefixOf = (folder: string): string => {
    let end = folder.length
    while (end > 0 && folder.charAt(end - 1) === "/") end -= 1
    const trimmed = folder.slice(0, end)
    return trimmed === "" ? "" : `${keyOf(trimmed)}/`
}

/** The lifetime in seconds: the request, or the fallback when none is named; a whole number from 1 to `max`, else EXPIRY_INVALID. */
export const expiryOf = (requested: number | undefined, fallback: number, max: number): number => {
    const seconds = requested ?? fallback
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > max) {
        throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.ExpiryInvalid, { context: { expiresIn: seconds, max } })
    }
    return seconds
}

/** A content type without its parameters, lowercase (`Image/PNG; charset=x` is `image/png`). */
export const essenceOf = (contentType: string): string => (contentType.split(";")[0] ?? "").trim().toLowerCase()

/** True when the content type is admitted by the list: exact, or a `family/*` entry; an empty or missing list admits every type. */
export const admitsContentType = (allowed: readonly string[] | undefined, contentType: string): boolean => {
    if (allowed === undefined || allowed.length === 0) return true
    const essence = essenceOf(contentType)
    return (
        essence !== "" &&
        allowed.some((entry) => {
            const wanted = essenceOf(entry)
            return wanted.endsWith("/*") ? essence.startsWith(wanted.slice(0, -1)) : essence === wanted
        })
    )
}

/** The limits of a call: its own fields over the options' (a field the call names replaces the default's). */
export const limitsOf = (defaults: UploadLimits, own: UploadLimits | undefined): UploadLimits => ({ ...defaults, ...own })

/** Refuses a content type the limits do not admit. */
export const checkContentType = (limits: UploadLimits, contentType: string): void => {
    if (!admitsContentType(limits.contentTypes, contentType)) {
        throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.ContentTypeNotAllowed, { context: { contentType } })
    }
}

/** Refuses a size above the limit in force. */
export const checkSize = (limits: UploadLimits, size: number): void => {
    if (limits.maxBytes !== undefined && size > limits.maxBytes) {
        throw new ObjectStorageError(OBJECT_STORAGE_ERROR_CODES.SizeExceeded, { context: { size, maxBytes: limits.maxBytes } })
    }
}

/** The path-style address `<origin>/<bucket>/<key>` (each key segment encoded), or the virtual-hosted `<scheme>://<bucket>.<host>/<key>`. */
export const publicAddressOf = (origin: string, bucket: string, key: string, pathStyle: boolean): string => {
    const encoded = key.split("/").map(encodeURIComponent).join("/")
    const base = new URL(origin)
    if (pathStyle) {
        let end = base.pathname.length
        while (end > 0 && base.pathname.charAt(end - 1) === "/") end -= 1
        return `${base.origin}${base.pathname.slice(0, end)}/${bucket}/${encoded}`
    }
    return `${base.protocol}//${bucket}.${base.host}/${encoded}`
}
