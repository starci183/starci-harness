import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { IncomingMessage, Server } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, it } from "node:test"
import { TestWorldErrorCode } from "../errors"
import { createMailpitApi } from "./mail-api"

interface Call {
    readonly method: string
    readonly url: string
    readonly body: unknown
}

const bodyOf = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Array<Buffer> = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
    const text = Buffer.concat(chunks).toString("utf8")
    return text === "" ? null : (JSON.parse(text) as unknown)
}

/** A mailpit that answers the shapes of its v1 API: newest-first list, one message, the three chaos triggers. */
const withSink = async (work: (url: string, calls: Array<Call>) => Promise<void>): Promise<void> => {
    const calls: Array<Call> = []
    let chaos: unknown = { Sender: { ErrorCode: 451, Probability: 0 }, Recipient: { ErrorCode: 451, Probability: 0 }, Authentication: { ErrorCode: 535, Probability: 0 } }
    const server: Server = createServer((request, response) => {
        void (async () => {
            const body = await bodyOf(request)
            calls.push({ method: request.method ?? "", url: request.url ?? "", body })
            response.setHeader("content-type", "application/json")
            if (request.url?.startsWith("/api/v1/messages") === true && request.method === "GET") {
                response.end(
                    JSON.stringify({
                        messages: [
                            { ID: "m2", From: { Name: "", Address: "noreply@shop.test" }, To: [{ Name: "Bo", Address: "bo@example.com" }], Cc: null, Bcc: [], Subject: "Second", Snippet: "two", Created: "2026-11-08T10:00:02Z" },
                            { ID: "m1", From: { Name: "Shop", Address: "noreply@shop.test" }, To: [{ Name: "", Address: "ann@example.com" }], Cc: [{ Name: "", Address: "cc@example.com" }], Bcc: [{ Name: "", Address: "hidden@example.com" }], Subject: "First", Snippet: "one", Created: "2026-11-08T10:00:01Z" },
                        ],
                    }),
                )
            } else if (request.url === "/api/v1/message/m1") {
                response.end(
                    JSON.stringify({
                        ID: "m1",
                        From: { Name: "Shop", Address: "noreply@shop.test" },
                        To: [{ Name: "", Address: "ann@example.com" }],
                        Subject: "First",
                        Text: "Hello Ann\nhttps://app.test/confirm?t=1",
                        HTML: "<p>Hello Ann</p>",
                        Created: "2026-11-08T10:00:01Z",
                        Attachments: [{ FileName: "terms.pdf", ContentType: "application/pdf", Size: 12 }],
                    }),
                )
            } else if (request.url === "/api/v1/messages" && request.method === "DELETE") response.end("ok")
            else if (request.url === "/api/v1/chaos" && request.method === "GET") response.end(JSON.stringify(chaos))
            else if (request.url === "/api/v1/chaos" && request.method === "PUT") {
                chaos = body
                response.end(JSON.stringify(body))
            } else {
                response.statusCode = 404
                response.end("not found")
            }
        })()
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    try {
        await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls)
    } finally {
        server.closeAllConnections()
        server.close()
    }
}

describe("mailpit api", () => {
    it("lists oldest first with the addresses of each message, and reads one whole message", async () => {
        await withSink(async (url) => {
            const api = createMailpitApi(url)
            const listed = await api.summaries()
            assert.deepEqual(
                listed.map((summary) => summary.id),
                ["m1", "m2"],
            )
            assert.deepEqual(listed[0]?.to, [{ name: "", address: "ann@example.com" }])
            assert.deepEqual(listed[0]?.cc, [{ name: "", address: "cc@example.com" }])
            assert.deepEqual(listed[0]?.bcc, [{ name: "", address: "hidden@example.com" }])
            assert.deepEqual(listed[1]?.cc, [], "a null address list is an empty one")
            assert.equal(listed[0]?.subject, "First")
            const message = await api.message("m1")
            assert.equal(message.subject, "First")
            assert.equal(message.text, "Hello Ann\nhttps://app.test/confirm?t=1")
            assert.equal(message.html, "<p>Hello Ann</p>")
            assert.deepEqual(message.attachments, [{ fileName: "terms.pdf", contentType: "application/pdf", size: 12 }])
            assert.equal(message.snippet, "Hello Ann\nhttps://app.test/confirm?t=1", "a message without a snippet takes the start of its text")
            await assert.rejects(api.message("ghost"), /read message ghost answered 404/)
        })
    })

    it("deletes every message", async () => {
        await withSink(async (url, calls) => {
            await createMailpitApi(url).deleteAll()
            assert.deepEqual(
                calls.map((call) => `${call.method} ${call.url}`),
                ["DELETE /api/v1/messages"],
            )
        })
    })

    it("refuses at one trigger and keeps the others as they were; acceptAll drops every probability and keeps the codes", async () => {
        await withSink(async (url, calls) => {
            const api = createMailpitApi(url)
            await api.refuse("recipient", { status: 550, probability: 100 })
            assert.deepEqual(calls.at(-1)?.body, {
                Sender: { ErrorCode: 451, Probability: 0 },
                Recipient: { ErrorCode: 550, Probability: 100 },
                Authentication: { ErrorCode: 535, Probability: 0 },
            })
            await api.refuse("authentication", { status: 454, probability: 50 })
            assert.deepEqual(await api.chaos(), {
                sender: { status: 451, probability: 0 },
                recipient: { status: 550, probability: 100 },
                authentication: { status: 454, probability: 50 },
            })
            await api.acceptAll()
            assert.deepEqual(await api.chaos(), {
                sender: { status: 451, probability: 0 },
                recipient: { status: 550, probability: 0 },
                authentication: { status: 454, probability: 0 },
            })
        })
    })

    it("rejects a status that is no SMTP error and a probability that is no percentage before calling the sink", async () => {
        await withSink(async (url, calls) => {
            const api = createMailpitApi(url)
            const refused = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === TestWorldErrorCode.ConfigInvalid
            await assert.rejects(api.refuse("sender", { status: 250, probability: 100 }), refused)
            await assert.rejects(api.refuse("sender", { status: 550.5, probability: 100 }), refused)
            await assert.rejects(api.refuse("sender", { status: 550, probability: 101 }), refused)
            await assert.rejects(api.refuse("sender", { status: 550, probability: 0.5 }), /probability must be a whole percentage from 0 to 100/)
            assert.deepEqual(calls, [])
        })
    })
})
