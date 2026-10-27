import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { readContract } from "./contract.js"
import { CHANGE_SCHEMA } from "./graph.js"
import { laneOf, loadLanes, recordsOf, repoOfLedger } from "./lanes.js"
import { loadOps } from "./ops.js"
import type { Ops } from "./ops.js"
import { getTask, latestAttempt, resultOf } from "./tasks.js"
import { getWorkflow, graphOf } from "./workflow.js"

/** The schema tag of ops/routes.yaml. */
export const ROUTES_SCHEMA = "starci/routes@1"

/** The causes of a decision on a task, by decision kind (ops/routes.yaml says what each means; causeOf reads them). */
const CAUSES = { red: ["findings", "failed", "rejected", "no-report"], question: ["blocked", "mismatch"] } as const

/** The decision kinds that carry routes. */
type RoutedKind = keyof typeof CAUSES

const routeSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    on: z.strictObject({ decision: z.enum(["red", "question"]), from: z.string().min(1), cause: z.enum([...CAUSES.red, ...CAUSES.question]) }),
    to: z.union([z.literal("same"), z.literal("build"), z.strictObject({ label: z.string().min(1) })]),
    limit: z.number().int().min(1),
})

const routesFileSchema = z.strictObject({ schema: z.literal(ROUTES_SCHEMA), routes: z.array(routeSchema).min(1) })

/** One bounded route of ops/routes.yaml. */
export type Route = z.infer<typeof routeSchema>

/** Loads ops/routes.yaml; a cause of another decision kind, or a label with no op file, is ROUTES_INVALID. */
export const loadRoutes = (ops: Ops): readonly Route[] => {
    const file = join(ops.dir, "routes.yaml")
    const parsed = routesFileSchema.safeParse(parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("ROUTES_INVALID", `${file}: ${z.prettifyError(parsed.error)}`)
    const { routes } = parsed.data
    const problems = routes.flatMap((route) => [
        ...((CAUSES[route.on.decision] as readonly string[]).includes(route.on.cause) ? [] : [`${route.id}: a ${route.on.decision} decision has no cause ${route.on.cause}`]),
        ...(route.on.from === "any" || route.on.from in ops.labels ? [] : [`${route.id}: from ${route.on.from} has no op file`]),
        ...(typeof route.to === "object" && !(route.to.label in ops.labels) ? [`${route.id}: to ${route.to.label} has no op file`] : []),
        ...(routes.filter((other) => other.id === route.id).length > 1 ? [`${route.id} is declared twice`] : []),
    ])
    if (problems.length > 0) throw new Refusal("ROUTES_INVALID", `${file}:\n${[...new Set(problems)].join("\n")}`)
    return routes
}

/** The legal route of a decision as its evidence carries it: the route, the label its change must carry, and its count. */
export interface LegalRoute {
    readonly id: string
    readonly to: string
    readonly label: string
    readonly taken: number
    readonly limit: number
}

/** What a red or question decision on a task allows: its cause, its legal route (none past the limit) and the gate it falls to. */
export interface RouteOptions {
    readonly key: string
    readonly cause: string
    readonly routes: readonly LegalRoute[]
    readonly gate: "owner" | null
}

/** The cause of a decision on a task, from its newest attempt's result (ops/routes.yaml names each). */
const causeOf = (db: DatabaseSync, taskId: string, kind: RoutedKind): string => {
    const attempt = latestAttempt(db, taskId)
    const result = attempt === undefined ? undefined : resultOf(db, attempt.id)
    if (kind === "question") return result?.status === "mismatch" ? "mismatch" : "blocked"
    if (result === undefined) return "no-report"
    const output: unknown = result.output
    if (typeof output === "object" && output !== null && "verdict" in output && output.verdict === "failed") return "findings"
    return result.status === "failed" ? "failed" : "rejected"
}

/** How many applied Kernel commands of a workflow took a route for decisions on one task key. */
const takenOf = (db: DatabaseSync, workflowId: string, route: string, key: string): number =>
    Number(
        db
            .prepare(
                "SELECT COUNT(DISTINCT c.cmd_id) AS n FROM commands c JOIN decisions d ON d.answered_by = c.cmd_id WHERE c.workflow_id = ? AND c.scope = 'kernel' AND c.status = 'applied' " +
                    "AND json_extract(c.body_json, '$.route') = ? AND json_extract(d.evidence_json, '$.key') = ?",
            )
            .get(workflowId, route, key)?.n ?? 0,
    )

/** The label a route's `to` asks for on a task, or undefined when it does not resolve (`build` of a task over no record with a lane). */
const targetOf = (route: Route, label: string, build: () => string | undefined): string | undefined => {
    if (route.to === "same") return label
    if (route.to === "build") return build()
    return route.to.label
}

/**
 * The routes of a decision on a task (ops/routes.yaml): the first route matching its kind, the task's label and its cause whose
 * `to` resolves is legal while it was taken fewer times than its limit for this task key; past it, or with none, the decision
 * falls to the owner gate (the Kernel escalates, kind owner).
 */
export const routeOptions = (db: DatabaseSync, workflowId: string, kind: RoutedKind, taskId: string): RouteOptions => {
    const task = getTask(db, taskId)
    const key = String(db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(taskId)?.plan_key ?? taskId)
    const cause = causeOf(db, taskId, kind)
    const ops = loadOps()
    const build = (): string | undefined => {
        const repo = task.worktree ?? repoOfLedger(db)
        if (repo === undefined || !existsSync(repo)) return undefined
        const lanes = loadLanes(ops)
        return recordsOf(task.contract, repo)
            .map((ref) => laneOf(ref, lanes, repo)?.build)
            .find((label) => label !== undefined)
    }
    for (const route of loadRoutes(ops)) {
        if (route.on.decision !== kind || route.on.cause !== cause || (route.on.from !== "any" && route.on.from !== task.label)) continue
        const label = targetOf(route, task.label, build)
        if (label === undefined) continue
        const taken = takenOf(db, workflowId, route.id, key)
        const to = typeof route.to === "string" ? route.to : `label ${route.to.label}`
        if (taken >= route.limit) return { key, cause, routes: [], gate: "owner" }
        return { key, cause, routes: [{ id: route.id, to, label, taken, limit: route.limit }], gate: null }
    }
    return { key, cause, routes: [], gate: "owner" }
}

/** True for a Kernel decision that carries routes: red or question on a task. */
export const isRouted = <T extends { readonly scope: string; readonly kind: string; readonly subject: string }>(decision: T): decision is T & { readonly kind: RoutedKind } =>
    decision.scope === "kernel" && (decision.kind === "red" || decision.kind === "question") && decision.subject.startsWith("t-")

const changeSchema = z.object({
    schema: z.literal(CHANGE_SCHEMA),
    changes: z.array(z.object({ op: z.string(), id: z.string().optional(), task: z.record(z.string(), z.unknown()).optional(), set: z.record(z.string(), z.unknown()).optional() })),
})

/** The label a change file's added task carries: inline, a Work flow (uat), or its contract file's. */
const addedLabel = (task: Record<string, unknown>, dir: string): string | undefined => {
    if (typeof task.label === "string") return task.label
    if (typeof task.uat === "string") return "uat"
    if (typeof task.contract !== "string") return undefined
    try {
        return readContract(resolve(dir, task.contract)).label
    } catch {
        return undefined
    }
}

/** What a Kernel command asks of its routed decisions: its kind, the decisions it answers, the route it names and its change file. */
export interface RoutedCommand {
    readonly kind: string
    readonly workflow: string
    readonly answers?: readonly string[] | undefined
    readonly route?: string | undefined
    readonly change?: string | undefined
}

/** Why a change file does not do what a route asks for a task key, or undefined when it does. */
const unfitChange = (db: DatabaseSync, workflowId: string, file: string, dir: string, key: string, route: LegalRoute): string | undefined => {
    let parsed: z.infer<typeof changeSchema>
    try {
        const raw: unknown = parse(readFileSync(file, "utf8"))
        const checked = changeSchema.safeParse(raw)
        if (!checked.success) return `a routed answer is a ${CHANGE_SCHEMA} file, and ${file} is not one`
        parsed = checked.data
    } catch (error: unknown) {
        return `${file} is not readable: ${error instanceof Error ? error.message : String(error)}`
    }
    const workflow = getWorkflow(db, workflowId)
    const labels = new Map(graphOf(db, workflowId, workflow.graphVersion).map((node) => [node.key, node.contract.label]))
    const fits = parsed.changes.some((change) => {
        if (change.op === "add") return change.task !== undefined && addedLabel(change.task, dir) === route.label
        if (route.to === "same") return (change.op === "retry" || change.op === "edit") && change.id === key
        if (change.op !== "retry" && change.op !== "edit") return false
        return (change.set?.label ?? labels.get(change.id ?? "")) === route.label
    })
    if (fits) return undefined
    return route.to === "same"
        ? `route ${route.id} retries or edits ${key}, or adds a scoped ${route.label} task, and the change does none of them`
        : `route ${route.id} repairs with a ${route.label} task, and the change adds, retries or edits none`
}

/**
 * Refuses ROUTE_ILLEGAL when a workflow-change answers a red or question decision on a task without taking its legal route:
 * the command names no route or another one, the decision is past its route's limit (the Kernel escalates, kind owner), or the
 * change file does not do what the route's `to` asks. Escalations and handoffs answer any decision.
 */
export const assertRoute = (db: DatabaseSync, command: RoutedCommand, dir: string): void => {
    if (command.kind !== "workflow-change") return
    const routed = (command.answers ?? [])
        .map((id) => db.prepare("SELECT id, scope, kind, subject FROM decisions WHERE id = ?").get(id))
        .filter((row) => row !== undefined)
        .map((row) => ({ id: String(row.id), scope: String(row.scope), kind: String(row.kind), subject: String(row.subject) }))
        .filter(isRouted)
    if (routed.length === 0) return
    for (const decision of routed) {
        const options = routeOptions(db, command.workflow, decision.kind, decision.subject)
        const legal = options.routes[0]
        if (legal === undefined) {
            throw new Refusal("ROUTE_ILLEGAL", `decision ${decision.id} (${decision.kind}, ${options.cause}, task ${options.key}) has no route left; escalate it (kind owner) to the Supervisor`)
        }
        if (command.route !== legal.id) {
            throw new Refusal("ROUTE_ILLEGAL", `decision ${decision.id} (${decision.kind}, ${options.cause}, task ${options.key}) allows route ${legal.id} (to ${legal.to}, ${String(legal.taken)} of ${String(legal.limit)} taken), not ${command.route ?? "none named"}; name it as route and do what it asks, or escalate`)
        }
        if (command.change === undefined) throw new Refusal("ROUTE_ILLEGAL", `route ${legal.id} needs a change file doing what it asks`)
        const why = unfitChange(db, command.workflow, resolve(dir, command.change), dir, options.key, legal)
        if (why !== undefined) throw new Refusal("ROUTE_ILLEGAL", why)
    }
}

/** A red or question decision's evidence with its cause, legal route and gate (routeOptions); unchanged when they cannot be read. */
export const withRoutes = (db: DatabaseSync, workflowId: string, kind: RoutedKind, taskId: string, evidence: unknown): unknown => {
    const base = typeof evidence === "object" && evidence !== null ? evidence : { evidence }
    try {
        return { ...base, ...routeOptions(db, workflowId, kind, taskId) }
    } catch (error: unknown) {
        return { ...base, routeError: error instanceof Error ? error.message : String(error) }
    }
}
