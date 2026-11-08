import { DomainError } from "@starci/common"
import type { ErrorKind } from "@starci/common"

/** The wire codes of object storage; the app maps each to its own error family (BE-ERROR) at the glue. */
export const OBJECT_STORAGE_ERROR_CODES = {
    /** The bucket has no object at the requested key. */
    ObjectNotFound: "OBJECT_STORAGE_NOT_FOUND",
    /** The store could not be reached, timed out or refused the call. */
    Unavailable: "OBJECT_STORAGE_UNAVAILABLE",
    /** The object key is not one the store accepts. */
    KeyInvalid: "OBJECT_STORAGE_KEY_INVALID",
    /** The bucket name is not one the store accepts. */
    BucketInvalid: "OBJECT_STORAGE_BUCKET_INVALID",
    /** The requested lifetime of a presigned request is not a whole number of seconds inside the allowed range. */
    ExpiryInvalid: "OBJECT_STORAGE_EXPIRY_INVALID",
    /** The object is larger than the size limit in force. */
    SizeExceeded: "OBJECT_STORAGE_SIZE_EXCEEDED",
    /** A size limit is in force and the upload request names no size to sign. */
    SizeRequired: "OBJECT_STORAGE_SIZE_REQUIRED",
    /** The content type is not one the limits in force admit. */
    ContentTypeNotAllowed: "OBJECT_STORAGE_CONTENT_TYPE_NOT_ALLOWED",
} as const

/** A wire code of object storage. */
export type ObjectStorageErrorCode = (typeof OBJECT_STORAGE_ERROR_CODES)[keyof typeof OBJECT_STORAGE_ERROR_CODES]

/** How a code travels, in the vocabulary of the harness back end's `ErrorKind`. */
export type ObjectStorageErrorKind = Extract<ErrorKind, "invalid" | "not-found" | "unavailable">

/** The kind each code travels as: a missing object is not-found, an unreachable store unavailable, everything else invalid. */
export const OBJECT_STORAGE_ERROR_KINDS: Readonly<Record<ObjectStorageErrorCode, ObjectStorageErrorKind>> = {
    OBJECT_STORAGE_NOT_FOUND: "not-found",
    OBJECT_STORAGE_UNAVAILABLE: "unavailable",
    OBJECT_STORAGE_KEY_INVALID: "invalid",
    OBJECT_STORAGE_BUCKET_INVALID: "invalid",
    OBJECT_STORAGE_EXPIRY_INVALID: "invalid",
    OBJECT_STORAGE_SIZE_EXCEEDED: "invalid",
    OBJECT_STORAGE_SIZE_REQUIRED: "invalid",
    OBJECT_STORAGE_CONTENT_TYPE_NOT_ALLOWED: "invalid",
}

/** The one error class of object storage, a `DomainError` of `@starci/common`: a wire code, the kind it travels as, the context for a log and the cause. */
export class ObjectStorageError extends DomainError<ObjectStorageErrorCode> {
    readonly kind: ObjectStorageErrorKind
    /** Non-secret context (the bucket, the key, the limit); never a credential. */
    readonly context: Readonly<Record<string, unknown>>

    constructor(code: ObjectStorageErrorCode, options: { readonly cause?: unknown; readonly context?: Readonly<Record<string, unknown>> } = {}) {
        super(options.cause === undefined ? { code } : { code, cause: options.cause })
        this.kind = OBJECT_STORAGE_ERROR_KINDS[code]
        this.context = options.context ?? {}
    }
}
