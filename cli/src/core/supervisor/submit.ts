import { resolve } from "node:path"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorSubmit } from "./driver.js"

/**
 * `starci supervisor submit <file>`: applies one Supervisor command (starci/command@1: goal, goal-change or stop) to a
 * workflow's Kernel, under cmdId dedupe and basedOn; the escalations it `answers` close with it. The workflow's repository is the
 * command's `project`, else `--project`, else the working directory, and a Supervisor submits only for its own project.
 */
export const supervisorSubmitVerb = defineVerb({
    path: ["supervisor", "submit"],
    summary: "apply one Supervisor command file (goal, goal-change, stop) to a workflow of the Supervisor's project; answers close escalations",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["supervisor", "owner"],
    schema: "starci/command-applied@1",
    flags: {
        file: { kind: "string", required: true, positional: true, summary: "the command file (json or yaml, schema starci/command@1)" },
        project: { kind: "string", summary: "the workflow's repository when the command names no project (default: the working directory)" },
    },
    run: async (context, flags) => {
        const data = await supervisorSubmit(context, resolve(context.cwd, flags.file), flags.project)
        const row = data.command as { readonly kind: string; readonly cmdId: string; readonly outcome: unknown }
        return { data, message: `${data.replay ? "replayed" : "applied"} ${row.kind} ${row.cmdId} in ${data.project}: ${JSON.stringify(row.outcome)}` }
    },
})
