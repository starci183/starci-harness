/** A text, or a holder that reveals it on demand (the app's `Secret`), so a secret never travels as a bare field. */
export type SecretInput = string | { reveal(): string }

/** The clock presigned requests are dated by; a spec passes a fixed one. */
export interface StorageClock {
    now(): Date
}

/** What an upload may be: at most `maxBytes` long and of one of the listed content types. Either field may be left out. */
export interface UploadLimits {
    /** The largest object in bytes. A limit in force makes `presignPut` require the exact `contentLength`, which the signature then fixes. */
    readonly maxBytes?: number
    /** The content types admitted: exact (`image/png`) or a family (`image/*`), compared without parameters and ignoring case. */
    readonly contentTypes?: readonly string[]
}

/** The settings of object storage, parsed by the app (BE-CONFIG-2); the package reads no environment. */
export interface ObjectStorageOptions {
    /** The S3 address the back end itself calls: MinIO on the internal network or the public origin. */
    readonly endpoint: string
    /** The origin browsers reach the store at; presigned requests are signed for it and public objects are read from it. Defaults to `endpoint`. */
    readonly publicEndpoint?: string
    /** The region the requests are signed for; MinIO accepts any. */
    readonly region: string
    /** The access key id of the store account. */
    readonly accessKeyId: SecretInput
    /** The secret access key of the store account. */
    readonly secretAccessKey: SecretInput
    /** Path-style addressing (`endpoint/bucket/key`), as MinIO serves it. Defaults to true. */
    readonly forcePathStyle?: boolean
    /** How long one call to the store may take, in milliseconds. Defaults to 30000. */
    readonly timeoutMs?: number
    /** The lifetime of a presigned request in seconds when the call names none. Defaults to 300. */
    readonly defaultExpiresIn?: number
    /** The longest lifetime a presigned request may ask for, in seconds. Defaults to and never exceeds 604800 (seven days, the SigV4 ceiling). */
    readonly maxExpiresIn?: number
    /** The limits every upload is held to unless the call names its own. */
    readonly limits?: UploadLimits
    /** The clock presigned requests are dated by. Defaults to the system clock. */
    readonly clock?: StorageClock
}

/** The longest a SigV4 presigned request lives. */
export const MAX_EXPIRES_IN_SECONDS = 604_800
/** The lifetime of a presigned request when neither the call nor the options name one. */
export const DEFAULT_EXPIRES_IN_SECONDS = 300
/** The time one call to the store may take when the options name none. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** The text a `SecretInput` holds. */
export const revealed = (secret: SecretInput): string => (typeof secret === "string" ? secret : secret.reveal())

/** The options with every default applied, the form the package works on. */
export interface ResolvedOptions {
    readonly endpoint: string
    readonly publicEndpoint: string
    readonly region: string
    readonly forcePathStyle: boolean
    readonly timeoutMs: number
    readonly defaultExpiresIn: number
    readonly maxExpiresIn: number
    readonly limits: UploadLimits
    readonly clock: StorageClock
}

/** Applies the defaults. */
export const resolveOptions = (options: ObjectStorageOptions): ResolvedOptions => ({
    endpoint: options.endpoint,
    publicEndpoint: options.publicEndpoint ?? options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? true,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    defaultExpiresIn: options.defaultExpiresIn ?? DEFAULT_EXPIRES_IN_SECONDS,
    maxExpiresIn: Math.min(options.maxExpiresIn ?? MAX_EXPIRES_IN_SECONDS, MAX_EXPIRES_IN_SECONDS),
    limits: options.limits ?? {},
    clock: options.clock ?? { now: () => new Date() },
})
