import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { MailMessage, MailRefusal, MailRefusalPoint, MailSummary, MailpitApi } from "../stack/mail-api"
import { createWorldMailFrom } from "./mail"
import type { MailPoll } from "./mail"

const summary = (id: string, subject: string, to: string, extra: Partial<MailSummary> = {}): MailSummary => ({
    id,
    from: { name: "", address: "noreply@shop.test" },
    to: [{ name: "", address: to }],
    cc: [],
    bcc: [],
    subject,
    snippet: "",
    created: "2026-11-08T10:00:00Z",
    ...extra,
})

const sinkOf = (summaries: Array<MailSummary>) => {
    const refusals: Array<readonly [MailRefusalPoint, MailRefusal]> = []
    let cleared = 0
    let accepted = 0
    const api: MailpitApi = {
        summaries: async () => summaries,
        message: async (id): Promise<MailMessage> => {
            const found = summaries.find((entry) => entry.id === id)
            if (found === undefined) throw new Error(`no message ${id}`)
            return { ...found, text: `text of ${id}`, html: "", attachments: [] }
        },
        deleteAll: async () => {
            cleared += 1
        },
        chaos: async () => ({ sender: { status: 451, probability: 0 }, recipient: { status: 451, probability: 0 }, authentication: { status: 535, probability: 0 } }),
        refuse: async (at, refusal) => {
            refusals.push([at, refusal])
        },
        acceptAll: async () => {
            accepted += 1
        },
    }
    return { api, refusals, counts: () => ({ cleared, accepted }) }
}

/** A poller that probes up to five times without sleeping, then fails naming what it waited for. */
const poller = (): MailPoll => async (label, probe, options) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const observed = await probe()
        if (observed) return observed
    }
    throw new Error(`timed out waiting for ${label} (${String(options.timeoutMs)})`)
}

describe("world mail", () => {
    it("lists every message, or only those addressed to an address in To, Cc or Bcc, ignoring case", async () => {
        const { api } = sinkOf([
            summary("m1", "Welcome", "Ann@Example.com"),
            summary("m2", "Copy", "bo@example.com", { cc: [{ name: "", address: "ann@example.com" }] }),
            summary("m3", "Hidden", "bo@example.com", { bcc: [{ name: "", address: "ann@example.com" }] }),
            summary("m4", "Other", "bo@example.com"),
        ])
        const mail = createWorldMailFrom(api, poller())
        assert.equal((await mail.messages()).length, 4)
        assert.deepEqual(
            (await mail.messages(" ann@example.com ")).map((entry) => entry.id),
            ["m1", "m2", "m3"],
        )
        assert.deepEqual(await mail.messages("nobody@example.com"), [])
    })

    it("waitFor answers the newest matching message whole, by subject when asked", async () => {
        const { api } = sinkOf([
            summary("m1", "Confirm your email", "ann@example.com"),
            summary("m2", "Reset your password", "ann@example.com"),
            summary("m3", "Confirm your email", "ann@example.com"),
            summary("m4", "Confirm your email", "bo@example.com"),
        ])
        const mail = createWorldMailFrom(api, poller())
        assert.equal((await mail.waitFor("ann@example.com")).id, "m3")
        assert.equal((await mail.waitFor("ann@example.com", { subject: "Reset your password" })).text, "text of m2")
        assert.equal((await mail.waitFor("ann@example.com", { subject: /^reset/i })).id, "m2")
        assert.equal((await mail.read("m1")).subject, "Confirm your email")
    })

    it("waitFor polls until the message arrives and names what it waited for when it never does", async () => {
        const arrivals: Array<MailSummary> = []
        const { api } = sinkOf(arrivals)
        const mail = createWorldMailFrom(api, async (label, probe, options) => {
            arrivals.push(summary("late", "Late", "ann@example.com"))
            return poller()(label, probe, options)
        })
        assert.equal((await mail.waitFor("ann@example.com", { timeoutMs: 10 })).id, "late")
        const { api: empty } = sinkOf([])
        await assert.rejects(createWorldMailFrom(empty, poller()).waitFor("ann@example.com", { subject: "Welcome", timeoutMs: 7 }), /a mail to ann@example.com with the subject Welcome \(7\)/)
    })

    it("refuses with a permanent, certain 550 by default, and clears and accepts through the sink", async () => {
        const { api, refusals, counts } = sinkOf([])
        const mail = createWorldMailFrom(api, poller())
        await mail.refuse("recipient")
        await mail.refuse("sender", { status: 452, probability: 30 })
        await mail.refuse("authentication", { status: 535 })
        assert.deepEqual(refusals, [
            ["recipient", { status: 550, probability: 100 }],
            ["sender", { status: 452, probability: 30 }],
            ["authentication", { status: 535, probability: 100 }],
        ])
        await mail.clear()
        await mail.acceptAll()
        assert.deepEqual(counts(), { cleared: 1, accepted: 1 })
    })
})
