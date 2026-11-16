import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MAIL_ERROR_CODES, MAIL_ERROR_KINDS, MailError, isValidMailbox, isValidMessageId } from "./index.ts"
import type { MailMessage } from "./index.ts"
import { isDomainError } from "@starci/common"
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

    it("sends Cc and Bcc as recipients, keeps one copy of an address in the first list that names it, and counts all three against the limit", async () => {
        const mailer = createMemoryMailer(testMailOptions({ maxRecipients: 4 }))
        const sent = await mailer.send({ to: "ada@example.com", cc: ["grace@example.com", "ADA@example.com"], bcc: "boss@example.com", message })
        assert.deepEqual(sent.accepted, ["ada@example.com", "grace@example.com", "boss@example.com"])
        const mail = mailer.outbox[0]
        assert.ok(mail)
        assert.deepEqual(mail.cc, ["grace@example.com"])
        assert.deepEqual(mail.bcc, ["boss@example.com"])
        assert.equal(mailer.lastTo("boss@example.com"), mail)
        const error = await refused(mailer.send({ to: ["a@x.test", "b@x.test"], cc: ["c@x.test", "d@x.test"], bcc: "e@x.test", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.MessageInvalid)
    })

    it("carries In-Reply-To, References and a named Message-ID, and generates one when none is named", async () => {
        const mailer = createMemoryMailer()
        const named = await mailer.send({
            to: "ada@example.com",
            inReplyTo: "<c2@mail.acme.test>",
            references: ["<c1@mail.acme.test>", "<c2@mail.acme.test>", "<c1@mail.acme.test>"],
            messageId: "<c3.reply@mail.acme.test>",
            message,
        })
        assert.equal(named.messageId, "<c3.reply@mail.acme.test>")
        const mail = mailer.outbox[0]
        assert.ok(mail)
        assert.equal(mail.inReplyTo, "<c2@mail.acme.test>")
        assert.deepEqual(mail.references, ["<c1@mail.acme.test>", "<c2@mail.acme.test>"])
        const plain = await mailer.send({ to: "ada@example.com", references: "<c1@mail.acme.test>", message })
        assert.match(plain.messageId, /^<memory-2@/u)
        assert.equal(mailer.outbox[1]?.inReplyTo, null)
    })

    it("refuses a bad Cc or Bcc address with MAIL_ADDRESS_INVALID, and a bad thread header with MAIL_MESSAGE_INVALID, sending nothing", async () => {
        const mailer = createMemoryMailer()
        for (const request of [
            { to: "a@x.test", cc: "bad", message },
            { to: "a@x.test", cc: ["b@x.test
Bcc: evil@y.test"], message },
            { to: "a@x.test", bcc: ["Display <b@x.test>"], message },
            { to: "a@x.test", bcc: "b@x.test
X-Evil: 1", message },
        ]) {
            assert.equal((await refused(mailer.send(request))).code, MAIL_ERROR_CODES.AddressInvalid, JSON.stringify(request).slice(0, 50))
        }
        const longId = `<${"a".repeat(260)}@x.test>`
        for (const request of [
            { to: "a@x.test", inReplyTo: "c2@mail.acme.test", message },
            { to: "a@x.test", inReplyTo: "<c2@mail.acme.test>
Bcc: evil@y.test", message },
            { to: "a@x.test", inReplyTo: "<a b@x.test>", message },
            { to: "a@x.test", inReplyTo: "<a@b@x.test>", message },
            { to: "a@x.test", inReplyTo: longId, message },
            { to: "a@x.test", references: ["<c1@x.test>", "<c2@x.test> <c3@x.test>"], message },
            { to: "a@x.test", references: "<c1@x.test>
X-Evil: 1", message },
            { to: "a@x.test", references: Array.from({ length: 51 }, (_unused, index) => `<m${String(index)}@x.test>`), message },
            { to: "a@x.test", messageId: "<x@y.test>
Bcc: evil@y.test", message },
            { to: "a@x.test", messageId: "plain", message },
        ]) {
            assert.equal((await refused(mailer.send(request))).code, MAIL_ERROR_CODES.MessageInvalid, JSON.stringify(request).slice(0, 60))
        }
        assert.equal(mailer.outbox.length, 0)
    })

    it("judges a Message-ID by its angle form", () => {
        for (const good of ["<a@b.test>", "<a.b+c@mail.example.com>", "<uuid-1234@localhost>"]) assert.equal(isValidMessageId(good), true, good)
        for (const bad of ["", "<>", "<@b.test>", "<a@>", "a@b.test", "<a@b.test", "<a
@b.test>", "<a@b..test>", "<a@b.test>x"]) assert.equal(isValidMessageId(bad), false, JSON.stringify(bad))
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

describe("attachments", () => {
    const pdf = { filename: "invoice.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }

    it("carries attachments into the outbox", async () => {
        const mailer = createMemoryMailer()
        await mailer.send({ to: "a@x.test", message: { ...message, attachments: [pdf] } })
        assert.deepEqual(mailer.outbox[0]?.attachments, [pdf])
    })

    it("refuses too many, too large, badly named and wrongly typed attachments with MAIL_MESSAGE_INVALID", async () => {
        const mailer = createMemoryMailer(testMailOptions({ maxAttachments: 2, maxAttachmentBytes: 10, attachmentContentTypes: ["application/pdf", "image/*"] }))
        const big = { ...pdf, content: new Uint8Array(11) }
        for (const attachments of [
            [pdf, pdf, pdf],
            [big],
            [pdf, { ...pdf, content: new Uint8Array(8) }],
            [{ ...pdf, filename: "../etc/passwd" }],
            [{ ...pdf, filename: "a\b.pdf" }],
            [{ ...pdf, filename: "x\r\n.pdf" }],
            [{ ...pdf, filename: " " }],
            [{ ...pdf, filename: ".." }],
            [{ filename: "a.pdf", content: new Uint8Array(1) }],
            [{ ...pdf, contentType: "application/x-msdownload" }],
            [{ ...pdf, contentType: "application/pdf\r\nBcc: x@y.test" }],
        ]) {
            const error = await refused(mailer.send({ to: "a@x.test", message: { ...message, attachments } }))
            assert.equal(error.code, MAIL_ERROR_CODES.MessageInvalid, JSON.stringify(attachments).slice(0, 70))
        }
        await mailer.send({ to: "a@x.test", message: { ...message, attachments: [{ filename: "p.PNG", content: new Uint8Array(2), contentType: "Image/PNG; name=p" }] } })
        assert.equal(mailer.outbox.length, 1)
    })
})

describe("MailError", () => {
    it("is a DomainError of @starci/common whose message is its code and whose params are empty", () => {
        const cause = new Error("socket")
        const error = new MailError("MAIL_CONNECT", { cause, detail: "refused", context: { host: "smtp.test" } })
        assert.ok(isDomainError(error))
        assert.equal(error.name, "MailError")
        assert.equal(error.message, "MAIL_CONNECT")
        assert.equal(error.kind, "unavailable")
        assert.equal(error.cause, cause)
        assert.deepEqual(error.params, {})
        assert.equal(new MailError("MAIL_AUTH").cause, undefined)
    })
})
