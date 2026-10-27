import type { GraphNode } from "@contract"

/**
 * The wave of every node: 0 for a node with no dependency inside the graph, else one more than its deepest dependency
 * (the longest dependency path). A dependency outside the graph is ignored; a cycle is cut where it closes.
 */
export const waveOf = (nodes: readonly GraphNode[]): ReadonlyMap<string, number> => {
    const byKey = new Map(nodes.map((node) => [node.key, node]))
    const waves = new Map<string, number>()
    const visiting = new Set<string>()
    const depth = (key: string): number => {
        const known = waves.get(key)
        if (known !== undefined) return known
        const node = byKey.get(key)
        if (node === undefined || visiting.has(key)) return -1
        visiting.add(key)
        const deepest = node.dependsOn.reduce((max, dep) => Math.max(max, depth(dep)), -1)
        visiting.delete(key)
        const wave = deepest + 1
        waves.set(key, wave)
        return wave
    }
    for (const node of nodes) depth(node.key)
    return waves
}

/** Nodes grouped by wave, in wave order, each wave keeping the order the server sent. */
export const groupByWave = (nodes: readonly GraphNode[], waves: ReadonlyMap<string, number>): readonly (readonly GraphNode[])[] => {
    const groups: GraphNode[][] = []
    for (const node of nodes) {
        const wave = waves.get(node.key) ?? 0
        while (groups.length <= wave) groups.push([])
        groups[wave]?.push(node)
    }
    return groups
}

/**
 * Graph units between wave rows and between nodes of one wave. Waves run top to bottom: a graph has more waves than nodes
 * per wave, so rows keep the fitted zoom near 1 in the 32rem canvas where columns shrank the labels below reading size.
 */
const ROW_STEP = 84
const COLUMN_STEP = 232

/** Node centres for the Grammar FlowGraph's manual layout: one row per wave, each row centred on x = 0. */
export const wavePositions = (groups: readonly (readonly GraphNode[])[]): ReadonlyMap<string, { readonly x: number; readonly y: number }> => {
    const positions = new Map<string, { x: number; y: number }>()
    groups.forEach((group, wave) => {
        group.forEach((node, index) => {
            positions.set(node.key, { x: (index - (group.length - 1) / 2) * COLUMN_STEP, y: wave * ROW_STEP })
        })
    })
    return positions
}
