import { resolve } from "node:path"
import { withMachine } from "../../harness/machine.js"
import { needOf, normalizeNeedKey, reopenRejected } from "../../harness/needs.js"
import { projectOf } from "../../harness/work.js"
import { Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci needs reopen <key>`: the Supervisor or Debug takes back a rejection. The waiters it released are parked on the need
 * again and a new round starts through the last task resolver a round recorded (harness/needs.ts reopenRejected), so the next
 * step resolves it and relays its commits; with no such resolver it opens at its router.
 */
export const needsReopenVerb = defineVerb({
    path: ["needs", "reopen"],
    summary: "reopen a rejected shared need in a new round: the waiters its rejection released are parked again and it resolves through its last resolver, whose commits the next step relays",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["supervisor", "debug"],
    schema: "starci/needs-reopen@1",
    flags: {
        key: { kind: "string", summary: "the rejected need's key", required: true, positional: true },
        reason: { kind: "string", summary: "why the rejection no longer holds (recorded on the need)", required: true },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectOf(flags.project === undefined ? context.cwd : resolve(context.cwd, flags.project), false)
        if (project.key === "") throw new Refusal("NEED_UNKNOWN", "this checkout belongs to no registered project; it has no shared needs")
        const key = normalizeNeedKey(flags.key)
        const by = callerRole() ?? "unknown"
        const reopened = withMachine((db) => {
            const need = needOf(db, project.key, key)
            if (need === undefined) throw new Refusal("NEED_UNKNOWN", `no need ${key} in this project; starci needs list names them`)
            return reopenRejected(db, need, `reopened by the ${by}: ${flags.reason}`, by)
        })
        return {
            data: { need: reopened.need, parked: reopened.parked },
            message: `reopened ${key} in round ${String(reopened.need.round)} (${reopened.need.state}): ${String(reopened.parked)} waiter(s) parked again; the next step of its workflows tends it`,
        }
    },
})
