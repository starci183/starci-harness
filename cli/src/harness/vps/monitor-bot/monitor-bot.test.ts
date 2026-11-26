// The monitor bot of PROJECT-MONITORING-6 without Telegram, Prometheus, Loki, Alertmanager or Docker: every one of them is a fake. The
// renderers (table, bar, sparkline, Vietnamese numbers), the command parsing, the owner-only and admin-only refusals, the PromQL and LogQL
// builders and their scope, the alert-button flow (an offer, an admin's confirmation, the silence's matchers), the resolved message, the
// daily report's schedule and the code's purity (Node built-ins and this folder only). Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { alertMessage, parsePayload, silenceable } from "./alerting.js"
import type { WebhookPayload } from "./alerting.js"
import { createBot, scopeOf, silenceMatchers, STALE_MS } from "./bot.js"
import type { BotDeps } from "./bot.js"
import { prometheus } from "./clients.js"
import type { Alertmanager, Docker, Fetch, Matcher, Prometheus, Sample, Series } from "./clients.js"
import { commandText, parseCommand, parseDuration } from "./commands.js"
import type { Command } from "./commands.js"
import { accessOf, normalizeUsername, parseAdmins, parseConfig } from "./config.js"
import type { BotEntry } from "./config.js"
import { daysToFull, dailyReport } from "./handlers.js"
import type { Sources } from "./handlers.js"
import { groupByToken } from "./main.js"
import { edgeQueries, exploreLink, hostQueries, logsQuery, stackMatcher, stepOf, topCpu } from "./queries.js"
import { bar, escapeHtml, fitMessage, formatBytes, formatDuration, formatNumber, formatPercent, sparkline, table } from "./render.js"
import { everyDay, localDate, nextDaily } from "./schedule.js"
import type { Keyboard, Telegram, Update } from "./telegram.js"
import { replyMarkup } from "./telegram.js"
import { alertQueue, memoryStore, parseStore, storeText } from "./owners.js"

const here = dirname(fileURLToPath(import.meta.url))

void test("the renderers: Vietnamese numbers, bytes, durations, bars, sparklines and aligned, escaped tables", () => {
    assert.equal(formatNumber(1234.5, 1), "1.234,5")
    assert.equal(formatNumber(1_234_567), "1.234.567")
    assert.equal(formatNumber(-0.04, 1), "0,0")
    assert.equal(formatNumber(Number.NaN), "—")
    assert.equal(formatPercent(0.856), "86%")
    assert.equal(formatPercent(0.0234), "2,3%")
    assert.equal(formatBytes(1536 * 1024 * 1024), "1,5 GB")
    assert.equal(formatBytes(512), "512 B")
    assert.equal(formatDuration(93_784), "1 ngày 2 giờ")
    assert.equal(formatDuration(300), "5 phút")
    assert.equal(formatDuration(0), "0 giây")
    assert.equal(bar(0.5), "▓▓▓▓▓░░░░░")
    assert.equal(bar(1.7, 4), "▓▓▓▓", "a bar is clamped")
    assert.equal(bar(Number.NaN, 3), "░░░")
    assert.equal(sparkline([0, 1, 2, 3, 4, 5, 6, 7]), "▁▂▃▄▅▆▇█")
    assert.equal(sparkline([3, 3, 3]), "▁▁▁", "a flat series is its lowest cell")
    assert.equal(sparkline([1, Number.NaN, 2]), "▁ █", "a missing point is a space")
    assert.equal(Array.from(sparkline(Array.from({ length: 100 }, (_unused, index) => index), 20)).length, 20, "at most `width` cells")
    assert.equal(sparkline([]), "")
    assert.equal(escapeHtml("<a & b>"), "&lt;a &amp; b&gt;")
    const html = table([["api", "12%"], ["web<x>", "3%"]], { header: ["Service", "CPU"], aligns: ["left", "right"] })
    assert.equal(html, "<pre>Service  CPU\n────────────\napi      12%\nweb&lt;x&gt;    3%</pre>")
    const long = fitMessage(`<pre>${"x".repeat(5000)}</pre>`)
    assert.ok(long.length <= 4096)
    assert.match(long, /<\/pre>\n…\(đã cắt bớt\)$/, "a cut reply closes its <pre>")
})

const parsed = (text: string): Command | string => {
    const result = parseCommand(text, "nivo_monitor_bot")
    return result.kind === "command" ? result.command : result.kind === "usage" ? `usage: ${result.text}` : "ignore"
}

const isUsage = (text: string): boolean => parseCommand(text, "nivo_monitor_bot").kind === "usage"

void test("the commands parse into checked arguments; another bot's mention, plain talk and an unknown command are ignored", () => {
    assert.deepEqual(parsed("/cpu"), { name: "cpu", range: "1h" })
    assert.deepEqual(parsed("/cpu 24h"), { name: "cpu", range: "24h" })
    assert.deepEqual(parsed("/CPU@nivo_monitor_bot 6h"), { name: "cpu", range: "6h" })
    assert.equal(parsed("/cpu@other_bot"), "ignore")
    assert.equal(parsed("hello /cpu"), "ignore")
    assert.equal(parsed("/reboot"), "ignore")
    assert.deepEqual(parseCommand("/cpu 2d", "nivo_monitor_bot"), { kind: "usage", text: "Cú pháp: /cpu [1h|6h|24h]" })
    assert.deepEqual(parsed("/ram"), { name: "ram", range: "1h" })
    assert.deepEqual(parsed("/logs api"), { name: "logs", service: "api", range: "15m" })
    assert.deepEqual(parsed("/logs nivo-production_api 1h"), { name: "logs", service: "nivo-production_api", range: "1h" })
    assert.ok(isUsage('/logs api"} |= "x'), "a service name is checked before it reaches LogQL")
    assert.ok(isUsage("/logs"))
    assert.deepEqual(parsed("/silence HostCpuBusy 1h"), { name: "silence", target: "HostCpuBusy", seconds: 3600 })
    assert.deepEqual(parsed("/silence all 30m"), { name: "silence", target: "all", seconds: 1800 })
    assert.ok(isUsage("/silence HostCpuBusy 8d"), "at most 7 days")
    assert.ok(isUsage("/silence Host.* 1h"), "a name, never a regex")
    assert.ok(isUsage("/silence HostCpuBusy"))
    assert.deepEqual(parsed("/chart 5xx"), { name: "chart", metric: "5xx", range: "24h" })
    assert.ok(isUsage("/chart load"))
    assert.deepEqual(parsed("/start"), { name: "help" })
    assert.ok(isUsage("/status now"))
    assert.equal(parseDuration("2h"), 7200)
    assert.equal(parseDuration("30s"), null)
    for (const text of ["/cpu 6h", "/logs api 1h", "/chart disk 7d", "/svc", "/silence all 90m"]) {
        const command = parsed(text)
        assert.ok(typeof command !== "string")
        assert.deepEqual(parsed(commandText(command)), command, `${text} is written back as itself`)
    }
})

const entry = (over: Partial<BotEntry> = {}): BotEntry => ({ slot: 0, project: "nivo", env: "production", stack: "nivo-production", tokenFile: "/run/secrets/alerts_0", chat: 42, owner: null, admins: [], ...over })

void test("only the owner chat is answered; a write needs a listed admin, or the owner chat's own user with no list", () => {
    assert.equal(accessOf(entry(), 7, 7), "none", "another chat is ignored")
    assert.equal(accessOf(entry(), 42, 42), "write", "a private owner chat is its user's")
    assert.equal(accessOf(entry({ chat: -100 }), -100, 42), "read", "a group with no admin list: everyone reads, nobody writes")
    assert.equal(accessOf(entry({ chat: -100, admins: [42] }), -100, 42), "write")
    assert.equal(accessOf(entry({ chat: -100, admins: [42] }), -100, 43), "read")
    assert.equal(accessOf(entry({ admins: [9] }), 42, 42), "read", "a listed admin list replaces the private-chat default")
    assert.deepEqual(parseAdmins(" 1, -2 ,3"), [1, -2, 3])
    assert.deepEqual(parseAdmins(""), [])
    assert.throws(() => parseAdmins("1;rm"), /no comma list/)
})

void test("the config is checked: a chat the server did not fill is refused, the admins are parsed", () => {
    const base = { server: "sv-1", telegram: "https://api.telegram.org", prometheus: "http://prometheus:9090", loki: null, alertmanager: "http://alertmanager:9093", docker: "http://socket-proxy:2375", grafana: "https://grafana-sv-1.example", renderer: false, listen: 9095, memoryAlertPercent: 90, diskAlertPercent: 85, reportHour: 8, reportOffsetMinutes: 420 }
    const config = parseConfig(JSON.stringify({ ...base, bots: [{ slot: 0, project: "nivo", env: "production", stack: "nivo-production", tokenFile: "/run/secrets/alerts_0", chat: -1001, admins: "5,6" }] }))
    assert.deepEqual(config.bots[0]?.admins, [5, 6])
    assert.equal(config.loki, null)
    assert.throws(() => parseConfig(`${JSON.stringify({ ...base, bots: [] }).slice(0, -1)},"bots":[{"slot":0,"project":"n","env":"p","stack":"n-p","tokenFile":"/t","chat":__STARCI_ALERTS_CHAT_0__,"admins":""}]}`), SyntaxError)
    assert.throws(() => parseConfig(JSON.stringify({ ...base, bots: [{ slot: 0, project: "n", env: "p", stack: "N P", tokenFile: "/t", chat: 1, admins: "" }] })), /no swarm stack name/)
})

const scope = { project: "nivo", stacks: ["nivo-staging", "nivo-production"] }

void test("every app query carries the scope's stacks; LogQL and Explore links are built from checked names only", () => {
    assert.equal(stackMatcher(scope), 'stack=~"nivo-staging|nivo-production"')
    assert.throws(() => stackMatcher({ project: "x", stacks: [] }), /holds no stack/)
    assert.throws(() => stackMatcher({ project: "x", stacks: ['a"}or{'] }), /no swarm stack name/)
    assert.equal(topCpu(scope, 3), 'topk(3, sum by (service) (rate(container_cpu_usage_seconds_total{stack=~"nivo-staging|nivo-production"}[5m])))')
    assert.match(edgeQueries(scope, "1h").errorRate, /service=~"\(nivo-staging\|nivo-production\)\.\*",code=~"5\.\."/)
    assert.match(edgeQueries(scope, "24h").p95, /^histogram_quantile\(0\.95, /)
    assert.equal(logsQuery(scope, "api"), '{stack=~"nivo-staging|nivo-production", service=~"nivo-staging_api|nivo-production_api"} |~ "(?i)(error|warn|fatal|panic|exception)"')
    assert.equal(logsQuery(scope, "nivo-production_api"), '{stack=~"nivo-staging|nivo-production", service=~"nivo-production_api"} |~ "(?i)(error|warn|fatal|panic|exception)"')
    assert.doesNotMatch(hostQueries.cpu, /stack/, "the host summary is the machine's own")
    assert.equal(stepOf(3600), 90)
    assert.equal(stepOf(600), 30)
    const link = exploreLink("https://grafana-sv-1.example/", "{x}", 900) ?? ""
    assert.match(link, /^https:\/\/grafana-sv-1\.example\/explore\?orgId=1&left=/)
    assert.match(decodeURIComponent(link), /"from":"now-15m"/)
    assert.equal(exploreLink(null, "{x}", 900), null)
    assert.equal(daysToFull(10, 17), 10, "7 bytes in 7 days, 10 left: 10 days")
    assert.equal(daysToFull(10, 9), null, "a disk that shrinks never fills")
})

void test("the Prometheus client encodes the query and refuses an answer that is not a vector", async () => {
    const urls: string[] = []
    const fake = (body: unknown, ok = true): Fetch => (url) => {
        urls.push(url)
        return Promise.resolve({ ok, status: ok ? 200 : 503, json: () => Promise.resolve(body) })
    }
    const client = prometheus("http://prometheus:9090", fake({ status: "success", data: { result: [{ metric: { service: "a" }, value: [1, "0.5"] }] } }))
    assert.deepEqual(await client.query('up{stack="a"}'), [{ labels: { service: "a" }, value: 0.5 }])
    assert.equal(urls[0], "http://prometheus:9090/api/v1/query?query=up%7Bstack%3D%22a%22%7D")
    await assert.rejects(prometheus("http://prometheus:9090", fake({ status: "error" })).query("up"), /no vector/)
    await assert.rejects(prometheus("http://prometheus:9090", fake({}, false)).query("up"), /prometheus:9090 answered 503/)
})

/** A fake Bot API that records what the bot sends, edits and answers. */
const fakeTelegram = (): { client: Telegram; sent: { chat: number; html: string; keyboard?: Keyboard }[]; edited: { chat: number; message: number; html: string }[]; answered: { id: string; notice?: string }[] } => {
    const sent: { chat: number; html: string; keyboard?: Keyboard }[] = []
    const edited: { chat: number; message: number; html: string }[] = []
    const answered: { id: string; notice?: string }[] = []
    const client: Telegram = {
        username: () => Promise.resolve("nivo_monitor_bot"),
        updates: () => Promise.resolve([]),
        send: (chat, html, keyboard) => {
            if (keyboard !== undefined) replyMarkup(keyboard)
            sent.push({ chat, html, ...(keyboard === undefined ? {} : { keyboard }) })
            return Promise.resolve(sent.length)
        },
        edit: (chat, message, html) => {
            edited.push({ chat, message, html })
            return Promise.resolve()
        },
        answer: (id, notice) => {
            answered.push({ id, ...(notice === undefined ? {} : { notice }) })
            return Promise.resolve()
        },
    }
    return { client, sent, edited, answered }
}

const NOW = Date.parse("2026-11-21T01:00:00Z")

/** Fake sources: Prometheus answers by query, Alertmanager records its silences. */
const fakeSources = (answers: (expr: string) => Sample[] = () => [], series: Series[] = []): { sources: Sources; silences: { matchers: readonly Matcher[]; seconds: number }[]; queries: string[] } => {
    const silences: { matchers: readonly Matcher[]; seconds: number }[] = []
    const queries: string[] = []
    const prom: Prometheus = {
        query: (expr) => {
            queries.push(expr)
            return Promise.resolve(answers(expr))
        },
        scalar: (expr) => {
            queries.push(expr)
            return Promise.resolve(answers(expr)[0]?.value ?? Number.NaN)
        },
        range: (expr) => {
            queries.push(expr)
            return Promise.resolve(series)
        },
    }
    const alertmanager: Alertmanager = {
        alerts: () => Promise.resolve([]),
        silence: (matchers, startsAt, endsAt) => {
            silences.push({ matchers, seconds: (endsAt.getTime() - startsAt.getTime()) / 1000 })
            return Promise.resolve("silence-1")
        },
    }
    const docker: Docker = { services: () => Promise.resolve([]), tasks: () => Promise.resolve([]) }
    return { sources: { prometheus: prom, loki: null, alertmanager, docker, grafana: null, renderer: false, memoryAlertPercent: 90, diskAlertPercent: 85, server: "sv-1", now: () => NOW }, silences, queries }
}

const message = (chat: number, from: number, text: string, date = NOW / 1000): Update => ({ update_id: 1, message: { message_id: 10, date, text, chat: { id: chat, type: chat < 0 ? "group" : "private" }, from: { id: from } } })
const press = (chat: number, from: number, data: string): Update => ({ update_id: 2, callback_query: { id: `cb-${data}`, data, from: { id: from }, message: { message_id: 99, chat: { id: chat } } } })

const botWith = (entries: readonly BotEntry[], sources: Sources) => {
    const telegram = fakeTelegram()
    let next = 0
    const logs: string[] = []
    const deps: BotDeps = { telegram: telegram.client, username: "nivo_monitor_bot", sources, id: () => `id${String((next += 1))}`, log: (line) => logs.push(line) }
    return { bot: createBot(entries, deps), telegram, logs }
}

void test("a read command answers the owner chat with a <pre> reply and buttons; another chat and a stale backlog get nothing", async () => {
    const { sources } = fakeSources((expr) => (expr.startsWith("topk") ? [{ labels: { service: "nivo-production_api" }, value: 0.42 }] : [{ labels: {}, value: 0.37 }]), [{ labels: {}, points: [[1, 0.2], [2, 0.5], [3, 0.37]] }])
    const { bot, telegram } = botWith([entry()], sources)
    await bot.handle(message(7, 7, "/cpu"))
    assert.equal(telegram.sent.length, 0, "another chat is ignored")
    await bot.handle(message(42, 42, "/cpu", (NOW - STALE_MS - 1000) / 1000))
    assert.equal(telegram.sent.length, 0, "a message older than 2 minutes is skipped")
    await bot.handle(message(42, 42, "/cpu 6h"))
    const reply = telegram.sent[0]
    assert.ok(reply !== undefined)
    assert.match(reply.html, /^🧠 <b>CPU<\/b> · nivo/)
    assert.match(reply.html, /<pre>🟢 {2}▓▓▓▓░░░░░░░░ +37%\n {3}▁█▅ +đỉnh 50%/)
    assert.match(reply.html, /api +42%/)
    assert.deepEqual(reply.keyboard?.[0]?.map((button) => button.data), ["c:/cpu 1h", "c:/cpu 6h", "c:/cpu 24h"])
    await bot.handle(press(42, 42, "c:/ram 1h"))
    assert.match(telegram.sent[1]?.html ?? "", /^💾 <b>RAM<\/b>/, "a button runs its command")
    await bot.handle(press(7, 7, "c:/ram 1h"))
    assert.equal(telegram.sent.length, 2, "a button pressed in another chat runs nothing")
})

void test("a silence needs an admin and an admin's confirmation, and matches only the app's stacks", async () => {
    const { sources, silences } = fakeSources()
    const group = entry({ chat: -100, admins: [5] })
    const { bot, telegram } = botWith([group, entry({ slot: 1, env: "staging", stack: "nivo-staging", chat: -100, admins: [5] })], sources)
    const { edited, answered } = telegram
    await bot.handle(message(-100, 6, "/silence HostCpuBusy 1h"))
    assert.match(telegram.sent[0]?.html ?? "", /^⛔ Chỉ admin/)
    assert.equal(bot.state().pending, 0)
    await bot.handle(message(-100, 5, "/silence EdgeErrorRate 2h"))
    const prompt = telegram.sent[1]
    assert.match(prompt?.html ?? "", /Im lặng <b>EdgeErrorRate<\/b> trong 2 giờ\?/)
    assert.deepEqual(prompt?.keyboard?.[0]?.map((button) => button.data), ["s:id1", "x:id1"])
    await bot.handle(press(-100, 6, "s:id1"))
    assert.equal(silences.length, 0, "a non-admin's press silences nothing")
    assert.equal(answered.at(-1)?.notice, "Chỉ admin mới làm được việc này")
    await bot.handle(press(-100, 5, "s:id1"))
    assert.deepEqual(silences, [{ matchers: [{ name: "alertname", value: "EdgeErrorRate", isRegex: false, isEqual: true }, { name: "stack", value: "nivo-production|nivo-staging", isRegex: true, isEqual: true }], seconds: 7200 }])
    assert.match(edited.at(-1)?.html ?? "", /Đã im lặng <b>EdgeErrorRate<\/b> đến 03:00 UTC/)
    await bot.handle(press(-100, 5, "s:id1"))
    assert.equal(silences.length, 1, "a confirmation is pressed once")
    assert.match(edited.at(-1)?.html ?? "", /hết hạn/)
    await bot.handle(message(-100, 5, "/silence all 30m"))
    await bot.handle(press(-100, 5, "x:id2"))
    assert.equal(silences.length, 1, "a cancel silences nothing")
    assert.deepEqual(silenceMatchers(scopeOf([group]), "all"), [{ name: "stack", value: "nivo-production", isRegex: true, isEqual: true }], "all is all of the app's, never the host's")
})

const payload = (alerts: Record<string, unknown>[], status = "firing"): string => JSON.stringify({ version: "4", status, groupLabels: {}, alerts })

void test("an alert is posted with its value, threshold, duration, cause and buttons; an app alert offers a silence an admin confirms", async () => {
    const { sources, silences, queries } = fakeSources((expr) => (expr.startsWith("topk(1, sum by (service) (rate(container_cpu") ? [{ labels: { service: "nivo-production_worker" }, value: 0.8 }] : []))
    const { bot, telegram } = botWith([entry()], sources)
    const host = parsePayload(payload([{ status: "firing", labels: { alertname: "HostCpuBusy", severity: "warning", instance: "node-1" }, annotations: { summary: "node-1 CPU is 93% busy", threshold: "90% for 15m" }, startsAt: "2026-11-21T00:40:00Z", endsAt: "0001-01-01T00:00:00Z" }]))
    await bot.notify(0, host)
    const posted = telegram.sent[0]
    assert.match(posted?.html ?? "", /^⚠️🔥 <b>HostCpuBusy<\/b> · node-1\nnode-1 CPU is 93% busy\n<i>ngưỡng 90% for 15m · đã 20 phút<\/i>\n🔎 Có thể do: nivo-production_worker \(80% CPU\) trong các service của nivo/)
    assert.deepEqual(posted?.keyboard?.map((row) => row.map((button) => button.data)), [["c:/cpu 1h", "c:/chart cpu 24h"]], "a host alert offers no silence")
    assert.ok(queries.some((expr) => expr.includes('stack=~"nivo-production"')), "the cause is looked for in the app's own services only")

    const app = parsePayload(payload([{ status: "firing", labels: { alertname: "PostgresDown", severity: "critical", stack: "nivo-production", service: "nivo-production_db-postgres-exporter" }, annotations: { summary: "the postgres of nivo-production does not answer" }, startsAt: "2026-11-21T00:58:00Z", endsAt: "0001-01-01T00:00:00Z" }]))
    await bot.notify(0, app)
    const appPost = telegram.sent[1]
    assert.match(appPost?.html ?? "", /^🔴🐘 <b>PostgresDown<\/b>/)
    const offer = appPost?.keyboard?.[1]?.[0]
    assert.equal(offer?.text, "🔕 Im lặng 1 giờ")
    await bot.handle(press(42, 42, offer.data))
    const confirm = telegram.sent[2]
    assert.match(confirm?.html ?? "", /Im lặng <b>PostgresDown · nivo-production<\/b> trong 1 giờ/)
    await bot.handle(press(42, 42, confirm?.keyboard?.[0]?.[0]?.data ?? ""))
    assert.deepEqual(silences[0]?.matchers, [{ name: "alertname", value: "PostgresDown", isRegex: false, isEqual: true }, { name: "stack", value: "nivo-production", isRegex: false, isEqual: true }])

    const resolved = parsePayload(payload([{ status: "resolved", labels: { alertname: "PostgresDown", stack: "nivo-production" }, annotations: {}, startsAt: "2026-11-21T00:58:00Z", endsAt: "2026-11-21T01:00:00Z" }], "resolved"))
    await bot.notify(0, resolved)
    assert.equal(telegram.sent[3]?.html, "✅ <b>Đã hết: PostgresDown</b> · nivo-production sau 2 phút")
    assert.deepEqual(telegram.sent[3].keyboard ?? [], [], "a resolved alert has no buttons")
    await assert.rejects(bot.notify(5, resolved), /slot 5 is not this bot's/)
    assert.throws(() => parsePayload('{"alerts":[]}'), /no Alertmanager webhook/)
    assert.equal(silenceable(scope, { stack: "next-production" }), false, "another app's alert is never this app's to silence")
})

void test("one notification groups its alerts and keeps every button within Telegram's 64 bytes", () => {
    const many = parsePayload(payload(Array.from({ length: 10 }, (_unused, index) => ({ status: "firing", labels: { alertname: "ServiceRestarting", stack: "nivo-production", service: `nivo-production_s${String(index)}` }, annotations: {}, startsAt: "2026-11-21T00:00:00Z", endsAt: "" }))))
    const out = alertMessage(many, scope, NOW, () => "q:abcdefgh")
    assert.match(out.html, /… và 2 cảnh báo nữa/)
    for (const row of out.keyboard) for (const button of row) assert.ok(Buffer.byteLength(button.data) <= 64)
    const payloadOf = (status: "firing" | "resolved"): WebhookPayload => ({ status, groupLabels: {}, alerts: [] })
    assert.equal(alertMessage(payloadOf("firing"), scope, NOW, () => "q:x").html, "")
})

void test("the daily report is due at 08:00 Asia/Ho_Chi_Minh and runs again the next day", async () => {
    const at = (iso: string): number => Date.parse(iso)
    assert.equal(nextDaily(at("2026-11-21T00:30:00Z"), 8, 420), at("2026-11-21T01:00:00Z"), "07:30 local: today 08:00")
    assert.equal(nextDaily(at("2026-11-21T01:00:00Z"), 8, 420), at("2026-11-22T01:00:00Z"), "08:00 sharp: tomorrow's")
    assert.equal(nextDaily(at("2026-11-21T20:00:00Z"), 8, 420), at("2026-11-22T01:00:00Z"), "03:00 local the next day")
    assert.equal(localDate(at("2026-11-21T18:00:00Z"), 420), "2026-11-22")
    let now = at("2026-11-21T00:00:00Z")
    const timers: { due: number; run: () => void }[] = []
    const ran: number[] = []
    const stop = everyDay(8, 420, (when) => { ran.push(when); return Promise.resolve() }, { now: () => now, setTimer: (ms, run) => { timers.push({ due: now + ms, run }); return { cancel: () => undefined } } }, () => undefined)
    assert.equal(timers[0]?.due, at("2026-11-21T01:00:00Z"))
    now = timers[0].due
    timers[0].run()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(ran, [at("2026-11-21T01:00:00Z")])
    assert.equal(timers[1]?.due, at("2026-11-22T01:00:00Z"), "it re-arms for the next day")
    stop()
    const { sources } = fakeSources((expr) => (expr.startsWith("avg(avg_over_time(up") ? [{ labels: {}, value: 0.9995 }] : expr.startsWith("count by (alertname)") ? [{ labels: { alertname: "HostCpuBusy" }, value: 3 }] : []))
    const report = await dailyReport(scopeOf([entry()]), "2026-11-21", sources)
    assert.match(report.html, /^🗓 <b>Báo cáo ngày 2026-11-21<\/b> · nivo/)
    assert.match(report.html, /production +99,95%/)
})

void test("bots that share a token are polled once; another project on the same token posts but answers nothing", () => {
    const warnings: string[] = []
    const tokens: Record<number, string> = { 0: "t1", 1: "t1", 2: "t2", 3: "t1" }
    const groups = groupByToken([entry(), entry({ slot: 1, env: "staging", stack: "nivo-staging" }), entry({ slot: 2, project: "next", stack: "next-production" }), entry({ slot: 3, project: "next", env: "staging", stack: "next-staging" })], (one) => tokens[one.slot] ?? "", (line) => warnings.push(line))
    assert.deepEqual(groups.map((group) => [group.token, group.poll, group.entries.map((one) => one.slot)]), [["t1", true, [0, 1]], ["t2", true, [2]], ["t1", false, [3]]])
    assert.match(warnings[0] ?? "", /next\/staging shares the bot of nivo/)
})

void test("the bot's code imports Node's built-ins and its own folder only: the container has nothing else", () => {
    const sources = readdirSync(join(here, "..", "..", "..", "..", "src", "harness", "vps", "monitor-bot")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    assert.ok(sources.includes("main.ts"))
    for (const name of sources) {
        const text = readFileSync(join(here, "..", "..", "..", "..", "src", "harness", "vps", "monitor-bot", name), "utf8")
        for (const [, from] of text.matchAll(/^import[^"]*"([^"]+)"/gm)) assert.match(from ?? "", /^(?:node:[a-z/]+|\.\/[a-z-]+\.js)$/, `${name} imports ${from ?? ""}`)
    }
})

/** A private message of a Telegram user with a username. */
const fromUser = (id: number, username: string, text: string, date = NOW / 1000): Update => ({ update_id: 3, message: { message_id: 11, date, text, chat: { id, type: "private" }, from: { id, username } } })

void test("an owner username: alerts wait until that user (any case) writes in private; the chat is learned, confirmed, persisted and the queue flushed", async () => {
    const { sources } = fakeSources()
    const telegram = fakeTelegram()
    const persisted: string[] = []
    const store = memoryStore(new Map(), (text) => persisted.push(text))
    const queue = alertQueue(2)
    const deps: BotDeps = { telegram: telegram.client, username: "nivo_monitor_bot", sources, id: () => "k", log: () => undefined, store, queue }
    const owned = [entry({ chat: null, owner: "starci183" }), entry({ slot: 1, env: "staging", stack: "nivo-staging", chat: null, owner: "starci183" })]
    const bot = createBot(owned, deps)
    const firing = (name: string): WebhookPayload => parsePayload(payload([{ status: "firing", labels: { alertname: name, stack: "nivo-production" }, annotations: { summary: name }, startsAt: "2026-11-21T00:58:00Z", endsAt: "" }]))
    for (const name of ["A1", "A2", "A3"]) await bot.notify(0, firing(name))
    assert.equal(telegram.sent.length, 0, "nobody to post to yet: accepted and queued")
    assert.equal(bot.state().queued, 2, "the queue is bounded")
    assert.deepEqual(bot.chats(), [])
    await bot.handle(fromUser(77, "mallory_x", "/start"))
    await bot.handle({ update_id: 4, message: { message_id: 12, date: NOW / 1000, text: "/start", chat: { id: -500, type: "group" }, from: { id: 78, username: "StarCi183" } } })
    assert.equal(telegram.sent.length, 0, "another user, or the owner in a group, learns nothing and gets nothing")
    await bot.handle(fromUser(42, "StarCi183", "/start", (NOW - 3_600_000) / 1000))
    assert.match(telegram.sent[0]?.html ?? "", /^✅ Đã kết nối cảnh báo cho <b>nivo production, nivo staging<\/b>/, "a backlog /start still connects")
    assert.deepEqual(telegram.sent.slice(1, 3).map((sent) => /<b>(A\d)<\/b>/.exec(sent.html)?.[1]), ["A2", "A3"], "the queued alerts follow, oldest first")
    assert.match(telegram.sent[3]?.html ?? "", /1 cảnh báo cũ hơn của nivo\/production đã bị bỏ/)
    assert.ok(telegram.sent.every((sent) => sent.chat === 42))
    assert.deepEqual(bot.chats(), [42])
    assert.deepEqual([...parseStore(persisted.at(-1) ?? "")].map(([key, found]) => [key, found.username, found.chat]), [["nivo/production", "starci183", 42], ["nivo/staging", "starci183", 42]])
    const before = telegram.sent.length
    await bot.handle(fromUser(99, "starci183", "/status"))
    assert.equal(telegram.sent.length, before, "a learned chat is pinned: another account under the same username is ignored")
    await bot.notify(1, firing("B1"))
    assert.equal(telegram.sent.at(-1)?.chat, 42, "from now on the alerts go to the learned chat")
    await bot.handle(fromUser(42, "starci183", "/help"))
    assert.match(telegram.sent.at(-1)?.html ?? "", /\/status/, "the owner chat is answered")
})

void test("the learned chats survive a restart; a changed owner drops the old chat; a legacy chat is never overridden", async () => {
    const text = storeText(new Map([["nivo/production", { username: "starci183", chat: 42, at: "2026-11-26T00:00:00.000Z" }]]))
    const restarted = memoryStore(parseStore(text), null)
    assert.equal(restarted.get("nivo/production", "starci183"), 42)
    assert.equal(restarted.get("nivo/production", "someone_else"), null, "the config names another owner now: learned again")
    assert.deepEqual([...parseStore('{"chats":{"x/y":{"username":"ok_name","chat":"7"}}}')], [], "a broken entry is dropped")
    assert.deepEqual([...parseStore("not json")], [])
    const { sources } = fakeSources()
    const telegram = fakeTelegram()
    const bot = createBot([entry({ chat: 42, owner: "starci183" })], { telegram: telegram.client, username: "nivo_monitor_bot", sources, id: () => "k", log: () => undefined, store: memoryStore(new Map(), null) })
    await bot.handle(fromUser(99, "starci183", "/start"))
    assert.equal(telegram.sent.length, 0, "a sealed chat (legacy) stays the one chat")
    assert.equal(normalizeUsername("@StarCi183"), "starci183")
    assert.equal(normalizeUsername("@ab"), null)
    const base = { server: "sv-1", telegram: "https://api.telegram.org", prometheus: "http://p:9090", loki: null, alertmanager: "http://a:9093", docker: "http://d:2375", grafana: null, renderer: false, listen: 9095, memoryAlertPercent: 90, diskAlertPercent: 85, reportHour: 8, reportOffsetMinutes: 420, state: "/home/node/owner-chats.json" }
    const one = (over: Record<string, unknown>): string => JSON.stringify({ ...base, bots: [{ slot: 0, project: "n", env: "p", stack: "n-p", tokenFile: "/t", admins: "", ...over }] })
    assert.deepEqual(parseConfig(one({ chat: null, owner: "@StarCi183" })).bots[0]?.owner, "starci183")
    assert.equal(parseConfig(one({ chat: null, owner: "starci183" })).state, "/home/node/owner-chats.json")
    assert.throws(() => parseConfig(one({ chat: null, owner: null })), /names neither a chat nor an owner/)
    assert.throws(() => parseConfig(one({ chat: null, owner: "x y" })), /owner is no Telegram username/)
})
