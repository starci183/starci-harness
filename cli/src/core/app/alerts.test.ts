// `starci app alerts setup|discover-chat --env <env>`: the app's own alert bot (PROJECT-MONITORING-5), never the harness bot. The Bot API is a mock
// fetch and the sealed store a map; no real Telegram call, no sops. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { loadTelegram } from "../../harness/telegram.js"
import { appRootOf, discoverAlertChat, setupAlerts, setYamlPreserving, startLine } from "./alerts.js"
import type { AlertChatSeams, AlertSetupSeams } from "./alerts.js"

const opsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops")
const TOKEN = "123456:fixture-alert-bot"

/** An app with environments.production.monitoring.alerts.telegram.member = alerts, its member sealed (fixture text). */
const app = (t: { after: (fn: () => void) => void }, declared = true): string => {
    const root = mkdtempSync(join(tmpdir(), "starci-app-alerts-"))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
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
        urls.push(input instanceof Request ? input.url : input.toString())
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

/** The setup's seams: a prompt answering `typed`, a seal recording what it seals, a store that opens or not, and getMe answering `nivo_alerts_bot`. */
const setupSeams = (typed: string, opens: boolean): AlertSetupSeams & { readonly sealedTokens: string[]; readonly prompts: string[] } => {
    const sealedTokens: string[] = []
    const prompts: string[] = []
    const fetcher = ((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString()
        const ok = url.includes("/bot123456:fixture-alert-bot/getMe")
        return Promise.resolve(new Response(JSON.stringify(ok ? { ok: true, result: { id: 1, is_bot: true, username: "nivo_alerts_bot" } } : { ok: false, error_code: 401, description: "Unauthorized" }), { status: ok ? 200 : 401 }))
    }) as typeof fetch
    return {
        prompt: (label) => { prompts.push(label); return Promise.resolve(typed) },
        sealToken: (_member, token) => { sealedTokens.push(token); return Promise.resolve() },
        open: () => { if (!opens) throw new Error("no identity opens it"); return { ALERTS_TELEGRAM_BOT_TOKEN: TOKEN } },
        fetcher,
        config: loadTelegram(opsDir),
        sealedTokens,
        prompts,
    }
}

void test("setup writes the owner username beside the member, asks no token the member holds, and works with a member this machine cannot open", async (t) => {
    const root = app(t)
    const file = join(root, ".starcistacks", "application-stacks.yaml")
    const locked = setupSeams("", false)
    const done = await setupAlerts(root, "production", { owner: "@StarCi183", token: false }, locked)
    assert.deepEqual(done, { member: "alerts", owner: "@StarCi183", bot: null, tokenSealed: false, configChanged: true })
    assert.deepEqual(locked.prompts, [], "the member holds the token: nothing is asked, nothing is opened to write the username")
    assert.match(readFileSync(file, "utf8"), /alerts: \{telegram: \{member: alerts, owner: "@StarCi183"\}\}/)
    assert.equal(startLine(done, "fixture", "production"), "Mở bot cảnh báo của fixture production và bấm Start (từ tài khoản @StarCi183).")
    const again = await setupAlerts(root, "production", { token: false }, setupSeams("", true))
    assert.equal(again.configChanged, false, "the owner is kept from the config")
    assert.equal(startLine(again, "fixture", "production"), "Mở bot @nivo_alerts_bot và bấm Start (từ tài khoản @StarCi183).")
})

void test("setup asks the token at the prompt when the member lacks it, checks it with getMe before sealing, and refuses a bad owner or a rejected token", async (t) => {
    const root = app(t, false)
    rmSync(join(root, ".starcistacks", "production", "secrets", "alerts.enc.yaml"))
    const typed = setupSeams(` ${TOKEN}\n`, false)
    const done = await setupAlerts(root, "production", { owner: "starci183", token: false }, typed)
    assert.deepEqual([done.bot, done.tokenSealed, done.owner], ["nivo_alerts_bot", true, "@starci183"])
    assert.deepEqual(typed.sealedTokens, [TOKEN])
    assert.match(readFileSync(join(root, ".starcistacks", "application-stacks.yaml"), "utf8"), /monitoring:\n {6}alerts:\n {8}telegram:\n {10}member: alerts\n {10}owner: "@starci183"/)
    const wrong = setupSeams("999:wrong", false)
    await assert.rejects(setupAlerts(root, "production", { token: true }, wrong), /TELEGRAM_TOKEN_REJECTED|401/)
    assert.deepEqual(wrong.sealedTokens, [], "a rejected token is never sealed")
    await assert.rejects(setupAlerts(root, "production", { owner: "@ab", token: false }, typed), /no Telegram username/)
    await assert.rejects(setupAlerts(app(t, false), "production", { token: false }, typed), /pass --owner/)
    await assert.rejects(setupAlerts(root, "nowhere", { owner: "@starci183", token: false }, typed), /environments\.nowhere is not declared/)
})

void test("a YAML edit keeps every other line as written, flow maps padded or not", () => {
    const text = "# head\nsides: {be: true}\nenvironments:\n  production:\n    ports: { web: 3200 }\n    deploy: {stack: s}  # kept\n"
    assert.equal(setYamlPreserving(text, ["environments", "production", "monitoring", "alerts", "telegram", "owner"], "@x_owner"), text.replace("  # kept\n", "  # kept\n    monitoring:\n      alerts:\n        telegram:\n          owner: \"@x_owner\"\n"))
})
