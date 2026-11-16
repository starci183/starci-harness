import { MAIL_ERROR_CODES, MailError } from "./errors.ts"
import type { MailSender, ResolvedMailOptions } from "./options.ts"
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

/**
 * The To, Cc and Bcc lists of one call as three lists of valid mailboxes. An address already in an earlier list (To, then Cc,
 * then Bcc, compared ignoring case) is dropped from the later one, so the server never gets it twice; To is required, Cc and
 * Bcc are optional, and the three together are at most `max`.
 */
export const recipientListsOf = (
    request: { readonly to: string | readonly string[]; readonly cc?: string | readonly string[]; readonly bcc?: string | readonly string[] },
    max: number,
): { readonly to: readonly string[]; readonly cc: readonly string[]; readonly bcc: readonly string[] } => {
    const listOf = (value: string | readonly string[] | undefined): readonly string[] => (value === undefined ? [] : typeof value === "string" ? [value] : value)
    const toList = listOf(request.to)
    const ccList = listOf(request.cc)
    const bccList = listOf(request.bcc)
    const total = toList.length + ccList.length + bccList.length
    if (toList.length === 0 || total > max) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `recipients ${String(total)} of at most ${String(max)}` })
    const seen = new Set<string>()
    const take = (list: readonly string[]): readonly string[] => {
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
    return { to: take(toList), cc: take(ccList), bcc: take(bccList) }
}

const MAX_MESSAGE_ID_LENGTH = 255
const MAX_REFERENCES = 50
const ID_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u

/** Whether a text is a Message-ID in its angle form (`<local@domain>`): dot-atoms on both sides, no whitespace, control characters or inner brackets. */
export const isValidMessageId = (value: string): boolean => {
    if (value.length > MAX_MESSAGE_ID_LENGTH || !value.startsWith("<") || !value.endsWith(">")) return false
    const inner = value.slice(1, -1)
    const at = inner.indexOf("@")
    if (at < 1 || at !== inner.lastIndexOf("@")) return false
    return ID_ATOM.test(inner.slice(0, at)) && ID_ATOM.test(inner.slice(at + 1))
}

/** A Message-ID that passed `isValidMessageId`, or a `MAIL_MESSAGE_INVALID` rejection naming the field. */
export const messageIdOf = (value: string, field: string): string => {
    if (!isValidMessageId(value)) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `${field} ${JSON.stringify(value.slice(0, 80))}` })
    return value
}

/** The References of a reply: one id or a list, each a valid Message-ID, none repeated, at most fifty. */
export const referencesOf = (references: string | readonly string[]): readonly string[] => {
    const list = typeof references === "string" ? [references] : references
    if (list.length > MAX_REFERENCES) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `references ${String(list.length)} of at most ${String(MAX_REFERENCES)}` })
    return [...new Set(list.map((entry) => messageIdOf(entry, "references")))]
}

/** A sender as a name and a valid mailbox; the display name is one line of at most a hundred characters. */
export const senderOf = (sender: MailSender): { readonly name: string; readonly address: string } => {
    if (typeof sender === "string") return { name: "", address: mailboxOf(sender) }
    if (hasControlCharacter(sender.name) || sender.name.length > MAX_NAME_LENGTH) throw invalidAddress(sender.name)
    return { name: sender.name, address: mailboxOf(sender.address) }
}

const MAX_FILENAME_LENGTH = 150

const typeOf = (contentType: string): string => (contentType.split(";")[0] ?? "").trim().toLowerCase()

/** Whether a media type is admitted by a list of exact types and families (`image/*`). */
export const admitsContentType = (admitted: readonly string[], contentType: string): boolean => {
    const type = typeOf(contentType)
    return admitted.some((entry) => {
        const wanted = entry.trim().toLowerCase()
        return wanted.endsWith("/*") ? type.startsWith(wanted.slice(0, -1)) : type === wanted
    })
}

const checkAttachments = (message: MailMessage, options: ResolvedMailOptions): void => {
    const files = message.attachments ?? []
    if (files.length > options.maxAttachments) {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `attachments ${String(files.length)} of at most ${String(options.maxAttachments)}` })
    }
    let bytes = 0
    for (const file of files) {
        const name = file.filename
        if (name.trim() === "" || name.length > MAX_FILENAME_LENGTH || name === "." || name === ".." || /[\\/]/u.test(name) || hasControlCharacter(name)) {
            throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "attachment name" })
        }
        if (file.contentType !== undefined && hasControlCharacter(file.contentType)) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "attachment type" })
        if (options.attachmentContentTypes !== null && (file.contentType === undefined || !admitsContentType(options.attachmentContentTypes, file.contentType))) {
            throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `attachment type ${file.contentType ?? "none"}` })
        }
        bytes += file.content.byteLength
    }
    if (bytes > options.maxAttachmentBytes) {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `attachments ${String(bytes)} bytes of at most ${String(options.maxAttachmentBytes)}` })
    }
}

/** Checks a message against the limits: a one-line subject, a text body, bodies under `maxBodyBytes`, attachments within their count, size, name and type limits. */
export const checkMessage = (message: MailMessage, options: ResolvedMailOptions): void => {
    if (message.subject.trim() === "" || message.subject.length > MAX_SUBJECT_LENGTH || hasControlCharacter(message.subject)) {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "subject" })
    }
    if (message.text.trim() === "") throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "text" })
    const bytes = Buffer.byteLength(message.text) + Buffer.byteLength(message.html ?? "")
    if (bytes > options.maxBodyBytes) {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: `body ${String(bytes)} bytes of at most ${String(options.maxBodyBytes)}` })
    }
    checkAttachments(message, options)
}
