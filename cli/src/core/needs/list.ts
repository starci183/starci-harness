import { resolve } from "node:path"
import { projectOf } from "../../harness/work.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { needsOf } from "../../harness/needs.js"
import { formatTable } from "../../shared/output.js"
import { ownerLine, viewOf, waiterLine } from "./view.js"

/** `starci needs list`: the project's shared needs, open first, with their router, owner and waiters; changes nothing. */
export const needsListVerb = defineVerb({
    path: ["needs", "list"],
    summary: "list the project's shared needs (open ones; --all also resolved, rejected and merged): key, state, router, owner or resolver, and the tasks waiting on each",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/needs-list@1",
    flags: {
        all: { kind: "boolean", summary: "also the needs that ended: resolved, rejected and merged" },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectOf(flags.project === undefined ? context.cwd : resolve(context.cwd, flags.project), false)
        const needs = project.key === "" ? [] : needsOf(project.key, flags.all).map(viewOf)
        const rows = needs.map((need) => [need.key, `${need.state}#${String(need.round)}`, need.level ?? "-", need.scope, ownerLine(need), need.waiters.map(waiterLine).join(", ") || "-"])
        return { data: { project: project.key, needs }, message: needs.length === 0 ? "no shared need" : formatTable([["NEED", "STATE", "ROUTER", "SCOPE", "OWNER", "WAITERS"], ...rows]) }
    },
})

