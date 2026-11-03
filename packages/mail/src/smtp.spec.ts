import assert from "node:assert/strict"
import { createServer } from "node:net"
import type { AddressInfo, Server, Socket } from "node:net"
import { afterEach, describe, it } from "node:test"
import { MAIL_ERROR_CODES, MailError, classifySmtpFailure, createMailer, renderTransactional } from "./index.ts"
import type { MailOptions } from "./index.ts"
import { resolveMailOptions } from "./options.ts"
import { smtpSettings } from "./smtp.ts"

/** What the fake server saw. */
interface Received {
    readonly from: string
    readonly to: readonly string[]
    readonly raw: string
}

/** How the fake server misbehaves. */
interface Behaviour {
    /** Never greets. */
    silent?: boolean
    /** Refuses these recipients with 550. */
    refuseRecipients?: readonly string[]
    /** Answers the end of DATA with this status line instead of accepting. */
    dataAnswer?: string
    /** Never answers the end of DATA. */
    stallAfterData?: boolean
}

const decodeQuotedPrintable = (text: string): string =>
    text.replace(/=\r?\n/gu, "").replace(/=([0-9A-F]{2})/gu, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

/** A small SMTP server on a random local port: no STARTTLS, the verbs a send uses. */
class FakeSmtp {
    readonly received: Received[] = []
    readonly #server: Server
    readonly #sockets = new Set<Socket>()
    readonly behaviour: Behaviour
    port = 0

    constructor(behaviour: Behaviour = {}) {
        this.behaviour = behaviour
        this.#server = createServer((socket) => {
            this.#sockets.add(socket)
            socket.on("close", () => this.#sockets.delete(socket))
            socket.on("error", () => undefined)
            this.#talk(socket)
        })
    }

    async listen(): Promise<void> {
        await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve))
        this.port = (this.#server.address() as AddressInfo).port
    }

    async close(): Promise<void> {
        for (const socket of this.#sockets) socket.destroy()
        await new Promise<void>((resolve) => {
            this.#server.close(() => {
                resolve()
            })
        })
    }

    #talk(socket: Socket): void {
        const say = (line: string): void => {
            socket.write(`${line}\r\n`)
        }
        if (this.behaviour.silent !== true) say("220 fake.test ESMTP ready")
        let buffer = ""
        let from = ""
        let to: string[] = []
        const state: { mode: "command" | "data" } = { mode: "command" }
        let data = ""
        const inData = (): boolean => state.mode === "data"
        const command = (line: string): void => {
            const verb = line.split(" ")[0]?.toUpperCase() ?? ""
            if (verb === "EHLO") say("250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME")
            else if (verb === "MAIL") {
                from = /<([^>]*)>/u.exec(line)?.[1] ?? ""
                to = []
                say("250 2.1.0 ok")
            } else if (verb === "RCPT") {
                const address = /<([^>]*)>/u.exec(line)?.[1] ?? ""
                if (this.behaviour.refuseRecipients?.includes(address) === true) say("550 5.1.1 user unknown")
                else {
                    to.push(address)
                    say("250 2.1.5 ok")
                }
            } else if (verb === "DATA") {
                state.mode = "data"
                data = ""
                say("354 end with <CRLF>.<CRLF>")
            } else if (verb === "STARTTLS") {
                say("502 5.5.1 STARTTLS is not supported")
            } else if (verb === "QUIT") {
                say("221 bye")
                socket.end()
            } else say("250 ok")
        }
        const finishData = (): void => {
            state.mode = "command"
            if (this.behaviour.stallAfterData === true) return
            if (this.behaviour.dataAnswer !== undefined) {
                say(this.behaviour.dataAnswer)
                return
            }
            this.received.push({ from, to, raw: data })
            say("250 2.0.0 queued as FAKE123")
        }
        socket.on("data", (chunk) => {
            buffer += chunk.toString("latin1")
            if (state.mode === "data") {
                const end = buffer.indexOf("\r\n.\r\n")
                if (end === -1) return
                data = buffer.slice(0, end)
                buffer = buffer.slice(end + 5)
                finishData()
                return
            }
            for (let newline = buffer.indexOf("\r\n"); newline !== -1; newline = buffer.indexOf("\r\n")) {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 2)
                command(line)
                if (inData()) break
            }
        })
    }
}

const open = async (behaviour: Behaviour = {}): Promise<FakeSmtp> => {
    const server = new FakeSmtp(behaviour)
    await server.listen()
    return server
}

const optionsFor = (server: FakeSmtp, overrides: Partial<MailOptions> = {}): MailOptions => ({
    host: "127.0.0.1",
    port: server.port,
    security: "none",
    from: { name: "Acme", address: "no-reply@acme.test" },
    connectionTimeoutMs: 2000,
    greetingTimeoutMs: 2000,
    socketTimeoutMs: 5000,
    sendTimeoutMs: 8000,
    ...overrides,
})

const failure = async (action: Promise<unknown>): Promise<MailError> => {
    try {
        await action
    } catch (error) {
        assert.ok(error instanceof MailError, `a MailError, got ${String(error)}`)
        return error
    }
    return assert.fail("the send should have been refused")
}

const message = renderTransactional({
    lang: "en",
    subject: "Confirm your email",
    brand: { name: "Acme" },
    paragraphs: ["Press the button to confirm."],
    action: { label: "Confirm", url: "https://app.test/confirm?token=abc123&x=1" },
})

describe("SMTP delivery against a fake server", () => {
    const servers: FakeSmtp[] = []
    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => server.close()))
    })
    const start = async (behaviour?: Behaviour): Promise<FakeSmtp> => {
        const server = await open(behaviour)
        servers.push(server)
        return server
    }

    it("delivers a message with the envelope, the headers and both bodies, and reports the server's acceptance", async () => {
        const server = await start()
        const mailer = createMailer(optionsFor(server, { replyTo: "help@acme.test" }))
        const sent = await mailer.send({ to: ["ada@example.com", "grace@example.com"], message })
        mailer.onModuleDestroy()
        assert.deepEqual(sent.accepted, ["ada@example.com", "grace@example.com"])
        assert.match(sent.messageId, /^<.+>$/u)
        const [mail] = server.received
        assert.ok(mail)
        assert.equal(mail.from, "no-reply@acme.test")
        assert.deepEqual(mail.to, ["ada@example.com", "grace@example.com"])
        assert.match(mail.raw, /^Subject: Confirm your email$/mu)
        assert.match(mail.raw, /^Reply-To: help@acme\.test$/mu)
        assert.match(mail.raw, /^From: Acme <no-reply@acme\.test>$/mu)
        const body = decodeQuotedPrintable(mail.raw)
        assert.ok(body.includes("Confirm: https://app.test/confirm?token=abc123&x=1"), "the text part carries the link")
        assert.ok(body.includes("<a href=\"https://app.test/confirm?token=abc123&amp;x=1\""), "the html part carries the escaped link")
        assert.match(mail.raw, /Content-Type: multipart\/alternative/u)
    })

    it("refuses a login over a channel with no encryption when the options are built", () => {
        assert.throws(() => resolveMailOptions({ host: "h", port: 25, security: "none", auth: { user: "u", pass: "p" }, from: "a@b.test" }), /no encryption/u)
    })

    it("sends the login to a server over STARTTLS-less plain only through the settings the transport builds", () => {
        const settings = smtpSettings(resolveMailOptions({ host: "smtp.acme.test", port: 587, auth: { user: "bot", pass: { reveal: () => "s3cret" } }, from: "a@b.test", allowSelfSigned: true }))
        assert.equal(settings.requireTLS, true)
        assert.equal(settings.ignoreTLS, false)
        assert.equal(settings.secure, false)
        assert.deepEqual(settings.auth, { user: "bot", pass: "s3cret" })
        assert.equal(settings.connectionTimeout, 10_000)
        assert.equal(settings.greetingTimeout, 10_000)
        assert.equal(settings.socketTimeout, 25_000)
        assert.notEqual(settings.tls?.rejectUnauthorized, true, "allowSelfSigned relaxes the certificate check")
        assert.equal(settings.tls?.minVersion, "TLSv1.2")
        const implicit = smtpSettings(resolveMailOptions({ host: "smtp.acme.test", port: 465, security: "tls", from: "a@b.test" }))
        assert.equal(implicit.secure, true)
        assert.deepEqual(implicit.tls, { rejectUnauthorized: true, minVersion: "TLSv1.2" })
    })

    it("refuses to send in the clear when STARTTLS is required and the server offers none (MAIL_TLS)", async () => {
        const server = await start()
        const mailer = createMailer({ ...optionsFor(server), security: "starttls" })
        const error = await failure(mailer.send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Tls)
        assert.equal(error.kind, "unavailable")
        assert.deepEqual(server.received, [])
    })

    it("maps a refused recipient to MAIL_RECIPIENT with the address in the detail", async () => {
        const server = await start({ refuseRecipients: ["nobody@example.com"] })
        const mailer = createMailer(optionsFor(server))
        const error = await failure(mailer.send({ to: "nobody@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Recipient)
        assert.equal(error.kind, "invalid")
        assert.equal(error.context.responseCode, 550)
        assert.deepEqual(server.received, [])
    })

    it("rejects the send when the server accepts only some recipients", async () => {
        const server = await start({ refuseRecipients: ["nobody@example.com"] })
        const mailer = createMailer(optionsFor(server))
        const error = await failure(mailer.send({ to: ["ada@example.com", "nobody@example.com"], message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Recipient)
        assert.match(error.detail, /nobody@example\.com/u)
    })

    it("maps a provider limit at the end of DATA to MAIL_LIMIT, rate-limited", async () => {
        const server = await start({ dataAnswer: "452 4.2.1 sending limit exceeded, try later" })
        const error = await failure(createMailer(optionsFor(server)).send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Limit)
        assert.equal(error.kind, "rate-limited")
    })

    it("maps a server that never greets to MAIL_TIMEOUT within the greeting timeout", async () => {
        const server = await start({ silent: true })
        const started = Date.now()
        const error = await failure(createMailer(optionsFor(server, { greetingTimeoutMs: 200 })).send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Timeout)
        assert.ok(Date.now() - started < 2000, "the greeting timeout bounds the wait")
    })

    it("bounds the whole send: a server that stalls after DATA ends in MAIL_TIMEOUT at the total timeout", async () => {
        const server = await start({ stallAfterData: true })
        const started = Date.now()
        const error = await failure(createMailer(optionsFor(server, { socketTimeoutMs: 60_000, sendTimeoutMs: 400 })).send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Timeout)
        assert.match(error.detail, /total timeout/u)
        assert.ok(Date.now() - started < 3000)
    })

    it("maps a closed port to MAIL_CONNECT", async () => {
        const server = await start()
        const port = server.port
        await server.close()
        servers.length = 0
        const error = await failure(createMailer({ ...optionsFor(server), port }).send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Connect)
        assert.equal(error.kind, "unavailable")
    })

    it("maps an unknown host to MAIL_DNS", async () => {
        const server = await start()
        const error = await failure(createMailer({ ...optionsFor(server), host: "no-such-host.invalid" }).send({ to: "ada@example.com", message }))
        assert.equal(error.code, MAIL_ERROR_CODES.Dns)
    })
})

describe("classifySmtpFailure", () => {
    const shaped = (fields: { readonly message?: string; readonly [field: string]: unknown }): Error => Object.assign(new Error(fields.message ?? ""), fields)

    it("reads the code, the response code and the words of the server", () => {
        const cases: readonly [Error, string][] = [
            [shaped({ code: "EAUTH", responseCode: 535, response: "535 5.7.8 Username and Password not accepted" }), "MAIL_AUTH"],
            [shaped({ code: "EAUTH", responseCode: 534, response: "534 5.7.9 Application-specific password required" }), "MAIL_APP_PASSWORD"],
            [shaped({ code: "ETIMEDOUT" }), "MAIL_TIMEOUT"],
            [shaped({ code: "ESOCKET", message: "Client network socket disconnected before secure TLS connection was established" }), "MAIL_TLS"],
            [shaped({ code: "ECONNRESET" }), "MAIL_CONNECT"],
            [shaped({ code: "EENVELOPE", responseCode: 553, response: "553 5.7.1 Sender address rejected: not owned by user" }), "MAIL_SENDER"],
            [shaped({ code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 Recipient address rejected: user unknown" }), "MAIL_RECIPIENT"],
            [shaped({ responseCode: 554, response: "554 5.7.1 relay access denied" }), "MAIL_SENDER"],
            [shaped({ responseCode: 421, response: "421 too many messages" }), "MAIL_LIMIT"],
            [shaped({ message: "boom" }), "MAIL_UNKNOWN"],
        ]
        for (const [error, code] of cases) assert.equal(classifySmtpFailure(error).code, code, error.message)
    })

    it("answers UNKNOWN for what is not an error object and passes a MailError through", () => {
        assert.equal(classifySmtpFailure("nope").code, MAIL_ERROR_CODES.Unknown)
        const own = new MailError(MAIL_ERROR_CODES.AddressInvalid)
        assert.equal(classifySmtpFailure(own), own)
    })

    it("keeps the cause and the context but never the credentials", () => {
        const cause = shaped({ code: "EAUTH", responseCode: 535, response: "535 denied" })
        const error = classifySmtpFailure(cause, { host: "smtp.acme.test", port: 587 })
        assert.equal(error.cause, cause)
        assert.deepEqual(error.context, { host: "smtp.acme.test", port: 587, responseCode: 535 })
    })
})
