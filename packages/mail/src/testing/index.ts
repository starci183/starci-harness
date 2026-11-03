import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { MailError } from "../errors.ts"
import type { MailErrorCode } from "../errors.ts"
import { resolveMailOptions } from "../options.ts"
import type { MailOptions } from "../options.ts"
import type { SentMail } from "../port.ts"
import { MailService } from "../service.ts"
import { MAILER } from "../tokens.ts"
import type { MailEnvelope, MailTransport } from "../transport.ts"

/** One message the in-memory outbox accepted. */
export interface OutboxMail extends MailEnvelope {
    readonly messageId: string
    /** The first `http(s)` link in the text body: the confirm or reset link of a transactional mail, or null. */
    readonly link: string | null
}

const LINK = /https?:\/\/[^\s<>"']+/u

/** The in-memory delivery: keeps every envelope the service hands over, fails on demand like a server that is down. */
export class MemoryTransport implements MailTransport {
    readonly #sent: OutboxMail[] = []
    readonly #failures: MailErrorCode[] = []
    closed = false

    deliver(envelope: MailEnvelope): Promise<SentMail> {
        const failure = this.#failures.shift()
        if (failure !== undefined) return Promise.reject(new MailError(failure, { detail: "injected by the test" }))
        const messageId = `<memory-${String(this.#sent.length + 1)}@mail.test>`
        this.#sent.push({ ...envelope, messageId, link: LINK.exec(envelope.text)?.[0] ?? null })
        return Promise.resolve({ messageId, accepted: [...envelope.to] })
    }

    close(): void {
        this.closed = true
    }

    /** Every message accepted, oldest first. */
    get sent(): readonly OutboxMail[] {
        return this.#sent
    }

    /** Makes the next `count` sends reject with `code`, as a server that is down or refusing does. */
    failNext(code: MailErrorCode, count = 1): void {
        for (let index = 0; index < count; index += 1) this.#failures.push(code)
    }

    /** Forgets every message and every injected failure. */
    clear(): void {
        this.#sent.length = 0
        this.#failures.length = 0
    }
}

/** A `Mailer` over memory, with the outbox a spec asserts on; the same checks as the SMTP one run before a message lands. */
export class MemoryMailer extends MailService {
    readonly #memory: MemoryTransport

    constructor(memory: MemoryTransport, options: MailOptions) {
        super(memory, resolveMailOptions(options))
        this.#memory = memory
    }

    /** Every message accepted, oldest first. */
    get outbox(): readonly OutboxMail[] {
        return this.#memory.sent
    }

    /** The messages sent to one mailbox (compared ignoring case), oldest first. */
    to(address: string): readonly OutboxMail[] {
        const wanted = address.toLowerCase()
        return this.#memory.sent.filter((mail) => mail.to.some((entry) => entry.toLowerCase() === wanted))
    }

    /** The newest message sent to one mailbox, or undefined. */
    lastTo(address: string): OutboxMail | undefined {
        return this.to(address).at(-1)
    }

    /** Makes the next sends reject with `code`. */
    failNext(code: MailErrorCode, count = 1): void {
        this.#memory.failNext(code, count)
    }

    /** Forgets every message. */
    clear(): void {
        this.#memory.clear()
    }
}

/** Options for a spec: a sink address, the plain channel a sink takes, a sender. Override any field. */
export const testMailOptions = (overrides: Partial<MailOptions> = {}): MailOptions => ({
    host: "127.0.0.1",
    port: 2525,
    security: "none",
    from: { name: "App", address: "no-reply@app.test" },
    ...overrides,
})

/** The in-memory mailer a spec holds and asserts on. */
export const createMemoryMailer = (options: MailOptions = testMailOptions()): MemoryMailer => new MemoryMailer(new MemoryTransport(), options)

/** A global Nest module providing the in-memory mailer under the same `MAILER` token as the real module. */
export const mailTestingModule = (mailer: MemoryMailer = createMemoryMailer()): DynamicModule => {
    class MailTestingModule {
        readonly kind = "mail-testing"
    }
    Module({})(MailTestingModule)
    return {
        module: MailTestingModule,
        global: true,
        providers: [{ provide: MAILER, useValue: mailer }],
        exports: [MAILER],
    }
}
