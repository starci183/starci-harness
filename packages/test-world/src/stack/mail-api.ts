/**
 * The mail sink is REAL: the stack definition's mailpit receives what the app under test sends over SMTP, and the world reads it
 * back through mailpit's HTTP API. This is the one client of that API (the service definition resets the sink with it, the
 * spec-facing reader of the world lists and reads with it). Chaos is mailpit's own failure injection: a probability and an SMTP
 * status code at three triggers of the conversation (the sender `MAIL FROM`, the recipient `RCPT TO` and `AUTH`).
 */
import { TestWorldErrorCode, worldError } from "../errors"
import type { FetchLike } from "./health"

const TIMEOUT_MS = 15_000
const LIST_LIMIT = 500

/** One address of a message. */
export interface MailAddress {
    /** The display name, empty when the message gave none. */
    readonly name: string
    /** The address (`ann@example.com`). */
    readonly address: string
}

/** One attachment of a message. */
export interface MailAttachment {
    readonly fileName: string
    readonly contentType: string
    /** The size in bytes. */
    readonly size: number
}

/** A message as the list shows it. */
export interface MailSummary {
    /** The sink's id of the message; `read(id)` answers the whole message. */
    readonly id: string
    readonly from: MailAddress
    readonly to: ReadonlyArray<MailAddress>
    readonly cc: ReadonlyArray<MailAddress>
    /** The envelope recipients that appear in neither `to` nor `cc`. */
    readonly bcc: ReadonlyArray<MailAddress>
    readonly subject: string
    /** The first characters of the text body. */
    readonly snippet: string
    /** When the sink accepted it (ISO 8601). */
    readonly created: string
}

/** A whole message: the summary plus its decoded bodies and attachments. */
export interface MailMessage extends MailSummary {
    /** The decoded `text/plain` body, empty when the message has none. */
    readonly text: string
    /** The decoded `text/html` body, empty when the message has none. */
    readonly html: string
    readonly attachments: ReadonlyArray<MailAttachment>
}

/** The three points of an SMTP conversation where mailpit's chaos can refuse. */
export type MailRefusalPoint = "sender" | "recipient" | "authentication"

/** What a chaos trigger does: with `probability` percent of the conversations it refuses with `status`. */
export interface MailRefusal {
    /** The SMTP status code of the refusal: 4xx is a temporary failure, 5xx a permanent one. */
    readonly status: number
    /** The share of conversations refused, 0 to 100. */
    readonly probability: number
}

/** The chaos of the sink: every trigger, refusing or not. */
export type MailChaos = Readonly<Record<MailRefusalPoint, MailRefusal>>

/** The API of one sink. */
export interface MailpitApi {
    /** Every message in the sink, oldest first. */
    summaries(): Promise<ReadonlyArray<MailSummary>>
    /** One whole message. */
    message(id: string): Promise<MailMessage>
    /** Deletes every message. */
    deleteAll(): Promise<void>
    /** The chaos in force. */
    chaos(): Promise<MailChaos>
    /** Sets one trigger; the others keep what they have. */
    refuse(at: MailRefusalPoint, refusal: MailRefusal): Promise<void>
    /** Stops every trigger refusing (the codes stay, the probability is 0). */
    acceptAll(): Promise<void>
}

const WIRE_TRIGGER: Readonly<Record<MailRefusalPoint, string>> = { sender: "Sender", recipient: "Recipient", authentication: "Authentication" }
const POINTS: ReadonlyArray<MailRefusalPoint> = ["sender", "recipient", "authentication"]

/** The status mailpit shows for a trigger that was never set. */
const DEFAULT_STATUS = 451

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)
const textOf = (value: unknown): string => (typeof value === "string" ? value : "")
const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0)
const recordsOf = (value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> => (Array.isArray(value) ? value.filter(isRecord) : [])

const addressOf = (value: unknown): MailAddress => (isRecord(value) ? { name: textOf(value.Name), address: textOf(value.Address) } : { name: "", address: "" })
const addressesOf = (value: unknown): ReadonlyArray<MailAddress> => recordsOf(value).map(addressOf)

const summaryOf = (wire: Readonly<Record<string, unknown>>): MailSummary => ({
    id: textOf(wire.ID),
    from: addressOf(wire.From),
    to: addressesOf(wire.To),
    cc: addressesOf(wire.Cc),
    bcc: addressesOf(wire.Bcc),
    subject: textOf(wire.Subject),
    snippet: textOf(wire.Snippet),
    created: textOf(wire.Created),
})

const messageOf = (wire: Readonly<Record<string, unknown>>): MailMessage => ({
    ...summaryOf(wire),
    snippet: textOf(wire.Snippet) || textOf(wire.Text).slice(0, 200),
    text: textOf(wire.Text),
    html: textOf(wire.HTML),
    attachments: recordsOf(wire.Attachments).map((attachment) => ({ fileName: textOf(attachment.FileName), contentType: textOf(attachment.ContentType), size: numberOf(attachment.Size) })),
})

const chaosOf = (wire: unknown): MailChaos => {
    const body = isRecord(wire) ? wire : {}
    const refusalOf = (point: MailRefusalPoint): MailRefusal => {
        const trigger = body[WIRE_TRIGGER[point]]
        return isRecord(trigger) ? { status: numberOf(trigger.ErrorCode), probability: numberOf(trigger.Probability) } : { status: DEFAULT_STATUS, probability: 0 }
    }
    return { sender: refusalOf("sender"), recipient: refusalOf("recipient"), authentication: refusalOf("authentication") }
}

const wireOf = (chaos: MailChaos): Readonly<Record<string, unknown>> =>
    Object.fromEntries(POINTS.map((point) => [WIRE_TRIGGER[point], { ErrorCode: chaos[point].status, Probability: chaos[point].probability }]))

/** Checks a refusal before it reaches the sink, so a typo fails at the spec and not as a silent no-op. */
const checkedRefusal = (at: MailRefusalPoint, refusal: MailRefusal): void => {
    if (!Number.isInteger(refusal.status) || refusal.status < 400 || refusal.status > 599) {
        throw worldError(TestWorldErrorCode.ConfigInvalid, `mail.refuse(${at}): status must be an SMTP error code from 400 to 599, got ${String(refusal.status)}`)
    }
    if (!Number.isInteger(refusal.probability) || refusal.probability < 0 || refusal.probability > 100) {
        throw worldError(TestWorldErrorCode.ConfigInvalid, `mail.refuse(${at}): probability must be a whole percentage from 0 to 100, got ${String(refusal.probability)}`)
    }
}

/** The API client of the sink at `baseUrl` (`http://127.0.0.1:<port>`). */
export const createMailpitApi = (baseUrl: string, fetchImpl: FetchLike = fetch): MailpitApi => {
    const call = async (what: string, method: string, path: string, body?: unknown): Promise<unknown> => {
        const response = await fetchImpl(`${baseUrl}${path}`, {
            method,
            ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const text = await response.text()
        if (!response.ok) throw worldError(TestWorldErrorCode.InfrastructureFailed, `mailpit ${what} answered ${response.status}: ${text.slice(0, 300)}`)
        if (text === "" || text === "ok") return null
        try {
            return JSON.parse(text) as unknown
        } catch {
            return text
        }
    }
    const readChaos = async (): Promise<MailChaos> => chaosOf(await call("read chaos", "GET", "/api/v1/chaos"))
    return {
        summaries: async () => {
            const listed = await call("list messages", "GET", `/api/v1/messages?limit=${LIST_LIMIT}`)
            // The sink lists newest first; the world answers oldest first, like every other record of a run.
            return recordsOf(isRecord(listed) ? listed.messages : undefined).map(summaryOf).reverse()
        },
        message: async (id) => {
            const wire = await call(`read message ${id}`, "GET", `/api/v1/message/${encodeURIComponent(id)}`)
            if (!isRecord(wire)) throw worldError(TestWorldErrorCode.InfrastructureFailed, `mailpit read message ${id} answered no message`)
            return messageOf(wire)
        },
        deleteAll: async () => {
            await call("delete messages", "DELETE", "/api/v1/messages")
        },
        chaos: readChaos,
        refuse: async (at, refusal) => {
            checkedRefusal(at, refusal)
            await call(`set chaos ${at}`, "PUT", "/api/v1/chaos", wireOf({ ...(await readChaos()), [at]: refusal }))
        },
        acceptAll: async () => {
            const current = await readChaos()
            const quiet = (point: MailRefusalPoint): MailRefusal => ({ status: current[point].status >= 400 ? current[point].status : DEFAULT_STATUS, probability: 0 })
            await call("clear chaos", "PUT", "/api/v1/chaos", wireOf({ sender: quiet("sender"), recipient: quiet("recipient"), authentication: quiet("authentication") }))
        },
    }
}
