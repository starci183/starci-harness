// `starci app alerts discover-chat --env <env>`: the app's own alert bot (PROJECT-MONITORING-5), never the harness bot. The Bot API is a mock
// fetch and the sealed store a map; no real Telegram call, no sops. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { loadTelegram } from "../../harness/telegram.js"
import { appRootOf, discoverAlertChat } from "./alerts.js"
import type { AlertChatSeams } from "./alerts.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const TOKEN = "123456:fixture-alert-bot"

/** An app with environments.production.monitoring.alerts.telegram.member = alerts, its member sealed (fixture text). */
const app = (t: { after: (fn: () => void) => void }, declared = true): string => {
    const root = mkdtempSync(join(tmpdir(), "starci-app-alerts-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, ".starcistacks", "production", "secrets"), { recursive: true })
    writeFileSync(join(root, "hfs.json"), JSON.stringify({ project: "fixture" }))
    writeFileSync(join(root, ".starcistacks", "application-stacks.yaml"), `environments:\n  production:\n    runtime: docker-swarm\n${declared ? "    monitoring:\n      alerts: {telegram: {member: alerts}}\n" : ""}`)
    writeFileSync(join(root, ".starcistacks", "production", "secrets", "alerts.enc.yaml"), "ALERTS_TELEGRAM_BOT_TOKEN: ENC[fixture]\nsops: {}\n")
    return root
}

/** The seams: a store holding the token, recording what is sealed, and a Bot API answering getUpdates with `updates`, recording the URLs called. */
const seams = (updates: unknown[]): AlertChatSeams & { readonly sealed: Record<string, string>[]; readonly urls: string[] } => {
    const sealed: Record<string, string>[] = []
    const urls: string[] = []
    const fetcher = ((input: string | URL | Request) => {
        urls.push(String(input))
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: updates }), { status: 200 }))
    }) as typeof fetch
    return { open: () => ({ ALERTS_TELEGRAM_BOT_TOKEN: TOKEN }), seal: (_file, values) => sealed.push({ ...values }), fetcher, config: loadTelegram(opsDir), sealed, urls }
}

const privateMessage = (id: number, name: string): unknown => ({ update_id: id, message: { message_id: 1, date: 0, chat: { id, type: "private", first_name: name }, from: { id, is_bot: false }, text: "/start" } })

void test("the one private chat that wrote to the app's bot is sealed as ALERTS_TELEGRAM_CHAT_ID, read with the member's own token", async (t) => {
    const root = app(t)
    const mock = seams([privateMessage(4242, "Owner")])
    const found = await discoverAlertChat(root, "production", undefined, mock)
    assert.equal(found.chat, "4242")
    assert.deepEqual(mock.sealed, [{ ALERTS_TELEGRAM_CHAT_ID: "4242" }])
    assert.equal(mock.urls.length, 1)
    assert.match(mock.urls[0] ?? "", /\/bot123456:fixture-alert-bot\/getUpdates$/, "the app's own token, not the harness bot's")
    assert.equal(appRootOf(join(root, ".starcistacks")), root)
})

void test("no chat yet, several chats, an undeclared bot or a member this machine cannot open are refused clearly, and nothing is sealed", async (t) => {
    const root = app(t)
    const empty = seams([])
    await assert.rejects(discoverAlertChat(root, "production", undefined, empty), /ALERTS_NO_CHAT|no private chat wrote to the alert bot of production yet: send it \/start/)
    assert.deepEqual(empty.sealed, [])
    const several = seams([privateMessage(1, "A"), privateMessage(2, "B")])
    await assert.rejects(discoverAlertChat(root, "production", undefined, several), /several chats wrote.*--chat/)
    assert.equal((await discoverAlertChat(root, "production", "2", several)).name, "B")
    await assert.rejects(discoverAlertChat(app(t, false), "production", undefined, seams([])), /monitoring\.alerts\.telegram\.member is not declared/)
    const locked = { ...seams([]), open: () => { throw new Error("no identity opens it") } }
    await assert.rejects(discoverAlertChat(root, "production", undefined, locked), /does not open on this machine \(it is sealed to its server, backup and CI keys\)/)
})
