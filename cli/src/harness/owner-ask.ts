import { recordOwnerRequest } from "./owner-requests.js"
import type { OwnerRequest } from "./owner-requests.js"
import { requestIdOf } from "./orca/client.js"
import { wakeSupervisor } from "./supervisor.js"
import type { Project } from "./work.js"

/** An owner request as handed over: the mailbox row and what the wake-up mail did. */
export interface OwnerAsk {
    readonly request: OwnerRequest
    readonly mail: string
}

/**
 * Hands the owner's words to a project's Supervisor, the one path of `supervisor ask` and the Telegram bridge: the request lands
 * in the project's mailbox (machine.sqlite `owner_requests`) and the Supervisor's Run is mailed awake; `supervisor next` returns it.
 */
export const askSupervisor = async (project: Project, by: string, text: string, cwd: string): Promise<OwnerAsk> => {
    const request = recordOwnerRequest(project, by, text)
    const mail = await wakeSupervisor(project.key, cwd, { type: "status", subject: `[Owner] request ${request.id}`, body: text, payload: { request: request.id }, retryRequest: requestIdOf("owner-request", request.id) })
    return { request, mail }
}
