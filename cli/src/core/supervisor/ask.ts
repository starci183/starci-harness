import { recordOwnerRequest } from "../../harness/owner-requests.js"
import { requestIdOf } from "../../harness/orca/client.js"
import { supervisorTitle, wakeSupervisor } from "../../harness/supervisor.js"
import { Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { projectFrom } from "./driver.js"

/**
 * `starci supervisor ask "<request>"`: the owner (or Debug relaying the owner's words) hands a request to a project's Supervisor
 * without typing in its terminal. The request lands in the project's mailbox (machine.sqlite `owner_requests`), the Supervisor's
 * Run is mailed to wake it, `supervisor next` returns it as an `owner-request`, and the Supervisor command whose `answers` name it
 * closes it.
 */
export const supervisorAskVerb = defineVerb({
    path: ["supervisor", "ask"],
    summary: "hand the owner's request to the project's Supervisor: recorded in its mailbox, its Run mailed awake; supervisor next returns it as owner-request",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "debug"],
    schema: "starci/owner-request@1",
    flags: {
        request: { kind: "string", required: true, positional: true, summary: "the owner's request, in the owner's words" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const text = flags.request.trim()
        if (text === "") throw new Refusal("OWNER_REQUEST_EMPTY", "supervisor ask needs the request's text")
        const project = await projectFrom(context, flags.project)
        const request = recordOwnerRequest(project, callerRole() ?? "owner", text)
        const mail = await wakeSupervisor(project.key, context.cwd, { type: "status", subject: `[Owner] request ${request.id}`, body: text, payload: { request: request.id }, retryRequest: requestIdOf("owner-request", request.id) })
        return { data: { request, mail }, message: `owner request ${request.id} for ${supervisorTitle(project.name)}: ${mail}` }
    },
})
