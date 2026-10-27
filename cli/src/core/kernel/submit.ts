import { resolve } from "node:path"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { kernelSubmit } from "./driver.js"

/**
 * `starci kernel submit <file>`: applies one Kernel command (starci/command@1: workflow-change, escalation or handoff) under
 * cmdId dedupe and basedOn; the decisions it `answers` close with it.
 */
export const kernelSubmitVerb = defineVerb({
    path: ["kernel", "submit"],
    summary: "apply one Kernel command file (workflow-change -> workflow amend; escalation|handoff -> a Supervisor decision and a wake-up mail)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "owner", "agent"],
    schema: "starci/command-applied@1",
    flags: { file: { kind: "string", required: true, positional: true, summary: "the command file (json or yaml, schema starci/command@1)" } },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const data = await kernelSubmit(context, root, resolve(context.cwd, flags.file))
        const verb = data.replay ? "replayed" : "applied"
        return { data, message: `${verb} ${data.command.kind} ${data.command.cmdId}: ${JSON.stringify(data.command.outcome)}` }
    },
})
