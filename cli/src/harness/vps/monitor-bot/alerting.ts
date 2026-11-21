/**
 * Alertmanager's notifications as the monitor bot posts them (PROJECT-MONITORING-6). Alertmanager keeps the routing of PROJECT-MONITORING-5
 * (an app's alerts to its environment's receiver, a host alert to one receiver of every app once) and the grouping (one notification per
 * group, repeated at most every repeat_interval); with the bot on, each receiver is a webhook to the bot's slot instead of a telegram_config,
 * so the bot posts the group with its buttons: the related command, the chart, and for an app alert a silence of 1 hour, confirmed by an
 * admin. A resolved alert follows with how long it lasted.
 */
import { escapeHtml, fitMessage, formatDuration } from "./render.js"
import { asArray, asLabels, asString, at } from "./json.js"
import type { Scope } from "./queries.js"
import type { Keyboard } from "./telegram.js"

/** One alert of Alertmanager's webhook payload (version 4). */
export interface WebhookAlert {
    readonly status: "firing" | "resolved"
    readonly labels: Readonly<Record<string, string>>
    readonly annotations: Readonly<Record<string, string>>
    readonly startsAt: string
    readonly endsAt: string
    readonly fingerprint?: string
}

/** Alertmanager's webhook payload, the fields the bot reads. */
export interface WebhookPayload {
    readonly status: "firing" | "resolved"
    readonly alerts: readonly WebhookAlert[]
    readonly groupLabels: Readonly<Record<string, string>>
}

/** Reads a webhook body; a body that is not Alertmanager's shape is refused. */
export const parsePayload = (text: string): WebhookPayload => {
    const raw: unknown = JSON.parse(text)
    if (at(raw, "version") !== "4" || !Array.isArray(at(raw, "alerts"))) throw new Error("the body is no Alertmanager webhook (version 4)")
    return {
        status: at(raw, "status") === "resolved" ? "resolved" : "firing",
        groupLabels: asLabels(at(raw, "groupLabels")),
        alerts: asArray(at(raw, "alerts")).map((alert): WebhookAlert => {
            const fingerprint = at(alert, "fingerprint")
            return {
                status: at(alert, "status") === "resolved" ? "resolved" : "firing",
                labels: asLabels(at(alert, "labels")),
                annotations: asLabels(at(alert, "annotations")),
                startsAt: asString(at(alert, "startsAt")),
                endsAt: asString(at(alert, "endsAt")),
                ...(typeof fingerprint === "string" ? { fingerprint } : {}),
            }
        }),
    }
}

/** What an alert name is about: its emoji, the command that shows it, and the chart that draws it. */
export const alertTopic = (name: string): { readonly emoji: string; readonly command: string; readonly chart: string | null } => {
    if (/Cpu/i.test(name)) return { emoji: "🔥", command: "/cpu 1h", chart: "/chart cpu 24h" }
    if (/Memory/i.test(name) && name.startsWith("Host")) return { emoji: "💾", command: "/ram 1h", chart: "/chart ram 24h" }
    if (/Disk/i.test(name)) return { emoji: "🗄", command: "/disk", chart: "/chart disk 7d" }
    if (/Edge|5xx|ErrorRate/i.test(name)) return { emoji: "🌐", command: "/status", chart: "/chart 5xx 24h" }
    if (/Postgres/i.test(name)) return { emoji: "🐘", command: "/svc", chart: null }
    if (/Redis/i.test(name)) return { emoji: "🧱", command: "/svc", chart: null }
    if (/Probe|Certificate/i.test(name)) return { emoji: "📡", command: "/status", chart: null }
    if (/Service|Replica|Restart|Target/i.test(name)) return { emoji: "🧩", command: "/svc", chart: name.includes("Memory") ? "/chart ram 24h" : null }
    return { emoji: "🚨", command: "/alerts", chart: null }
}

/** Whether an app bot may silence an alert: only its own (a stack of its scope); a host alert reaches every app, so no app silences it. */
export const silenceable = (scope: Scope, labels: Readonly<Record<string, string>>): boolean => {
    const stack = labels.stack ?? ""
    return stack !== "" && scope.stacks.includes(stack)
}

const secondsBetween = (from: string, to: number): number => (to - Date.parse(from)) / 1000

/**
 * The message of one notification: each firing alert with its severity, emoji, summary (its value), threshold and how long it fires, the
 * likely cause when one is given (`cause`, the app's top mover); each resolved one with how long it lasted. `offer` registers a silence
 * offer and returns its button data (the caller keeps the offer); buttons go under the first firing alert's topic.
 */
export const alertMessage = (payload: WebhookPayload, scope: Scope, nowMs: number, offer: (alert: WebhookAlert) => string, cause?: string): { readonly html: string; readonly keyboard: Keyboard } => {
    const firing = payload.alerts.filter((alert) => alert.status === "firing")
    const resolved = payload.alerts.filter((alert) => alert.status === "resolved")
    const lines: string[] = []
    for (const alert of firing.slice(0, 8)) {
        const name = alert.labels.alertname ?? "Alert"
        const topic = alertTopic(name)
        const severity = alert.labels.severity === "critical" ? "🔴" : "⚠️"
        const where = alert.labels.service ?? alert.labels.instance ?? alert.labels.stack ?? ""
        lines.push(`${severity}${topic.emoji} <b>${escapeHtml(name)}</b>${where === "" ? "" : ` · ${escapeHtml(where)}`}`)
        if (alert.annotations.summary !== undefined) lines.push(escapeHtml(alert.annotations.summary))
        const facts = [alert.annotations.threshold === undefined ? "" : `ngưỡng ${escapeHtml(alert.annotations.threshold)}`, `đã ${formatDuration(secondsBetween(alert.startsAt, nowMs))}`].filter((part) => part !== "")
        lines.push(`<i>${facts.join(" · ")}</i>`)
    }
    if (firing.length > 8) lines.push(`<i>… và ${String(firing.length - 8)} cảnh báo nữa (/alerts)</i>`)
    if (cause !== undefined && firing.length > 0) lines.push(`🔎 Có thể do: ${escapeHtml(cause)}`)
    for (const alert of resolved.slice(0, 8)) {
        const name = alert.labels.alertname ?? "Alert"
        const where = alert.labels.service ?? alert.labels.instance ?? alert.labels.stack ?? ""
        const ended = Date.parse(alert.endsAt)
        lines.push(`✅ <b>Đã hết: ${escapeHtml(name)}</b>${where === "" ? "" : ` · ${escapeHtml(where)}`} sau ${formatDuration(((Number.isFinite(ended) ? ended : nowMs) - Date.parse(alert.startsAt)) / 1000)}`)
    }
    if (resolved.length > 8) lines.push(`<i>… và ${String(resolved.length - 8)} cảnh báo đã hết nữa</i>`)
    const first = firing[0]
    const keyboard: { text: string; data: string }[][] = []
    if (first !== undefined) {
        const topic = alertTopic(first.labels.alertname ?? "")
        const row = [{ text: "Xem chi tiết", data: `c:${topic.command}` }, ...(topic.chart === null ? [] : [{ text: "Biểu đồ", data: `c:${topic.chart}` }])]
        keyboard.push(row)
        const own = firing.find((alert) => silenceable(scope, alert.labels))
        if (own !== undefined) keyboard.push([{ text: "🔕 Im lặng 1 giờ", data: offer(own) }])
    }
    return { html: fitMessage(lines.join("\n")), keyboard }
}

/** The query of the likely cause of a host alert, within the app's own services (never another app's): CPU or memory top mover. */
export const causeKind = (payload: WebhookPayload): "cpu" | "memory" | null => {
    const names = payload.alerts.filter((alert) => alert.status === "firing").map((alert) => alert.labels.alertname ?? "")
    if (names.some((name) => /Cpu/i.test(name))) return "cpu"
    if (names.some((name) => /Memory/i.test(name))) return "memory"
    return null
}
