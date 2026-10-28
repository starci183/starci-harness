import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"
import { workerViews } from "./workers.js"

/** `starci supervisor workers`: the project's `[Worker]` seats with their task, result, seat and liveness; changes nothing. */
export const supervisorWorkersVerb = defineVerb({
    path: ["supervisor", "workers"],
    summary: "list the project's [Worker] seats: task status, filed result, seat and its liveness, and what supervisor next handed (--all: the ended ones too)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: ["supervisor", "owner", "debug"],
    schema: "starci/supervisor-workers@1",
    flags: {
        all: { kind: "boolean", summary: "also the workers the Supervisor accepted or rejected" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project, false)
        const workers = workerViews(project, flags.all)
        const rows = workers.map((worker) => [worker.id, worker.topic, worker.task, worker.taskStatus, worker.result?.status ?? "-", worker.seat === null ? "-" : `${worker.seat.id} ${worker.seat.status}`, worker.liveness, worker.endedBy ?? "-"])
        return { data: { workers }, message: workers.length === 0 ? "no worker" : formatTable([["WORKER", "TOPIC", "TASK", "STATUS", "RESULT", "SEAT", "LIVENESS", "ENDED"], ...rows]) }
    },
})
