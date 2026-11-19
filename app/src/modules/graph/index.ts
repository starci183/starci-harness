/** The layering of a dependency graph: the one owner of how a workflow's nodes fall into waves. */

/** A graph node, by id. */
export interface GraphLayerNode {
    readonly id: string
}

/** A dependency edge: `target` waits for `source`. */
export interface GraphLayerEdge {
    readonly source: string
    readonly target: string
}

/** The layer of every node: one after its deepest predecessor (longest path). Edges that close a cycle are ignored. */
export const layerOf = (nodes: ReadonlyArray<GraphLayerNode>, edges: ReadonlyArray<GraphLayerEdge>): ReadonlyMap<string, number> => {
    const known = new Set(nodes.map((node) => node.id))
    const layers = new Map<string, number>(nodes.map((node) => [node.id, 0]))
    const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target)
    // Relaxation bounded by the node count, so a cycle cannot loop for ever.
    for (let pass = 0; pass < nodes.length; pass += 1) {
        let changed = false
        for (const edge of usable) {
            const next = (layers.get(edge.source) ?? 0) + 1
            if (next > (layers.get(edge.target) ?? 0) && next < nodes.length) {
                layers.set(edge.target, next)
                changed = true
            }
        }
        if (!changed) break
    }
    return layers
}
