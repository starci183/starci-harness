import { MAIL_ERROR_CODES, MailError } from "./errors.ts"
import { hasControlCharacter } from "./policy.ts"
import type { RenderedMail } from "./port.ts"

/** HTML that is already safe to place in a page: the output of `html`, `raw` or `escapeHtml`'s caller, never a bare string. */
export class SafeHtml {
    readonly #value: string

    constructor(value: string) {
        this.#value = value
    }

    toString(): string {
        return this.#value
    }
}

/** A value `html` accepts: text and numbers are escaped, a `SafeHtml` is placed as it is, a list is joined. */
export type HtmlValue = string | number | boolean | null | undefined | SafeHtml | readonly HtmlValue[]

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

/** Escapes the five characters that open markup or end an attribute; use it for any text placed in HTML, attribute values included. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? char)

/** Marks a string as trusted HTML (a fragment the template author wrote, never user input). */
export const raw = (trusted: string): SafeHtml => new SafeHtml(trusted)

const valueHtml = (value: HtmlValue): string => {
    if (value === null || value === undefined || value === false || value === true) return ""
    if (value instanceof SafeHtml) return value.toString()
    if (typeof value === "string") return escapeHtml(value)
    if (typeof value === "number") return escapeHtml(String(value))
    return value.map(valueHtml).join("")
}

/** A template literal that escapes every interpolated value: ``html`<p>${name}</p>` `` cannot carry markup from `name`. */
export const html = (strings: TemplateStringsArray, ...values: readonly HtmlValue[]): SafeHtml =>
    new SafeHtml(strings.reduce((out, chunk, index) => out + chunk + (index < values.length ? valueHtml(values[index]) : ""), ""))

/** Collapses a text to one line: every run of whitespace, line breaks included, becomes one space. */
export const oneLine = (text: string): string => text.replace(/\s+/gu, " ").trim()

/** A link target the mail may carry: an absolute `https:` (or `http:`) URL; anything else is `MAIL_MESSAGE_INVALID`. */
export const safeUrl = (value: string, protocols: readonly string[] = ["https:", "http:"]): string => {
    let parsed: URL
    try {
        parsed = new URL(value)
    } catch {
        throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "link" })
    }
    if (!protocols.includes(parsed.protocol) || hasControlCharacter(value)) throw new MailError(MAIL_ERROR_CODES.MessageInvalid, { detail: "link" })
    return parsed.toString()
}

/** The brand a transactional mail is drawn for. */
export interface MailBrand {
    /** The name in the header. */
    readonly name: string
    /** A `#rrggbb` accent for the button and the header rule; anything else falls back to the default. */
    readonly accent?: string
}

/** The button of a transactional mail. */
export interface MailAction {
    /** The label on the button. */
    readonly label: string
    /** The link it opens; an absolute https (or http) URL. */
    readonly url: string
}

/** What a transactional mail says; every field is plain text, escaped when drawn. */
export interface TransactionalMail {
    /** The language of the mail (the html `lang`). */
    readonly lang: string
    /** The subject; also the title when `heading` is left out. */
    readonly subject: string
    readonly brand: MailBrand
    /** The heading in the body. Defaults to the subject. */
    readonly heading?: string
    /** The paragraphs of the body, in order. */
    readonly paragraphs: readonly string[]
    /** The one button. */
    readonly action?: MailAction
    /** A small print line under the button (why this mail arrived, how to ignore it). */
    readonly footer?: string
}

/** The accent when the brand names none or a malformed one. */
export const DEFAULT_ACCENT = "#2563eb"

const ACCENT = /^#[0-9a-fA-F]{6}$/u

const BODY_STYLE = "margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;"
const CARD_STYLE = "max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;"

/** Draws a transactional mail (heading, paragraphs, one button, a footer) as `{ subject, text, html }` with every value escaped. */
export const renderTransactional = (mail: TransactionalMail): RenderedMail => {
    const subject = oneLine(mail.subject)
    const heading = oneLine(mail.heading ?? mail.subject)
    const accent = mail.brand.accent !== undefined && ACCENT.test(mail.brand.accent) ? mail.brand.accent : DEFAULT_ACCENT
    const url = mail.action === undefined ? null : safeUrl(mail.action.url)
    const button =
        mail.action === undefined || url === null
            ? ""
            : html`<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:12px 20px;background:${accent};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${mail.action.label}</a></p><p style="font-size:13px;color:#52525b;word-break:break-all;">${url}</p>`
    const body = html`<!doctype html><html lang="${mail.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="${BODY_STYLE}"><div style="${CARD_STYLE}"><p style="margin:0 0 16px;font-size:14px;font-weight:bold;color:${accent};">${mail.brand.name}</p><h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>${mail.paragraphs.map((paragraph) => html`<p style="margin:0 0 12px;line-height:1.5;">${paragraph}</p>`)}${button}${mail.footer === undefined ? "" : html`<p style="margin:24px 0 0;font-size:12px;color:#71717a;">${mail.footer}</p>`}</div></body></html>`
    const lines = [heading, "", ...mail.paragraphs.flatMap((paragraph) => [paragraph, ""])]
    if (mail.action !== undefined && url !== null) lines.push(`${mail.action.label}: ${url}`, "")
    if (mail.footer !== undefined) lines.push(mail.footer, "")
    lines.push(`-- ${mail.brand.name}`)
    return { subject, text: lines.join("\n"), html: body.toString() }
}
