/**
 * The entry of the monitor-bot container (`node /app/main.js`, ops/vps/monitor/components.yaml `monitor-bot`): reads its config and each
 * app bot's token file, long-polls every distinct bot, serves Alertmanager's webhooks on the stack's internal network (`/alert/<slot>`) and
 * `/healthz`, and posts the daily report. One process serves every app bot of the server. Nothing here is imported by the CLI; the CLI
 * ships this folder's compiled files as swarm configs.
 */
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { pathToFileURL } from "node:url"
import { parsePayload } from "./alerting.js"
import { createBot } from "./bot.js"
import type { MonitorBot } from "./bot.js"
import { alertmanager, docker, loki, prometheus } from "./clients.js"
import type { Fetch } from "./clients.js"
import { parseConfig } from "./config.js"
import type { BotConfig, BotEntry } from "./config.js"
import type { Sources } from "./handlers.js"
import { everyDay, localDate } from "./schedule.js"
import { TelegramError, telegram } from "./telegram.js"

const log = (line: string): void => {
    process.stderr.write(`${new Date().toISOString()} ${line}\n`)
}

/**
 * The entries grouped into bots: one per token and project. The first project of a token polls it; another project sharing the same token
 * posts its alerts but polls nothing (two pollers of one token conflict, and one chat must never see two apps), which is logged.
 */
export const groupByToken = (entries: readonly BotEntry[], tokenOf: (entry: BotEntry) => string, warn: (line: string) => void): { readonly token: string; readonly poll: boolean; readonly entries: BotEntry[] }[] => {
    const groups: { token: string; project: string; poll: boolean; entries: BotEntry[] }[] = []
    for (const entry of entries) {
        const token = tokenOf(entry)
        const same = groups.find((group) => group.token === token && group.project === entry.project)
        if (same !== undefined) {
            same.entries.push(entry)
            continue
        }
        const poller = groups.find((group) => group.token === token && group.poll)
        if (poller !== undefined) warn(`${entry.project}/${entry.env} shares the bot of ${poller.project}: it posts its alerts but answers no command (one bot per app)`)
        groups.push({ token, project: entry.project, poll: poller === undefined, entries: [entry] })
    }
    return groups.map(({ token, poll, entries: members }) => ({ token, poll, entries: members }))
}

const readBody = async (request: IncomingMessage, limit: number): Promise<string> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
        const buffer = chunk as Buffer
        size += buffer.length
        if (size > limit) throw new Error("the body passes its limit")
        chunks.push(buffer)
    }
    return Buffer.concat(chunks).toString("utf8")
}

const poll = async (bot: MonitorBot, client: ReturnType<typeof telegram>, name: string, stopped: () => boolean): Promise<void> => {
    let offset = 0
    let backoff = 1000
    while (!stopped()) {
        try {
            const updates = await client.updates(offset, 50)
            backoff = 1000
            for (const update of updates) {
                offset = Math.max(offset, update.update_id + 1)
                await bot.handle(update)
            }
        } catch (error: unknown) {
            const conflict = error instanceof TelegramError && error.code === 409
            log(`${name}: ${conflict ? "another poller holds this bot (409); waiting" : error instanceof Error ? error.message : String(error)}`)
            await new Promise((resolve) => setTimeout(resolve, conflict ? 30_000 : backoff))
            backoff = Math.min(backoff * 2, 60_000)
        }
    }
}

/** Starts the service from the config file. */
export const start = async (config: BotConfig, fetcher: Fetch): Promise<() => void> => {
    const sources: Sources = {
        prometheus: prometheus(config.prometheus, fetcher),
        loki: config.loki === null ? null : loki(config.loki, fetcher),
        alertmanager: alertmanager(config.alertmanager, fetcher),
        docker: docker(config.docker, fetcher),
        grafana: config.grafana,
        renderer: config.renderer,
        memoryAlertPercent: config.memoryAlertPercent,
        diskAlertPercent: config.diskAlertPercent,
        server: config.server,
        now: () => Date.now(),
    }
    const tokens = new Map(config.bots.map((entry) => [entry.slot, readFileSync(entry.tokenFile, "utf8").trim()]))
    const groups = groupByToken(config.bots, (entry) => tokens.get(entry.slot) ?? "", log)
    const bySlot = new Map<number, MonitorBot>()
    let stopped = false
    const bots: MonitorBot[] = []
    for (const group of groups) {
        const client = telegram(config.telegram, group.token, fetcher)
        const username = !group.poll ? null : await client.username().catch((error: unknown) => {
            log(`${group.entries.map((entry) => `${entry.project}/${entry.env}`).join(", ")}: getMe failed: ${error instanceof Error ? error.message : String(error)}`)
            return null
        })
        const bot = createBot(group.entries, { telegram: client, username: username ?? "", sources, id: () => randomBytes(6).toString("base64url"), log })
        bots.push(bot)
        for (const entry of group.entries) bySlot.set(entry.slot, bot)
        const name = group.entries.map((entry) => `${entry.project}/${entry.env}`).join(", ")
        if (group.poll && username !== null) void poll(bot, client, name, () => stopped)
    }
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
        const done = (status: number, text: string): void => {
            response.writeHead(status, { "content-type": "text/plain" }).end(text)
        }
        if (request.method === "GET" && request.url === "/healthz") {
            done(200, "ok")
            return
        }
        const match = /^\/alert\/(\d{1,2})$/.exec(request.url ?? "")
        const bot = match === null ? undefined : bySlot.get(Number(match[1]))
        if (request.method !== "POST" || match === null || bot === undefined) {
            done(404, "no such receiver")
            return
        }
        readBody(request, 1_048_576)
            .then(async (text) => {
                await bot.notify(Number(match[1]), parsePayload(text))
                done(200, "posted")
            })
            .catch((error: unknown) => {
                log(`alert slot ${match[1] ?? "?"}: ${error instanceof Error ? error.message : String(error)}`)
                done(500, "not posted")
            })
    })
    server.listen(config.listen, "0.0.0.0")
    const stopReport = everyDay(
        config.reportHour,
        config.reportOffsetMinutes,
        async (atMs) => {
            for (const bot of bots) await bot.report(localDate(atMs, config.reportOffsetMinutes)).catch((error: unknown) => {
                log(`daily report: ${error instanceof Error ? error.message : String(error)}`)
            })
        },
        {
            now: () => Date.now(),
            setTimer: (ms, run) => {
                const timer = setTimeout(run, ms)
                return { cancel: () => { clearTimeout(timer) } }
            },
        },
        (error) => { log(`daily report: ${error instanceof Error ? error.message : String(error)}`) },
    )
    log(`monitor-bot serves ${String(config.bots.length)} app bot(s) on ${String(groups.length)} token(s); webhooks on :${String(config.listen)}`)
    return () => {
        stopped = true
        stopReport()
        server.close()
    }
}

/** True when this file is the process's entry (the container), never when the specs import it. */
const isEntry = (): boolean => process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntry()) {
    const file = process.env.MONITOR_BOT_CONFIG ?? "/app/config.json"
    const stop = await start(parseConfig(readFileSync(file, "utf8")), fetch)
    for (const signal of ["SIGTERM", "SIGINT"] as const)
        process.on(signal, () => {
            stop()
            process.exit(0)
        })
}
