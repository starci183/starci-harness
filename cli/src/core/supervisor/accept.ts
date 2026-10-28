import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"
import { acceptWorker } from "./workers.js"

/**
 * `starci supervisor accept <worker>`: the Supervisor accepts a worker that reported done; `task verify` settles it on a clean
 * checkout (green commits its paths on the worker's branch, red fails it). Landing that branch is Debug's.
 */
export const supervisorAcceptVerb = defineVerb({
    path: ["supervisor", "accept"],
    summary: "accept a [Worker] that reported done: task verify settles it (green commits on its branch starci/<worker>, red fails it); the worker ends accepted or red",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner"],
    schema: "starci/supervisor-worker-end@1",
    flags: {
        worker: { kind: "string", required: true, positional: true, summary: "the worker id, its task id or its seat id" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const data = await acceptWorker(context, await projectFrom(context, flags.project), flags.worker)
        return { data, message: `worker ${data.worker} ${data.ended}: ${data.detail}`, ...(data.ended === "accepted" ? {} : { exitCode: 1 }) }
    },
})
