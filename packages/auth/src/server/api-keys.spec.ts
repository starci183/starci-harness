import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { inspect } from "node:util"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import {
    API_KEY_REJECTED_EVENT,
    API_KEY_TEXT_MAX,
    ApiKeyVerifier,
    apiKeySecretMatches,
    apiKeySecretSha256,
    apiKeyTextOf,
    issueApiKey,
    parseApiKey,
    readApiKeyText,
    registerApiKey,
} from "./api-keys.ts"
import type { ApiKeyRecord, ApiKeyStore } from "./api-keys.ts"
import { AuthError } from "./errors.ts"

interface Scope {
    readonly workspaceId: string
}

interface Logged {
    readonly event: string
    readonly context: Readonly<Record<string, unknown>> | undefined
}

const NOW = new Date(Date.UTC(2026, 10, 13, 12))

const storeOf = (...records: ApiKeyRecord<Scope>[]): ApiKeyStore<Scope> & { readonly asked: string[] } => {
    const asked: string[] = []
    return {
        asked,
        findApiKey: (keyId) => {
            asked.push(keyId)
            return Promise.resolve(records.find((record) => record.id === keyId) ?? null)
        },
    }
}

const issued = (overrides: Partial<ApiKeyRecord<Scope>> = {}, prefix = "") => {
    const key = issueApiKey({ prefix })
    const record: ApiKeyRecord<Scope> = { id: key.id, secretSha256: key.secretSha256, scope: { workspaceId: "ws-1" }, ...overrides }
    return { text: key.key.reveal(), record }
}

const setup = (records: ApiKeyRecord<Scope>[], options: { readonly prefix?: string; readonly acceptApiKeyHeader?: boolean } = {}) => {
    const logged: Logged[] = []
    const store = storeOf(...records)
    const verifier = new ApiKeyVerifier<Scope>({
        store,
        ...options,
        clock: { now: () => NOW },
        logger: { warn: (event, context) => logged.push({ event, context }) },
    })
    return { verifier, logged, store }
}

const bearer = (text: string) => ({ authorization: `Bearer ${text}` })

test("an issued key verifies from the bearer header and answers its id and the app's scope", async () => {
    const { text, record } = issued()
    const { verifier, logged } = setup([record])
    const outcome = await verifier.verify(bearer(text))
    assert.deepEqual(outcome, { kind: "ok", value: { keyId: record.id, scope: { workspaceId: "ws-1" } } })
    assert.deepEqual(await verifier.authenticate(bearer(text)), { keyId: record.id, scope: { workspaceId: "ws-1" } })
    assert.deepEqual(logged, [])
})

test("an issued key is a random uuid, a dot and 43 base64url characters; only the secret's sha256 is returned to store", () => {
    const key = issueApiKey()
    const text = key.key.reveal()
    assert.match(text, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u)
    const secret = text.slice(text.indexOf(".") + 1)
    assert.equal(key.secretSha256, createHash("sha256").update(secret).digest("hex"))
    assert.equal(apiKeySecretSha256(secret), key.secretSha256)
    assert.notEqual(issueApiKey().key.reveal(), text)
    assert.deepEqual(Object.keys(key).sort(), ["id", "key", "secretSha256"])
})

test("the plaintext of an issued key never prints, logs or serialises", () => {
    const key = issueApiKey({ id: "k1", prefix: "nvk_" })
    assert.ok(key.key.reveal().startsWith("nvk_k1."))
    assert.equal(String(key.key), "[api key]")
    assert.equal(key.key.toString(), "[api key]")
    assert.equal(JSON.stringify(key).includes(key.key.reveal()), false)
    assert.equal(inspect(key).includes(key.key.reveal()), false)
})

test("issuing refuses an id or a prefix outside the key alphabet", () => {
    assert.throws(() => issueApiKey({ id: "a.b" }), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ApiKeyMalformed && error.kind === "invalid")
    assert.throws(() => issueApiKey({ id: "" }), AuthError)
    assert.throws(() => issueApiKey({ prefix: "nv.k" }), AuthError)
    assert.throws(() => new ApiKeyVerifier({ store: storeOf(), prefix: "has space" }), AuthError)
})

test("a prefixed verifier admits only keys that start with its prefix", async () => {
    const { text, record } = issued({}, "crm_")
    const { verifier } = setup([record], { prefix: "crm_" })
    assert.equal((await verifier.verify(bearer(text))).kind, "ok")
    const bare = text.slice("crm_".length)
    assert.deepEqual(await verifier.verify(bearer(bare)), { kind: "refused", code: AUTH_ERROR_CODES.ApiKeyRejected, detail: { reason: "malformed" } })
})

test("X-Api-Key is read only when accepted, and naming both headers is refused", async () => {
    const { text, record } = issued()
    const off = setup([record])
    assert.deepEqual(await off.verifier.verify({ "x-api-key": text }), { kind: "refused", code: AUTH_ERROR_CODES.ApiKeyRejected, detail: { reason: "missing" } })
    const on = setup([record], { acceptApiKeyHeader: true })
    assert.equal((await on.verifier.verify({ "x-api-key": ` ${text} ` })).kind, "ok")
    assert.equal((await on.verifier.verify(bearer(text))).kind, "ok")
    assert.deepEqual(await on.verifier.verify({ ...bearer(text), "x-api-key": text }), {
        kind: "refused",
        code: AUTH_ERROR_CODES.ApiKeyRejected,
        detail: { reason: "ambiguous" },
    })
    assert.deepEqual(apiKeyTextOf({ "x-api-key": [text, text] }, true), { kind: "refused", code: "ambiguous" })
})

test("a wrong secret, an unknown id, a revoked and an expired key are each refused with one wire code and their reason", async () => {
    const live = issued()
    const revoked = issued({ revokedAt: new Date(NOW.getTime() - 1) })
    const expired = issued({ expiresAt: NOW })
    const later = issued({ expiresAt: new Date(NOW.getTime() + 1), revokedAt: null })
    const { verifier, logged } = setup([live.record, revoked.record, expired.record, later.record])
    const wrong = `${live.record.id}.${"A".repeat(43)}`
    const unknown = issueApiKey().key.reveal()
    const reasons = []
    for (const text of [wrong, unknown, revoked.text, expired.text]) {
        const outcome = await verifier.verify(bearer(text))
        assert.ok(outcome.kind === "refused")
        assert.equal(outcome.code, AUTH_ERROR_CODES.ApiKeyRejected)
        reasons.push(outcome.detail?.reason)
    }
    assert.deepEqual(reasons, ["secret", "unknown", "revoked", "expired"])
    assert.equal((await verifier.verify(bearer(later.text))).kind, "ok")
    assert.deepEqual(
        logged.map((entry) => entry.event),
        Array.from({ length: 4 }, () => API_KEY_REJECTED_EVENT),
    )
})

test("a revoked key with the wrong secret says only that the secret is wrong", async () => {
    const revoked = issued({ revokedAt: NOW })
    const { verifier } = setup([revoked.record])
    const outcome = await verifier.verify(bearer(`${revoked.record.id}.${"B".repeat(43)}`))
    assert.deepEqual(outcome, { kind: "refused", code: AUTH_ERROR_CODES.ApiKeyRejected, detail: { reason: "secret", keyId: revoked.record.id } })
})

test("authenticate throws the typed refusal with the reason, never the key, in its context", async () => {
    const { text, record } = issued({ revokedAt: NOW })
    const { verifier } = setup([record])
    await assert.rejects(verifier.authenticate(bearer(text)), (error: unknown) => {
        assert.ok(error instanceof AuthError)
        assert.equal(error.code, AUTH_ERROR_CODES.ApiKeyRejected)
        assert.equal(error.kind, "unauthenticated")
        assert.deepEqual(error.context, { reason: "revoked", keyId: record.id })
        return true
    })
    await assert.rejects(verifier.authenticate({}), (error: unknown) => error instanceof AuthError && error.context.reason === "missing")
})

test("malformed headers and key texts are refused before the store is asked", async () => {
    const { text, record } = issued()
    const { verifier, store } = setup([record])
    const id = record.id
    const headers = [
        {},
        { authorization: "" },
        { authorization: `Basic ${text}` },
        { authorization: `Bearer ${text} extra` },
        { authorization: "Bearer" },
        { authorization: `Bearer ${"a".repeat(API_KEY_TEXT_MAX + 1)}` },
        { authorization: `Bearer ${id}` },
        { authorization: `Bearer ${id}.` },
        { authorization: `Bearer .${"A".repeat(43)}` },
        { authorization: `Bearer ${id}.short` },
        { authorization: `Bearer ${id}.${"A".repeat(43)}.x` },
        { authorization: `Bearer ${id}.${"A".repeat(42)}=` },
        { authorization: `Bearer ${"x".repeat(129)}.${"A".repeat(43)}` },
        { authorization: `Bearer ü.${"A".repeat(43)}` },
    ]
    for (const header of headers) {
        const outcome = await verifier.verify(header)
        assert.equal(outcome.kind, "refused", JSON.stringify(header))
    }
    assert.deepEqual(store.asked, [])
    assert.equal((await verifier.verify({ authorization: `bearer   ${text}` })).kind, "ok")
    assert.deepEqual(store.asked, [id])
})

test("parseApiKey splits at the one dot and bounds both halves", () => {
    assert.deepEqual(parseApiKey(`k-1_A.${"s".repeat(22)}`), { keyId: "k-1_A", secret: "s".repeat(22) })
    assert.equal(parseApiKey(`k.${"s".repeat(21)}`), null)
    assert.equal(parseApiKey(`k.${"s".repeat(257)}`), null)
    assert.equal(parseApiKey(`p_k.${"s".repeat(22)}`, "q_"), null)
    assert.deepEqual(parseApiKey(`p_k.${"s".repeat(22)}`, "p_"), { keyId: "k", secret: "s".repeat(22) })
})

test("the secret compare is timing safe: equal-length digests, false on any differing byte, a fault on a stored value that is no sha256", () => {
    const secret = "S".repeat(43)
    const stored = apiKeySecretSha256(secret)
    assert.equal(apiKeySecretMatches(secret, stored), true)
    assert.equal(apiKeySecretMatches(secret, stored.toUpperCase()), true)
    assert.equal(apiKeySecretMatches(`T${secret.slice(1)}`, stored), false)
    assert.equal(apiKeySecretMatches(`${secret.slice(0, -1)}T`, stored), false)
    const flipped = `${stored.slice(0, -1)}${stored.endsWith("0") ? "1" : "0"}`
    assert.equal(apiKeySecretMatches(secret, flipped), false)
    for (const bad of ["", stored.slice(2), `${stored}00`, "z".repeat(64)]) {
        assert.throws(() => apiKeySecretMatches(secret, bad), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ApiKeyRecordInvalid)
    }
})

test("an unknown key id still runs the digest compare, and a corrupt stored hash is an internal fault, not a refusal", async () => {
    const { text, record } = issued({ secretSha256: "not-a-digest" })
    const { verifier } = setup([record])
    await assert.rejects(verifier.verify(bearer(text)), (error: unknown) => error instanceof AuthError && error.kind === "internal")
    const unknown = setup([])
    assert.equal((await unknown.verifier.verify(bearer(issueApiKey().key.reveal()))).kind, "refused")
})

test("no refusal logs or answers key material", async () => {
    const { text, record } = issued()
    const { verifier, logged } = setup([record], { acceptApiKeyHeader: true })
    const secret = text.slice(text.indexOf(".") + 1)
    const wrong = `${record.id}.${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`
    const outcomes = [
        await verifier.verify(bearer(wrong)),
        await verifier.verify({ authorization: `Basic ${text}` }),
        await verifier.verify({ ...bearer(text), "x-api-key": text }),
    ]
    const seen = JSON.stringify({ logged, outcomes })
    assert.equal(seen.includes(secret), false)
    assert.equal(seen.includes(secret.slice(0, -1)), false)
    assert.equal(logged.length, 3)
})

test("registering a key from text keeps its id and the sha256 of its secret only", () => {
    const secret = "r".repeat(43)
    assert.deepEqual(registerApiKey(`key-7.${secret}\r\n`), { id: "key-7", secretSha256: apiKeySecretSha256(secret) })
    assert.deepEqual(registerApiKey(`nvk_key-7.${secret}`, { prefix: "nvk_" }), { id: "key-7", secretSha256: apiKeySecretSha256(secret) })
    for (const text of ["", "no-dot", `key-7.${secret}.x`, `other_key-7.${secret}`]) {
        assert.throws(
            () => registerApiKey(text, { prefix: text.startsWith("other") ? "nvk_" : "" }),
            (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ApiKeyMalformed && !JSON.stringify(error.context).includes(secret),
        )
    }
})

test("a registered key verifies like an issued one", async () => {
    const text = issueApiKey({ id: "imported" }).key.reveal()
    const hash = registerApiKey(text)
    const { verifier } = setup([{ ...hash, scope: { workspaceId: "ws-2" } }])
    assert.deepEqual(await verifier.verify(bearer(text)), { kind: "ok", value: { keyId: "imported", scope: { workspaceId: "ws-2" } } })
})

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<string | Uint8Array> {
    for (const part of parts) {
        await Promise.resolve()
        yield part
    }
}

test("readApiKeyText reads stdin to the end, trimmed, and refuses an input past the bound", async () => {
    assert.equal(await readApiKeyText(chunks("k.", Buffer.from("abc"), "\n")), "k.abc")
    await assert.rejects(readApiKeyText(chunks("x".repeat(API_KEY_TEXT_MAX), "xxx")), (error: unknown) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.ApiKeyMalformed)
})

test("the default verifier reads the system clock", async () => {
    const { text, record } = issued({ expiresAt: new Date(Date.now() + 60_000) })
    const verifier = new ApiKeyVerifier<Scope>({ store: storeOf(record) })
    assert.equal((await verifier.verify(bearer(text))).kind, "ok")
    assert.equal((await verifier.verifyKey(text)).kind, "ok")
})
