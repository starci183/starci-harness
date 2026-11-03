import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OBJECT_STORAGE_ERROR_CODES, OBJECT_STORAGE_ERROR_KINDS, ObjectStorageError } from "./errors.ts"
import { admitsContentType, expiryOf, isValidBucketName, isValidObjectKey, prefixOf, publicAddressOf } from "./policy.ts"
import { FAKE_STORAGE_ORIGIN, FakeStorageClock, createMemoryObjectStorage } from "./testing/index.ts"

const CODES = OBJECT_STORAGE_ERROR_CODES
const png = new Uint8Array([1, 2, 3])

describe("keys and buckets", () => {
    it("admits clean relative keys and refuses the rest", () => {
        for (const key of ["a", "users/u1/avatar.png", "a b/ü.txt", "x".repeat(1024)]) assert.equal(isValidObjectKey(key), true, key)
        for (const key of ["", "/a", "a//b", "a/", "./a", "a/../b", "a\\b", "a\u0000b", "x".repeat(1025)]) assert.equal(isValidObjectKey(key), false, JSON.stringify(key))
    })

    it("admits S3 bucket names and refuses the rest", () => {
        for (const bucket of ["media", "nivo-dev-media", "a1b", "my.bucket"]) assert.equal(isValidBucketName(bucket), true, bucket)
        for (const bucket of ["ab", "Media", "-media", "media-", "my..bucket", "under_score", "x".repeat(64)]) assert.equal(isValidBucketName(bucket), false, bucket)
    })

    it("turns a folder into a listing prefix", () => {
        assert.equal(prefixOf(""), "")
        assert.equal(prefixOf("///"), "")
        assert.equal(prefixOf("users/u1//"), "users/u1/")
        assert.throws(() => prefixOf("../x"), { code: CODES.KeyInvalid })
    })

    it("refuses a bad bucket or key on every call with a coded error", async () => {
        const storage = createMemoryObjectStorage()
        await assert.rejects(storage.head("Bad", "k"), { code: CODES.BucketInvalid })
        await assert.rejects(storage.get("media", "../k"), { code: CODES.KeyInvalid })
        await assert.rejects(storage.presignGet("media", ""), { code: CODES.KeyInvalid })
        await assert.rejects(storage.removeMany("media", ["ok", "a//b"]), { code: CODES.KeyInvalid })
        assert.throws(() => storage.publicUrl("media", "../k"), { code: CODES.KeyInvalid })
    })
})

describe("expiry", () => {
    it("takes the default, a whole number of seconds from 1 to the maximum, and refuses the rest", () => {
        assert.equal(expiryOf(undefined, 300, 3600), 300)
        assert.equal(expiryOf(1, 300, 3600), 1)
        assert.equal(expiryOf(3600, 300, 3600), 3600)
        for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3601]) assert.throws(() => expiryOf(bad, 300, 3600), { code: CODES.ExpiryInvalid })
    })

    it("never lets the options raise the ceiling above seven days", async () => {
        const storage = createMemoryObjectStorage({ maxExpiresIn: 10_000_000 })
        await assert.rejects(storage.presignGet("media", "k", { expiresIn: 604_801 }), { code: CODES.ExpiryInvalid })
        assert.equal((await storage.presignGet("media", "k", { expiresIn: 604_800 })).expiresIn, 604_800)
    })
})

describe("presigned requests", () => {
    it("dates a PUT by the clock and carries the headers the caller must send", async () => {
        const clock = new FakeStorageClock(Date.UTC(2026, 5, 1))
        const storage = createMemoryObjectStorage({ clock, defaultExpiresIn: 120 })
        const request = await storage.presignPut("media", "users/u1/a.png", { contentType: "image/png", contentLength: 3 })
        assert.equal(request.method, "PUT")
        assert.equal(request.expiresIn, 120)
        assert.equal(request.expiresAt, "2026-06-01T00:02:00.000Z")
        assert.deepEqual(request.headers, { "Content-Type": "image/png", "Content-Length": "3" })
        assert.ok(request.url.startsWith(`${FAKE_STORAGE_ORIGIN}/media/users/u1/a.png?`))
    })

    it("signs a GET without headers", async () => {
        const request = await createMemoryObjectStorage().presignGet("media", "k.txt", { expiresIn: 60, downloadName: "x.txt" })
        assert.deepEqual([request.method, request.headers, request.expiresIn], ["GET", {}, 60])
    })

    it("holds an upload to the size and content type limits before signing anything", async () => {
        const storage = createMemoryObjectStorage({ limits: { maxBytes: 10, contentTypes: ["image/png", "image/*"] } })
        await assert.rejects(storage.presignPut("media", "a", { contentType: "image/png" }), { code: CODES.SizeRequired })
        await assert.rejects(storage.presignPut("media", "a", { contentType: "image/png", contentLength: 11 }), { code: CODES.SizeExceeded })
        await assert.rejects(storage.presignPut("media", "a", { contentType: "image/png", contentLength: -1 }), { code: CODES.SizeExceeded })
        await assert.rejects(storage.presignPut("media", "a", { contentType: "image/png", contentLength: 1.5 }), { code: CODES.SizeExceeded })
        await assert.rejects(storage.presignPut("media", "a", { contentType: "text/html", contentLength: 5 }), { code: CODES.ContentTypeNotAllowed })
        assert.deepEqual(storage.store.signed, [])
        assert.equal((await storage.presignPut("media", "a", { contentType: "Image/WEBP; q=1", contentLength: 10 })).method, "PUT")
    })

    it("lets a call replace a field of the default limits", async () => {
        const storage = createMemoryObjectStorage({ limits: { maxBytes: 10, contentTypes: ["image/*"] } })
        const request = await storage.presignPut("media", "a", { contentType: "video/mp4", contentLength: 500, limits: { maxBytes: 1000, contentTypes: ["video/mp4"] } })
        assert.equal(request.headers["Content-Length"], "500")
    })

    it("needs no size when no size limit is in force", async () => {
        const request = await createMemoryObjectStorage().presignPut("media", "a", { contentType: "text/plain" })
        assert.deepEqual(request.headers, { "Content-Type": "text/plain" })
    })
})

describe("content types", () => {
    it("matches exact types and families without parameters, ignoring case", () => {
        assert.equal(admitsContentType(undefined, "anything"), true)
        assert.equal(admitsContentType([], "anything"), true)
        assert.equal(admitsContentType(["image/*"], "IMAGE/PNG;x=1"), true)
        assert.equal(admitsContentType(["image/png"], "image/jpeg"), false)
        assert.equal(admitsContentType(["image/*"], "imagex/png"), false)
        assert.equal(admitsContentType(["image/*"], ""), false)
    })
})

describe("reads, writes and deletes through the port", () => {
    it("puts under the limits and reads back, heads and confirms", async () => {
        const storage = createMemoryObjectStorage({ limits: { maxBytes: 3, contentTypes: ["image/png"] } })
        await assert.rejects(storage.put("media", "a", new Uint8Array(4), "image/png"), { code: CODES.SizeExceeded })
        await assert.rejects(storage.put("media", "a", png, "text/plain"), { code: CODES.ContentTypeNotAllowed })
        await storage.put("media", "a", png, "image/png")
        assert.deepEqual([...((await storage.get("media", "a"))?.bytes ?? [])], [1, 2, 3])
        assert.equal((await storage.head("media", "a"))?.size, 3)
        assert.equal((await storage.confirmUpload("media", "a")).contentType, "image/png")
        await assert.rejects(storage.confirmUpload("media", "a", { maxBytes: 2 }), { code: CODES.SizeExceeded })
        await assert.rejects(storage.confirmUpload("media", "a", { contentTypes: ["video/*"] }), { code: CODES.ContentTypeNotAllowed })
        await assert.rejects(storage.confirmUpload("media", "none"), { code: CODES.ObjectNotFound })
        assert.equal(await storage.get("media", "none"), null)
    })

    it("removes one key, and many in batches of a thousand", async () => {
        const storage = createMemoryObjectStorage()
        const keys = Array.from({ length: 2500 }, (_, index) => `k/${String(index)}`)
        for (const key of keys) storage.seed("media", key, "x", "text/plain")
        await storage.remove("media", "k/0")
        await storage.remove("media", "k/0")
        assert.equal(await storage.removeMany("media", keys), 2499)
        assert.equal(await storage.removeMany("media", []), 0)
    })

    it("lists the files of a folder newest first, up to the limit, without subfolders", async () => {
        const clock = new FakeStorageClock()
        const storage = createMemoryObjectStorage({ clock })
        for (const name of ["old", "mid", "new"]) {
            storage.seed("media", `f/${name}.txt`, name, "text/plain")
            clock.advance(1000)
        }
        storage.seed("media", "f/sub/deep.txt", "x", "text/plain")
        storage.seed("media", "root.txt", "x", "text/plain")
        assert.deepEqual((await storage.list("media", "f", 10)).map((entry) => entry.name), ["new.txt", "mid.txt", "old.txt"])
        assert.equal((await storage.list("media", "f/", 2)).length, 2)
        assert.deepEqual((await storage.list("media", "", 5)).map((entry) => entry.name), ["root.txt"])
        assert.deepEqual(await storage.list("media", "f", -1), [])
    })

    it("sets a bucket up, public or not", async () => {
        const storage = createMemoryObjectStorage()
        await storage.ensureBucket("media")
        await storage.ensureBucket("avatars", { publicRead: true })
        assert.deepEqual([...storage.store.buckets.keys()], ["media", "avatars"])
        assert.deepEqual([...storage.store.publicBuckets], ["avatars"])
    })

    it("builds public addresses, path-style or virtual-hosted", () => {
        const path = createMemoryObjectStorage({ publicEndpoint: "https://files.example.com/storage/" })
        assert.equal(path.publicUrl("avatars", "u 1/a#b.png"), "https://files.example.com/storage/avatars/u%201/a%23b.png")
        const hosted = createMemoryObjectStorage({ publicEndpoint: "https://s3.example.com", forcePathStyle: false })
        assert.equal(hosted.publicUrl("avatars", "a.png"), "https://avatars.s3.example.com/a.png")
        assert.equal(publicAddressOf("https://x.test", "b-b", "k", true), "https://x.test/b-b/k")
    })
})

describe("errors", () => {
    it("travel as a kind and keep the cause and a non-secret context", async () => {
        const storage = createMemoryObjectStorage()
        storage.store.down = true
        await assert.rejects(storage.head("media", "k"), (failure: unknown) => failure instanceof ObjectStorageError && failure.kind === "unavailable")
        const cause = new Error("boom")
        const error = new ObjectStorageError(CODES.Unavailable, { cause, context: { bucket: "media" } })
        assert.equal(error.cause, cause)
        assert.deepEqual(error.context, { bucket: "media" })
        assert.equal(new ObjectStorageError(CODES.KeyInvalid).cause, undefined)
        assert.equal(error.name, "ObjectStorageError")
    })

    it("give every code a kind", () => {
        assert.deepEqual(Object.keys(OBJECT_STORAGE_ERROR_KINDS).sort(), Object.values(CODES).sort())
        assert.equal(OBJECT_STORAGE_ERROR_KINDS[CODES.ObjectNotFound], "not-found")
        assert.equal(OBJECT_STORAGE_ERROR_KINDS[CODES.ExpiryInvalid], "invalid")
    })
})

describe("the in-memory browser", () => {
    it("accepts an upload that matches what was signed and refuses one that does not", async () => {
        const clock = new FakeStorageClock()
        const storage = createMemoryObjectStorage({ clock })
        const signed = await storage.presignPut("media", "u/a b.png", { contentType: "image/png", contentLength: 3, expiresIn: 60 })
        assert.equal(await storage.upload(signed.url, png, "text/html"), 403)
        assert.equal(await storage.upload(signed.url, new Uint8Array(4), "image/png"), 403)
        assert.equal(await storage.upload(signed.url, png, "image/png"), 200)
        assert.equal((await storage.head("media", "u/a b.png"))?.size, 3)
        const late = await storage.presignPut("media", "u/late.png", { contentType: "image/png", expiresIn: 60 })
        clock.advance(61_000)
        assert.equal(await storage.upload(late.url, png, "image/png"), 403)
    })

    it("seeds binary bodies and closes", async () => {
        const storage = createMemoryObjectStorage()
        storage.seed("media", "bin", png, "application/octet-stream")
        assert.equal((await storage.head("media", "bin"))?.size, 3)
        storage.onModuleDestroy()
        assert.equal(storage.store.destroyed, true)
    })
})
