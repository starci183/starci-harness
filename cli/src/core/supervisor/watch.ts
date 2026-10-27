import { loadStallRules } from "../../harness/stall.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"
import type { SupervisorTick } from "./driver.js"

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * `starci supervisor watch`: `supervisor tick` in a loop for a foreground terminal, sleeping ops/liveness.yaml stall.watchSeconds
 * between passes and printing each pass's actions as it happens; `--ticks <n>` stops after n passes (default: until killed).
 */
export const supervisorWatchVerb = defineVerb({
    path: ["supervisor", "watch"],
    summary: "run supervisor tick in a loop (every stall.watchSeconds of ops/liveness.yaml) in a foreground terminal",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-watch@1",
    flags: { ticks: { kind: "string", summary: "stop after this many passes (default: run until killed)" } },
    run: async (context, flags) => {
        const limit = flags.ticks === undefined ? Infinity : Number(flags.ticks)
        if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Refusal("CLI_USAGE", `--ticks is a whole number above 0, not "${String(flags.ticks)}"`, EXIT_USAGE)
        const seconds = loadStallRules().watchSeconds
        const ticks: SupervisorTick[] = []
        for (let pass = 1; pass <= limit; pass += 1) {
            const tick = await supervisorTick(context)
            ticks.push(tick)
            const lines = tick.actions.length === 0 ? "" : `\n  ${tick.actions.join("\n  ")}`
            context.progress(`${new Date().toISOString()} tick ${String(pass)}: ${tick.swept.length === 0 ? "nothing swept" : `swept ${tick.swept.join(", ")}`}${lines}`)
            if (pass < limit) await sleep(seconds * 1000)
        }
        return { data: { ticks: ticks.length, last: ticks.at(-1) ?? null }, message: `supervisor watch: ${String(ticks.length)} tick(s)` }
    },
})
