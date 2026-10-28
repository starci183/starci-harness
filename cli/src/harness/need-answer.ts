import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { Refusal } from "../shared/errors.js"
import { normalizeNeedKey } from "./needs.js"
import { getWorkflow, graphOf } from "./workflow.js"

/** What a coordinator command says about a shared need. */
interface NeedAnswerCommand {
    readonly kind: string
    readonly workflow: string
    readonly answers?: readonly string[] | undefined
    readonly change?: string | undefined
    readonly need?: { readonly key: string; readonly resolver?: string | undefined; readonly reject?: string | undefined } | undefined
}

/** How a Kernel answers a shared-need decision, said in every refusal so a wrong answer bounces back with the right one. */
export const KERNEL_NEED_GUIDANCE =
    "answer a shared-need decision with one kernel submit: a workflow-change whose `need` is {key: <the decision's need>, resolver: <the task key that builds it>} (add that task in the change, or name one the graph holds; never a task waiting on the need), or {key, reject: <why it is not shared>} to send its waiters back to their Ops; or an escalation to give it to the Supervisor"

/** How the Supervisor answers a shared-need decision. */
export const SUPERVISOR_NEED_GUIDANCE =
    "answer a shared-need decision with supervisor submit of a need-owner command (workflow: the owning workflow, need: {key}) to give it to that workflow's Kernel, or need: {key, reject: <why>} to send its waiters back to their Ops; or starci supervisor dispatch --need <key> --brief <job> to give it to a [Worker] (a package need fills --input package itself)"

const refuse = (why: string, guidance: string): Refusal => new Refusal("NEED_ANSWER_INVALID", `${why}; ${guidance}`)

/** The open-or-answered shared-need decisions a command names in its answers, with the need each one routes. */
const sharedNeedsAnswered = (db: DatabaseSync, scope: string, answers: readonly string[]): { readonly id: string; readonly need: string; readonly waiters: readonly string[] }[] =>
    answers.flatMap((id) => {
        const row = db.prepare("SELECT kind, scope, evidence_json FROM decisions WHERE id = ?").get(id)
        if (row?.kind !== "shared-need" || row.scope !== scope) return []
        const evidence = JSON.parse(String(row.evidence_json)) as { readonly need?: unknown; readonly waiters?: unknown }
        const waiters = Array.isArray(evidence.waiters) ? evidence.waiters.flatMap((waiter: unknown) => (typeof waiter === "object" && waiter !== null && "key" in waiter && typeof waiter.key === "string" ? [waiter.key] : [])) : []
        return [{ id, need: typeof evidence.need === "string" ? evidence.need : "", waiters }]
    })

/** The task keys a workflow's graph holds after a change file (or a whole workflow file) is applied, as far as the file says. */
const keysAfter = (db: DatabaseSync, workflow: string, change: string | undefined, dir: string): ReadonlySet<string> => {
    const keys = new Set(graphOf(db, workflow, getWorkflow(db, workflow).graphVersion).map((node) => node.key))
    if (change === undefined) return keys
    let raw: unknown
    try {
        raw = parse(readFileSync(resolve(dir, change), "utf8"))
    } catch {
        return keys
    }
    if (typeof raw !== "object" || raw === null) return keys
    if ("tasks" in raw && Array.isArray(raw.tasks)) return new Set(raw.tasks.flatMap((task: unknown) => (typeof task === "object" && task !== null && "id" in task && typeof task.id === "string" ? [task.id] : [])))
    if (!("changes" in raw) || !Array.isArray(raw.changes)) return keys
    for (const entry of raw.changes as unknown[]) {
        if (typeof entry !== "object" || entry === null || !("op" in entry)) continue
        if (entry.op === "add" && "task" in entry && typeof entry.task === "object" && entry.task !== null && "id" in entry.task && typeof entry.task.id === "string") keys.add(entry.task.id)
        if (entry.op === "remove" && "id" in entry && typeof entry.id === "string") keys.delete(entry.id)
    }
    return keys
}

/**
 * Refuses NEED_ANSWER_INVALID, with the guidance of how to answer, a command whose word on a shared need does not fit, before it is
 * applied, so a wrong answer leaves the decision open and never wedges it: a `need` that answers no shared-need decision, one
 * command for two needs, a key other than the decision's, a Kernel answer naming neither or both of a resolver and a rejection, a
 * resolver the graph will not hold or that waits on the need itself (a cycle), or a Supervisor naming a resolver (its owner is a
 * workflow or a worker). A Kernel may also answer with an escalation, which hands the need to the Supervisor.
 */
export const assertNeedAnswer = (db: DatabaseSync, scope: "kernel" | "supervisor", command: NeedAnswerCommand, dir: string): void => {
    const guidance = scope === "kernel" ? KERNEL_NEED_GUIDANCE : SUPERVISOR_NEED_GUIDANCE
    const answered = sharedNeedsAnswered(db, scope, command.answers ?? [])
    const { need } = command
    if (answered.length > 1) throw refuse(`this command answers ${String(answered.length)} shared-need decisions (${answered.map((one) => one.id).join(", ")}); answer one need per command`, guidance)
    if (scope === "kernel" && command.kind === "escalation") return
    if (need === undefined) {
        if (answered.length === 0) return
        throw refuse(`decision ${answered[0]?.id ?? "?"} is a shared-need decision for ${answered[0]?.need ?? "?"} and this ${command.kind} names no need`, guidance)
    }
    if (scope === "supervisor" && command.kind !== "need-owner") throw refuse(`a ${command.kind} carries no need`, guidance)
    if (scope === "kernel" && command.kind !== "workflow-change") throw refuse(`a ${command.kind} carries no need`, guidance)
    let key: string
    try {
        key = normalizeNeedKey(need.key)
    } catch (error: unknown) {
        throw refuse(error instanceof Error ? error.message : String(error), guidance)
    }
    const decision = answered[0]
    if (scope === "kernel" && decision === undefined) throw refuse(`need ${key} answers no shared-need decision of this workflow; name the decision in answers`, guidance)
    if (decision !== undefined && decision.need !== key) throw refuse(`decision ${decision.id} routes ${decision.need}, not ${key}`, guidance)
    if (need.resolver !== undefined && need.reject !== undefined) throw refuse(`need ${key} names a resolver and a rejection; it is one or the other`, guidance)
    if (scope === "supervisor") {
        if (need.resolver !== undefined) throw refuse(`the Supervisor names an owner (this command's workflow) or a [Worker], never a resolver task`, guidance)
        return
    }
    if (need.resolver === undefined && need.reject === undefined) throw refuse(`need ${key} names neither a resolver nor a rejection`, guidance)
    if (need.resolver === undefined) return
    if (decision?.waiters.includes(need.resolver) === true) throw refuse(`${need.resolver} waits on ${key} itself: a cycle; name the task that builds it`, guidance)
    if (!keysAfter(db, command.workflow, command.change, dir).has(need.resolver)) throw refuse(`resolver ${need.resolver} is no task of workflow ${command.workflow} after this change`, guidance)
}
