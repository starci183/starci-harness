import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadStallRules } from "../../harness/stall.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { runAttached } from "../../shared/exec.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"
import type { SupervisorTick } from "./driver.js"

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const DIST = fileURLToPath(new URL("../..", import.meta.url))

/** The build of the CLI this process runs: the newest modification time of its built modules (dist's .js files), which every build moves. */
/** Modified time of one dist file, or -1 when a build is removing or rewriting it (Windows answers UNKNOWN, not ENOENT). */
const mtimeOf = (file: string): number => {
    try {
        return statSync(join(DIST, file), { throwIfNoEntry: false })?.mtimeMs ?? -1
    } catch {
        return -1
    }
}

/** The newest dist module's modified time; -1 while a build has the folder half written, which never equals a settled stamp. */
const buildStamp = (): number => {
    try {
        const times = readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".js")).map(mtimeOf)
        return times.includes(-1) ? -1 : Math.max(0, ...times)
    } catch {
        return -1
    }
}

/**
 * `starci supervisor watch`: `supervisor tick` in a loop for a foreground terminal, sleeping ops/liveness.yaml stall.watchSeconds
 * between passes and printing each pass's actions as it happens; `--ticks <n>` stops after n passes (default: until killed). A
 * long-lived process keeps the modules it loaded, so a new build of its own dist is never ticked with: once the build stands
 * unchanged for one sleep, the watch runs itself again from the new build (same argv, terminal and environment) and exits
 * with that process's code.
 */
export const supervisorWatchVerb = defineVerb({
    path: ["supervisor", "watch"],
    summary: "run supervisor tick in a loop (every stall.watchSeconds of ops/liveness.yaml) in a foreground terminal; it reloads itself on a new build of the CLI",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-watch@1",
    flags: { ticks: { kind: "string", summary: "stop after this many passes (default: run until killed)" } },
    run: async (context, flags) => {
        const limit = flags.ticks === undefined ? Infinity : Number(flags.ticks)
        if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Refusal("CLI_USAGE", `--ticks is a whole number above 0, not "${String(flags.ticks)}"`, EXIT_USAGE)
        const seconds = loadStallRules().watchSeconds
        const loaded = buildStamp()
        let seen = loaded
        const ticks: SupervisorTick[] = []
        // One pass after another, `seconds` apart, until the limit; a new build of the CLI first settles, then replaces this process.
        const pass = async (n: number): Promise<void> => {
            const stamp = buildStamp()
            if (stamp !== -1 && stamp !== loaded && stamp === seen) {
                context.progress(`${new Date().toISOString()} a new build of ${DIST}: reloading`)
                process.exit(await runAttached(process.execPath, [...process.execArgv, ...process.argv.slice(1)], process.cwd()))
            }
            if (stamp === loaded) {
                const tick = await supervisorTick(context)
                ticks.push(tick)
                const lines = tick.actions.length === 0 ? "" : `\n  ${tick.actions.join("\n  ")}`
                const swept = tick.swept.length === 0 ? "nothing swept" : "swept " + tick.swept.join(", ")
                context.progress(`${new Date().toISOString()} tick ${String(n)}: ${swept}${lines}`)
                if (n >= limit) return
            } else {
                seen = stamp
                context.progress(`${new Date().toISOString()} a new build of ${DIST} is being written: no tick until it settles`)
            }
            await sleep(seconds * 1000)
            await pass(stamp === loaded ? n + 1 : n)
        }
        await pass(1)
        return { data: { ticks: ticks.length, last: ticks.at(-1) ?? null }, message: `supervisor watch: ${String(ticks.length)} tick(s)` }
    },
})
