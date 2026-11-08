/**
 * The spec-facing reader of the mail sink: what the app under test sent, read back through the sink's HTTP API, and the
 * refusals the sink can be told to make. It reads the container's own API port, never toxiproxy, so an outage a spec injects
 * on SMTP cannot blind it.
 */
import { createMailpitApi } from "../stack/mail-api"
import type { MailMessage, MailRefusal, MailRefusalPoint, MailSummary, MailpitApi } from "../stack/mail-api"

/** How `mail.waitFor` picks and polls. */
export interface MailWaitOptions {
    /** Only a message whose subject equals this string, or matches this expression. */
    readonly subject?: string | RegExp
    /** The deadline in milliseconds (default 30000). */
    readonly timeoutMs?: number
    /** The pause between two checks in milliseconds (default 250). */
    readonly intervalMs?: number
}

/** How a refusal is made; both default to a permanent, certain refusal. */
export interface MailRefuseOptions {
    /** The SMTP status code, 400 to 599 (default 550: a 4xx is temporary, a 5xx permanent). */
    readonly status?: number
    /** The share of conversations refused, 0 to 100 (default 100: every one). */
    readonly probability?: number
}

/** The handle behind `world.mail`: the real mail sink of the stack. */
export interface WorldMail {
    /** The messages in the sink, oldest first; with `to`, only those addressed to that address (To, Cc or Bcc, case-insensitive). */
    messages(to?: string): Promise<ReadonlyArray<MailSummary>>
    /** One whole message by id: subject, `text`, `html`, addresses and attachments. */
    read(id: string): Promise<MailMessage>
    /** Waits until a message addressed to `to` (and matching `options.subject`) is in the sink and answers the newest such message whole. */
    waitFor(to: string, options?: MailWaitOptions): Promise<MailMessage>
    /** Deletes every message (each spec file starts with an empty sink anyway). */
    clear(): Promise<void>
    /**
     * Makes the sink refuse the SMTP conversation at `at` until `acceptAll`: `sender` answers `MAIL FROM`, `recipient` answers
     * `RCPT TO`, `authentication` answers `AUTH`. A refusal in force when the spec file ends is cleared by the next reset.
     * What chaos cannot do (a silent server, a refused connection) is the outage of `world.infra.mail`: `stall()` and `cut()`.
     */
    refuse(at: MailRefusalPoint, options?: MailRefuseOptions): Promise<void>
    /** Stops every refusal. */
    acceptAll(): Promise<void>
}

/** How the reader polls: the world's own poller, handed in so the deadline message and defaults stay the world's. */
export type MailPoll = <T>(label: string, probe: () => Promise<T | null | undefined>, options: Pick<MailWaitOptions, "timeoutMs" | "intervalMs">) => Promise<T>

const DEFAULT_REFUSAL: MailRefusal = { status: 550, probability: 100 }

const addressedTo = (summary: MailSummary, to: string): boolean => {
    const wanted = to.trim().toLowerCase()
    return [...summary.to, ...summary.cc, ...summary.bcc].some((entry) => entry.address.toLowerCase() === wanted)
}

const subjectMatches = (subject: string, wanted: string | RegExp | undefined): boolean => (wanted === undefined ? true : typeof wanted === "string" ? subject === wanted : wanted.test(subject))

/** The reader over a sink API; `api` is injected so the reader is unit-tested without a container. */
export const createWorldMailFrom = (api: MailpitApi, poll: MailPoll): WorldMail => {
    const messages = async (to?: string): Promise<ReadonlyArray<MailSummary>> => {
        const all = await api.summaries()
        return to === undefined ? all : all.filter((summary) => addressedTo(summary, to))
    }
    return {
        messages,
        read: (id) => api.message(id),
        waitFor: async (to, options = {}) => {
            const found = await poll(
                `a mail to ${to}${options.subject === undefined ? "" : ` with the subject ${String(options.subject)}`}`,
                async () => (await messages(to)).filter((summary) => subjectMatches(summary.subject, options.subject)).at(-1) ?? null,
                options,
            )
            return api.message(found.id)
        },
        clear: () => api.deleteAll(),
        refuse: (at, options = {}) => api.refuse(at, { status: options.status ?? DEFAULT_REFUSAL.status, probability: options.probability ?? DEFAULT_REFUSAL.probability }),
        acceptAll: () => api.acceptAll(),
    }
}

/** The reader of the sink whose HTTP API answers at `apiUrl`. */
export const createWorldMail = (apiUrl: string, poll: MailPoll): WorldMail => createWorldMailFrom(createMailpitApi(apiUrl), poll)
