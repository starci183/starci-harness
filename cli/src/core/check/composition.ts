import { relative, sep } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { underPaths } from "../../harness/contract.js"
import { openExistingLedger } from "../../harness/ledger.js"
import { loadPolicy } from "../../harness/policy.js"
import { getTask } from "../../harness/tasks.js"
import { getWorkflow, graphOf } from "../../harness/workflow.js"
import type { ToolRun } from "../../shared/exec.js"

/**
 * The composition rules (policy/quality.yaml runtime.compositionRules) a task defers: a task whose contract names the task that
 * composes the module it writes (`context.composedBy`) does not answer for those rules on its own allowPaths, since the module
 * is meant to stand unused until that task wires it in. The deferral is an obligation, never a waiver: the composer's check
 * judges the module with no deferral, and so does the workflow's final verify before the workflow is done.
 */
export interface Deferral {
    readonly to: string
    readonly paths: readonly string[]
    readonly rules: readonly string[]
}

/** A module whose composition rules a task deferred to its composer: the producer's plan key and the module's paths. */
export interface Obligation {
    readonly producer: string
    readonly to: string
    readonly paths: readonly string[]
}

/** What a check judges about composition: the deferral it applies, and the modules it must judge in full. */
export interface Composition {
    readonly deferral: Deferral | null
    readonly obligations: readonly Obligation[]
}

/** No composition: the check judges as it always did. */
export const NO_COMPOSITION: Composition = { deferral: null, obligations: [] }

const withLedger = <T>(root: string, read: (db: DatabaseSync) => T, absent: T): T => {
    const db = openExistingLedger(root)
    if (db === undefined) return absent
    try {
        return read(db)
    } finally {
        db.close()
    }
}

/** The obligations a workflow's current graph carries: every node whose contract names its composer. */
const obligationsOf = (db: DatabaseSync, workflowId: string): Obligation[] => {
    const workflow = getWorkflow(db, workflowId)
    return graphOf(db, workflowId, workflow.graphVersion).flatMap((node) => {
        const to = node.contract.context.composedBy
        return to === undefined ? [] : [{ producer: node.key, to, paths: node.contract.context.allowPaths }]
    })
}

/**
 * The composition a task's check applies: its own deferral when its contract names a composer, and the modules of its
 * workflow whose producers named it (by plan key) as their composer, which its check judges with no deferral.
 */
export const taskComposition = (root: string, taskId: string): Composition =>
    withLedger(
        root,
        (db) => {
            const task = getTask(db, taskId)
            const to = task.contract.context.composedBy
            const deferral = to === undefined ? null : { to, paths: task.contract.context.allowPaths, rules: loadPolicy(root).quality.runtime.compositionRules }
            const row = db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(taskId)
            const key = typeof row?.plan_key === "string" ? row.plan_key : undefined
            const obligations = task.workflowId === null || key === undefined ? [] : obligationsOf(db, task.workflowId).filter((each) => each.to === key)
            return { deferral, obligations }
        },
        NO_COMPOSITION,
    )

/**
 * The composition a wave's check applies to the union its tasks landed: each task's deferral on its own allowPaths, except a
 * producer whose composer is among the wave's tasks (that composer answers for the module now), and every module those
 * composers answer for, judged with no deferral.
 */
export const waveComposition = (root: string, taskIds: readonly string[]): Composition => {
    const each = taskIds.map((taskId) => taskComposition(root, taskId))
    const obligations = [...new Map(each.flatMap((one) => one.obligations).map((obligation) => [obligation.producer, obligation])).values()]
    const composers = new Set(obligations.map((obligation) => obligation.to))
    const deferrals = each.flatMap((one) => (one.deferral === null || composers.has(one.deferral.to) ? [] : [one.deferral]))
    const first = deferrals[0]
    const deferral = first === undefined ? null : { to: [...new Set(deferrals.map((one) => one.to))].join(","), paths: [...new Set(deferrals.flatMap((one) => one.paths))], rules: first.rules }
    return { deferral, obligations }
}

/** Every module of a workflow whose composition rules a task deferred: what the workflow's final verify judges with no deferral. */
export const workflowComposition = (root: string, workflowId: string): Composition => withLedger(root, (db) => ({ deferral: null, obligations: obligationsOf(db, workflowId) }), NO_COMPOSITION)

/** Whether a lint finding's rule (`<plugin>/<name>` or `<name>`) is one of the deferred rules. */
const isDeferredRule = (deferral: Deferral, ruleId: unknown): boolean => typeof ruleId === "string" && deferral.rules.includes(ruleId.split("/").at(-1) ?? ruleId)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const toSlash = (path: string): string => path.split(sep).join("/")

/** What one ESLint run says once a deferral is applied: the findings that still count, as lines, and how many were deferred. */
export interface DeferredJudgement {
    readonly remaining: readonly string[]
    readonly deferred: number
}

/**
 * Judges an ESLint run made with `--format json` under a deferral: a finding of a deferred rule on a file under the deferral's
 * paths is deferred, every other finding counts. Undefined when the output is not ESLint's json (a tool that ignores the
 * format), so the caller judges the run by its exit code. A run that failed with no finding at all (a crash) counts.
 */
export const judgeDeferred = (run: ToolRun, root: string, deferral: Deferral): DeferredJudgement | undefined => {
    let parsed: unknown
    try {
        parsed = JSON.parse(run.stdout)
    } catch {
        return undefined
    }
    if (!Array.isArray(parsed)) return undefined
    const remaining: string[] = []
    let deferred = 0
    for (const result of parsed.filter(isRecord)) {
        const file = typeof result.filePath === "string" ? toSlash(relative(root, result.filePath)) : "?"
        const own = underPaths(file, deferral.paths)
        for (const message of (Array.isArray(result.messages) ? result.messages : []).filter(isRecord)) {
            if (own && isDeferredRule(deferral, message.ruleId)) deferred += 1
            else remaining.push(`${file}:${String(Number(message.line ?? 0))}:${String(Number(message.column ?? 0))} ${message.severity === 2 ? "error" : "warning"} ${String(message.message)} ${String(message.ruleId)}`)
        }
    }
    if (run.exitCode !== 0 && remaining.length === 0 && deferred === 0) remaining.push(`eslint exited ${String(run.exitCode)} with no finding: ${run.stderr.trim()}`)
    return { remaining, deferred }
}
