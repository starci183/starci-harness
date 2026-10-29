import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "../supervisor/driver.js"
import { unparkProject } from "./park-engine.js"

/**
 * `starci project unpark [--project <checkout>] [--wait <seconds>]`: brings a parked project back (core/project/park-engine.ts
 * `unparkProject`): its Supervisor starts, and once it attached each parked workflow's Kernel is relaunched on its own worktree
 * and the workflow resumed, which dispatches the tasks the park stopped at the same try from their patch. A Supervisor not
 * attached within the wait leaves the rest to `supervisor tick`, which finishes it.
 */
export const projectUnparkVerb = defineVerb({
    path: ["project", "unpark"],
    summary: "bring a parked project back: start its Supervisor, relaunch each parked workflow's Kernel, resume it and re-dispatch the parked tasks from their patches",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/project-unpark@1",
    flags: {
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
        wait: { kind: "string", summary: "seconds to wait for the Supervisor to attach before leaving the rest to supervisor tick (default 180)" },
    },
    run: async (context, flags) => {
        const project = await projectFrom(context, flags.project)
        const wait = flags.wait === undefined ? 180 : Number(flags.wait)
        if (!Number.isFinite(wait) || wait < 0) throw new Refusal("CLI_USAGE", `--wait takes a number of seconds, not ${flags.wait ?? ""}`, EXIT_USAGE)
        const data = await unparkProject(context, project, wait)
        const lines = [
            `unparked project ${data.name}: ${data.supervisor}`,
            ...data.workflows.map((one) => `workflow ${one.workflow} ${one.status}: ${one.kernel}`),
            ...data.workers,
            ...data.problems,
        ]
        return { data, message: lines.join("\n") }
    },
})
