import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import { MAIL_ERROR_CODES, MailError } from "./errors.ts"
import type { MailErrorCode } from "./errors.ts"
import { revealed } from "./options.ts"
import type { ResolvedMailOptions } from "./options.ts"
import type { SentMail } from "./port.ts"
import { assertSmtpTarget } from "./target.ts"
import type { ResolveAddresses } from "./target.ts"
import type { MailEnvelope, MailTransport } from "./transport.ts"

interface FailureShape {
    readonly code: string
    readonly responseCode: number | null
    readonly response: string
    readonly message: string
}

const textField = (error: object, name: string): string => {
    const value: unknown = Reflect.get(error, name)
    return typeof value === "string" ? value : ""
}

const shapeOf = (error: unknown): FailureShape => {
    if (typeof error !== "object" || error === null) return { code: "", responseCode: null, response: "", message: "" }
    const responseCode: unknown = Reflect.get(error, "responseCode")
    return {
        code: textField(error, "code"),
        responseCode: typeof responseCode === "number" ? responseCode : null,
        response: textField(error, "response"),
        message: textField(error, "message"),
    }
}

const APP_PASSWORD = /application-specific|app password|5\.7\.9|apppasswords/iu
const AUTH_WORDS = /authentication|credentials|username and password/iu
const TIMEOUT_WORDS = /timed? ?out|greeting never received/iu
const TLS_WORDS = /certificate|ssl|tls|wrong version number|handshake|self[- ]signed|STARTTLS/iu
const RECIPIENT_WORDS = /recipient|user unknown|mailbox unavailable|no such user/iu
const SENDER_WORDS = /sender|from|send as|not (?:owned|allowed|permitted)|5\.7\.60|not authenticated|relay/iu
const ONLY_RECIPIENT_WORDS = /recipient|user unknown/iu
const SENDER_REFUSAL = /sender|send as|not (?:owned|allowed|permitted) |5\.7\.60|553|relay access denied|domain.*not verified|not verified/iu
const LIMIT_WORDS = /rate|limit|quota|too many|exceeded|4\.2\.1|452/iu
const CONNECT_CODES = new Set(["ECONNREFUSED", "ECONNECTION", "ECONNRESET", "EHOSTUNREACH"])
const CONNECT_WORDS = /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL/u

const codeOf = (shape: FailureShape, text: string): MailErrorCode => {
    if (shape.code === "EAUTH" || shape.responseCode === 535 || shape.responseCode === 534 || AUTH_WORDS.test(text)) {
        return APP_PASSWORD.test(text) ? MAIL_ERROR_CODES.AppPassword : MAIL_ERROR_CODES.Auth
    }
    if (shape.code === "ETIMEDOUT" || shape.code === "ECONNTIMEOUT" || TIMEOUT_WORDS.test(text)) return MAIL_ERROR_CODES.Timeout
    if (shape.code === "ENOTFOUND" || shape.code === "EDNS" || /getaddrinfo|ENOTFOUND/iu.test(text)) return MAIL_ERROR_CODES.Dns
    if (CONNECT_CODES.has(shape.code) || CONNECT_WORDS.test(text)) return MAIL_ERROR_CODES.Connect
    if (TLS_WORDS.test(text)) return MAIL_ERROR_CODES.Tls
    if (shape.code === "ESOCKET") return MAIL_ERROR_CODES.Connect
    if (shape.code === "EENVELOPE" || RECIPIENT_WORDS.test(text)) {
        return SENDER_WORDS.test(text) && !ONLY_RECIPIENT_WORDS.test(text) ? MAIL_ERROR_CODES.Sender : MAIL_ERROR_CODES.Recipient
    }
    if (SENDER_REFUSAL.test(text)) return MAIL_ERROR_CODES.Sender
    if (LIMIT_WORDS.test(text)) return MAIL_ERROR_CODES.Limit
    return MAIL_ERROR_CODES.Unknown
}

/** Maps a nodemailer or SMTP failure to the wire code a caller can act on; a `MailError` passes through as it is. */
export const classifySmtpFailure = (error: unknown, context: Readonly<Record<string, unknown>> = {}): MailError => {
    if (error instanceof MailError) return error
    const shape = shapeOf(error)
    const text = `${shape.response} ${shape.message}`.slice(0, 300)
    const detail = text.replace(/\s+/gu, " ").trim()
    return new MailError(codeOf(shape, text), {
        cause: error,
        detail,
        context: { ...context, ...(shape.responseCode === null ? {} : { responseCode: shape.responseCode }) },
    })
}

const addressOf = (entry: unknown): string => {
    if (typeof entry === "string") return entry
    if (typeof entry === "object" && entry !== null) return textField(entry, "address")
    return ""
}

/** The nodemailer settings an options object means: the channel mode, the timeouts, the certificate policy. */
export const smtpSettings = (options: ResolvedMailOptions): SMTPTransport.Options => ({
    host: options.host,
    port: options.port,
    secure: options.security === "tls",
    requireTLS: options.security === "starttls",
    ignoreTLS: options.security === "none",
    ...(options.auth === null ? {} : { auth: { user: options.auth.user, pass: revealed(options.auth.pass) } }),
    ...(options.helloName === null ? {} : { name: options.helloName }),
    connectionTimeout: options.connectionTimeoutMs,
    greetingTimeout: options.greetingTimeoutMs,
    socketTimeout: options.socketTimeoutMs,
    tls: { rejectUnauthorized: !options.allowSelfSigned, minVersion: "TLSv1.2" },
})

/** The one owner of nodemailer: delivers an envelope over SMTP, with every timeout in force and every failure a `MailError`. */
export class SmtpTransport implements MailTransport {
    readonly #options: ResolvedMailOptions
    readonly #nodemailer: Transporter<SMTPTransport.SentMessageInfo>

    readonly #resolve: ResolveAddresses | undefined

    constructor(options: ResolvedMailOptions, resolve?: ResolveAddresses) {
        this.#resolve = resolve
        this.#options = options
        this.#nodemailer = nodemailer.createTransport(smtpSettings(options))
    }

    async deliver(envelope: MailEnvelope): Promise<SentMail> {
        const context = { host: this.#options.host, port: this.#options.port }
        if (this.#options.publicTargetOnly) {
            await assertSmtpTarget(this.#options.host, this.#options.port, this.#resolve === undefined ? {} : { resolve: this.#resolve })
        }
        let timer: NodeJS.Timeout | undefined
        const expired = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                this.#nodemailer.close()
                reject(new MailError(MAIL_ERROR_CODES.Timeout, { detail: "the send took longer than the total timeout", context }))
            }, this.#options.sendTimeoutMs)
        })
        const sending = this.#nodemailer.sendMail({
            from: { name: envelope.from.name, address: envelope.from.address },
            ...(envelope.replyTo === null ? {} : { replyTo: envelope.replyTo }),
            to: [...envelope.to],
            subject: envelope.subject,
            text: envelope.text,
            ...(envelope.html === null ? {} : { html: envelope.html }),
            ...(envelope.attachments.length === 0
                ? {}
                : {
                      attachments: envelope.attachments.map((file) => ({
                          filename: file.filename,
                          content: Buffer.from(file.content),
                          ...(file.contentType === undefined ? {} : { contentType: file.contentType }),
                      })),
                  }),
        })
        try {
            const info = await Promise.race([sending, expired])
            const rejected = info.rejected.map(addressOf)
            if (rejected.length > 0) throw new MailError(MAIL_ERROR_CODES.Recipient, { detail: rejected.join(", "), context })
            return { messageId: info.messageId, accepted: info.accepted.map(addressOf) }
        } catch (error) {
            sending.catch(() => undefined)
            throw classifySmtpFailure(error, context)
        } finally {
            clearTimeout(timer)
        }
    }

    close(): void {
        this.#nodemailer.close()
    }
}
