import type { DatabaseSync } from "node:sqlite"
import { setTimeout as sleep } from "node:timers/promises"
import { openLedger } from "../../harness/ledger.js"
import { loadPolicy } from "../../harness/policy.js"
import { recordEvent } from "../../harness/tasks.js"
import { runWave, WAVE_RUNNING, waveBusy } from "../../harness/wave.js"
import type { WaveReport } from "../../harness/wave.js"
import { asRefusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { reconcile } from "./engine.js"

/** What `workflow wave` did: the wave it ran, or nothing when none was due; `last` is the newest recorded wave verdict. */
interface WaveData {
    readonly workflow: string
    readonly wave: WaveReport | null
    readonly last: { readonly verdict: string; readonly head: string; readonly at: string } | null
}

const WAIT_POLL_MS = 1_000

/** The newest wave verdict recorded for the workflow (wave-verified), what a caller that did not run the wave reads. */
const lastWave = (db: DatabaseSync, workflow: string): WaveData["last"] => {
    const row = db.prepare("SELECT at, data_json FROM events WHERE kind = 'wave-verified' AND subject = ? ORDER BY id DESC LIMIT 1").get(workflow)
    if (row === undefined) return null
    const data = JSON.parse(String(row.data_json)) as { readonly verdict?: string; readonly head?: string }
    return { verdict: data.verdict ?? "-", head: data.head ?? "-", at: String(row.at) }
}

/** Waits while the workflow's wave runs elsewhere (its lock held, or a job starting), up to `deadline`; true when it is free. */
const waitFree = async (db: DatabaseSync, workflow: string, deadline: number): Promise<boolean> => {
    if (!waveBusy(db, workflow)) return true
    if (Date.now() >= deadline) return false
    await sleep(WAIT_POLL_MS)
    return waitFree(db, workflow, deadline)
}

/**
 * `starci workflow wave <id>`: runs the workflow's due wave verify now (harness/wave.ts), the round a settling step starts once a
 * batch has landed: its scope decision recorded first, then the heavy checks the landed tasks left, once over their union.
 * One wave of a workflow runs at a time: when another process runs it, this one refuses with WAVE_RUNNING, or with `--wait`
 * waits for it and reports the verdict it recorded. Exit 1 when the wave is red (its owning tasks are failed, back to the Kernel).
 * The detached wave job a coordinator's step starts is this verb.
 */
export const workflowWaveVerb = defineVerb({
    path: ["workflow", "wave"],
    summary: "run the workflow's due wave verify now, one per workflow at a time: record its scope decision, run the heavy checks the landed tasks left once over their union, fail the tasks whose files are red (exit 1 when red); --wait waits for a wave another process runs",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/workflow-wave@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        wait: { kind: "string", summary: "seconds to wait for a wave another process runs (or a job starting) before running a due one or reporting its verdict" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const waitMs = flags.wait === undefined ? 0 : Number(flags.wait) * 1000
            if (waitMs > 0 && !(await waitFree(db, flags.workflow, Date.now() + waitMs))) {
                return { data: { workflow: flags.workflow, wave: null, last: lastWave(db, flags.workflow) }, message: `workflow ${flags.workflow}: the wave still runs after ${String(flags.wait)} s`, exitCode: 1 }
            }
            let wave: WaveReport | undefined
            try {
                wave = await runWave(db, root, flags.workflow, loadPolicy(root).quality.runtime.stepTimeoutSeconds * 1000)
            } catch (error: unknown) {
                const refusal = asRefusal(error)
                // A wave that reached no verdict is recorded, so a detached job's failure is seen; another runner's wave is not a failure.
                if (refusal.code !== WAVE_RUNNING) recordEvent(db, "wave-error", flags.workflow, { code: refusal.code, message: refusal.message })
                throw error
            }
            // The workflow moves to the status its tasks now call for (a red wave blocks it) without waiting for the next step.
            if (wave !== undefined) reconcile(root, flags.workflow)
            const last = lastWave(db, flags.workflow)
            const data: WaveData = { workflow: flags.workflow, wave: wave ?? null, last }
            if (wave === undefined) {
                const verdict = last === null ? "" : `; the last wave was ${last.verdict} at ${last.head.slice(0, 12)} (${last.at})`
                return { data, message: `workflow ${flags.workflow}: no wave is due${verdict}`, exitCode: last?.verdict === "red" && waitMs > 0 ? 1 : 0 }
            }
            const lines = [
                `wave ${wave.verdict}: ${String(wave.tasks.length)} task(s), ${wave.base.slice(0, 12)}..${wave.head.slice(0, 12)}, ${String(wave.changed.length)} changed file(s)`,
                ...wave.commands.map((command) => `  ran: ${command}`),
                ...wave.prepared.map((outcome) => `${outcome.status} ${outcome.name}: ${outcome.detail.split("\n")[0] ?? ""}`),
                ...Object.entries(wave.outcomes).flatMap(([task, outcomes]) => outcomes.map((outcome) => `${outcome.status} ${outcome.name} (${task})`)),
                ...wave.returned.map((task) => `returned: ${task} failed, back to the Kernel${wave.free.includes(task) ? " (not proven its own: no try spent)" : ""}`),
                ...wave.errors.map((error) => `wave error, no task failed: ${error}`),
            ]
            return { data, message: lines.join("\n"), exitCode: wave.verdict === "green" ? 0 : 1 }
        } finally {
            db.close()
        }
    },
})
