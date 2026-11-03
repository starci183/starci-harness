/** A text, or a holder that reveals it on demand (the app's `Secret`), so a secret never travels as a bare field. */
export type SecretInput = string | { reveal(): string }

/** How the channel to the mail server is secured: implicit TLS (port 465), STARTTLS (587, required to succeed) or none (a local mail sink only). */
export type MailSecurity = "tls" | "starttls" | "none"

/** A sender: a bare mailbox or a display name and a mailbox. */
export type MailSender = string | { readonly name: string; readonly address: string }

/** The login of the mail server account. */
export interface MailAuth {
    /** The login name. */
    readonly user: string
    /** The password, or the application password the provider issues. */
    readonly pass: SecretInput
}

/** The settings of mail, parsed by the app (BE-CONFIG-2); the package reads no environment. */
export interface MailOptions {
    /** The mail server. */
    readonly host: string
    /** The mail port: 465 with `tls`, 587 with `starttls`, 25 or a sink's port otherwise. */
    readonly port: number
    /** How the channel is secured. Defaults to `starttls`, which fails the send when the server offers no STARTTLS; `none` is for a local mail sink. */
    readonly security?: MailSecurity
    /** The login; leave out for a server that takes mail without one. */
    readonly auth?: MailAuth
    /** The From of every message unless the call names its own. */
    readonly from: MailSender
    /** The Reply-To of every message unless the call names its own. */
    readonly replyTo?: string
    /** The name this server introduces itself with (EHLO). Defaults to the machine's. */
    readonly helloName?: string
    /** Accept a self-signed certificate: a development mail catcher only. Defaults to false. */
    readonly allowSelfSigned?: boolean
    /** How long the connection may take to open, in milliseconds. Defaults to 10000. */
    readonly connectionTimeoutMs?: number
    /** How long the server may take to greet, in milliseconds. Defaults to 10000. */
    readonly greetingTimeoutMs?: number
    /** How long the connection may stay silent, in milliseconds. Defaults to 25000. */
    readonly socketTimeoutMs?: number
    /** How long one whole send may take, connect to quit, in milliseconds. Defaults to 30000. */
    readonly sendTimeoutMs?: number
    /** The most recipients one send names. Defaults to 20. */
    readonly maxRecipients?: number
    /** The longest body (text plus HTML) one send carries, in bytes. Defaults to 1048576. */
    readonly maxBodyBytes?: number
    /** The most files one message attaches. Defaults to 3. */
    readonly maxAttachments?: number
    /** The most bytes all attachments of one message add up to. Defaults to 5242880. */
    readonly maxAttachmentBytes?: number
    /** The media types an attachment may have: exact (`application/pdf`) or a family (`image/*`), compared without parameters and ignoring case. Leave out to admit any. */
    readonly attachmentContentTypes?: readonly string[]
    /** Refuse, before connecting, a server that is not on a public mail port or resolves to a private, loopback or link-local address (`assertSmtpTarget`): for a server a user chose. Defaults to false. */
    readonly publicTargetOnly?: boolean
}

/** The time the connection may take to open when the options name none. */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
/** The time the server may take to greet when the options name none. */
export const DEFAULT_GREETING_TIMEOUT_MS = 10_000
/** The silence a connection may keep when the options name none. */
export const DEFAULT_SOCKET_TIMEOUT_MS = 25_000
/** The time one whole send may take when the options name none. */
export const DEFAULT_SEND_TIMEOUT_MS = 30_000
/** The recipients one send may name when the options name no limit. */
export const DEFAULT_MAX_RECIPIENTS = 20
/** The body one send may carry when the options name no limit. */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576

/** The files one message may attach when the options name no limit. */
export const DEFAULT_MAX_ATTACHMENTS = 3
/** The bytes all attachments may add up to when the options name no limit. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 5_242_880

/** The text a `SecretInput` holds. */
export const revealed = (secret: SecretInput): string => (typeof secret === "string" ? secret : secret.reveal())

/** The options with every default applied, the form the package works on. */
export interface ResolvedMailOptions {
    readonly host: string
    readonly port: number
    readonly security: MailSecurity
    readonly auth: MailAuth | null
    readonly from: MailSender
    readonly replyTo: string | null
    readonly helloName: string | null
    readonly allowSelfSigned: boolean
    readonly connectionTimeoutMs: number
    readonly greetingTimeoutMs: number
    readonly socketTimeoutMs: number
    readonly sendTimeoutMs: number
    readonly maxRecipients: number
    readonly maxBodyBytes: number
    readonly maxAttachments: number
    readonly maxAttachmentBytes: number
    readonly attachmentContentTypes: readonly string[] | null
    readonly publicTargetOnly: boolean
}

const positive = (name: string, value: number): number => {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`mail: ${name} must be a positive whole number, got ${String(value)}`)
    return value
}

/** Applies the defaults and refuses settings that cannot work: a port outside 1-65535, a non-positive timeout or limit, a login over a channel with no encryption. */
export const resolveMailOptions = (options: MailOptions): ResolvedMailOptions => {
    if (options.security === "none" && options.auth !== undefined) throw new TypeError("mail: a login over a channel with no encryption is refused")
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new RangeError(`mail: port must be 1-65535, got ${String(options.port)}`)
    return resolved(options)
}

const resolved = (options: MailOptions): ResolvedMailOptions => ({
    host: options.host,
    port: options.port,
    security: options.security ?? "starttls",
    auth: options.auth ?? null,
    from: options.from,
    replyTo: options.replyTo ?? null,
    helloName: options.helloName ?? null,
    allowSelfSigned: options.allowSelfSigned ?? false,
    connectionTimeoutMs: positive("connectionTimeoutMs", options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS),
    greetingTimeoutMs: positive("greetingTimeoutMs", options.greetingTimeoutMs ?? DEFAULT_GREETING_TIMEOUT_MS),
    socketTimeoutMs: positive("socketTimeoutMs", options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS),
    sendTimeoutMs: positive("sendTimeoutMs", options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS),
    maxRecipients: positive("maxRecipients", options.maxRecipients ?? DEFAULT_MAX_RECIPIENTS),
    maxBodyBytes: positive("maxBodyBytes", options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES),
    maxAttachments: positive("maxAttachments", options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS),
    maxAttachmentBytes: positive("maxAttachmentBytes", options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES),
    attachmentContentTypes: options.attachmentContentTypes ?? null,
    publicTargetOnly: options.publicTargetOnly ?? false,
})
