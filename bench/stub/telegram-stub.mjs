// The bench's Telegram stand-in: a fake Bot API on 127.0.0.1, run by a scenario's `serve: {stub: telegram}` step. It prints
// `stub telegram: <url> token <token>`; the token is minted per run and is the only one it accepts (any other answers 401).
// It answers getMe, getUpdates (offset honoured; a long poll waits at most a second) and sendMessage (kept, in order). A scenario
// plays the people who write to the bot with `POST <url>/__update {chat, text, replyTo?, type?}` and reads what the bot sent
// with `GET <url>/__sent`, an envelope whose data.messages lists every message with its message_id, chat_id, text and reply_to.
// It is preloaded with the Orca stand-in like every node of a bench run, which returns at once outside a binary named orca.
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"

const token = `bench${randomBytes(12).toString("hex")}`
const updates = []
const sent = []
let nextUpdate = 1
let nextMessage = 1

const json = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
}

const readBody = async (request) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString("utf8")
    return text === "" ? {} : JSON.parse(text)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const message = (chat, text, type, replyTo) => ({
    message_id: nextMessage++,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chat, type, first_name: `person ${String(chat)}` },
    from: { id: chat, is_bot: false, first_name: `person ${String(chat)}` },
    text,
    ...(replyTo === undefined ? {} : { reply_to_message: { message_id: replyTo } }),
})

const bot = async (method, body) => {
    if (method === "getMe") return { id: 1, is_bot: true, first_name: "StarCi bench", username: "starci_bench_bot" }
    if (method === "getUpdates") {
        const offset = Number(body.offset ?? 0)
        const due = () => updates.filter((update) => update.update_id >= offset)
        if (due().length === 0 && Number(body.timeout ?? 0) > 0) await sleep(Math.min(Number(body.timeout), 1) * 1000)
        return due()
    }
    if (method === "sendMessage") {
        const replyTo = body.reply_parameters?.message_id
        const entry = { message_id: nextMessage++, chat_id: String(body.chat_id), text: String(body.text ?? ""), reply_to: replyTo ?? null }
        sent.push(entry)
        return { message_id: entry.message_id, date: Math.floor(Date.now() / 1000), chat: { id: Number(body.chat_id), type: "private" }, text: entry.text }
    }
    return undefined
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    readBody(request)
        .then(async (body) => {
            if (url.pathname === "/__sent") return json(response, 200, { schema: "bench/telegram-sent@1", ok: true, data: { count: sent.length, messages: sent } })
            if (url.pathname === "/__update" && request.method === "POST") {
                const update = { update_id: nextUpdate++, message: message(Number(body.chat), String(body.text ?? ""), body.type ?? "private", body.replyTo === undefined ? undefined : Number(body.replyTo)) }
                updates.push(update)
                return json(response, 200, { schema: "bench/telegram-update@1", ok: true, data: update })
            }
            const call = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname)
            if (call === null) return json(response, 404, { ok: false, error_code: 404, description: "Not Found" })
            if (call[1] !== token) return json(response, 401, { ok: false, error_code: 401, description: "Unauthorized" })
            const result = await bot(call[2], body)
            if (result === undefined) return json(response, 404, { ok: false, error_code: 404, description: `Not Found: method ${call[2]}` })
            return json(response, 200, { ok: true, result })
        })
        .catch((error) => json(response, 500, { ok: false, error_code: 500, description: String(error) }))
})

server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    process.stdout.write(`stub telegram: http://127.0.0.1:${String(address.port)} token ${token}\n`)
})
