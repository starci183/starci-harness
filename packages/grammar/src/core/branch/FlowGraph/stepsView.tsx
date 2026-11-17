"use client"

import {
    ArrowPathIcon,
    ArrowsRightLeftIcon,
    BoltIcon,
    CheckCircleIcon,
    CheckIcon,
    ClockIcon,
    MinusCircleIcon,
    PlayIcon,
    QuestionMarkCircleIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline"
import { BaseEdge, EdgeLabelRenderer, Handle, useInternalNode, useStore, Position, type EdgeProps, type Node, type NodeProps } from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { isValidElement, memo, useMemo, type ReactNode } from "react"
import { Avatar } from "../../leaf/Avatar/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { useCustomTone } from "../../useCustomTone.js"
import { chipsOf, roundedPath, stepsAvoidRoute, stepsBackRoute, stepsForwardRoute, stepsSideRoute, STEPS_CORNER, STEPS_EXIT_CHARS, STEPS_EXIT_INSET, STEPS_PORT_CHARS, STEPS_TITLE_CHARS, STEPS_TITLE_LINES, type StepsBackRoute, type StepsBox, type StepsDiamondSide, type StepsExits } from "./steps.js"
import type { FlowGraphChip, FlowGraphDirection, FlowGraphLegendItem, FlowGraphLegendKind, FlowGraphNode, FlowGraphPort, FlowGraphRunStatus, FlowGraphStepKind, FlowGraphTone } from "./types.js"

/**
 * The tone of each `steps` kind. Core's palette is HeroUI's (accent, success, warning, danger, default), which has no purple, teal or coral:
 * the approved hues map to the closest soft pairs (event purple → accent, action teal → success, condition amber → warning, ask coral →
 * danger, wait grey → neutral, end → success). An app that declares its own tones (`GrammarToneRegistry`) passes them through `kindTones`.
 */
export const STEP_KIND_TONES: Readonly<Record<FlowGraphStepKind, FlowGraphTone>> = {
    event: "accent",
    action: "success",
    condition: "warning",
    ask: "danger",
    wait: "neutral",
    end: "success",
}

/** The glyph a kind draws when the node brings no icon of its own. */
const KIND_GLYPHS: Readonly<Record<FlowGraphStepKind, IconSource>> = {
    event: BoltIcon,
    action: PlayIcon,
    condition: ArrowsRightLeftIcon,
    ask: QuestionMarkCircleIcon,
    wait: ClockIcon,
    end: CheckIcon,
}

const STATUS_GLYPHS: Readonly<Record<FlowGraphRunStatus, IconSource>> = {
    done: CheckCircleIcon,
    running: ArrowPathIcon,
    failed: XCircleIcon,
    waiting: ClockIcon,
    skipped: MinusCircleIcon,
}

/** The words a status reads out when the app gives none (`statusLabels`). */
export const DEFAULT_STATUS_LABELS: Readonly<Record<FlowGraphRunStatus, string>> = {
    done: "Done",
    running: "Running",
    failed: "Failed",
    waiting: "Waiting",
    skipped: "Skipped",
}

/**
 * The arrowhead of a steps edge (0.37.27, owner drawing C, "the arrow holds its shape"): a SMALL SOLID TRIANGLE, about 8px long, filled in the edge's colour (the marker is in user
 * space, so the edge's own width does not scale it). A run's taken edge and its head are the success green; an untaken one's is the light neutral of its line.
 */
export const STEPS_ARROW_BOX = 26
export const STEPS_ARROW_STROKE = 1
export const STEPS_TAKEN_TONE = "var(--success)"
export const STEPS_UNTAKEN_TONE = "color-mix(in oklab, var(--muted) 55%, transparent)"
/** The round dot every steps edge STARTS with (0.37.27, owner: "start with a round dot"): a white disc with an edge-coloured ring, radius 4, on its source's port. */
export const STEPS_EDGE_DOT = 4

/** `lane` (0.37.35): the distance out of its port at which a branch turns into its own lane, stamped as `data-grammar-flow-lane`. */
const EdgeDot = ({ x, y, lane }: { readonly x: number, readonly y: number, readonly lane?: number | undefined }) => (
    <circle className="starci-core-flow-graph-edge-dot" cx={x} cy={y} r={STEPS_EDGE_DOT} data-grammar-flow-edge-dot="true" {...(lane === undefined ? {} : { "data-grammar-flow-lane": String(lane) })} />
)

export const STEP_BUILT_IN_TONES: readonly string[] = ["neutral", "accent", "success", "warning", "danger", "muted"]

/** An icon is a node when React can render it as one; anything else (a function or a forwardRef / memo component) is an icon source. */
const isIconNode = (icon: IconSource | ReactNode): icon is ReactNode =>
    icon === null || isValidElement(icon) || typeof icon === "string" || typeof icon === "number" || typeof icon === "boolean" || Array.isArray(icon)

export const StepGlyph = ({ icon, kind }: { readonly icon: IconSource | ReactNode | undefined, readonly kind: FlowGraphStepKind }) => {
    if (icon === undefined) return <Icon source={KIND_GLYPHS[kind]} usage="chip" />
    return isIconNode(icon) ? <>{icon}</> : <Icon source={icon as IconSource} usage="chip" />
}

/** What a step card reads out: its name, its line, its tag and where the run is. */
export const stepAriaLabel = (node: FlowGraphNode, statusLabels: Readonly<Record<FlowGraphRunStatus, string>>): string =>
    [node.label, node.description, node.tag, node.status === undefined ? undefined : statusLabels[node.status]].filter((part) => part !== undefined && part !== "").join(", ")

export type StepNodeData = {
    readonly graphNode: FlowGraphNode
    readonly kind: FlowGraphStepKind
    readonly tone: FlowGraphTone
    readonly ports: ReadonlyArray<FlowGraphPort>
    /** An edge leaves this step (not from a port): its end edge shows the solid anchor dot. */
    readonly hasEdgeOut?: boolean
    readonly isSelected: boolean
    readonly direction: FlowGraphDirection
    /** The word beside the status icon on the card ("Done", "Running"). */
    readonly statusLabel?: string
    readonly [key: string]: unknown
}

/** The chips under a title or in a loop card's header: up to three, then one "+N" pill; accent is the pink soft pair, neutral the grey one. */
export const StepChips = ({ chips }: { readonly chips: ReadonlyArray<FlowGraphChip> | undefined }) => {
    const { shown, rest } = chipsOf(chips)
    if (shown.length === 0) return null
    return (
        <span className="starci-core-flow-graph-step-chips" data-grammar-flow-chips="true">
            {shown.map((chip, index) => (
                <span key={`${chip.label}:${String(index)}`} className="starci-core-flow-graph-step-chip" data-tone={chip.tone ?? "neutral"} data-grammar-flow-chip="true">{chip.label}</span>
            ))}
            {rest > 0 ? <span className="starci-core-flow-graph-step-chip" data-tone="neutral" data-grammar-flow-chip="more">{`+${String(rest)}`}</span> : null}
        </span>
    )
}

const SIDES = {
    TB: { in: Position.Top, out: Position.Bottom, start: Position.Left, end: Position.Right },
    LR: { in: Position.Left, out: Position.Right, start: Position.Top, end: Position.Bottom },
} as const

/** The hidden handles of a card: in, out, and the side handles back edges leave and enter by. */
const StepHandles = ({ direction, hasOut, isAnchored }: { readonly direction: FlowGraphDirection, readonly hasOut: boolean, readonly isAnchored: boolean }) => {
    const sides = SIDES[direction]
    const handle = "starci-core-flow-graph-step-handle"
    return (
        <>
            <Handle className={handle} id="in" isConnectable={false} position={sides.in} type="target" />
            {hasOut ? <Handle className={isAnchored ? `${handle} starci-core-flow-graph-step-anchor` : handle} id="out" isConnectable={false} position={sides.out} type="source" /> : null}
            <Handle className={handle} id="back-out-start" isConnectable={false} position={sides.start} type="source" />
            <Handle className={handle} id="back-out-end" isConnectable={false} position={sides.end} type="source" />
            <Handle className={handle} id="back-in-start" isConnectable={false} position={sides.start} type="target" />
            <Handle className={handle} id="back-in-end" isConnectable={false} position={sides.end} type="target" />
        </>
    )
}

/**
 * A step card: the icon tile in the kind's soft pair, the title (14, medium) and one muted line (12), an optional corner tag, the run
 * status ring and badge, and for a condition its output ports along the bottom, each with the port dot its edges leave from.
 * An `end` node is a pill with a check.
 */
export const FlowGraphStepView = memo(({ data }: NodeProps<Node<StepNodeData>>) => {
    const { graphNode, kind, tone, ports, isSelected, direction, statusLabel, hasEdgeOut } = data
    const custom = useCustomTone(tone, STEP_BUILT_IN_TONES)
    const isEnd = kind === "end"
    const body = isEnd ? (
        <span className="starci-core-flow-graph-step-end">
            <span className="starci-core-flow-graph-step-end-mark"><StepGlyph icon={graphNode.icon} kind="end" /></span>
            <span className="starci-core-flow-graph-step-title">{graphNode.label}</span>
        </span>
    ) : (
        <span className="starci-core-flow-graph-step-body">
            <span className="starci-core-flow-graph-step-tile" aria-hidden="true"><StepGlyph icon={graphNode.icon} kind={kind} /></span>
            <span className="starci-core-flow-graph-step-copy">
                <span className="starci-core-flow-graph-step-title" {...(graphNode.label.length > STEPS_TITLE_CHARS * STEPS_TITLE_LINES ? { title: graphNode.label } : {})}>{graphNode.label}</span>
                {graphNode.agent === undefined ? null : (
                    <span className="starci-core-flow-graph-step-agent" data-grammar-flow-agent="true">
                        <Avatar name={graphNode.agent.name} {...(graphNode.agent.avatar === undefined ? {} : { src: graphNode.agent.avatar })} size="sm" isDecorative />
                        <span className="starci-core-flow-graph-step-agent-name">{graphNode.agent.name}</span>
                    </span>
                )}
                {graphNode.description === undefined || graphNode.description === "" ? null : <span className="starci-core-flow-graph-step-line" title={graphNode.description}>{graphNode.description}</span>}
                <StepChips chips={graphNode.chips} />
            </span>
        </span>
    )
    return (
        <div
            className="starci-core-flow-graph-step"
            ref={custom.ref as never}
            {...custom.attrs}
            data-grammar-flow-node={graphNode.id}
            data-grammar-selected={isSelected ? "true" : "false"}
            data-kind={kind}
            data-tone={tone}
            data-status={graphNode.status}
            data-dimmed={graphNode.isDimmed === true ? "true" : undefined}
            data-placeholder={graphNode.isPlaceholder === true ? "true" : undefined}
        >
            <StepHandles direction={direction} hasOut={ports.length === 0 || kind !== "condition"} isAnchored={hasEdgeOut === true} />
            {graphNode.tag === undefined || graphNode.tag === "" ? null : <span className="starci-core-flow-graph-step-tag" data-grammar-flow-tag="true">{graphNode.tag}</span>}
            {graphNode.status === undefined ? null : (
                <span className="starci-core-flow-graph-step-status" data-status={graphNode.status} data-grammar-flow-status={graphNode.status} aria-hidden="true">
                    <Icon source={STATUS_GLYPHS[graphNode.status]} usage="chip" />
                    {statusLabel === undefined || statusLabel === "" ? null : <span className="starci-core-flow-graph-step-status-word">{statusLabel}</span>}
                </span>
            )}
            {graphNode.href === undefined ? body : (
                <RouterLink className="starci-core-flow-graph-link starci-core-flow-graph-step-link" data-grammar-flow-link="true" href={graphNode.href}>{body}</RouterLink>
            )}
            {ports.length === 0 ? null : (
                <span className="starci-core-flow-graph-step-outputs" data-grammar-flow-outputs="true">
                    {ports.map((port) => (
                        <span key={port.id} className="starci-core-flow-graph-step-port" data-grammar-flow-port={port.id} {...(port.tone === undefined ? {} : { "data-tone": port.tone })}>
                            <span className="starci-core-flow-graph-step-port-label" {...(port.label.length > STEPS_PORT_CHARS ? { title: port.label } : {})}>{port.label}</span>
                            <Handle className="starci-core-flow-graph-step-port-dot" id={`port:${port.id}`} isConnectable={false} position={SIDES[direction].out} type="source" />
                        </span>
                    ))}
                </span>
            )}
        </div>
    )
})
FlowGraphStepView.displayName = "FlowGraphStepView"

export type DiamondNodeData = StepNodeData & {
    /** Where each port is drawn: beside the side vertex its branch leaves, or beside the end vertex (`ahead`). */
    readonly portSides: ReadonlyMap<string, StepsDiamondSide>
}

/**
 * A decision diamond (0.39.1, `shape: "diamond"`): the diamond in the card's border and ground (status, selected and dimmed as a card), its label (the question)
 * inside at 14 medium, up to two lines, and each port's word (12 medium, muted; danger for an error port) beside the vertex its branch leaves. A side vertex holds the
 * port's handle; a branch ahead leaves the end vertex (`out`). The kind's tile, line, tag, chips and agent are not drawn: they stay in the node's accessible name.
 */
export const FlowGraphDiamondView = memo(({ data }: NodeProps<Node<DiamondNodeData>>) => {
    const { graphNode, kind, tone, ports, portSides, isSelected, direction, statusLabel } = data
    const custom = useCustomTone(tone, STEP_BUILT_IN_TONES)
    const sides = SIDES[direction]
    const question = <span className="starci-core-flow-graph-diamond-label" {...(graphNode.label.length > STEPS_TITLE_CHARS * STEPS_TITLE_LINES ? { title: graphNode.label } : {})}>{graphNode.label}</span>
    return (
        <div
            className="starci-core-flow-graph-step starci-core-flow-graph-diamond"
            ref={custom.ref as never}
            {...custom.attrs}
            data-grammar-flow-node={graphNode.id}
            data-grammar-flow-diamond="true"
            data-grammar-selected={isSelected ? "true" : "false"}
            data-kind={kind}
            data-tone={tone}
            data-status={graphNode.status}
            data-dimmed={graphNode.isDimmed === true ? "true" : undefined}
            data-placeholder={graphNode.isPlaceholder === true ? "true" : undefined}
        >
            <svg className="starci-core-flow-graph-diamond-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <polygon points="50,0 100,50 50,100 0,50" />
            </svg>
            <StepHandles direction={direction} hasOut isAnchored={false} />
            {graphNode.status === undefined ? null : (
                <span className="starci-core-flow-graph-step-status" data-status={graphNode.status} data-grammar-flow-status={graphNode.status} aria-hidden="true">
                    <Icon source={STATUS_GLYPHS[graphNode.status]} usage="chip" />
                    {statusLabel === undefined || statusLabel === "" ? null : <span className="starci-core-flow-graph-step-status-word">{statusLabel}</span>}
                </span>
            )}
            {graphNode.href === undefined ? question : (
                <RouterLink className="starci-core-flow-graph-link starci-core-flow-graph-diamond-link" data-grammar-flow-link="true" href={graphNode.href}>{question}</RouterLink>
            )}
            {ports.map((port) => (
                <span
                    key={port.id}
                    className="starci-core-flow-graph-diamond-port"
                    data-grammar-flow-port={port.id}
                    data-side={portSides.get(port.id) ?? "ahead"}
                    {...(port.tone === undefined ? {} : { "data-tone": port.tone })}
                    {...(port.label.length > STEPS_PORT_CHARS ? { title: port.label } : {})}
                >
                    {port.label}
                </span>
            ))}
            {ports.flatMap((port) => {
                const side = portSides.get(port.id) ?? "ahead"
                if (side === "ahead") return []
                return [<Handle key={port.id} className="starci-core-flow-graph-step-handle" id={`port:${port.id}`} isConnectable={false} position={side === "start" ? sides.start : sides.end} type="source" />]
            })}
        </div>
    )
})
FlowGraphDiamondView.displayName = "FlowGraphDiamondView"

export type ContainerNodeData = {
    readonly graphNode: FlowGraphNode
    readonly direction: FlowGraphDirection
    readonly isSelected: boolean
    /** A loop frame's exit pills as the layout placed them (0.39.1). */
    readonly exits?: StepsExits
    readonly [key: string]: unknown
}

/**
 * A loop card (0.37.4): a box with a 1.5px primary outline and a header line (its label and chips); the nodes it holds are separate nodes drawn over it,
 * at the places the layout gave them inside the box. It has the handles of a card, so an edge to or from its id meets its edge.
 */
export const FlowGraphContainerView = memo(({ data }: NodeProps<Node<ContainerNodeData>>) => {
    const { graphNode, direction, isSelected, exits } = data
    const container = graphNode.container
    const kind = container?.kind ?? "group"
    const description = kind === "loop" ? container?.description : undefined
    const note = kind === "loop" ? container?.note : undefined
    return (
        <div className="starci-core-flow-graph-container" data-kind={kind} data-grammar-flow-node={graphNode.id} data-grammar-flow-container="true" data-grammar-selected={isSelected ? "true" : "false"}>
            <StepHandles direction={direction} isAnchored={false} hasOut />
            <span className="starci-core-flow-graph-container-head">
                <span className="starci-core-flow-graph-container-label">{container?.label ?? graphNode.label}</span>
                {description === undefined || description === "" ? null : <span className="starci-core-flow-graph-container-description">{description}</span>}
                <StepChips chips={container?.chips} />
            </span>
            {note === undefined || note === "" ? null : <span className="starci-core-flow-graph-container-note" data-grammar-flow-note="true">{note}</span>}
            {exits === undefined ? null : exits.ports.map((port, index) => <ExitPill key={port.id} port={port} direction={direction} offset={exits.offsets[index] ?? 0} width={exits.widths[index] ?? 0} />)}
        </div>
    )
})
FlowGraphContainerView.displayName = "FlowGraphContainerView"

const STEP_LABEL = "starci-core-flow-graph-step-label"

/** One box per card, `x,y,width,height;` in the edges' coordinates, so the store selector returns a string and an edge re-renders only when a box moves. */
const parseBoxes = (key: string): ReadonlyArray<StepsBox> => key === "" ? [] : key.split(";").filter((part) => part !== "").map((part) => {
    const [x = 0, y = 0, width = 0, height = 0] = part.split(",").map(Number)
    return { x, y, width, height }
})

/**
 * The boxes of the cards an edge must not cross (0.39.4): every step and diamond card but the edge's own two ends, in the edges' coordinates, read from the
 * measured nodes so a dragged card and a card that wraps to another height are obstacles where they stand. A loop frame is not one: an edge crosses its border to reach the cards inside.
 * `ends` (0.42.0) are the boxes of the edge's own source and target: a rerouted stretch keeps clear of them as well, so a back edge never runs through the card it returns to.
 */
const useObstacles = (source: string, target: string): { readonly others: ReadonlyArray<StepsBox>, readonly ends: ReadonlyArray<StepsBox> } => {
    const key = useStore((state) => {
        let others = ""
        let ends = ""
        for (const node of state.nodeLookup.values()) {
            if (node.type !== "flowGraphStep" && node.type !== "flowGraphDiamond") continue
            const width = node.measured.width
            const height = node.measured.height
            if (width === undefined || height === undefined) continue
            const at = node.internals.positionAbsolute
            const box = `${String(Math.round(at.x))},${String(Math.round(at.y))},${String(Math.round(width))},${String(Math.round(height))};`
            if (node.id === source || node.id === target) ends += box
            else others += box
        }
        return `${others}|${ends}`
    })
    return useMemo(() => {
        const [others = "", ends = ""] = key.split("|")
        return { others: parseBoxes(others), ends: parseBoxes(ends) }
    }, [key])
}

/**
 * A way out of a loop frame (0.39.1): the FlowGraph's label pill (12, the hairline border on the surface) ON the frame's end edge, placed by the layout (LR: its start
 * {@link STEPS_EXIT_INSET} inside the right edge, its middle at `offset` from the frame's middle; TB: centred on the bottom edge at `offset` across). Its edges leave
 * the handle at its far end.
 */
const ExitPill = ({ port, direction, offset, width }: { readonly port: FlowGraphPort, readonly direction: FlowGraphDirection, readonly offset: number, readonly width: number }) => {
    const place = direction === "LR"
        ? { insetInlineStart: `calc(100% - ${String(STEPS_EXIT_INSET)}px)`, insetBlockStart: `calc(50% + ${String(offset)}px)`, inlineSize: `${String(width)}px` }
        : { insetInlineStart: `calc(50% + ${String(offset)}px)`, insetBlockStart: "100%", inlineSize: `${String(width)}px` }
    return (
        <span className={`${STEP_LABEL} starci-core-flow-graph-exit`} data-grammar-flow-exit={port.id} style={place} {...(port.label.length > STEPS_EXIT_CHARS ? { title: port.label } : {})}>
            <span className="starci-core-flow-graph-exit-label">{port.label}</span>
            <Handle className="starci-core-flow-graph-step-handle starci-core-flow-graph-exit-handle" id={`port:${port.id}`} isConnectable={false} position={SIDES[direction].out} type="source" />
        </span>
    )
}

/**
 * A forward edge (0.37.27, drawing C): ORTHOGONAL ONLY, out of its port (or the card's end edge) to the shared trunk, across, then into the next card, a 10px
 * rounded corner at every turn, the round dot at its start and the small solid arrowhead at its end; a label without a port is a pill on its last run.
 * A branch out of a port (0.37.35) turns at its own lane (`data.lane`, DNA-COMMON-FLOW-BRANCH-LANES), so no two branches share a vertical run.
 */
export const FlowGraphStepEdge = memo(({ sourceX, sourceY, targetX, targetY, markerEnd, label, data, source, target }: EdgeProps) => {
    const obstacles = useObstacles(source, target)
    const direction = (data?.["direction"] as FlowGraphDirection | undefined) ?? "LR"
    const measured = useInternalNode(target)?.measured
    const span = (direction === "LR" ? measured?.height : measured?.width) ?? 0
    const laneData = data?.["lane"]
    const lane = typeof laneData === "number" ? laneData : undefined
    // A diamond's branch out of a side vertex (0.39.1) runs across, then along: one turn.
    const isSide = data?.["side"] === "start" || data?.["side"] === "end"
    const points = isSide ? stepsSideRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, direction) : stepsAvoidRoute(stepsForwardRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, direction, span, lane), obstacles.others, direction, obstacles.ends)
    const turn = points[points.length - 2] ?? { x: sourceX, y: sourceY }
    const labelX = (turn.x + targetX) / 2
    const labelY = (turn.y + targetY) / 2
    return (
        <>
            <BaseEdge path={roundedPath(points, STEPS_CORNER)} {...(markerEnd === undefined ? {} : { markerEnd })} />
            <EdgeDot x={sourceX} y={sourceY} lane={lane} />
            {typeof label === "string" && label !== "" ? (
                <EdgeLabelRenderer>
                    <span className={STEP_LABEL} data-grammar-flow-edge-label="true" {...(data?.["isFallback"] === true ? { "data-variant": "fallback" } : {})} style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}>{label}</span>
                </EdgeLabelRenderer>
            ) : null}
        </>
    )
})
FlowGraphStepEdge.displayName = "FlowGraphStepEdge"

const BACK_RADIUS = 12
/** Across (`LR`) a channel runs down the layer gap, so its label sits beside the line instead of over it, where it would cover the cards. */
const LR_LABEL_GAP = 6

/** A back edge: dashed, routed round the cards through the channel under its source's layer, its label a pill on the channel run. */
export const FlowGraphBackEdge = memo(({ sourceX, sourceY, targetX, targetY, markerEnd, label, data, source, target }: EdgeProps) => {
    const obstacles = useObstacles(source, target)
    const route = data?.["route"] as StepsBackRoute | undefined
    const direction = (data?.["direction"] as FlowGraphDirection | undefined) ?? "TB"
    if (route === undefined) return null
    const points = stepsAvoidRoute(stepsBackRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, route, direction), obstacles.others, direction, obstacles.ends)
    // The label sits on the run along the channel: the longest run of the route (the channel stays the 3rd run when the edge is not rerouted).
    const runs = points.slice(1).map((point, index) => ({ from: points[index] as { x: number, y: number }, to: point }))
    const longest = runs.reduce((best, run) => Math.hypot(run.to.x - run.from.x, run.to.y - run.from.y) > Math.hypot(best.to.x - best.from.x, best.to.y - best.from.y) ? run : best, runs[0] ?? { from: { x: sourceX, y: sourceY }, to: { x: targetX, y: targetY } })
    const from = points.length === 6 ? points[2] as { x: number, y: number } : longest.from
    const to = points.length === 6 ? points[3] as { x: number, y: number } : longest.to
    return (
        <>
            <BaseEdge path={roundedPath(points, BACK_RADIUS)} {...(markerEnd === undefined ? {} : { markerEnd })} />
            <EdgeDot x={sourceX} y={sourceY} />
            {typeof label === "string" && label !== "" ? (
                <EdgeLabelRenderer>
                    <span className={STEP_LABEL} data-grammar-flow-edge-label="true" data-variant="back" style={{ transform: `${direction === "LR" ? `translate(${String(LR_LABEL_GAP)}px, -50%)` : "translate(-50%, -50%)"} translate(${String((from.x + to.x) / 2)}px, ${String((from.y + to.y) / 2)}px)` }}>{label}</span>
                </EdgeLabelRenderer>
            ) : null}
        </>
    )
})
FlowGraphBackEdge.displayName = "FlowGraphBackEdge"

/** The kind legend under a `steps` graph: a small tile in each kind's tone and its name. */
export const FlowGraphLegend = ({ items, kindTones = STEP_KIND_TONES }: { readonly items: ReadonlyArray<FlowGraphLegendItem>, readonly kindTones?: Readonly<Record<FlowGraphStepKind, FlowGraphTone>> }) => (
    <ul className="starci-core-flow-graph-legend" data-grammar-flow-legend="true">
        {items.map((item) => <LegendEntry key={item.kind} item={item} tone={legendToneOf(item.kind, kindTones)} />)}
    </ul>
)

/** The tone of a legend entry: its kind's, and the loop frame's neutral (0.39.1). */
const legendToneOf = (kind: FlowGraphLegendKind, kindTones: Readonly<Record<FlowGraphStepKind, FlowGraphTone>>): FlowGraphTone => kind === "loop" ? "neutral" : kindTones[kind]

const LegendEntry = ({ item, tone }: { readonly item: FlowGraphLegendItem, readonly tone: FlowGraphTone }) => {
    const custom = useCustomTone(tone, STEP_BUILT_IN_TONES)
    return (
        <li className="starci-core-flow-graph-legend-item" ref={custom.ref as never} {...custom.attrs} data-kind={item.kind} data-tone={tone} {...(item.shape === undefined ? {} : { "data-shape": item.shape })}>
            <span className="starci-core-flow-graph-legend-swatch" aria-hidden="true" />
            {item.label}
        </li>
    )
}
