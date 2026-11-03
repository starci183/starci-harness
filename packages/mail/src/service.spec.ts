import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MAIL_ERROR_CODES, MAIL_ERROR_KINDS, MailError, isValidMailbox } from "./index.ts"
import type { MailMessage } from "./index.ts"
import { resolveMailOptions } from "./options.ts"
import { createMemoryMailer, testMailOptions } from "./testing/index.ts"

const message: MailMessage = { subject: "Hello", text: "Open https://app.test/confirm?token=abc to confirm.", html: "<p>Hello</p>" }

const refused = async (action: Promise<unknown>): Promise<MailError> => {
    try {
        await action
    } catch (error) {
        assert.ok(error instanceof MailError)
        return error
    }
    return assert.fail("the send should have been refused")
}

describe("mailboxes", () => {
    it("accepts plain mailboxes", () => {
        for (const good of ["ada@example.com", "a.b+tag@sub.example.co.uk", "o'neil@example.com", "x@a-b.example"]) assert.equal(isValidMailbox(good), true, good)
    })

    it("refuses display forms, line breaks, missing parts and over-long parts", () => {
        const long = `${"a".repeat(65)}@example.com`
        for (const bad of ["", "ada", "ada@", "@example.com", "ada@example", "Ada <ada@example.com>", "ada@example.com\nBcc: x@y.test", "a..b@example.com", ".a@example.com", "ada@-example.com", "ada@exa mple.com", long, `${"a".repeat(250)}@example.com`]) {
            assert.equal(isValidMailbox(bad), false, JSON.stringify(bad))
        }
    })
})

describe("Mailer checks (the same in the SMTP port and the memory outbox)", () => {
    it("accepts a message and records the envelope, the bodies and the first link", async () => {
        const mailer = createMemoryMailer(testMailOptions({ replyTo: "help@app.test" }))
        const sent = await mailer.send({ to: " Ada@Example.com ", message })
        assert.deepEqual(sent.accepted, ["Ada@Example.com"])
        const mail = mailer.outbox[0]
        assert.ok(mail)
        assert.deepEqual(mail.from, { name: "App", address: "no-reply@app.test" })
        assert.equal(mail.replyTo, "help@app.test")
        assert.equal(mail.subject, "Hello")
        assert.equal(mail.html, "<p>Hello</p>")
        assert.equal(mail.link, "https://app.test/confirm?token=abc")
        assert.equal(mailer.lastTo("ada@example.com"), mail)
        assert.equal(mailer.to("nobody@example.com").length, 0)
    })

    it("lets a call name its own sender and reply-to, and sends a text-only message without an html part", async () => {
        const mailer = createMemoryMailer()
        await mailer.send({ to: "ada@example.com", message: { subject: "Plain", text: "No links here." }, from: "ops@app.test", replyTo: "reply@app.test" })
        const mail = mailer.outbox[0]
        assert.ok(mail)
        assert.deepEqual(mail.from, { name: "", address: "ops@app.test" })
        assert.equal(mail.replyTo, "reply@app.test")
        assert.equal(mail.html, null)
        assert.equal(mail.link, null)
    })

    it("drops a repeated recipient, ignoring case", async () => {
        const mailer = createMemoryMailer()
        const sent = await mailer.send({ to: ["ada@example.com", "ADA@example.com", "grace@example.com"], message })
        assert.deepEqual(sent.accepted, ["ada@example.com", "grace@example.com"])
    })

    it("refuses a bad recipient, sender or reply-to with MAIL_ADDRESS_INVALID, sending nothing", async () => {
        const mailer = createMemoryMailer()
        for (const request of [
            { to: "not-an-address", message },
            { to: ["ada@example.com", "bad"], message },
            { to: "ada@example.com", message, from: "Display <x@y.test>" },
            { to: "ada@example.com", message, from: { name: "Evil\r\nBcc: x@y.test", address: "a@b.test" } },
            { to: "ada@example.com", message, replyTo: "x\ny@b.test" },
        ]) {
            const error = await refused(mailer.send(request))
            assert.equal(error.code, MAIL_ERROR_CODES.AddressInvalid)
            assert.equal(error.kind, "invalid")
        }
        assert.equal(mailer.outbox.length, 0)
    })

    it("refuses no recipient, too many recipients, an empty or multi-line subject, no text and an over-long body with MAIL_MESSAGE_INVALID", async () => {
        const mailer = createMemoryMailer(testMailOptions({ maxRecipients: 2, maxBodyBytes: 100 }))
        for (const request of [
            { to: [], message },
            { to: ["a@x.test", "b@x.test", "c@x.test"], message },
            { to: "a@x.test", message: { ...message, subject: "  " } },
            { to: "a@x.test", message: { ...message, subject: "Hi\r\nBcc: x@y.test" } },
            { to: "a@x.test", message: { ...message, subject: "s".repeat(201) } },
            { to: "a@x.test", message: { ...message, text: " " } },
            { to: "a@x.test", message: { ...message, text: "t".repeat(101) } },
        ]) {
            const error = await refused(mailer.send(request))
            assert.equal(error.code, MAIL_ERROR_CODES.MessageInvalid, JSON.stringify(request).slice(0, 60))
        }
        assert.equal(mailer.outbox.length, 0)
    })

    it("fails the next sends on demand with the injected code and recovers", async () => {
        const mailer = createMemoryMailer()
        mailer.failNext(MAIL_ERROR_CODES.Connect, 2)
        assert.equal((await refused(mailer.send({ to: "a@x.test", message }))).code, MAIL_ERROR_CODES.Connect)
        assert.equal((await refused(mailer.send({ to: "a@x.test", message }))).kind, "unavailable")
        await mailer.send({ to: "a@x.test", message })
        assert.equal(mailer.outbox.length, 1)
        mailer.clear()
        assert.equal(mailer.outbox.length, 0)
    })

    it("closes its transport at shutdown", () => {
        const mailer = createMemoryMailer()
        mailer.onModuleDestroy()
        assert.ok(mailer)
    })
})

describe("options", () => {
    it("applies the defaults", () => {
        const resolved = resolveMailOptions({ host: "smtp.app.test", port: 587, from: "a@b.test" })
        assert.equal(resolved.security, "starttls")
        assert.equal(resolved.allowSelfSigned, false)
        assert.equal(resolved.sendTimeoutMs, 30_000)
        assert.equal(resolved.maxRecipients, 20)
        assert.equal(resolved.maxBodyBytes, 1_048_576)
    })

    it("refuses a port outside 1-65535 and a non-positive timeout or limit when the options are built", () => {
        for (const port of [0, 70_000, 25.5]) assert.throws(() => resolveMailOptions({ host: "h", port, from: "a@b.test" }), RangeError)
        for (const field of ["connectionTimeoutMs", "greetingTimeoutMs", "socketTimeoutMs", "sendTimeoutMs", "maxRecipients", "maxBodyBytes"] as const) {
            assert.throws(() => resolveMailOptions({ host: "h", port: 25, from: "a@b.test", [field]: 0 }), RangeError, field)
        }
    })

    it("travels every code as one of three kinds", () => {
        for (const kind of Object.values(MAIL_ERROR_KINDS)) assert.ok(["invalid", "rate-limited", "unavailable"].includes(kind))
        assert.equal(Object.keys(MAIL_ERROR_KINDS).length, Object.keys(MAIL_ERROR_CODES).length)
    })
})
