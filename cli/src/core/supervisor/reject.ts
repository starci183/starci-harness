import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"
import { rejectWorker } from "./workers.js"

/** `starci supervisor reject <worker>`: the Supervisor ends a worker it will not accept; a live task is cancelled and its seat released. */
export const supervisorRejectVerb = defineVerb({
    path: ["supervisor", "reject"],
    summary: "reject a [Worker]: a live task is cancelled (seat stopped and released, tab closed, dirty paths preserved); the worker ends rejected and its worktree is removed",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner"],
    schema: "starci/supervisor-worker-end@1",
    flags: {
        worker: { kind: "string", required: true, positional: true, summary: "the worker id, its task id or its seat id" },
        reason: { kind: "string", summary: "why, recorded with the cancel" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const data = await rejectWorker(context, await projectFrom(context, flags.project), flags.worker, flags.reason)
        return { data, message: `worker ${data.worker} rejected: ${data.detail}` }
    },
})
