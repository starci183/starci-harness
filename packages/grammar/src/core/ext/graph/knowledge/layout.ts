import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force"
import type { KnowledgeCluster, KnowledgeItem, KnowledgeLink } from "./types.js"

/** The smallest and the largest bubble radius, in graph units; the busiest item gets the largest. */
export const MIN_RADIUS = 11
export const MAX_RADIUS = 28
/** The gap kept between two bubbles, and between a name and a bubble or another name. */
export const BUBBLE_GAP = 6
export const LABEL_GAP = 8
export const LABEL_HEIGHT = 26
/** The empty margin around the whole map. */
export const MAP_PADDING = 32
const TICKS = 320
/** Extra room kept on top of every gap, so that rounding the output to a tenth never brings two things closer than the gap. */
const SLACK = 0.3

export interface Bubble {
    readonly id: string
    /** The centre. */
    readonly x: number
    readonly y: number
    readonly r: number
}

export interface LabelBox {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

export interface KnowledgeLayout {
    readonly bubbles: readonly Bubble[]
    /** One name per cluster that has bubbles, with its own box. */
    readonly labels: readonly LabelBox[]
    readonly width: number
    readonly height: number
}

interface Body extends SimulationNodeDatum {
    id: string
    r: number
    cx: number
    cy: number
}

interface Box {
    l: number
    t: number
    r: number
    b: number
}

/** The width of a cluster's name box: the words at the caption size plus a dot and padding, over-estimated so the real text never spills (it is cut with an ellipsis). */
export const labelWidth = (name: string): number => Math.min(220, Math.ceil(name.length * 7.6 + 34))

/** The radius of a bubble from its use count, by area: an item used twice as much covers twice the ground. */
export const radiusOf = (weight: number, most: number): number => MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.max(0, weight) / Math.max(1, most))

/** Every line of the map once: each item to its source, then each link, an unordered pair kept only the first time it is met and never an item to itself. */
export const linePairs = (items: readonly KnowledgeItem[], links: readonly KnowledgeLink[]): readonly (readonly [string, string])[] => {
    const seen = new Set<string>()
    const ids = new Set(items.map((item) => item.id))
    const pairs: (readonly [string, string])[] = []
    const add = (from: string, to: string): void => {
        if (from === to || !ids.has(from) || !ids.has(to)) return
        const key = JSON.stringify(from < to ? [from, to] : [to, from])
        if (seen.has(key)) return
        seen.add(key)
        pairs.push([from, to])
    }
    for (const item of items) if (item.sourceId !== undefined) add(item.id, item.sourceId)
    for (const link of links) add(link.from, link.to)
    return pairs
}

const meets = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
const grown = (b: Box, by: number): Box => ({ l: b.l - by, t: b.t - by, r: b.r + by, b: b.b + by })
const circleMeets = (x: number, y: number, r: number, box: Box): boolean => {
    const nx = Math.max(box.l, Math.min(x, box.r))
    const ny = Math.max(box.t, Math.min(y, box.b))
    return (x - nx) ** 2 + (y - ny) ** 2 < r * r
}

/**
 * Where each cluster stands: a lone one at the origin, otherwise a wide grid (one row up to four clusters, two rows for five to eight, and so on; at most
 * `maxColumns` across, so a phone gets a tall grid it reads top-down) whose columns are as wide as the widest cluster or cluster name in them and whose rows are
 * as tall as the largest cluster in them; the last row is centred. A wide map is the one that fits a wide panel.
 */
const centres = (reach: readonly number[], names: readonly number[], maxColumns: number): [number, number][] => {
    const n = reach.length
    if (n === 1) return [[0, 0]]
    const cols = Math.max(1, Math.min(maxColumns, Math.ceil(n / Math.max(1, Math.round(Math.sqrt(n / 2.2))))))
    const rows = Math.ceil(n / cols)
    const room = (r: number): number => 2 * r + 44
    const across = (i: number): number => Math.max(room(reach[i] ?? 0), (names[i] ?? 0) + 2 * LABEL_GAP)
    const colWidth = Array.from({ length: cols }, (_, c) => Math.max(...reach.map((_, i) => i).filter((i) => i % cols === c).map(across)))
    const rowHeight = Array.from({ length: rows }, (_, r) => Math.max(...reach.filter((_, i) => Math.floor(i / cols) === r).map(room)) + 36)
    const total = colWidth.reduce((a, b) => a + b, 0)
    const tall = rowHeight.reduce((a, b) => a + b, 0)
    return reach.map((_, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        const inRow = Math.min(cols, n - r * cols)
        const used = colWidth.slice(0, inRow).reduce((a, b) => a + b, 0)
        const x = (total - used) / 2 + colWidth.slice(0, c).reduce((a, b) => a + b, 0) + (colWidth[c] ?? 0) / 2 - total / 2
        const y = rowHeight.slice(0, r).reduce((a, b) => a + b, 0) + (rowHeight[r] ?? 0) / 2 - tall / 2
        return [x, y] as [number, number]
    })
}

/**
 * Lays out the knowledge map: the clusters on a wide grid (at most `options.maxColumns` across), each bubble pulled to its cluster's centre, a fact drawn toward
 * its source and a linked item toward the other end of its link, no two bubbles allowed to touch.
 * Pure and seeded: the start is computed from the order of the input (a sunflower spiral per cluster) and d3-force runs a fixed number of ticks on a fixed random
 * source, so the same input gives the same positions every time. Cluster names are placed last, each above its cluster, clear of every bubble and every other name.
 */
export const layoutKnowledge = (
    clusters: readonly KnowledgeCluster[],
    items: readonly KnowledgeItem[],
    options: { readonly links?: readonly KnowledgeLink[]; readonly maxColumns?: number } = {},
): KnowledgeLayout => {
    const most = items.reduce((max, item) => Math.max(max, item.weight), 0)
    const clusterIds = new Set(clusters.map((cluster) => cluster.id))
    const known = items.filter((item) => clusterIds.has(item.clusterId))
    const byCluster = new Map<string, KnowledgeItem[]>()
    for (const item of known) byCluster.set(item.clusterId, [...(byCluster.get(item.clusterId) ?? []), item])
    const live = clusters.filter((cluster) => (byCluster.get(cluster.id)?.length ?? 0) > 0)
    if (live.length === 0) return { bubbles: [], labels: [], width: 0, height: 0 }

    const reach = live.map((cluster) => {
        const area = (byCluster.get(cluster.id) ?? []).reduce((sum, item) => sum + Math.PI * (radiusOf(item.weight, most) + BUBBLE_GAP) ** 2, 0)
        return Math.sqrt(area / 0.62 / Math.PI)
    })
    const where = centres(
        reach,
        live.map((cluster) => labelWidth(cluster.name)),
        options.maxColumns ?? Number.POSITIVE_INFINITY,
    )

    const bodies: Body[] = []
    const members = new Map<string, Body[]>()
    live.forEach((cluster, at) => {
        const [cx, cy] = where[at] ?? [0, 0]
        const own: Body[] = []
        ;(byCluster.get(cluster.id) ?? []).forEach((item, index) => {
            const spread = 9 * Math.sqrt(index + 1)
            const angle = index * 2.399963229728653
            own.push({ id: item.id, r: radiusOf(item.weight, most), cx, cy, x: cx + Math.cos(angle) * spread, y: cy + Math.sin(angle) * spread })
        })
        members.set(cluster.id, own)
        bodies.push(...own)
    })
    const byId = new Map(bodies.map((body) => [body.id, body] as const))
    const links: SimulationLinkDatum<Body>[] = linePairs(known, options.links ?? []).flatMap(([from, to]) => {
        const a = byId.get(from)
        const b = byId.get(to)
        return a === undefined || b === undefined ? [] : [{ source: a, target: b }]
    })

    const simulation = forceSimulation(bodies)
        .randomSource(() => 0.5)
        .force("x", forceX<Body>((body) => body.cx).strength(0.12))
        .force("y", forceY<Body>((body) => body.cy).strength(0.12))
        .force("charge", forceManyBody<Body>().strength(-14))
        .force(
            "link",
            forceLink<Body, SimulationLinkDatum<Body>>(links)
                .distance((link) => (link.source as Body).r + (link.target as Body).r + 26)
                .strength(0.08),
        )
        .force("collide", forceCollide<Body>((body) => body.r + BUBBLE_GAP / 2).iterations(3))
        .stop()
    simulation.tick(TICKS)

    // d3 settles near contact; this pass makes the gap exact and certain: push any two closer than r + r + gap apart, in a fixed order, until none is.
    for (let pass = 0; pass < 600; pass += 1) {
        let moved = false
        for (let i = 0; i < bodies.length; i += 1)
            for (let j = i + 1; j < bodies.length; j += 1) {
                const a = bodies[i]
                const b = bodies[j]
                if (a === undefined || b === undefined) continue
                const dx = (b.x ?? 0) - (a.x ?? 0)
                const dy = (b.y ?? 0) - (a.y ?? 0)
                const need = a.r + b.r + BUBBLE_GAP + SLACK
                const dist = Math.hypot(dx, dy)
                if (dist >= need - 0.01) continue
                const ux = dist === 0 ? 1 : dx / dist
                const uy = dist === 0 ? 0 : dy / dist
                const push = (need - dist) / 2 + 0.02
                a.x = (a.x ?? 0) - ux * push
                a.y = (a.y ?? 0) - uy * push
                b.x = (b.x ?? 0) + ux * push
                b.y = (b.y ?? 0) + uy * push
                moved = true
            }
        if (!moved) break
    }

    // The names: above the cluster's own bubbles, lifted until clear of every bubble and every name placed before.
    const placed: Box[] = []
    const names: { id: string; box: Box; width: number }[] = []
    for (const cluster of live) {
        const own = members.get(cluster.id) ?? []
        const cx = own.reduce((sum, body) => sum + (body.x ?? 0), 0) / own.length
        const top = Math.min(...own.map((body) => (body.y ?? 0) - body.r))
        const width = labelWidth(cluster.name)
        const box: Box = { l: cx - width / 2, t: top - LABEL_GAP - LABEL_HEIGHT, r: cx + width / 2, b: top - LABEL_GAP }
        for (let step = 0; step < 300; step += 1) {
            const room = grown(box, LABEL_GAP + SLACK)
            if (!bodies.some((body) => circleMeets(body.x ?? 0, body.y ?? 0, body.r, room)) && !placed.some((other) => meets(room, other))) break
            box.t -= 6
            box.b -= 6
        }
        placed.push(box)
        names.push({ id: cluster.id, box, width })
    }

    const left = Math.min(...bodies.map((body) => (body.x ?? 0) - body.r), ...names.map((name) => name.box.l))
    const top = Math.min(...bodies.map((body) => (body.y ?? 0) - body.r), ...names.map((name) => name.box.t))
    const right = Math.max(...bodies.map((body) => (body.x ?? 0) + body.r), ...names.map((name) => name.box.r))
    const bottom = Math.max(...bodies.map((body) => (body.y ?? 0) + body.r), ...names.map((name) => name.box.b))
    const dx = MAP_PADDING - left
    const dy = MAP_PADDING - top
    const round = (value: number): number => Math.round(value * 10) / 10
    return {
        bubbles: bodies.map((body) => ({ id: body.id, x: round((body.x ?? 0) + dx), y: round((body.y ?? 0) + dy), r: round(body.r) })),
        labels: names.map((name) => ({ id: name.id, x: round(name.box.l + dx), y: round(name.box.t + dy), width: name.width, height: LABEL_HEIGHT })),
        width: Math.ceil(right - left + 2 * MAP_PADDING),
        height: Math.ceil(bottom - top + 2 * MAP_PADDING),
    }
}
