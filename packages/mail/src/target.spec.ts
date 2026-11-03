import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MAIL_ERROR_CODES, MailError, PUBLIC_MAIL_PORTS, assertSmtpTarget, createMailer, isPrivateAddress, isWellFormedHost } from "./index.ts"

const refused = async (action: Promise<unknown>): Promise<MailError> => {
    try {
        await action
    } catch (error) {
        assert.ok(error instanceof MailError)
        return error
    }
    return assert.fail("the target should have been refused")
}

describe("isPrivateAddress", () => {
    it("names the addresses no public mail server has", () => {
        for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) {
            assert.equal(isPrivateAddress(address), true, address)
        }
    })

    it("admits public addresses", () => {
        for (const address of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(address), false, address)
    })
})

describe("isWellFormedHost", () => {
    it("accepts host names and IP literals and refuses the rest", () => {
        for (const good of ["smtp.example.com", "mail-1.example.co", "localhost", "203.0.113.5", "::1"]) assert.equal(isWellFormedHost(good), true, good)
        for (const bad of ["", "-a.example.com", "a..example.com", "exa mple.com", "a.example.com/", `${"a".repeat(64)}.example.com`, "mail.example.com:25"]) assert.equal(isWellFormedHost(bad), false, bad)
    })
})

describe("assertSmtpTarget", () => {
    const publicHost = async (): Promise<readonly string[]> => Promise.resolve(["203.0.113.9"])

    it("answers the addresses of a public host on a public mail port", async () => {
        assert.deepEqual(await assertSmtpTarget("smtp.example.com", 587, { resolve: publicHost }), ["203.0.113.9"])
        assert.deepEqual(await assertSmtpTarget("203.0.113.9", 465), ["203.0.113.9"])
        for (const port of PUBLIC_MAIL_PORTS) assert.deepEqual(await assertSmtpTarget("203.0.113.9", port), ["203.0.113.9"])
    })

    it("refuses a host that resolves to a private, loopback or link-local address after DNS (MAIL_CONNECT)", async () => {
        for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1"]) {
            const error = await refused(assertSmtpTarget("evil.example.com", 587, { resolve: () => Promise.resolve([address]) }))
            assert.equal(error.code, MAIL_ERROR_CODES.Connect, address)
        }
        const mixed = await refused(assertSmtpTarget("evil.example.com", 587, { resolve: () => Promise.resolve(["203.0.113.9", "10.0.0.5"]) }))
        assert.equal(mixed.code, MAIL_ERROR_CODES.Connect)
        assert.equal((await refused(assertSmtpTarget("127.0.0.1", 25))).code, MAIL_ERROR_CODES.Connect)
    })

    it("refuses a port that is not a mail port and a port out of range (MAIL_CONNECT)", async () => {
        for (const port of [22, 80, 6379, 0, 70_000, 25.5]) assert.equal((await refused(assertSmtpTarget("smtp.example.com", port, { resolve: publicHost }))).code, MAIL_ERROR_CODES.Connect, String(port))
    })

    it("refuses a malformed host, a host that does not resolve and a host with no address (MAIL_DNS)", async () => {
        assert.equal((await refused(assertSmtpTarget("bad host", 587))).code, MAIL_ERROR_CODES.Dns)
        assert.equal((await refused(assertSmtpTarget("gone.example.com", 587, { resolve: () => Promise.reject(new Error("ENOTFOUND")) }))).code, MAIL_ERROR_CODES.Dns)
        assert.equal((await refused(assertSmtpTarget("empty.example.com", 587, { resolve: () => Promise.resolve([]) }))).code, MAIL_ERROR_CODES.Dns)
    })

    it("admits a private address and any port for a development catcher when allowPrivate is set", async () => {
        assert.deepEqual(await assertSmtpTarget("127.0.0.1", 1025, { allowPrivate: true }), ["127.0.0.1"])
    })

    it("is applied before the connection by a mailer with publicTargetOnly", async () => {
        const mailer = createMailer({ host: "127.0.0.1", port: 25, security: "none", from: "a@b.test", publicTargetOnly: true })
        const error = await refused(mailer.send({ to: "ada@example.com", message: { subject: "s", text: "t" } }))
        assert.equal(error.code, MAIL_ERROR_CODES.Connect)
        assert.equal(error.detail, "private address")
    })
})
