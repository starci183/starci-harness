/**
 * The replies of the monitor bot's read commands and of its daily report, from Prometheus, Loki, Alertmanager and the Docker API. Each
 * reply is one screen: a title, a `<pre>` table or two, and buttons for the period and the related commands. An app's reply shows its own
 * services (the scope's stacks) and the machine's summary, never another app's.
 */
import type { Alertmanager, Docker, Loki, ManagedAlert, Prometheus, Sample } from "./clients.js"
import { RANGES, helpText } from "./commands.js"
import type { ChartMetric, Command, Range } from "./commands.js"
import { alertHistory, chartQuery, edgeQueries, exploreLink, hostQueries, logsQuery, serviceQueries, stepOf, topCpu, topMemory, uptimeShare } from "./queries.js"
import type { Scope } from "./queries.js"
import { bar, clip, escapeHtml, fitMessage, formatBytes, formatDuration, formatNumber, formatPercent, sparkline, statusOf, table } from "./render.js"
import type { Keyboard } from "./telegram.js"

/** A reply: HTML and its buttons. */
export interface Reply {
    readonly html: string
    readonly keyboard?: Keyboard
}

/** What a handler reads. */
export interface Sources {
    readonly prometheus: Prometheus
    readonly loki: Loki | null
    readonly alertmanager: Alertmanager
    readonly docker: Docker
    readonly grafana: string | null
    readonly renderer: boolean
    readonly memoryAlertPercent: number
    readonly diskAlertPercent: number
    readonly server: string
    /** Epoch milliseconds. */
    readonly now: () => number
}

/** The environments of a scope, by stack (`nivo-production` is production of nivo). */
export interface ScopeEnvs extends Scope {
    readonly envs: readonly { readonly env: string; readonly stack: string }[]
}

const button = (text: string, command: string): { text: string; data: string } => ({ text, data: `c:${command}` })

const short = (scope: Scope, service: string): string => {
    const stack = scope.stacks.find((one) => service.startsWith(`${one}_`))
    return stack === undefined ? service : scope.stacks.length > 1 ? `${stack.slice(stack.lastIndexOf("-") + 1)}/${service.slice(stack.length + 1)}` : service.slice(stack.length + 1)
}

const title = (emoji: string, text: string, scope: Scope): string => `${emoji} <b>${escapeHtml(text)}</b> · ${escapeHtml(scope.project)}`

const safe = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
        return await read()
    } catch {
        return fallback
    }
}

const nowSeconds = (sources: Sources): number => Math.floor(sources.now() / 1000)

const rangeButtons = (name: string, ranges: readonly Range[], current: Range): { text: string; data: string }[] => ranges.map((range) => button(range === current ? `• ${range}` : range, `/${name} ${range}`))

const hostLines = async (sources: Sources): Promise<string[][]> => {
    const [cpu, memory, disk] = await Promise.all([safe(() => sources.prometheus.scalar(hostQueries.cpu), Number.NaN), safe(() => sources.prometheus.scalar(hostQueries.memory), Number.NaN), safe(() => sources.prometheus.scalar(hostQueries.disk), Number.NaN)])
    const memoryWarn = sources.memoryAlertPercent / 100
    const diskWarn = sources.diskAlertPercent / 100
    return [
        [statusOf(cpu, 0.75, 0.9), "CPU", bar(cpu), formatPercent(cpu)],
        [statusOf(memory, memoryWarn - 0.1, memoryWarn), "RAM", bar(memory), formatPercent(memory)],
        [statusOf(disk, diskWarn - 0.1, diskWarn), "Disk", bar(disk), formatPercent(disk)],
    ]
}

/** /status: the one-screen health of the app's environments and of the machine. */
export const statusReply = async (scope: ScopeEnvs, sources: Sources): Promise<Reply> => {
    const services = await safe(() => sources.docker.services(scope.stacks), [])
    const queries = serviceQueries(scope)
    const started = await safe(() => sources.prometheus.query(queries.started), [] as Sample[])
    const rows = await Promise.all(
        scope.envs.map(async ({ env, stack }) => {
            const own = services.filter((service) => service.stack === stack)
            const tags = own.map((service) => /:([^@:/]+)(?:@|$)/.exec(service.image)?.[1] ?? "?")
            const version = mostCommon(tags) ?? "—"
            const envScope = { project: scope.project, stacks: [stack] }
            const edge = edgeQueries(envScope, "1h")
            const [errors, p95] = await Promise.all([safe(() => sources.prometheus.scalar(edge.errorRate), Number.NaN), safe(() => sources.prometheus.scalar(edge.p95), Number.NaN)])
            const starts = started.filter((sample) => sample.labels.service?.startsWith(`${stack}_`) === true).map((sample) => sample.value)
            const uptime = starts.length === 0 ? Number.NaN : nowSeconds(sources) - Math.max(...starts)
            const healthy = own.length > 0 && own.every((service) => service.updateState === null || service.updateState === "completed")
            return [healthy ? "🟢" : own.length === 0 ? "⚪" : "⚠️", env, clip(version, 14), formatDuration(uptime), Number.isFinite(p95) ? `${formatNumber(p95 * 1000)}ms` : "—", formatPercent(errors)]
        }),
    )
    const host = await hostLines(sources)
    const html = [
        title("📊", "Trạng thái", scope),
        table(rows, { header: ["", "Env", "Phiên bản", "Uptime", "p95", "5xx"], aligns: ["left", "left", "left", "right", "right", "right"] }),
        `🖥 <b>Máy ${escapeHtml(sources.server)}</b>`,
        table(host, { aligns: ["left", "left", "left", "right"] }),
    ].join("\n")
    return { html: fitMessage(html), keyboard: [[button("CPU", "/cpu 1h"), button("RAM", "/ram 1h"), button("Disk", "/disk")], [button("Service", "/svc"), button("Cảnh báo", "/alerts"), button("Triển khai", "/deploys")]] }
}

const mostCommon = (values: readonly string[]): string | undefined => {
    const counts = new Map<string, number>()
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
}

/** /cpu [range]: the machine's CPU now, its sparkline over the range, the app's services using the most CPU. */
export const cpuReply = async (scope: Scope, range: Range, sources: Sources): Promise<Reply> => {
    const seconds = RANGES[range]
    const [now, series, top] = await Promise.all([
        safe(() => sources.prometheus.scalar(hostQueries.cpu), Number.NaN),
        safe(() => sources.prometheus.range(hostQueries.cpu, seconds, stepOf(seconds), nowSeconds(sources)), []),
        safe(() => sources.prometheus.query(topCpu(scope)), [] as Sample[]),
    ])
    const values = series[0]?.points.map(([, value]) => value) ?? []
    const peak = values.length === 0 ? Number.NaN : Math.max(...values)
    const rows = top.map((sample) => [clip(short(scope, sample.labels.service ?? "?"), 22), `${formatNumber(sample.value * 100, 0)}%`])
    const html = [
        title("🧠", "CPU", scope),
        table([[statusOf(now, 0.75, 0.9), bar(now, 12), formatPercent(now)], ["", sparkline(values), `đỉnh ${formatPercent(peak)}`]], { aligns: ["left", "left", "right"] }),
        `<i>${range} qua · ngưỡng cảnh báo 90% trong 15 phút</i>`,
        rows.length === 0 ? "<i>Chưa có số liệu CPU của service nào.</i>" : table(rows, { header: ["Service", "CPU (1 core = 100%)"], aligns: ["left", "right"] }),
    ].join("\n")
    return { html: fitMessage(html), keyboard: [rangeButtons("cpu", ["1h", "6h", "24h"], range), [button("RAM", "/ram 1h"), button("Biểu đồ", `/chart cpu ${range}`)]] }
}

/** /ram [range]: used and total, a bar, the alert threshold, the app's services using the most memory. */
export const ramReply = async (scope: Scope, range: Range, sources: Sources): Promise<Reply> => {
    const seconds = RANGES[range]
    const [used, total, series, top] = await Promise.all([
        safe(() => sources.prometheus.scalar(hostQueries.memoryUsed), Number.NaN),
        safe(() => sources.prometheus.scalar(hostQueries.memoryTotal), Number.NaN),
        safe(() => sources.prometheus.range(hostQueries.memory, seconds, stepOf(seconds), nowSeconds(sources)), []),
        safe(() => sources.prometheus.query(topMemory(scope)), [] as Sample[]),
    ])
    const fraction = used / total
    const threshold = sources.memoryAlertPercent / 100
    const values = series[0]?.points.map(([, value]) => value) ?? []
    const html = [
        title("💾", "RAM", scope),
        table([[statusOf(fraction, threshold - 0.1, threshold), bar(fraction, 12), formatPercent(fraction)], ["", sparkline(values), `${formatBytes(used)} / ${formatBytes(total)}`]], { aligns: ["left", "left", "right"] }),
        `<i>${range} qua · ngưỡng cảnh báo ${String(sources.memoryAlertPercent)}% trong 10 phút</i>`,
        top.length === 0 ? "<i>Chưa có số liệu RAM của service nào.</i>" : table(top.map((sample) => [clip(short(scope, sample.labels.service ?? "?"), 22), formatBytes(sample.value)]), { header: ["Service", "RAM"], aligns: ["left", "right"] }),
    ].join("\n")
    return { html: fitMessage(html), keyboard: [rangeButtons("ram", ["1h", "6h", "24h"], range), [button("CPU", "/cpu 1h"), button("Biểu đồ", `/chart ram ${range}`)]] }
}

/** The days until a file system is full at its 7-day pace, or null when it does not grow. */
export const daysToFull = (availNow: number, avail7dAgo: number): number | null => {
    const perDay = (avail7dAgo - availNow) / 7
    if (!Number.isFinite(perDay) || perDay <= 0) return null
    return availNow / perDay
}

/** /disk: each file system, its use, its 7-day growth and when it is full at that pace. */
export const diskReply = async (scope: Scope, sources: Sources): Promise<Reply> => {
    const [size, avail, ago] = await Promise.all([
        safe(() => sources.prometheus.query(hostQueries.diskSize), [] as Sample[]),
        safe(() => sources.prometheus.query(hostQueries.diskAvail), [] as Sample[]),
        safe(() => sources.prometheus.query(hostQueries.diskAvail7dAgo), [] as Sample[]),
    ])
    const key = (sample: Sample): string => `${sample.labels.instance ?? ""}|${sample.labels.mountpoint ?? ""}`
    const threshold = sources.diskAlertPercent / 100
    const seen = new Set<string>()
    const rows = size
        .filter((sample) => {
            const id = key(sample)
            if (seen.has(id) || sample.value <= 0) return false
            seen.add(id)
            return true
        })
        .map((sample) => {
            const free = avail.find((other) => key(other) === key(sample))?.value ?? Number.NaN
            const before = ago.find((other) => key(other) === key(sample))?.value ?? Number.NaN
            const fraction = 1 - free / sample.value
            const days = daysToFull(free, before)
            const mount = (sample.labels.mountpoint ?? "?").replace(/^\/rootfs(?=\/|$)/, "") || "/"
            return [statusOf(fraction, threshold - 0.1, threshold), clip(mount, 14), bar(fraction, 8), formatPercent(fraction), formatBytes(sample.value), Number.isFinite(before) ? formatBytes(before - free) : "—", days === null ? "—" : `${formatNumber(days, days < 10 ? 1 : 0)} ngày`]
        })
    const html = [
        title("🗄", "Disk", scope),
        rows.length === 0 ? "<i>Chưa có số liệu disk.</i>" : table(rows, { header: ["", "Mount", "", "Dùng", "Tổng", "+7 ngày", "Đầy sau"], aligns: ["left", "left", "left", "right", "right", "right", "right"] }),
        `<i>ngưỡng cảnh báo ${String(sources.diskAlertPercent)}% · ước tính theo tốc độ 7 ngày qua</i>`,
    ].join("\n")
    return { html: fitMessage(html), keyboard: [[button("Biểu đồ 7 ngày", "/chart disk 7d"), button("Trạng thái", "/status")]] }
}

/** /svc: each service of the app with its replicas (running of wanted), uptime, restarts over 24h and database connections. */
export const svcReply = async (scope: Scope, sources: Sources): Promise<Reply> => {
    const services = await safe(() => sources.docker.services(scope.stacks), [])
    const tasks = await safe(() => sources.docker.tasks(services.map((service) => service.name)), [])
    const queries = serviceQueries(scope)
    const [started, restarts, connections] = await Promise.all([safe(() => sources.prometheus.query(queries.started), [] as Sample[]), safe(() => sources.prometheus.query(queries.restarts), [] as Sample[]), safe(() => sources.prometheus.query(queries.dbConnections), [] as Sample[])])
    const valueOf = (samples: readonly Sample[], name: string): number => samples.find((sample) => sample.labels.service === name)?.value ?? Number.NaN
    const rows = [...services]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((service) => {
            const running = tasks.filter((task) => task.serviceId === service.id && task.state === "running").length
            const wanted = service.replicas
            const ok = wanted === null ? running > 0 : running >= wanted
            const restarted = valueOf(restarts, service.name)
            const db = valueOf(connections, service.name)
            const start = valueOf(started, service.name)
            return [ok ? (Number.isFinite(restarted) && restarted > 3 ? "⚠️" : "🟢") : "🔴", clip(short(scope, service.name), 18), `${String(running)}/${wanted === null ? "g" : String(wanted)}`, formatDuration(nowSeconds(sources) - start), Number.isFinite(restarted) ? formatNumber(restarted) : "—", Number.isFinite(db) ? formatNumber(db) : ""]
        })
    const html = [
        title("🧩", "Service", scope),
        rows.length === 0 ? "<i>Không thấy service nào của app trên máy này.</i>" : table(rows, { header: ["", "Service", "Rep", "Uptime", "Restart 24h", "DB"], aligns: ["left", "left", "right", "right", "right", "right"] }),
    ].join("\n")
    return { html: fitMessage(html), keyboard: [[button("Triển khai", "/deploys"), button("Cảnh báo", "/alerts")]] }
}

/** The lines /logs shows at most. */
export const LOG_LINES = 15

/** /logs <svc> [range]: the newest errors and warnings of one service of the app, and the Grafana link of the same query. */
export const logsReply = async (scope: Scope, service: string, range: Range, sources: Sources): Promise<Reply> => {
    const expr = logsQuery(scope, service)
    const link = exploreLink(sources.grafana, expr, RANGES[range])
    const head = title("📜", `Logs ${service}`, scope)
    if (sources.loki === null) return { html: `${head}\n<i>Loki không chạy trên máy này.</i>` }
    const loki = sources.loki
    const lines = await safe(() => loki.lines(expr, RANGES[range], LOG_LINES, sources.now()), null)
    const body =
        lines === null
            ? "<i>Không đọc được Loki.</i>"
            : lines.length === 0
              ? `<i>Không có lỗi hay cảnh báo nào trong ${range} qua.</i>`
              : `<pre>${escapeHtml(lines.map((line) => `${new Date(Number(line.ns / 1_000_000n)).toISOString().slice(11, 19)} ${clip(line.line.replaceAll(/\s+/g, " "), 160)}`).join("\n"))}</pre>`
    const html = [head, body, link === null ? "" : `<a href="${escapeHtml(link)}">Mở trong Grafana</a>`].filter((part) => part !== "").join("\n")
    return { html: fitMessage(html), keyboard: [rangeButtons(`logs ${service}`, ["15m", "1h", "6h"], range).filter((item) => Buffer.byteLength(item.data) <= 64)] }
}

/** Whether an alert belongs to the scope: its stack is one of the scope's, or it has no stack (a host alert every app receives). */
export const inScope = (scope: Scope, labels: Readonly<Record<string, string>>): boolean => {
    const stack = labels.stack ?? ""
    return stack === "" || scope.stacks.includes(stack)
}

const alertRow = (alert: ManagedAlert, now: number): string[] => [alert.labels.severity === "critical" ? "🔴" : "⚠️", clip(alert.labels.alertname ?? "?", 24), clip(alert.labels.service ?? alert.labels.instance ?? "", 16), formatDuration(now - Date.parse(alert.startsAt) / 1000)]

/** /alerts: the open alerts of the app (and the host), the silenced ones, and how often each fired over 24h. */
export const alertsReply = async (scope: Scope, sources: Sources): Promise<Reply> => {
    const alerts = (await safe(() => sources.alertmanager.alerts(), [] as ManagedAlert[])).filter((alert) => inScope(scope, alert.labels))
    const history = await safe(() => sources.prometheus.query(alertHistory(scope, "24h")), [] as Sample[])
    const now = nowSeconds(sources)
    const open = alerts.filter((alert) => alert.silencedBy.length === 0)
    const silenced = alerts.filter((alert) => alert.silencedBy.length > 0)
    const html = [
        title(open.length === 0 ? "✅" : "🚨", "Cảnh báo", scope),
        open.length === 0 ? "Không có cảnh báo nào đang mở." : table(open.map((alert) => alertRow(alert, now)), { header: ["", "Cảnh báo", "Ở đâu", "Đã"], aligns: ["left", "left", "left", "right"] }),
        silenced.length === 0 ? "" : `🔕 <b>Đang im lặng</b>\n${table(silenced.map((alert) => alertRow(alert, now)))}`,
        history.length === 0 ? "<i>24 giờ qua: không cảnh báo nào của app.</i>" : `🕘 <b>24 giờ qua</b>\n${table(history.map((sample) => [clip(sample.labels.alertname ?? "?", 28), `×${formatNumber(sample.value)}`]), { aligns: ["left", "right"] })}`,
    ]
        .filter((part) => part !== "")
        .join("\n")
    return { html: fitMessage(html), keyboard: [[button("Trạng thái", "/status"), button("Service", "/svc")]] }
}

/** /deploys: the latest update of each service of every environment of the app, newest first. */
export const deploysReply = async (scope: ScopeEnvs, sources: Sources): Promise<Reply> => {
    const services = await safe(() => sources.docker.services(scope.stacks), [])
    const envOf = (stack: string): string => scope.envs.find((one) => one.stack === stack)?.env ?? stack
    const rows = [...services]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12)
        .map((service) => {
            const tag = /:([^@:/]+)(?:@|$)/.exec(service.image)?.[1] ?? "?"
            const state = service.updateState === null || service.updateState === "completed" ? "✅" : service.updateState.startsWith("rollback") ? "↩️" : service.updateState === "paused" ? "⏸" : "🔄"
            return [state, envOf(service.stack), clip(short(scope, service.name), 16), clip(tag, 14), service.updatedAt.slice(0, 16).replace("T", " ")]
        })
    const html = [title("🚀", "Triển khai", scope), rows.length === 0 ? "<i>Không thấy service nào của app trên máy này.</i>" : table(rows, { header: ["", "Env", "Service", "Phiên bản", "Lúc (UTC)"] })].join("\n")
    return { html: fitMessage(html), keyboard: [[button("Service", "/svc"), button("Trạng thái", "/status")]] }
}

/** /chart <metric> [range]: Grafana's renderer is not in the stack, so the chart is a text sparkline with its low, high and last values. */
export const chartReply = async (scope: Scope, metric: ChartMetric, range: Range, sources: Sources): Promise<Reply> => {
    const seconds = RANGES[range]
    const series = await safe(() => sources.prometheus.range(chartQuery(metric, scope), seconds, stepOf(seconds), nowSeconds(sources)), [])
    const values = (series[0]?.points ?? []).map(([, value]) => value).filter((value) => Number.isFinite(value))
    const label = { cpu: "CPU", ram: "RAM", disk: "Disk", "5xx": "5xx" }[metric]
    const html = [
        title("📈", `${label} · ${range}`, scope),
        values.length === 0 ? "<i>Chưa có số liệu.</i>" : table([[sparkline(values, 32)], [`thấp ${formatPercent(Math.min(...values))} · cao ${formatPercent(Math.max(...values))} · hiện ${formatPercent(values.at(-1) ?? Number.NaN)}`]]),
        sources.renderer ? "" : "<i>Biểu đồ dạng chữ: Grafana image renderer không chạy trong stack giám sát.</i>",
    ]
        .filter((part) => part !== "")
        .join("\n")
    return { html: fitMessage(html), keyboard: [(["1h", "6h", "24h", "7d"] as const).map((one) => button(one === range ? `• ${one}` : one, `/chart ${metric} ${one}`))] }
}

/** The reply of a read command; a write command is the caller's (it needs an admin and a confirmation). */
export const readReply = async (command: Exclude<Command, { name: "silence" }>, scope: ScopeEnvs, sources: Sources): Promise<Reply> => {
    switch (command.name) {
        case "status":
            return statusReply(scope, sources)
        case "cpu":
            return cpuReply(scope, command.range, sources)
        case "ram":
            return ramReply(scope, command.range, sources)
        case "disk":
            return diskReply(scope, sources)
        case "svc":
            return svcReply(scope, sources)
        case "logs":
            return logsReply(scope, command.service, command.range, sources)
        case "alerts":
            return alertsReply(scope, sources)
        case "deploys":
            return deploysReply(scope, sources)
        case "chart":
            return chartReply(scope, command.metric, command.range, sources)
        case "help":
            return { html: helpText(), keyboard: [[button("Trạng thái", "/status"), button("Cảnh báo", "/alerts")]] }
    }
}

/** The daily report of one app: per environment its uptime, 5xx and p95 over 24h, its alerts, and the machine's disk growth. */
export const dailyReport = async (scope: ScopeEnvs, day: string, sources: Sources): Promise<Reply> => {
    const rows = await Promise.all(
        scope.envs.map(async ({ env, stack }) => {
            const envScope = { project: scope.project, stacks: [stack] }
            const edge = edgeQueries(envScope, "24h")
            const [up, errors, p95, requests, fired] = await Promise.all([
                safe(() => sources.prometheus.scalar(uptimeShare(envScope, "24h")), Number.NaN),
                safe(() => sources.prometheus.scalar(edge.errorRate), Number.NaN),
                safe(() => sources.prometheus.scalar(edge.p95), Number.NaN),
                safe(() => sources.prometheus.scalar(edge.requests), Number.NaN),
                safe(() => sources.prometheus.query(alertHistory(envScope, "24h")), [] as Sample[]),
            ])
            return [statusOf(1 - up, 0.001, 0.01), env, Number.isFinite(up) ? `${formatNumber(up * 100, 2)}%` : "—", Number.isFinite(requests) ? formatNumber(requests) : "—", formatPercent(errors), Number.isFinite(p95) ? `${formatNumber(p95 * 1000)}ms` : "—", formatNumber(fired.length)]
        }),
    )
    const [diskNow, diskBefore] = await Promise.all([safe(() => sources.prometheus.scalar(hostQueries.diskAvailRoot), Number.NaN), safe(() => sources.prometheus.scalar(hostQueries.diskAvail1dAgo), Number.NaN)])
    const host = await hostLines(sources)
    const html = [
        `🗓 <b>Báo cáo ngày ${escapeHtml(day)}</b> · ${escapeHtml(scope.project)}`,
        table(rows, { header: ["", "Env", "Uptime", "Request", "5xx", "p95", "Cảnh báo"], aligns: ["left", "left", "right", "right", "right", "right", "right"] }),
        `🖥 <b>Máy ${escapeHtml(sources.server)}</b> · disk ${Number.isFinite(diskBefore - diskNow) ? `+${formatBytes(diskBefore - diskNow)}` : "—"} trong 24 giờ`,
        table(host, { aligns: ["left", "left", "left", "right"] }),
    ].join("\n")
    return { html: fitMessage(html), keyboard: [[button("Trạng thái", "/status"), button("Cảnh báo", "/alerts"), button("Disk", "/disk")]] }
}
