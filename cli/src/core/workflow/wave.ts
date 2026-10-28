import { openLedger } from "../../harness/ledger.js"
import { loadPolicy } from "../../harness/policy.js"
import { runWave } from "../../harness/wave.js"
import type { WaveReport } from "../../harness/wave.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** What `workflow wave` did: the wave it ran, or nothing when none was due. */
interface WaveData {
    readonly workflow: string
    readonly wave: WaveReport | null
}

/**
 * `starci workflow wave <id>`: runs the workflow's due wave verify now (harness/wave.ts), the round `workflow step` runs itself
 * once a batch has landed: its scope decision recorded first, then the heavy checks the landed tasks left, once over their union.
 * Exit 1 when the wave is red (its owning tasks are failed, back to the Kernel).
 */
export const workflowWaveVerb = defineVerb({
    path: ["workflow", "wave"],
    summary: "run the workflow's due wave verify now: record its scope decision, run the heavy checks the landed tasks left once over their union, fail the tasks whose files are red (exit 1 when red)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/workflow-wave@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const wave = await runWave(db, root, flags.workflow, loadPolicy(root).quality.runtime.stepTimeoutSeconds * 1000)
            const data: WaveData = { workflow: flags.workflow, wave: wave ?? null }
            if (wave === undefined) return { data, message: `workflow ${flags.workflow}: no wave is due` }
            const lines = [
                `wave ${wave.verdict}: ${String(wave.tasks.length)} task(s), ${wave.base.slice(0, 12)}..${wave.head.slice(0, 12)}, ${String(wave.changed.length)} changed file(s)`,
                ...wave.commands.map((command) => `  ran: ${command}`),
                ...wave.prepared.map((outcome) => `${outcome.status} ${outcome.name}: ${outcome.detail.split("\n")[0] ?? ""}`),
                ...Object.entries(wave.outcomes).flatMap(([task, outcomes]) => outcomes.map((outcome) => `${outcome.status} ${outcome.name} (${task})`)),
                ...wave.returned.map((task) => `returned: ${task} failed, back to the Kernel`),
            ]
            return { data, message: lines.join("\n"), exitCode: wave.verdict === "green" ? 0 : 1 }
        } finally {
            db.close()
        }
    },
})
