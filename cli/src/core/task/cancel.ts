import { now, openLedger } from "../../harness/ledger.js"
import { inTransaction, releaseLeases } from "../../harness/leases.js"
import { getTask, recordEvent, setStatus } from "../../harness/tasks.js"
import type { TaskStatus } from "../../harness/tasks.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface CancelData {
    readonly task: string
    readonly from: TaskStatus
    readonly status: TaskStatus
    readonly reason: string | null
    readonly leasesReleased: number
}

/** `starci task cancel <task-id>`: ends a queued, running or reported task as cancelled and frees its leases; stopping its seat comes with the seat module. */
export const taskCancelVerb = defineVerb({
    path: ["task", "cancel"],
    summary: "cancel a queued, running or reported task and release its path leases",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["kernel", "owner"],
    schema: "starci/task-cancel@1",
    flags: {
        task: { kind: "string", summary: "the task id", required: true, positional: true },
        reason: { kind: "string", summary: "why, recorded in the ledger's events" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const data = inTransaction(db, (): CancelData => {
                const from = getTask(db, flags.task).status
                const task = setStatus(db, flags.task, "cancelled")
                // An attempt still open when its task is cancelled ends here, so no attempt stays open forever.
                db.prepare("UPDATE attempts SET outcome = 'cancelled', ended_at = ? WHERE task_id = ? AND ended_at IS NULL").run(now(), task.id)
                const leasesReleased = releaseLeases(db, task.id)
                recordEvent(db, "task-cancelled", task.id, { from, reason: flags.reason ?? null })
                return { task: task.id, from, status: task.status, reason: flags.reason ?? null, leasesReleased }
            })
            return { data, message: `cancelled ${data.task} (was ${data.from}); released ${String(data.leasesReleased)} lease(s)` }
        } finally {
            db.close()
        }
    },
})
