import { checkMessage, mailboxOf, messageIdOf, recipientListsOf, referencesOf, senderOf } from "./policy.ts"
import type { ResolvedMailOptions } from "./options.ts"
import type { Mailer, SendMailRequest, SentMail } from "./port.ts"
import type { MailTransport } from "./transport.ts"

/** The Mailer port over a transport: checks the recipients (To, Cc, Bcc), the thread headers, the sender and the message, then hands one envelope over. */
export class MailService implements Mailer {
    readonly #transport: MailTransport
    readonly #options: ResolvedMailOptions

    constructor(transport: MailTransport, options: ResolvedMailOptions) {
        this.#transport = transport
        this.#options = options
    }

    async send(request: SendMailRequest): Promise<SentMail> {
        const { to, cc, bcc } = recipientListsOf(request, this.#options.maxRecipients)
        const inReplyTo = request.inReplyTo === undefined ? null : messageIdOf(request.inReplyTo, "inReplyTo")
        const references = request.references === undefined ? [] : referencesOf(request.references)
        const messageId = request.messageId === undefined ? null : messageIdOf(request.messageId, "messageId")
        checkMessage(request.message, this.#options)
        const from = senderOf(request.from ?? this.#options.from)
        const replyTo = request.replyTo ?? this.#options.replyTo
        return this.#transport.deliver({
            from,
            replyTo: replyTo === null ? null : mailboxOf(replyTo),
            to,
            cc,
            bcc,
            inReplyTo,
            references,
            messageId,
            subject: request.message.subject,
            text: request.message.text,
            html: request.message.html ?? null,
            attachments: request.message.attachments ?? [],
        })
    }

    /** Closes the connection the transport holds; the Nest module calls it at shutdown. */
    onModuleDestroy(): void {
        this.#transport.close()
    }
}
