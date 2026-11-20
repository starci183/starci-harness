import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureCommand, captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { withHeavySlot } from "../../harness/heavy.js"
import type { HeavyKind } from "../../harness/heavy.js"
import { loadSlotRules, slotKind, slotRoot, withSlot } from "../../harness/slots.js"
import { laneHolder, waitSeconds } from "./holder.js"

/**
 * Runs one argv without a shell. npm and npx go through the heavy-command governor as `heavy` (the kind's, else a build), since nothing
 * else governs them; any other program (`node`, the app's own `starci app check`) runs as it is and governs its own heavy children.
 */
export const runArgv = async (argv: readonly string[], cwd: string, label: string, heavy: HeavyKind | undefined): Promise<ToolRun> => {
    const [tool, ...args] = argv
    if (tool === undefined) throw new Refusal("CLI_USAGE", "name the command after --: starci slot run <kind> -- <command...>")
    if (tool === "npm" || tool === "npx") return withHeavySlot(heavy ?? "build", label, cwd, {}, (held) => captureCommand(argv, cwd, held.options))
    return captureTool(tool === "node" ? process.execPath : tool, args, cwd)
}

/**
 * `starci slot run <kind> -- <command...>`: take a slot of the kind under the lane's name and this process's pid, run the command,
 * release the slot when it ends, however it ends. A killed run leaves a slot whose pid is gone, which the next take reclaims.
 */
export const slotRunVerb = defineVerb({
    path: ["slot", "run"],
    summary: "run one command while holding a machine-wide slot of a kind (npm ci under npm, a full gate or push under gate): the slot records this process's pid and is released when the command ends, so a killed run never leaves it held",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/slot-run@1",
    flags: {
        kind: { kind: "string", summary: "the slot kind (ops/slots.yaml kinds)", required: true, positional: true },
        command: { kind: "rest", summary: "the command and its arguments, after -- (npm and npx run through the heavy-command governor)", required: true },
        lane: { kind: "string", summary: "the lane that holds it (default: STARCI_LANE, else the branch lane/<lane>)" },
        wait: { kind: "string", summary: "seconds to wait for a free slot before SLOT_BUSY (default: until one frees)" },
        out: { kind: "string", summary: "also write the command's whole output to this file" },
        dir: { kind: "string", summary: "the slot root (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots)" },
    },
    run: async (context, flags) => {
        const rules = loadSlotRules()
        const root = slotRoot(flags.dir, rules)
        const kind = slotKind(rules, flags.kind)
        const holder = await laneHolder(context.cwd, flags.lane)
        const label = `slot run ${flags.kind}: ${flags.command.join(" ").slice(0, 80)}`
        const outcome = await withSlot(root, rules, flags.kind, holder, { waitSeconds: waitSeconds(flags.wait), say: context.progress }, async (taken) => {
            context.progress(`${flags.kind} slot ${String(taken.n)} held by ${holder} (pid ${String(process.pid)})`)
            const run = await runArgv(flags.command, context.cwd, label, kind.heavy)
            return { taken, run }
        })
        const { run, taken } = outcome
        if (flags.out !== undefined) writeFileSync(resolve(context.cwd, flags.out), `${run.stdout}\n${run.stderr}`)
        for (const text of [run.stdout, run.stderr]) if (text !== "") context.progress(text)
        return {
            data: { kind: flags.kind, n: taken.n, file: taken.file, holder, reclaimed: taken.reclaimed, waitedSeconds: taken.waitedSeconds, exitCode: run.exitCode, timedOut: run.timedOut, stdout: run.stdout.slice(-4000), stderr: run.stderr.slice(-4000) },
            message: `${flags.command.join(" ")} exited ${String(run.exitCode)} under ${flags.kind} slot ${String(taken.n)} (released)`,
            exitCode: run.exitCode === 0 ? 0 : 1,
        }
    },
})
