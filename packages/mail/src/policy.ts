import { MAIL_ERROR_CODES, MailError } from "./errors.ts"
import type { MailSender } from "./options.ts"
import type { MailMessage } from "./port.ts"

const MAX_ADDRESS_LENGTH = 254
const MAX_LOCAL_LENGTH = 64
const MAX_LABEL_LENGTH = 63
const MAX_SUBJECT_LENGTH = 200
const MAX_NAME_LENGTH = 100

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u

/** Whether a text is a plain mailbox (`local@domain`): ASCII, no display name, no angle brackets, no whitespace or control characters. */
export const isValidMailbox = (value: string): boolean => {
    if (value.length > MAX_ADDRESS_LENGTH) return false
    const at = value.lastIndexOf("@")
    if (at < 1) return false
    const local = value.slice(0, at)
    const domain = value.slice(at + 1)
    if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return false
    const labels = domain.split(".")
    return labels.length >= 2 && labels.every((label) => label.length <= MAX_LABEL_LENGTH && DOMAIN_LABEL.test(label))
}

/** Whether a text holds a control character (a line break, a NUL): what header injection is made of. */
export const hasControlCharacter = (value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        if (code < 0x20 || code === 0x7f) return true
    }
    return false
}

const invalidAddress = (value: string): MailError => new MailError(MAIL_ERROR_CODES.AddressInvalid, { detail: value.slice(0, 80) })

/** A mailbox that passed `isValidMailbox`, or an `MAIL_ADDRESS_INVALID` rejection. */
export const mailboxOf = (value: string): string => {
    const trimmed = value.trim()
    if (!isValidMailbox(trimmed)) throw invalidAddress(value)
    return trimmed
}

/** The recipients of a call, each a valid mailbox, none repeated (compared ignoring case), at most `max`. */
export const recipientsOf = (to: string | readonly string[], max: number): readonly string[] => {
    const list = typeof to === "string" ? [to] : to
    if (list.length === 0 || list.length > max) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `recipients ${String(list.length)} of at most ${String(max)}` })
    const seen = new Set<string>()
    const out: string[] = []
    for (const entry of list) {
        const mailbox = mailboxOf(entry)
        if (!seen.has(mailbox.toLowerCase())) {
            seen.add(mailbox.toLowerCase())
            out.push(mailbox)
        }
    }
    return out
}

/** A sender as a name and a valid mailbox; the display name is one line of at most a hundred characters. */
export const senderOf = (sender: MailSender): { readonly name: string; readonly address: string } => {
    if (typeof sender === "string") return { name: "", address: mailboxOf(sender) }
    if (hasControlCharacter(sender.name) || sender.name.length > MAX_NAME_LENGTH) throw invalidAddress(sender.name)
    return { name: sender.name, address: mailboxOf(sender.address) }
}

/** Checks a message against the limits: a one-line subject, a text body, bodies together under `maxBodyBytes`. */
export const checkMessage = (message: MailMessage, maxBodyBytes: number): void => {
    if (message.subject.trim() === "" || message.subject.length > MAX_SUBJECT_LENGTH || hasControlCharacter(message.subject)) {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "subject" })
    }
    if (message.text.trim() === "") throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "text" })
    const bytes = Buffer.byteLength(message.text) + Buffer.byteLength(message.html ?? "")
    if (bytes > maxBodyBytes) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `body ${String(bytes)} bytes of at most ${String(maxBodyBytes)}` })
}
