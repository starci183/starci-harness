import { bridgeCycle, releaseBridge, runBridge, takeBridge } from "../../harness/telegram-bridge.js"
import { bridgeLiveness, channelCounts, connectedChannel, loadTelegram, readChannel, telegramBot, tokenPresent, withChannelStore } from "../../harness/telegram.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

const ACTIONS = ["run", "status"] as const

/**
 * `starci supervisor telegram-bridge <run|status>`: the owner's Telegram channel as a host service (ops/host.yaml
 * `telegram-bridge`). `run` holds the host's one bridge seat and loops: send every notice due (an `owner` escalation,
 * an owner request taken up, a workflow that ended; once each, within ops/telegram.yaml's budget), then long-poll the bot and
 * record each message of the owner's chat that answers a notice (a reply to it, `/answer <decision-id> <text>`) or asks
 * (`/ask <project> <text>`) as an owner request, as `supervisor ask` does, which wakes that project's Supervisor. A message of any
 * other chat is ignored and logged by its chat id. `--once` runs one cycle without waiting. `status` reads the seat's beat.
 */
export const supervisorTelegramBridgeVerb = defineVerb({
    path: ["supervisor", "telegram-bridge"],
    summary: "run the owner's Telegram bridge (notices out, owner replies in as owner requests that wake the Supervisor) or report its liveness",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor", "debug"],
    schema: "starci/telegram-bridge@1",
    flags: {
        action: { kind: "string", required: true, positional: true, summary: "run or status" },
        once: { kind: "boolean", summary: "run: one cycle that does not wait for a message, then exit" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        const action = ACTIONS.find((known) => known === flags.action)
        if (action === undefined) throw new Refusal("CLI_USAGE", `supervisor telegram-bridge takes ${ACTIONS.join(", ")}, not ${flags.action}`, EXIT_USAGE)
        const config = loadTelegram()
        if (action === "status") {
            const { channel, counts } = withChannelStore((db) => ({ channel: readChannel(db), counts: channelCounts(db) }))
            const liveness = bridgeLiveness(channel, config)
            const data = { liveness, pid: channel.bridgePid, beat: channel.bridgeBeat, configured: tokenPresent(config), chat: channel.chatId !== null, ...counts }
            return { data, message: `telegram bridge: ${liveness}${channel.bridgeBeat === null ? "" : ` (pid ${String(channel.bridgePid ?? "-")}, beat ${channel.bridgeBeat})`}` }
        }
        if (callerRole() === "debug") throw new Refusal("ROLE_REFUSED", "supervisor telegram-bridge run is the owner's host service; Debug reads its status")
        const bot = telegramBot(config)
        connectedChannel()
        if (!takeBridge(config.staleSeconds)) return { data: { ran: false, reason: "another bridge holds the seat" }, message: "telegram bridge: another bridge is alive on this host; nothing to do" }
        if (flags.once) {
            const cycle = await bridgeCycle(bot, context.cwd, 0).finally(releaseBridge)
            const lines = [...cycle.sweep.sent.map((key) => `sent ${key}`), ...cycle.sweep.failed.map((key) => `send failed ${key}`), ...cycle.handled.map((done) => `update ${String(done.update)}: ${done.outcome}`)]
            return { data: { ran: true, ...cycle }, message: ["telegram bridge: one cycle", ...lines].join("\n") }
        }
        context.progress(`telegram bridge: running (pid ${String(process.pid)})`)
        await runBridge(bot, context.cwd, context.progress).finally(releaseBridge)
        return { data: { ran: true }, message: "telegram bridge: stopped" }
    },
})
