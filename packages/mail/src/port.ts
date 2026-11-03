/** One message: a one-line subject, a plain-text body and, usually, the HTML twin of it. */
export interface MailMessage {
    /** The subject, one line. */
    readonly subject: string
    /** The plain-text body; every message has one. */
    readonly text: string
    /** The HTML body. */
    readonly html?: string
}

/** A message the render helpers produced: the HTML twin is always there. */
export interface RenderedMail extends MailMessage {
    readonly html: string
}

/** One call to `Mailer.send`. */
export interface SendMailRequest {
    /** One mailbox or several; the address alone (`ada@example.com`), never a display form. */
    readonly to: string | readonly string[]
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
