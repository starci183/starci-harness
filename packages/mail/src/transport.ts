import type { MailAttachment, SentMail } from "./port.ts"

/** What a transport is asked to deliver: validated mailboxes and a checked message. */
export interface MailEnvelope {
    readonly from: { readonly name: string; readonly address: string }
    readonly replyTo: string | null
    readonly to: readonly string[]
    /** Visible in the headers. */
    readonly cc: readonly string[]
    /** In the SMTP envelope only, never in a header. */
    readonly bcc: readonly string[]
    /** The Message-ID of the message this one answers (`<local@domain>`), or null. */
    readonly inReplyTo: string | null
    /** The Message-IDs of the thread, oldest first. */
    readonly references: readonly string[]
    /** The Message-ID this message carries when the caller names it; null leaves it to the transport. */
    readonly messageId: string | null
    readonly subject: string
    readonly text: string
    readonly html: string | null
    readonly attachments: readonly MailAttachment[]
}

/**
 * The delivery the service is built from, on validated envelopes. nodemailer implements it in one file; the in-memory outbox
 * of `@starci/mail/testing` implements it for specs. Every failure rejects with a `MailError`.
 */
export interface MailTransport {
    deliver(envelope: MailEnvelope): Promise<SentMail>
    close(): void
}
