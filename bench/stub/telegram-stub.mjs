// The bench's Telegram stand-in: a fake Bot API on 127.0.0.1, run by a scenario's `serve: {stub: telegram}` step. It prints
// `stub telegram: <url> token <token>`; the token is minted per run and is the only one it accepts (any other answers 401).
// It answers getMe, getUpdates (offset honoured; a long poll waits at most a second), sendMessage and sendPhoto (a json body
// naming a file id, or a multipart upload; kept, in order), answerCallbackQuery and editMessageReplyMarkup. A scenario plays the
// people who write to the bot with `POST <url>/__update {chat, text, replyTo?, type?}`, presses a button with
// `POST <url>/__callback {chat, data, messageId}`, and reads what the bot did with `GET <url>/__sent`, an envelope whose
// data.messages lists every message with its message_id, chat_id, text (a photo's caption), reply_to, photo (`upload` or the file
// id it named) and keyboard (the callback data and urls of its buttons), data.edits every keyboard edit and data.toasts every
// answered press.
// It is preloaded with the Orca stand-in like every node of a bench run, which returns at once outside a binary named orca.
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"

const token = `bench${randomBytes(12).toString("hex")}`
const updates = []
const sent = []
const edits = []
const toasts = []
let nextFile = 1
let nextUpdate = 1
let nextMessage = 1

const json = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
}

// A multipart form's text fields (utf-8), and `upload` for its file part.
const readForm = (buffer, type) => {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type)
    const marker = `--${boundary?.[1] ?? boundary?.[2] ?? ""}`
    const fields = {}
    for (const part of buffer.toString("latin1").split(marker)) {
        const name = /name="([^"]+)"/.exec(part)?.[1]
        if (name === undefined) continue
        const value = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "")
        fields[name] = /filename="/.test(part) ? "upload" : Buffer.from(value, "latin1").toString("utf8")
    }
    for (const key of ["reply_markup", "reply_parameters"]) if (typeof fields[key] === "string") fields[key] = JSON.parse(fields[key])
    return fields
}

const readBody = async (request) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const type = request.headers["content-type"] ?? ""
    if (type.startsWith("multipart/form-data")) return readForm(buffer, type)
    const text = buffer.toString("utf8")
    return text === "" ? {} : JSON.parse(text)
}

const keyboardOf = (body) => (body.reply_markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data ?? button.url)

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
    if (method === "sendMessage" || method === "sendPhoto") {
        const replyTo = body.reply_parameters?.message_id
        const photo = method === "sendPhoto" ? String(body.photo) : null
        const entry = { message_id: nextMessage++, chat_id: String(body.chat_id), text: String(body.text ?? body.caption ?? ""), reply_to: replyTo ?? null, photo, keyboard: keyboardOf(body) }
        sent.push(entry)
        const file = photo === null ? {} : { photo: [{ file_id: photo === "upload" ? `bench-file-${String(nextFile++)}` : photo }] }
        return { message_id: entry.message_id, date: Math.floor(Date.now() / 1000), chat: { id: Number(body.chat_id), type: "private" }, text: entry.text, ...file }
    }
    if (method === "answerCallbackQuery") {
        toasts.push({ id: String(body.callback_query_id), text: String(body.text ?? "") })
        return true
    }
    if (method === "editMessageReplyMarkup") {
        edits.push({ chat_id: String(body.chat_id), message_id: Number(body.message_id), keyboard: keyboardOf(body) })
        return true
    }
    return undefined
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    readBody(request)
        .then(async (body) => {
            if (url.pathname === "/__sent") return json(response, 200, { schema: "bench/telegram-sent@1", ok: true, data: { count: sent.length, messages: sent, edits, toasts } })
            if (url.pathname === "/__callback" && request.method === "POST") {
                const chat = Number(body.chat)
                const update = { update_id: nextUpdate++, callback_query: { id: `cb-${String(nextUpdate)}`, from: { id: chat, is_bot: false }, message: { message_id: Number(body.messageId), chat: { id: chat, type: "private" } }, data: String(body.data) } }
                updates.push(update)
                return json(response, 200, { schema: "bench/telegram-update@1", ok: true, data: update })
            }
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
