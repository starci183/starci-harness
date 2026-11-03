/** The wire codes of mail; the app maps each to its own error family (BE-ERROR) at the glue. */
export const MAIL_ERROR_CODES = {
    /** The mail server refused the login. */
    Auth: "MAIL_AUTH",
    /** The provider wants an application password instead of the account password. */
    AppPassword: "MAIL_APP_PASSWORD",
    /** The mail server could not be reached or dropped the connection. */
    Connect: "MAIL_CONNECT",
    /** The mail server did not answer in time. */
    Timeout: "MAIL_TIMEOUT",
    /** The mail server name does not exist. */
    Dns: "MAIL_DNS",
    /** The secure connection failed or the server offers none while one is required. */
    Tls: "MAIL_TLS",
    /** The server refuses the sender address. */
    Sender: "MAIL_SENDER",
    /** The server refused the recipient address. */
    Recipient: "MAIL_RECIPIENT",
    /** The provider's sending limit was reached. */
    Limit: "MAIL_LIMIT",
    /** The server refused the message for a reason this client does not know. */
    Unknown: "MAIL_UNKNOWN",
    /** An address is not a mailbox this package sends to. */
    AddressInvalid: "MAIL_ADDRESS_INVALID",
    /** The message is not one this package sends: an empty or multi-line subject, no text, a body over the limit, too many recipients. */
    MessageInvalid: "MAIL_MESSAGE_INVALID",
} as const

/** A wire code of mail. */
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[keyof typeof MAIL_ERROR_CODES]

/** How a code travels, in the vocabulary of the harness back end's `ErrorKind`. */
export type MailErrorKind = "invalid" | "rate-limited" | "unavailable"

/** The kind each code travels as: a refused login, sender, recipient or message is invalid, a spent limit rate-limited, an unreachable server unavailable. */
export const MAIL_ERROR_KINDS: Readonly<Record<MailErrorCode, MailErrorKind>> = {
    MAIL_AUTH: "invalid",
    MAIL_APP_PASSWORD: "invalid",
    MAIL_CONNECT: "unavailable",
    MAIL_TIMEOUT: "unavailable",
    MAIL_DNS: "invalid",
    MAIL_TLS: "unavailable",
    MAIL_SENDER: "invalid",
    MAIL_RECIPIENT: "invalid",
    MAIL_LIMIT: "rate-limited",
    MAIL_UNKNOWN: "unavailable",
    MAIL_ADDRESS_INVALID: "invalid",
    MAIL_MESSAGE_INVALID: "invalid",
}

/** The one error class of mail: a wire code, the kind it travels as, the server's own words and non-secret context. */
export class MailError extends Error {
    readonly code: MailErrorCode
    readonly kind: MailErrorKind
    /** What the server answered, trimmed to one line (empty when there was no answer); never a credential. */
    readonly detail: string
    /** Non-secret context (the host, the port, the SMTP response code); never a credential. */
    readonly context: Readonly<Record<string, unknown>>

    constructor(
        code: MailErrorCode,
        options: { readonly cause?: unknown; readonly detail?: string; readonly context?: Readonly<Record<string, unknown>> } = {},
    ) {
        super(code, options.cause === undefined ? undefined : { cause: options.cause })
        this.name = "MailError"
        this.code = code
        this.kind = MAIL_ERROR_KINDS[code]
        this.detail = options.detail ?? ""
        this.context = options.context ?? {}
    }
}
