import { tail } from "../core/deps/packages.js"
import { captureNpm } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { withHeavySlot } from "./heavy.js"

/**
 * The scripts that prepare an installed app tree before anything checks or runs it, in order: its `codegen`, then `build:modules`, the
 * app's declared build of its workspace packages (a package whose `main` is `./dist/index.js` resolves only once it is built). Each is the
 * app's own root npm script, and one the app does not declare is skipped (`--if-present`). The lane gate (after an install)
 * and `dev sync` both prepare a tree through `prepareTree`.
 */
export const PREPARE_SCRIPTS: readonly string[] = ["codegen", "build:modules"]

/** A prepare step that failed: the command (`npm run build:modules`, `npm ci`), its exit code and the tail of what it printed (`tail`). */
export interface PrepareFailure {
    readonly command: string
    readonly exitCode: number
    readonly output: string
}

/** One npm script run at a root; the real one runs under a heavy build slot. */
export type ScriptRunner = (root: string, script: string, label: string) => Promise<ToolRun>

/** `npm run <script> --silent --if-present` at `root` under a heavy build slot (harness/heavy.ts). */
export const runPrepareScript: ScriptRunner = (root, script, label) =>
    withHeavySlot("build", `${label}: npm run ${script}`, root, {}, (held) => captureNpm(["run", script, "--silent", "--if-present"], root, held.options))

/**
 * Runs `scripts` in order at `root` and stops at the first that fails. Returns the scripts that ran green, the failure (undefined when all
 * passed) and every run's output for the caller's log. `label` names the caller in the governor's queue.
 */
export const prepareTree = async (root: string, label: string, scripts: readonly string[] = PREPARE_SCRIPTS, run: ScriptRunner = runPrepareScript): Promise<{ readonly ran: readonly string[]; readonly failure?: PrepareFailure; readonly log: readonly string[] }> => {
    const ran: string[] = []
    const log: string[] = []
    for (const script of scripts) {
        const done = await run(root, script, label)
        log.push(done.stdout, done.stderr)
        if (done.exitCode !== 0) return { ran, failure: { command: `npm run ${script}`, exitCode: done.exitCode, output: tail(done.stdout, done.stderr) }, log }
        ran.push(script)
    }
    return { ran, log }
}
