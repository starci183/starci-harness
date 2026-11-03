import { checkMessage, mailboxOf, recipientsOf, senderOf } from "./policy.ts"
import type { ResolvedMailOptions } from "./options.ts"
import type { Mailer, SendMailRequest, SentMail } from "./port.ts"
import type { MailTransport } from "./transport.ts"

/** The Mailer port over a transport: checks the recipients, the sender and the message, then hands one envelope over. */
export class MailService implements Mailer {
    readonly #transport: MailTransport
    readonly #options: ResolvedMailOptions

    constructor(transport: MailTransport, options: ResolvedMailOptions) {
        this.#transport = transport
        this.#options = options
    }

    async send(request: SendMailRequest): Promise<SentMail> {
        const to = recipientsOf(request.to, this.#options.maxRecipients)
        checkMessage(request.message, this.#options)
        const from = senderOf(request.from ?? this.#options.from)
        const replyTo = request.replyTo ?? this.#options.replyTo
        return this.#transport.deliver({
            from,
            replyTo: replyTo === null ? null : mailboxOf(replyTo),
            to,
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
