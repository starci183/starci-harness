import type { MailAttachment, SentMail } from "./port.ts"

/** What a transport is asked to deliver: validated mailboxes and a checked message. */
export interface MailEnvelope {
    readonly from: { readonly name: string; readonly address: string }
    readonly replyTo: string | null
    readonly to: readonly string[]
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
