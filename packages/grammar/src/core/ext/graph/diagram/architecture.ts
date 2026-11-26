/**
 * The architecture layout of a flowchart (owner 2026-11-26, the Essentials canvas): a lesson's system drawn the way the canvas draws it, by rows, instead of
 * by ELK. It applies to one shape only, a hub that calls two or more services, each node standing over the stores it alone uses:
 *
 * - the caller from outside (the one node that calls the hub) stands on top, its line straight down into the hub;
 * - the hub stands centred over the services, its own stores beside it on the right, a dashed line across to each;
 * - the hub's calls leave it as ONE trunk down to a bar across the services and drop from the bar straight into each service, the call's words (`1 trừ
 *   tiền`) as a pill on its drop: the merge-bar rule (owner 2026-11-26, the NIVO flow graph's: a node takes one line per side, many lines meet on a bar
 *   first), here for the lines that fan out;
 * - each service stands over its own stores (a database, a cache), a dashed line straight down to each;
 * - a frame round them (a subgraph, "Docker on your machine") keeps its name on top.
 *
 * Every other drawing (a flow with decisions, a chain, a graph whose stores are shared) returns undefined and keeps ELK's layout. Pure: the sizes come from
 * `nodeSize`, the pill sizes from `measure`.
 */
import type { Box, FlowLayout, Measure, Route, SizedNode } from "../layout.js"
import { CONTAINER_INSETS, nodeSize, type DiagramLayout } from "./graph.js"
import type { DiagramEdge, DiagramGraph, DiagramNode } from "./model.js"
import type { TextWidth } from "./sequence.js"

/** The room between two service columns. */
const COLUMN_GAP = 36
/** The room between two stores under one service, and between a store row and its neighbours. */
const STORE_GAP = 12
/** How far the bar stands under the hub. */
const BUS_DROP = 26
/** The least length of a drop from the bar into a service, and the room kept round the pill on it. */
const DROP_LEAST = 36
const DROP_PILL_ROOM = 20
/** The gap between a service row and the row of its stores. */
const STORE_ROW_GAP = 44
/** The gap between the hub and its first store beside it, and between two stores beside it. */
const HUB_STORE_GAP = 56
/** The gap between the caller on top and the frame (or the hub) under it. */
const ENTRY_GAP = 44
/** The padding inside the frame, on top of its insets. */
const PAD = 8
/** How much wider than a service the hub is drawn, so the one that coordinates reads first. */
const HUB_WIDER = 40

type Pt = readonly [number, number]

/** The parts of the architecture shape, found in a graph, or undefined when the graph is not that shape. */
export interface ArchitectureShape {
    readonly entry?: DiagramNode
    readonly hub: DiagramNode
    readonly services: readonly DiagramNode[]
    /** The stores of each node that has any (the hub and the services), in the order the links name them. */
    readonly stores: ReadonlyMap<string, readonly DiagramNode[]>
    readonly frame?: DiagramNode
    /** The edges by role: the caller's call, the hub's calls (in service order) and each store link. */
    readonly entryEdge?: DiagramEdge
    readonly calls: readonly DiagramEdge[]
    readonly storeEdges: readonly DiagramEdge[]
}

/**
 * The architecture shape of a graph, or undefined: exactly one hub with two or more solid calls out, every callee a service that calls nothing on, at most
 * one caller of the hub from outside, every dashed link a store link from the hub or a service to a node nothing else touches, at most one frame and the
 * hub, the services and the stores all inside it (or all outside), the caller outside it. Pure.
 */
export const architectureShape = (graph: DiagramGraph): ArchitectureShape | undefined => {
    if (graph.kind !== "flowchart") return undefined
    const byId = new Map(graph.nodes.map((node) => [node.id, node] as const))
    const solid = graph.edges.filter((edge) => !edge.dashed && edge.back !== true && edge.source !== edge.target)
    const dashed = graph.edges.filter((edge) => edge.dashed && edge.back !== true)
    if (solid.length + dashed.length !== graph.edges.length) return undefined
    const outs = (id: string): DiagramEdge[] => solid.filter((edge) => edge.source === id)
    const hubs = graph.nodes.filter((node) => node.shape !== "container" && outs(node.id).length >= 2)
    const hub = hubs[0]
    if (hub === undefined || hubs.length !== 1) return undefined
    const calls = outs(hub.id)
    const services = calls.map((edge) => byId.get(edge.target)).filter((node): node is DiagramNode => node !== undefined)
    if (services.length !== calls.length || new Set(services.map((node) => node.id)).size !== services.length) return undefined
    if (services.some((service) => service.shape === "container" || outs(service.id).length > 0 || solid.filter((edge) => edge.target === service.id).length !== 1)) return undefined
    const intoHub = solid.filter((edge) => edge.target === hub.id)
    if (intoHub.length > 1) return undefined
    const entryEdge = intoHub[0]
    const entry = entryEdge === undefined ? undefined : byId.get(entryEdge.source)
    if (entryEdge !== undefined && (entry === undefined || entry.shape === "container" || outs(entry.id).length !== 1 || solid.some((edge) => edge.target === entry.id))) return undefined
    // Every solid edge is the caller's call or one of the hub's.
    if (solid.length !== calls.length + (entryEdge === undefined ? 0 : 1)) return undefined
    const owners = new Set([hub.id, ...services.map((node) => node.id)])
    const stores = new Map<string, DiagramNode[]>()
    const touched = new Map<string, number>()
    for (const edge of graph.edges) {
        touched.set(edge.source, (touched.get(edge.source) ?? 0) + 1)
        touched.set(edge.target, (touched.get(edge.target) ?? 0) + 1)
    }
    for (const edge of dashed) {
        const store = byId.get(edge.target)
        if (!owners.has(edge.source) || store === undefined || store.shape === "container" || owners.has(store.id) || store.id === entry?.id || touched.get(store.id) !== 1) return undefined
        stores.set(edge.source, [...(stores.get(edge.source) ?? []), store])
    }
    const placed = new Set([...owners, ...(entry === undefined ? [] : [entry.id]), ...[...stores.values()].flat().map((node) => node.id)])
    const frames = graph.nodes.filter((node) => node.shape === "container")
    if (frames.length > 1) return undefined
    const frame = frames[0]
    if (graph.nodes.some((node) => node.shape !== "container" && !placed.has(node.id))) return undefined
    const inner = [...placed].filter((id) => id !== entry?.id)
    const framed = (id: string): boolean => frame !== undefined && byId.get(id)?.parentId === frame.id
    if (frame === undefined ? graph.nodes.some((node) => node.parentId !== undefined) : frame.parentId !== undefined || !inner.every(framed) || (entry !== undefined && entry.parentId !== undefined)) return undefined
    return {
        ...(entry === undefined ? {} : { entry }),
        hub,
        services,
        stores,
        ...(frame === undefined ? {} : { frame }),
        ...(entryEdge === undefined ? {} : { entryEdge }),
        calls,
        storeEdges: dashed,
    }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/**
 * The architecture layout of a graph (see the file's comment), always top-down, or undefined when the graph is not the architecture shape. The hub's calls
 * are `merged`: their routes share the trunk and the bar on purpose, so the drawing keeps them as they are instead of moving a shared stretch aside.
 */
export const layoutArchitecture = (given: DiagramGraph, textWidth: TextWidth, measure: Measure): DiagramLayout | undefined => {
    const graph: DiagramGraph = { ...given, direction: "TB" }
    const shape = architectureShape(graph)
    if (shape === undefined) return undefined
    const { entry, hub, services, stores, frame, entryEdge, calls, storeEdges } = shape
    const size = new Map(graph.nodes.map((node) => [node.id, nodeSize(node, "TB", textWidth)] as const))
    const sizeOf = (id: string): Box => size.get(id) ?? { width: 80, height: 40 }
    // The services one width and one height, so the row reads as peers; the hub wider than them.
    const serviceWidth = Math.max(...services.map((node) => sizeOf(node.id).width))
    const serviceHeight = Math.max(...services.map((node) => sizeOf(node.id).height))
    for (const node of services) size.set(node.id, { width: serviceWidth, height: serviceHeight })
    size.set(hub.id, { width: Math.max(sizeOf(hub.id).width, serviceWidth + HUB_WIDER), height: Math.max(sizeOf(hub.id).height, serviceHeight) })
    const storesOf = (id: string): readonly DiagramNode[] => stores.get(id) ?? []
    const storeRowWidth = (id: string): number => {
        const row = storesOf(id)
        return row.length === 0 ? 0 : sum(row.map((node) => sizeOf(node.id).width)) + STORE_GAP * (row.length - 1)
    }
    const columns = services.map((node) => Math.max(serviceWidth, storeRowWidth(node.id)))
    const rowWidth = sum(columns) + COLUMN_GAP * (columns.length - 1)
    const hubBox = sizeOf(hub.id)
    const hubStores = storesOf(hub.id)
    const hubStoreWidth = Math.max(0, ...hubStores.map((node) => sizeOf(node.id).width))
    const inset = frame === undefined ? { top: 0, right: 0, bottom: 0, left: 0 } : CONTAINER_INSETS
    const left = inset.left + (frame === undefined ? 0 : PAD)
    const top = inset.top + (frame === undefined ? 0 : PAD)
    // The hub is centred over the row; the stores beside it stand out to the right and widen the frame when they pass the row.
    const content = Math.max(rowWidth, hubBox.width)
    const hubCx = left + content / 2
    const rowStart = left + (content - rowWidth) / 2
    const hubX = hubCx - hubBox.width / 2
    const hubY = top
    const hubStoresRight = hubStores.length === 0 ? 0 : hubX + hubBox.width + HUB_STORE_GAP + hubStoreWidth
    // Drop length: room for the tallest pill on a drop.
    const pills = new Map(calls.flatMap((edge) => (edge.label === undefined || edge.label === "" ? [] : [[edge.id, measure(edge.label)] as const])))
    const pillTall = Math.max(0, ...[...pills.values()].map((box) => box.height))
    const busY = hubY + hubBox.height + BUS_DROP
    const drop = Math.max(DROP_LEAST, pillTall + DROP_PILL_ROOM)
    const serviceY = busY + drop
    const storeY = serviceY + serviceHeight + STORE_ROW_GAP
    // Positions, relative to the frame when there is one.
    const positions: Record<string, { x: number; y: number }> = {}
    positions[hub.id] = { x: Math.round(hubX), y: Math.round(hubY) }
    // The hub's stores: the first level with the hub's middle, any next one under the one before it.
    let besideY = hubY + hubBox.height / 2
    hubStores.forEach((node, index) => {
        const box = sizeOf(node.id)
        const y = index === 0 ? besideY - box.height / 2 : besideY
        positions[node.id] = { x: Math.round(hubX + hubBox.width + HUB_STORE_GAP), y: Math.round(y) }
        besideY = y + box.height + STORE_GAP
    })
    let lowest = 0
    let x = rowStart
    services.forEach((node, index) => {
        const column = columns[index] ?? serviceWidth
        const centre = x + column / 2
        positions[node.id] = { x: Math.round(centre - serviceWidth / 2), y: Math.round(serviceY) }
        let storeX = centre - storeRowWidth(node.id) / 2
        for (const store of storesOf(node.id)) {
            const box = sizeOf(store.id)
            positions[store.id] = { x: Math.round(storeX), y: Math.round(storeY) }
            lowest = Math.max(lowest, storeY + box.height)
            storeX += box.width + STORE_GAP
        }
        x += column + COLUMN_GAP
    })
    lowest = Math.max(lowest, serviceY + serviceHeight, besideY)
    const innerRight = Math.max(left + content, hubStoresRight)
    const frameBox: Box | undefined =
        frame === undefined ? undefined : { width: Math.round(innerRight + PAD + inset.right), height: Math.round(lowest + PAD + inset.bottom) }
    // The frame (or, without one, the nodes) stands under the caller.
    const entryBox = entry === undefined ? undefined : sizeOf(entry.id)
    const below = entryBox === undefined ? 0 : entryBox.height + ENTRY_GAP
    const origin = { x: 0, y: below }
    // A node in the frame keeps a position relative to it (xyflow's parentId); without a frame every position is absolute, moved under the caller here.
    if (frame !== undefined) positions[frame.id] = { x: origin.x, y: origin.y }
    else for (const [id, here] of Object.entries(positions)) positions[id] = { x: here.x + origin.x, y: here.y + origin.y }
    const inFrame = new Set(frame === undefined ? [] : graph.nodes.filter((node) => node.parentId === frame.id).map((node) => node.id))
    const absolute = (id: string): { x: number; y: number } => {
        const here = positions[id] ?? { x: 0, y: 0 }
        return inFrame.has(id) ? { x: here.x + origin.x, y: here.y + origin.y } : here
    }
    const rect = (id: string): { l: number; t: number; r: number; b: number } => {
        const at = absolute(id)
        const box = sizeOf(id)
        return { l: at.x, t: at.y, r: at.x + box.width, b: at.y + box.height }
    }
    const hubRect = rect(hub.id)
    const trunkX = Math.round((hubRect.l + hubRect.r) / 2)
    if (entry !== undefined && entryBox !== undefined) positions[entry.id] = { x: Math.round(trunkX - entryBox.width / 2), y: 0 }
    const routes: Record<string, Route> = {}
    if (entry !== undefined && entryEdge !== undefined) {
        const from = rect(entry.id)
        routes[entryEdge.id] = { points: [[trunkX, from.b], [trunkX, hubRect.t]] }
    }
    const busAt = Math.round(hubRect.b + BUS_DROP)
    for (const edge of calls) {
        const to = rect(edge.target)
        const c = Math.round((to.l + to.r) / 2)
        const points: Pt[] = Math.abs(c - trunkX) <= 1 ? [[trunkX, hubRect.b], [trunkX, to.t]] : [[trunkX, hubRect.b], [trunkX, busAt], [c, busAt], [c, to.t]]
        const pill = pills.get(edge.id)
        routes[edge.id] = pill === undefined ? { points } : { points, label: { x: Math.round(c - pill.width / 2), y: Math.round(busAt + (to.t - busAt - pill.height) / 2), width: pill.width, height: pill.height } }
    }
    for (const edge of storeEdges) {
        const from = rect(edge.source)
        const to = rect(edge.target)
        const toCx = Math.round((to.l + to.r) / 2)
        if (edge.source === hub.id) {
            const y = Math.round((from.t + from.b) / 2)
            const toCy = Math.round((to.t + to.b) / 2)
            routes[edge.id] = { points: Math.abs(toCy - y) <= 1 ? [[from.r, y], [to.l, y]] : [[from.r, y], [Math.round(from.r + HUB_STORE_GAP / 2), y], [Math.round(from.r + HUB_STORE_GAP / 2), toCy], [to.l, toCy]] }
            continue
        }
        // Straight down when the store stands under the service; else one jog half way, the line leaving the service inside its width.
        if (toCx > from.l + 12 && toCx < from.r - 12) routes[edge.id] = { points: [[toCx, from.b], [toCx, to.t]] }
        else {
            const startX = Math.round(Math.min(Math.max(toCx, from.l + 16), from.r - 16))
            const mid = Math.round((from.b + to.t) / 2)
            routes[edge.id] = { points: [[startX, from.b], [startX, mid], [toCx, mid], [toCx, to.t]] }
        }
    }
    const boxes: Record<string, Box> = frame === undefined || frameBox === undefined ? {} : { [frame.id]: frameBox }
    const layout: FlowLayout = { positions, boxes, routes, ports: {} }
    const sizes: SizedNode[] = graph.nodes.map((node) => {
        const box = node.id === frame?.id && frameBox !== undefined ? frameBox : sizeOf(node.id)
        return {
            id: node.id,
            width: box.width,
            height: box.height,
            ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
            ...(node.shape === "container" ? { insets: CONTAINER_INSETS } : {}),
        }
    })
    const rects = graph.nodes.map((node) => (node.id === frame?.id && frameBox !== undefined ? { l: origin.x, t: origin.y, r: origin.x + frameBox.width, b: origin.y + frameBox.height } : rect(node.id)))
    const width = Math.max(...rects.map((each) => each.r), ...Object.values(routes).flatMap((route) => [...route.points.map((point) => point[0]), ...(route.label === undefined ? [] : [route.label.x + route.label.width])]))
    const height = Math.max(...rects.map((each) => each.b))
    const first = entry ?? hub
    const firstRect = rect(first.id)
    return {
        graph,
        layout,
        sizes,
        entry: { x: firstRect.l, y: firstRect.t, width: firstRect.r - firstRect.l, height: firstRect.b - firstRect.t },
        width: Math.max(1, Math.ceil(width)),
        height: Math.max(1, Math.ceil(height)),
        merged: new Set(calls.map((edge) => edge.id)),
    }
}
