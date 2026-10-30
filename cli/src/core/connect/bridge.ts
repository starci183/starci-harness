import { bridgeCycle, releaseBridge, runBridge, takeBridge } from "../../harness/telegram-bridge.js"
import { bridgeLiveness, channelCounts, connectedChannel, loadTelegram, readChannel, telegramBot, tokenSource, withChannelStore } from "../../harness/telegram.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"

/** What `connect telegram bridge` does: run the bridge, or report its liveness. */
export const BRIDGE_MODES = ["run", "status"] as const

/**
 * `starci connect telegram bridge <run|status>`: the owner's Telegram channel as a host service (ops/host.yaml
 * `telegram-bridge`). `run` holds the host's one bridge seat and loops: send every notice due (the kinds ops/telegram.yaml
 * `notices` lists, once each, within its budget), then long-poll the bot and answer the owner's chat: a question answered (a
 * reply, a button, `/answer <ticket> <text>`), `/status`, `/tickets`, or any other message recorded as an owner request
 * (`/ask <project> <text>`), as `supervisor ask` does, which wakes that project's Supervisor. A message of any other chat is
 * ignored and logged by its chat id. `--once` runs one cycle without waiting. `status` reads the seat's beat.
 */
export const telegramBridge = async (context: VerbContext, mode: string | undefined, once: boolean): Promise<VerbResult<unknown>> => {
    const action = BRIDGE_MODES.find((known) => known === mode)
    if (action === undefined) throw new Refusal("CLI_USAGE", `connect telegram bridge takes ${BRIDGE_MODES.join(" or ")}, not ${String(mode)}`, EXIT_USAGE)
    const config = loadTelegram()
    if (action === "status") {
        const { channel, counts } = withChannelStore((db) => ({ channel: readChannel(db), counts: channelCounts(db) }))
        const liveness = bridgeLiveness(channel, config)
        const data = { liveness, pid: channel.bridgePid, beat: channel.bridgeBeat, configured: tokenSource(config) !== null, chat: channel.chatId !== null, ...counts }
        return { data, message: `telegram bridge: ${liveness}${channel.bridgeBeat === null ? "" : ` (pid ${String(channel.bridgePid ?? "-")}, beat ${channel.bridgeBeat})`}` }
    }
    if (callerRole() === "debug") throw new Refusal("ROLE_REFUSED", "connect telegram bridge run is the owner's host service; Debug reads its status")
    const bot = telegramBot(config)
    connectedChannel()
    if (!takeBridge(config.staleSeconds)) return { data: { ran: false, reason: "another bridge holds the seat" }, message: "telegram bridge: another bridge is alive on this host; nothing to do" }
    if (once) {
        const cycle = await bridgeCycle(bot, context.cwd, 0).finally(releaseBridge)
        const lines = [...cycle.sweep.sent.map((key) => `sent ${key}`), ...cycle.sweep.failed.map((key) => `send failed ${key}`), ...cycle.handled.map((done) => `update ${String(done.update)}: ${done.outcome}`)]
        return { data: { ran: true, ...cycle }, message: ["telegram bridge: one cycle", ...lines].join("\n") }
    }
    context.progress(`telegram bridge: running (pid ${String(process.pid)})`)
    await runBridge(bot, context.cwd, context.progress).finally(releaseBridge)
    return { data: { ran: true }, message: "telegram bridge: stopped" }
}
