import { MAIN_KINDS, type FlowModel } from "./model.js"
import { normalizeStatus } from "./shared/status.js"
import type { FlowNode, GraphEdge } from "./types.js"

/**
 * Folding a long flow (owner 2026-11-26: a 57-edge flow must stay readable). When a flow has more steps than `above`, every side road the run did not take
 * folds behind one pill on the edge that leads into it ("+N steps", the app's words); the spine and every step the run reached stay drawn. Pressing a
 * pill unfolds that road.
 */
export interface FlowCollapse {
    /** The words of a pill that stands for `count` folded steps ("+N bước"). */
    readonly label: (count: number) => string
    /** Fold only when the flow has more steps than this. Default 20. */
    readonly above?: number
}

/** The id of a fold pill starts with this (it is no step of the app); the rest names the edge it hangs on. */
export const FOLD_PREFIX = "starci-fold:"

export const DEFAULT_FOLD_ABOVE = 20

export interface FoldedFlow {
    readonly nodes: readonly FlowNode[]
    readonly edges: readonly GraphEdge[]
    /** Each pill and the steps it stands for. */
    readonly folds: ReadonlyMap<string, readonly string[]>
}

const STARTED = new Set(["done", "running", "wait", "error"])

/**
 * The flow with its untaken side roads folded: the spine (the longest run of main edges from a start, the spine layout's rule), every step the run reached
 * (done, running, waiting, failed), every container and what it holds, and every road named in `open` stay; each other road off a kept step becomes one pill
 * on the edge into it, and its steps and their edges leave the drawing. A flow at or under `above` steps, or with nothing to fold, comes back as it is.
 */
export const foldFlow = (nodes: readonly FlowNode[], edges: readonly GraphEdge[], model: FlowModel, collapse: FlowCollapse, open: ReadonlySet<string>): FoldedFlow => {
    const above = collapse.above ?? DEFAULT_FOLD_ABOVE
    if (nodes.filter((node) => node.container === undefined).length <= above) return { nodes, edges, folds: new Map() }
    const kindOf = new Map(model.edges.map((item) => [item.edge, item.kind] as const))
    const forward = edges.filter((edge) => kindOf.has(edge) && kindOf.get(edge) !== "loop")
    const outs = (id: string): GraphEdge[] => forward.filter((edge) => edge.source === id)
    // The spine: the longest run of main edges from a start.
    const memo = new Map<string, number>()
    const length = (id: string, seen: ReadonlySet<string>): number => {
        const known = memo.get(id)
        if (known !== undefined) return known
        const next = outs(id).filter((edge) => MAIN_KINDS.has(kindOf.get(edge) ?? "ok") && !seen.has(edge.target))
        const value = 1 + Math.max(0, ...next.map((edge) => length(edge.target, new Set([...seen, id]))))
        memo.set(id, value)
        return value
    }
    const starts = nodes.filter((node) => node.container === undefined && !forward.some((edge) => edge.target === node.id)).map((node) => node.id)
    const kept = new Set<string>()
    let cursor = [...starts].sort((a, b) => length(b, new Set()) - length(a, new Set()))[0]
    while (cursor !== undefined && !kept.has(cursor)) {
        kept.add(cursor)
        const next = outs(cursor).filter((edge) => MAIN_KINDS.has(kindOf.get(edge) ?? "ok"))
        cursor = [...next].sort((a, b) => length(b.target, new Set()) - length(a.target, new Set()))[0]?.target
    }
    for (const node of nodes) {
        if (STARTED.has(normalizeStatus(node.status)) || node.container !== undefined) kept.add(node.id)
        for (const child of node.container?.childIds ?? []) kept.add(child)
    }
    for (const start of starts) kept.add(start)
    // An opened road is kept whole, and so is what it leads to.
    for (let changed = true; changed; ) {
        changed = false
        for (const edge of forward) {
            if (kept.has(edge.source) && !kept.has(edge.target) && open.has(`${FOLD_PREFIX}${edge.source}>${edge.target}`)) {
                const queue = [edge.target]
                for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
                    if (kept.has(id)) continue
                    kept.add(id)
                    changed = true
                    queue.push(...outs(id).map((other) => other.target))
                }
            }
        }
    }
    const folds = new Map<string, string[]>()
    const folded = new Set<string>()
    const pills: FlowNode[] = []
    const pillEdges: GraphEdge[] = []
    for (const edge of forward) {
        if (!kept.has(edge.source) || kept.has(edge.target) || folded.has(edge.target)) continue
        const steps: string[] = []
        const queue = [edge.target]
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            if (kept.has(id) || folded.has(id)) continue
            folded.add(id)
            steps.push(id)
            queue.push(...outs(id).map((other) => other.target))
        }
        const id = `${FOLD_PREFIX}${edge.source}>${edge.target}`
        folds.set(id, steps)
        pills.push({ id, label: collapse.label(steps.length), kind: "action", placeholder: true })
        pillEdges.push({ ...edge, target: id })
    }
    if (folds.size === 0) return { nodes, edges, folds }
    return {
        nodes: [...nodes.filter((node) => !folded.has(node.id)), ...pills],
        edges: [...edges.filter((edge) => !folded.has(edge.source) && !folded.has(edge.target)), ...pillEdges],
        folds,
    }
}
