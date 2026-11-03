import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import { createObjectStorage } from "./index.ts"
import type { ObjectStorage } from "./index.ts"
import { OBJECT_STORAGE_ERROR_CODES, ObjectStorageError } from "./errors.ts"
import { AwsS3Transport } from "./aws.ts"

interface Stored {
    body: Buffer
    type: string
    at: Date
}

const xml = (response: ServerResponse, status: number, body: string): void => {
    response.writeHead(status, { "content-type": "application/xml" })
    response.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`)
}

const bodyOf = async (request: IncomingMessage): Promise<Buffer> => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
}

/** A path-style S3 that answers the few calls the transport makes; `broken` makes every call a 500. */
class FakeS3 {
    readonly buckets = new Map<string, Map<string, Stored>>()
    readonly policies = new Map<string, string>()
    broken = false
    pages = 0

    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? "/", "http://fake")
        const [bucket = "", ...rest] = decodeURIComponent(url.pathname.slice(1)).split("/")
        const key = rest.join("/")
        if (this.broken) {
            xml(response, 500, "<Error><Code>InternalError</Code></Error>")
            return
        }
        const objects = this.buckets.get(bucket)
        if (key === "") return this.bucketCall(request, response, url, bucket, objects)
        if (objects === undefined) {
            xml(response, 404, "<Error><Code>NoSuchBucket</Code></Error>")
            return
        }
        const found = objects.get(key)
        if (request.method === "PUT") {
            objects.set(key, { body: await bodyOf(request), type: request.headers["content-type"] ?? "", at: new Date("2026-01-02T03:04:05.000Z") })
            response.writeHead(200, { etag: '"abc"' })
            response.end()
            return
        }
        if (found === undefined) {
            if (request.method === "HEAD") {
                response.writeHead(404).end()
                return
            }
            xml(response, 404, "<Error><Code>NoSuchKey</Code></Error>")
            return
        }
        const headers = { "content-type": found.type, "content-length": String(found.body.length), "last-modified": found.at.toUTCString(), etag: '"abc"' }
        response.writeHead(200, headers)
        response.end(request.method === "HEAD" ? undefined : found.body)
        return
    }

    private async bucketCall(request: IncomingMessage, response: ServerResponse, url: URL, bucket: string, objects: Map<string, Stored> | undefined): Promise<void> {
        if (request.method === "HEAD") {
            response.writeHead(objects === undefined ? 404 : 200).end()
            return
        }
        if (request.method === "PUT" && url.searchParams.has("policy")) {
            this.policies.set(bucket, (await bodyOf(request)).toString("utf8"))
            response.writeHead(204).end()
            return
        }
        if (request.method === "PUT") {
            this.buckets.set(bucket, new Map())
            response.writeHead(200).end()
            return
        }
        if (objects === undefined) {
            xml(response, 404, "<Error><Code>NoSuchBucket</Code></Error>")
            return
        }
        if (request.method === "POST") {
            const keys = [...(await bodyOf(request)).toString("utf8").matchAll(/<Key>([^<]*)<\/Key>/gu)].map((match) => match[1] ?? "")
            const deleted = keys.filter((key) => objects.delete(key))
            xml(response, 200, `<DeleteResult>${deleted.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join("")}</DeleteResult>`)
            return
        }
        this.listCall(response, url, objects)
        return
    }

    private listCall(response: ServerResponse, url: URL, objects: Map<string, Stored>): void {
        const prefix = url.searchParams.get("prefix") ?? ""
        const after = url.searchParams.get("continuation-token")
        const names = [...objects.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).sort()
        const from = after === null ? 0 : Number(after)
        const page = names.slice(from, from + 2)
        const more = from + 2 < names.length
        this.pages += 1
        const contents = page.map((key) => `<Contents><Key>${key}</Key><LastModified>${objects.get(key)?.at.toISOString() ?? ""}</LastModified></Contents>`).join("")
        xml(response, 200, `<ListBucketResult><IsTruncated>${String(more)}</IsTruncated>${more ? `<NextContinuationToken>${String(from + 2)}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`)
    }
}

describe("the AWS transport against a local S3", () => {
    const fake = new FakeS3()
    let server: Server
    let endpoint = ""
    let storage: ObjectStorage & { onModuleDestroy(): void }
    const now = new Date("2026-03-01T00:00:00.000Z")

    before(async () => {
        server = createServer((request, response) => {
            void fake.handle(request, response)
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
        storage = createObjectStorage({
            endpoint,
            publicEndpoint: "https://files.example.com",
            region: "us-east-1",
            accessKeyId: "AKIAFAKE",
            secretAccessKey: { reveal: () => "secret-fake" },
            timeoutMs: 2000,
            clock: { now: () => now },
        })
    })

    after(async () => {
        storage.onModuleDestroy()
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve()
            })
        })
    })

    it("creates a missing bucket once, with an anonymous read policy only when public", async () => {
        await storage.ensureBucket("media")
        await storage.ensureBucket("media")
        await storage.ensureBucket("avatars", { publicRead: true })
        assert.deepEqual([...fake.buckets.keys()].sort(), ["avatars", "media"])
        assert.equal(fake.policies.has("media"), false)
        assert.match(fake.policies.get("avatars") ?? "", /arn:aws:s3:::avatars\/\*/u)
    })

    it("puts, heads and gets an object and answers null for a missing one", async () => {
        await storage.put("media", "users/u1/a.txt", new TextEncoder().encode("hello"), "text/plain")
        const head = await storage.head("media", "users/u1/a.txt")
        assert.ok(head)
        assert.equal(head.size, 5)
        assert.equal(head.contentType, "text/plain")
        assert.equal(head.lastModified, "2026-01-02T03:04:05.000Z")
        assert.equal(head.etag, '"abc"')
        const read = await storage.get("media", "users/u1/a.txt")
        assert.equal(new TextDecoder().decode(read?.bytes), "hello")
        assert.equal(await storage.head("media", "users/u1/none.txt"), null)
        assert.equal(await storage.get("media", "users/u1/none.txt"), null)
        assert.equal(await storage.head("absent-bucket", "k"), null)
    })

    it("confirms an upload against the limits in force", async () => {
        assert.equal((await storage.confirmUpload("media", "users/u1/a.txt", { maxBytes: 5, contentTypes: ["text/*"] })).size, 5)
        await assert.rejects(storage.confirmUpload("media", "users/u1/a.txt", { maxBytes: 4 }), { code: OBJECT_STORAGE_ERROR_CODES.SizeExceeded })
        await assert.rejects(storage.confirmUpload("media", "users/u1/none.txt"), { code: OBJECT_STORAGE_ERROR_CODES.ObjectNotFound })
    })

    it("lists the files of one folder across pages, newest first, without subfolders", async () => {
        for (const name of ["a", "b", "c"]) await storage.put("media", `list/${name}.txt`, new Uint8Array(1), "text/plain")
        await storage.put("media", "list/deep/d.txt", new Uint8Array(1), "text/plain")
        const listed = await storage.list("media", "list/", 10)
        assert.deepEqual(listed.map((entry) => entry.name).sort(), ["a.txt", "b.txt", "c.txt"])
        assert.ok(fake.pages >= 2)
        assert.equal((await storage.list("media", "list", 2)).length, 2)
    })

    it("deletes one key and many, counting what the store reports", async () => {
        await storage.remove("media", "list/a.txt")
        assert.equal(await storage.removeMany("media", ["list/b.txt", "list/c.txt", "list/missing.txt"]), 2)
        assert.equal(await storage.removeMany("media", []), 0)
    })

    it("signs a PUT for the public origin with the content type and size in the signature", async () => {
        const signed = await storage.presignPut("media", "users/u1/avatar.png", { contentType: "image/png", contentLength: 1234, expiresIn: 600 })
        const url = new URL(signed.url)
        assert.equal(url.origin, "https://files.example.com")
        assert.equal(url.pathname, "/media/users/u1/avatar.png")
        assert.equal(url.searchParams.get("X-Amz-Expires"), "600")
        assert.equal(url.searchParams.get("X-Amz-Date"), "20260301T000000Z")
        const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";")
        assert.ok(signedHeaders.includes("content-type"), signedHeaders.join(","))
        assert.ok(signedHeaders.includes("content-length"), signedHeaders.join(","))
        assert.equal(signed.expiresAt, "2026-03-01T00:10:00.000Z")
        assert.deepEqual(signed.headers, { "Content-Type": "image/png", "Content-Length": "1234" })
    })

    it("signs a GET with the default lifetime and an optional download name", async () => {
        const plain = await storage.presignGet("media", "users/u1/a b.txt")
        assert.equal(new URL(plain.url).searchParams.get("X-Amz-Expires"), "300")
        assert.equal(new URL(plain.url).pathname, "/media/users/u1/a%20b.txt")
        const named = await storage.presignGet("media", "k.txt", { downloadName: "report 1.txt" })
        assert.match(new URL(named.url).searchParams.get("response-content-disposition") ?? "", /^attachment; filename="report%201\.txt"$/u)
    })

    it("builds a public address without a request", () => {
        assert.equal(storage.publicUrl("avatars", "users/u 1/a.png"), "https://files.example.com/avatars/users/u%201/a.png")
    })

    it("turns a failing store into UNAVAILABLE with the cause kept and no credential in the context", async () => {
        fake.broken = true
        try {
            for (const call of [
                () => storage.head("media", "k"),
                () => storage.get("media", "k"),
                () => storage.put("media", "k", new Uint8Array(1), "text/plain"),
                () => storage.removeMany("media", ["k"]),
                () => storage.list("media", "", 5),
                () => storage.ensureBucket("media"),
            ]) {
                await assert.rejects(call(), (failure: unknown) => {
                    assert.ok(failure instanceof ObjectStorageError)
                    assert.equal(failure.code, OBJECT_STORAGE_ERROR_CODES.Unavailable)
                    assert.equal(failure.kind, "unavailable")
                    assert.notEqual(failure.cause, undefined)
                    assert.doesNotMatch(JSON.stringify(failure.context), /secret-fake|AKIAFAKE/u)
                    return true
                })
            }
        } finally {
            fake.broken = false
        }
    })

    it("reports a signing failure as UNAVAILABLE", async () => {
        const transport = new AwsS3Transport({ endpoint: "http://[broken", region: "us-east-1", accessKeyId: "a", secretAccessKey: "b" })
        await assert.rejects(transport.sign({ method: "GET", bucket: "media", key: "k", expiresIn: 60, signingDate: now }), { code: OBJECT_STORAGE_ERROR_CODES.Unavailable })
        transport.destroy()
    })
})
