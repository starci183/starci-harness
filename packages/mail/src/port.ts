/** One file attached to a message. */
export interface MailAttachment {
    /** The file name the reader sees: no path, no control characters, at most 150 characters. */
    readonly filename: string
    /** The bytes. */
    readonly content: Uint8Array
    /** The media type (`application/pdf`); required while the options list the admitted types. */
    readonly contentType?: string
}

/** One message: a one-line subject, a plain-text body and, usually, the HTML twin of it. */
export interface MailMessage {
    /** The subject, one line. */
    readonly subject: string
    /** The plain-text body; every message has one. */
    readonly text: string
    /** The HTML body. */
    readonly html?: string
    /** Files to attach, within the count and size limits of the options. */
    readonly attachments?: readonly MailAttachment[]
}

/** A message the render helpers produced: the HTML twin is always there. */
export interface RenderedMail extends MailMessage {
    readonly html: string
}

/** One call to `Mailer.send`. */
export interface SendMailRequest {
    /** One mailbox or several; the address alone (`ada@example.com`), never a display form. */
    readonly to: string | readonly string[]
    /** Visible copies: one mailbox or several, the same plain form as `to`; counted with `to` and `bcc` against `maxRecipients`. */
    readonly cc?: string | readonly string[]
    /** Hidden copies: delivered to, never written in a header (the server sees them in the SMTP envelope only). */
    readonly bcc?: string | readonly string[]
    /** The Message-ID this message answers, in its angle form (`<local@domain>`): what makes a reply thread. */
    readonly inReplyTo?: string
    /** The Message-IDs of the thread, oldest first, each in its angle form (at most 50): a reply lists its parent's References, then the parent's id. */
    readonly references?: string | readonly string[]
    /** The Message-ID of this message (`<local@domain>`) when the caller must know it before the send; omitted, the transport generates one. */
    readonly messageId?: string
    /** The message. */
    readonly message: MailMessage
    /** The From of this message when it differs from the options'. */
    readonly from?: string | { readonly name: string; readonly address: string }
    /** The Reply-To of this message when it differs from the options'. */
    readonly replyTo?: string
}

/** What the mail server answered for an accepted message. */
export interface SentMail {
    /** The message id the server or the client assigned. */
    readonly messageId: string
    /** The recipients the server accepted. */
    readonly accepted: readonly string[]
}

/**
 * The Mailer port. `send` resolves when every recipient was accepted by the server (a refused recipient rejects with
 * `MAIL_RECIPIENT`), and rejects with a `MailError` for every other failure.
 */
export interface Mailer {
    /** Sends one message to one or several mailboxes. */
    send(request: SendMailRequest): Promise<SentMail>
}
