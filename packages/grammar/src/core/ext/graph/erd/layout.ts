import ElkModule from "elkjs/lib/elk.bundled.js"
import type { ELK, ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api.js"
import { ERD_WIDTH, HEAD_PORT, erdPortId, erdPortY, type ErdModel, type ErdSide } from "./model.js"

export type Point = readonly [number, number]

/** The size of a label's box, from its words. */
export type ErdMeasure = (text: string) => { readonly width: number; readonly height: number }

/** The room of a label when nothing measured it: the caption type at about 6.5px a character, 10px of padding each side, a 22px line. */
export const estimateErdLabel: ErdMeasure = (text) => ({ width: Math.ceil(text.length * 6.5) + 20, height: 22 })

export interface ErdRoute {
    /** From the port of the field's entity (`from`) to the head port of the other (`to`); the first and the last point lie on the boxes. */
    readonly points: readonly Point[]
    /** The sides of the boxes the line leaves and enters by. */
    readonly fromSide: ErdSide
    readonly toSide: ErdSide
    readonly label?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

export interface ErdLayout {
    readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
    readonly routes: Readonly<Record<string, ErdRoute>>
}

export interface ErdLayoutSettings {
    readonly measure?: ErdMeasure
}

/** How far a relation to the entity itself runs beside its box, and the gap between that line and its words. */
const SELF_LANE = 40
const SELF_GAP = 12

const options: LayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "40",
    "elk.spacing.edgeNode": "24",
    "elk.spacing.edgeEdge": "16",
    "elk.spacing.edgeLabel": "10",
    "elk.spacing.labelNode": "10",
    "elk.spacing.portPort": "8",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.spacing.nodeNodeBetweenLayers": "56",
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP",
    "elk.json.edgeCoords": "ROOT",
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
}

/** elkjs is a CommonJS bundle that sets `default` on its constructor; under Node the import is that constructor's module object, under a bundler the constructor itself. */
const Elk: typeof ElkModule = (ElkModule as unknown as { readonly default?: typeof ElkModule }).default ?? ElkModule
let engine: ELK | undefined

/** Which sides the two ends of a relation use. The line runs from the entity others point at (the "one" end) to the one that holds the field, so the layers read left to right (or top to bottom) from the first to the last. */
const SIDES: { readonly toSide: ErdSide; readonly fromSide: ErdSide } = { toSide: "R", fromSide: "L" }

const portSide = (side: ErdSide): string => (side === "L" ? "WEST" : "EAST")

interface Used {
    readonly node: string
    readonly row: string
    readonly side: ErdSide
}

/**
 * Places the entities with ELK's layered algorithm and routes every relation, orthogonally, from the port of its field to the head port of the entity it points at.
 * ELK is given each relation the other way round (from the entity pointed at to the field that points), so what is pointed at stands first; the route is turned back after.
 * The same input always gives the same coordinates, rounded to whole pixels.
 */
export const layoutErd = async (model: ErdModel, settings: ErdLayoutSettings = {}): Promise<ErdLayout> => {
    const { measure = estimateErdLabel } = settings
    engine ??= new Elk()
    const rowIndex = new Map<string, number>()
    for (const node of model.nodes) node.rows.forEach((row, index) => rowIndex.set(`${node.id}::${row.field.id}`, index))
    const used = new Map<string, Used>()
    const use = (node: string, row: string, side: ErdSide): string => {
        const id = erdPortId(node, row, side)
        used.set(id, { node, row, side })
        return id
    }
        const selfs = model.edges.filter((edge) => edge.source === edge.target)
    // A relation to its own entity is drawn outside ELK: out of the field, round a line beside the box, into the head; ELK keeps the room beside the box for it and its words.
    const reach = new Map<string, number>()
    for (const edge of selfs) reach.set(edge.source, Math.max(reach.get(edge.source) ?? 0, SELF_LANE + SELF_GAP + (edge.label === undefined ? 0 : measure(edge.label).width) + SELF_GAP))
    const elkEdges: ElkExtendedEdge[] = model.edges.filter((edge) => edge.source !== edge.target).map((edge) => {
        const side = SIDES
        const box = edge.label === undefined ? undefined : measure(edge.label)
        return {
            id: edge.id,
            sources: [use(edge.target, HEAD_PORT, side.toSide)],
            targets: [use(edge.source, edge.sourcePort, side.fromSide)],
            ...(box === undefined || edge.label === undefined ? {} : { labels: [{ id: `${edge.id}::label`, text: edge.label, width: box.width, height: box.height, layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }] }),
        }
    })
    const root: ElkNode = {
        id: "root",
        layoutOptions: options,
        children: model.nodes.map((node) => ({
            id: node.id,
            width: ERD_WIDTH,
            height: node.height,
            layoutOptions: { "elk.portConstraints": "FIXED_POS", ...(reach.has(node.id) ? { "elk.margins": `[top=0,left=0,bottom=0,right=${String(reach.get(node.id))}]` } : {}) },
            ports: [...used.values()]
                .filter((port) => port.node === node.id)
                .map((port) => {
                    const index = rowIndex.get(`${port.node}::${port.row}`)
                    const y = erdPortY(port.row === HEAD_PORT || index === undefined ? HEAD_PORT : index)
                    return { id: erdPortId(port.node, port.row, port.side), x: port.side === "L" ? 0 : ERD_WIDTH, y, width: 0, height: 0, layoutOptions: { "elk.port.side": portSide(port.side) } }
                }),
        })),
        edges: elkEdges,
    }
    const laid = await engine.layout(root)
    const positions: Record<string, { x: number; y: number }> = {}
    for (const child of laid.children ?? []) positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }
    const routes: Record<string, ErdRoute> = {}
    for (const edge of laid.edges ?? []) routes[edge.id] = routeOf(edge)
    for (const edge of selfs) {
        const at = positions[edge.source]
        const row = rowIndex.get(`${edge.source}::${edge.sourcePort}`)
        if (at === undefined) continue
        const from = at.y + erdPortY(row ?? HEAD_PORT)
        const to = at.y + erdPortY(HEAD_PORT)
        const x = at.x + ERD_WIDTH
        const box = edge.label === undefined ? undefined : measure(edge.label)
        routes[edge.id] = {
            points: [[x, from], [x + SELF_LANE, from], [x + SELF_LANE, to], [x, to]],
            fromSide: "R",
            toSide: "R",
            ...(box === undefined ? {} : { label: { x: x + SELF_LANE + SELF_GAP, y: Math.round((from + to) / 2 - box.height / 2), width: box.width, height: box.height } }),
        }
    }
    return { positions, routes }
}

const routeOf = (edge: ElkExtendedEdge): ErdRoute => {
    const section = edge.sections?.[0]
    const round = (point: { readonly x: number; readonly y: number }): Point => [Math.round(point.x), Math.round(point.y)]
    // ELK drew it from the entity pointed at to the field; the route is kept from the field to the entity pointed at.
    const forward = section === undefined ? [] : [round(section.startPoint), ...(section.bendPoints ?? []).map(round), round(section.endPoint)]
    const label = edge.labels?.[0]
    return {
        points: forward.reverse(),
        fromSide: SIDES.fromSide,
        toSide: SIDES.toSide,
        ...(label?.x === undefined || label.y === undefined ? {} : { label: { x: Math.round(label.x), y: Math.round(label.y), width: Math.round(label.width ?? 0), height: Math.round(label.height ?? 0) } }),
    }
}


export interface ErdBounds {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** The room everything takes: the boxes, the lines and the words on them. */
export const erdBounds = (model: ErdModel, layout: ErdLayout): ErdBounds => {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    const take = (x: number, y: number): void => {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
    }
    for (const node of model.nodes) {
        const at = layout.positions[node.id]
        if (at === undefined) continue
        take(at.x, at.y)
        take(at.x + ERD_WIDTH, at.y + node.height)
    }
    for (const route of Object.values(layout.routes)) {
        for (const point of route.points) take(point[0], point[1])
        if (route.label !== undefined) {
            take(route.label.x, route.label.y)
            take(route.label.x + route.label.width, route.label.y + route.label.height)
        }
    }
    return left === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: left, y: top, width: right - left, height: bottom - top }
}
