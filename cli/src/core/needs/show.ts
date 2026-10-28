import { resolve } from "node:path"
import { projectOf } from "../../harness/work.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { normalizeNeedKey, readNeed } from "../../harness/needs.js"
import { Refusal } from "../../shared/errors.js"
import { ownerLine, viewOf, waiterLine } from "./view.js"

/** `starci needs show <key>`: one shared need with its decision, owner, resolver, reason and every waiter's report; changes nothing. */
export const needsShowVerb = defineVerb({
    path: ["needs", "show"],
    summary: "show one shared need: its state, router and decision, owner and resolver, why it stands there, and every waiter with the rules, paths and note it reported",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/needs-show@1",
    flags: {
        key: { kind: "string", summary: "the need key, e.g. capability:platform.http", required: true, positional: true },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectOf(flags.project === undefined ? context.cwd : resolve(context.cwd, flags.project), false)
        const key = normalizeNeedKey(flags.key)
        const need = project.key === "" ? undefined : readNeed(project.key, key)
        if (need === undefined) throw new Refusal("NEED_UNKNOWN", `no shared need ${key} in this project; starci needs list --all names them`)
        const view = viewOf(need)
        const lines = [
            `${view.key}: ${view.state} (round ${String(view.round)}), router ${view.level ?? "-"}, scope ${view.scope}${view.mergedInto === null ? "" : `, merged into ${view.mergedInto}`}`,
            `decision: ${view.decision === null ? "-" : `${view.decision.id} (${view.decision.scope}, ${view.decision.workflow})`}`,
            `owner: ${ownerLine(view)}`,
            `why: ${view.reason ?? "-"}`,
            ...view.waiters.map((waiter) => `waiter ${waiterLine(waiter)}: gave ${waiter.given}; rules ${waiter.rules.join(", ") || "-"}; paths ${waiter.paths.join(", ") || "-"}${waiter.note === null ? "" : `; ${waiter.note}`}`),
        ]
        return { data: view, message: lines.join("\n") }
    },
})
