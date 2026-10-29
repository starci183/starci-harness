import assert from "node:assert/strict"
import { X509Certificate } from "node:crypto"
import { request } from "node:https"
import { test } from "node:test"
import type { FakeStartContext } from "./contracts"
import { FakesHost } from "./host"
import { defineHttpFake } from "./http-fake"
import { fakeTls, issueFakeTls } from "./tls"

const start: FakeStartContext = { runId: "run", secret: (label) => `secret-${label}`, now: () => new Date() }

/** An issuer as a sign-in contract needs it: discovery over HTTPS naming its own https URL. */
const issuerFake = defineHttpFake({
    https: true,
    routes: [
        {
            method: "GET",
            path: "/.well-known/openid-configuration",
            handle: (_request, context) => ({ body: { issuer: context.url, jwks_uri: `${context.url}/jwks` } }),
        },
    ],
})

interface Answer {
    readonly status: number
    readonly body: string
}

/** One GET with the given trust: `ca` undefined means the default trust store only. */
const get = (url: string, ca: string | undefined, servername?: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
        const target = new URL(url)
        const call = request(
            {
                host: target.hostname,
                port: target.port,
                path: target.pathname,
                method: "GET",
                agent: false,
                ...(ca === undefined ? {} : { ca }),
                ...(servername === undefined ? {} : { servername }),
            },
            (response) => {
                let body = ""
                response.setEncoding("utf8")
                response.on("data", (chunk: string) => (body += chunk))
                response.on("end", () => resolve({ status: response.statusCode ?? 0, body }))
            },
        )
        call.on("error", reject)
        call.end()
    })

test("an https fake answers on https://127.0.0.1:<port> and publishes the run CA", async () => {
    const fake = await issuerFake().start(start)
    try {
        assert.match(fake.url, /^https:\/\/127\.0\.0\.1:\d+$/)
        assert.equal(fake.ca, fakeTls().ca)
        const answer = await get(`${fake.url}/.well-known/openid-configuration`, fake.ca)
        assert.equal(answer.status, 200)
        assert.deepEqual(JSON.parse(answer.body), { issuer: fake.url, jwks_uri: `${fake.url}/jwks` })
        const recorded = (await fake.control("requests", undefined)) as ReadonlyArray<{ path: string; status: number }>
        assert.deepEqual(recorded.map(({ path, status }) => ({ path, status })), [{ path: "/.well-known/openid-configuration", status: 200 }])
    } finally {
        await fake.close()
    }
})

test("a client trusting the fake CA reaches it by every loopback name the certificate covers", async () => {
    const fake = await issuerFake().start(start)
    try {
        const answer = await get(`https://localhost:${fake.port}/.well-known/openid-configuration`, fake.ca)
        assert.equal(answer.status, 200)
        const docker = await get(`${fake.url}/.well-known/openid-configuration`, fake.ca, "host.docker.internal")
        assert.equal(docker.status, 200)
    } finally {
        await fake.close()
    }
})

test("a client that does not trust the fake CA is refused: no default trust, no other CA, no global fetch", async () => {
    const fake = await issuerFake().start(start)
    try {
        await assert.rejects(get(`${fake.url}/.well-known/openid-configuration`, undefined), (cause: NodeJS.ErrnoException) => {
            assert.match(cause.code ?? "", /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_VERIFY_LEAF_SIGNATURE/)
            return true
        })
        await assert.rejects(get(`${fake.url}/.well-known/openid-configuration`, issueFakeTls().ca), (cause: NodeJS.ErrnoException) => {
            assert.match(cause.code ?? "", /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_SIGNATURE_FAILURE/)
            return true
        })
        await assert.rejects(fetch(`${fake.url}/.well-known/openid-configuration`), TypeError)
        const recorded = (await fake.control("requests", undefined)) as ReadonlyArray<unknown>
        assert.equal(recorded.length, 0, "an untrusted handshake never reaches a route")
    } finally {
        await fake.close()
    }
})

test("the certificates: a CA that signs a server certificate for the loopback names only", () => {
    const tls = issueFakeTls()
    const ca = new X509Certificate(tls.ca)
    const leaf = new X509Certificate(tls.cert)
    assert.equal(ca.ca, true)
    assert.equal(leaf.ca, false)
    assert.equal(ca.verify(ca.publicKey), true)
    assert.equal(leaf.verify(ca.publicKey), true)
    assert.equal(leaf.checkIssued(ca), true)
    assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1")
    assert.equal(leaf.checkIP("::1"), "::1")
    assert.equal(leaf.checkHost("localhost"), "localhost")
    assert.equal(leaf.checkHost("host.docker.internal"), "host.docker.internal")
    assert.equal(leaf.checkHost("example.com"), undefined)
    assert.equal(leaf.checkIP("10.0.0.1"), undefined)
    assert.ok(new Date(leaf.validTo).getTime() > Date.now())
    assert.ok(new Date(leaf.validFrom).getTime() < Date.now())
    assert.notEqual(issueFakeTls().ca, tls.ca, "every issue is fresh material")
})

test("the fakes host publishes the CA of an https fake and none for a plain one", async () => {
    const plain = defineHttpFake({ handle: () => ({ body: "ok" }) })
    const host = new FakesHost({ idp: issuerFake(), plain: plain() }, start)
    try {
        const started = await host.start()
        assert.equal(started.fakes["idp"]?.ca, fakeTls().ca)
        assert.match(started.fakes["idp"]?.url ?? "", /^https:\/\//)
        assert.equal(Object.hasOwn(started.fakes["plain"] ?? {}, "ca"), false)
        assert.match(started.fakes["plain"]?.url ?? "", /^http:\/\//)
    } finally {
        await host.close()
    }
})
