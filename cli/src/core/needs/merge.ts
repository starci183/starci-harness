import { resolve } from "node:path"
import { withMachine } from "../../harness/machine.js"
import { mergeNeeds, normalizeNeedKey } from "../../harness/needs.js"
import { projectOf } from "../../harness/work.js"
import { Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { closeDecision } from "./tend.js"

/**
 * `starci needs merge <into> <from>`: a coordinator folds a need two workers spelled differently into one key. The waiters of
 * `from` move to `into`, `from` ends merged (its open decision closes; a later report of it attaches to `into`), and the next
 * step routes `into` with every waiter it now has.
 */
export const needsMergeVerb = defineVerb({
    path: ["needs", "merge"],
    summary: "fold shared need <from> into <into> when two workers named one need differently: its waiters move, <from> ends merged and later reports of it join <into>",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["kernel", "supervisor", "owner", "debug"],
    schema: "starci/needs-merge@1",
    flags: {
        into: { kind: "string", summary: "the key that stays", required: true, positional: true },
        from: { kind: "string", summary: "the key folded into it", required: true, positional: true },
        project: { kind: "string", summary: "any checkout or worktree of the project's repositories (default: the working directory)" },
    },
    run: async (context, flags) => {
        const project = await projectOf(flags.project === undefined ? context.cwd : resolve(context.cwd, flags.project), false)
        if (project.key === "") throw new Refusal("NEED_UNKNOWN", "this checkout belongs to no registered project; it has no shared needs")
        const into = normalizeNeedKey(flags.into)
        const from = normalizeNeedKey(flags.from)
        const merged = withMachine((db) => mergeNeeds(db, project.key, into, from, callerRole() ?? "unknown"))
        closeDecision(merged.from.decision, `merged into ${into}`)
        return { data: { into: merged.into, from: merged.from, moved: merged.moved }, message: `merged ${from} into ${into}: ${String(merged.moved)} waiter(s) moved; ${into} is ${merged.into.state}` }
    },
})
