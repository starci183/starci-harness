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
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, type EdgeProps, type Node, type NodeProps } from "@xyflow/react"
import { Link as RouterLink } from "react-aria-components"
import { isValidElement, memo, type ReactNode } from "react"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { useCustomTone } from "../../useCustomTone.js"
import { chipsOf, roundedPath, stepsBackRoute, STEPS_PORT_CHARS, type StepsBackRoute } from "./steps.js"
import type { FlowGraphChip, FlowGraphDirection, FlowGraphLegendItem, FlowGraphNode, FlowGraphPort, FlowGraphRunStatus, FlowGraphStepKind, FlowGraphTone } from "./types.js"

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
 * The arrowhead of a steps edge (0.37.0): an open chevron, about 6px, drawn with a 1.5px stroke in screen units (the marker is in user space so
 * the edge's own width does not scale it). A taken edge's head is the strong text tone; an untaken one's is the light neutral of its line.
 */
export const STEPS_ARROW_BOX = 20
export const STEPS_ARROW_STROKE = 1.5
export const STEPS_UNTAKEN_TONE = "color-mix(in oklab, var(--muted) 55%, transparent)"

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
    readonly isSelected: boolean
    readonly direction: FlowGraphDirection
    /** The word beside the status icon on the card ("Xong", "Đang chạy"). */
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
const StepHandles = ({ direction, hasOut }: { readonly direction: FlowGraphDirection, readonly hasOut: boolean }) => {
    const sides = SIDES[direction]
    const handle = "starci-core-flow-graph-step-handle"
    return (
        <>
            <Handle className={handle} id="in" isConnectable={false} position={sides.in} type="target" />
            {hasOut ? <Handle className={handle} id="out" isConnectable={false} position={sides.out} type="source" /> : null}
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
    const { graphNode, kind, tone, ports, isSelected, direction, statusLabel } = data
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
                <span className="starci-core-flow-graph-step-title">{graphNode.label}</span>
                {graphNode.description === undefined || graphNode.description === "" ? null : <span className="starci-core-flow-graph-step-line">{graphNode.description}</span>}
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
            <StepHandles direction={direction} hasOut={ports.length === 0 || kind !== "condition"} />
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

export type ContainerNodeData = {
    readonly graphNode: FlowGraphNode
    readonly direction: FlowGraphDirection
    readonly isSelected: boolean
    readonly [key: string]: unknown
}

/**
 * A loop card (0.37.4): a box with a 1.5px primary outline and a header line (its label and chips); the nodes it holds are separate nodes drawn over it,
 * at the places the layout gave them inside the box. It has the handles of a card, so an edge to or from its id meets its edge.
 */
export const FlowGraphContainerView = memo(({ data }: NodeProps<Node<ContainerNodeData>>) => {
    const { graphNode, direction, isSelected } = data
    return (
        <div className="starci-core-flow-graph-container" data-grammar-flow-node={graphNode.id} data-grammar-flow-container="true" data-grammar-selected={isSelected ? "true" : "false"}>
            <StepHandles direction={direction} hasOut />
            <span className="starci-core-flow-graph-container-head">
                <span className="starci-core-flow-graph-container-label">{graphNode.container?.label ?? graphNode.label}</span>
                <StepChips chips={graphNode.container?.chips} />
            </span>
        </div>
    )
})
FlowGraphContainerView.displayName = "FlowGraphContainerView"

const STEP_LABEL = "starci-core-flow-graph-step-label"

/** A forward edge: a smooth curve from its port (or the card's bottom) into the next card, with an arrowhead; a label without a port is a pill on it. */
export const FlowGraphStepEdge = memo(({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label }: EdgeProps) => {
    const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    return (
        <>
            <BaseEdge path={path} {...(markerEnd === undefined ? {} : { markerEnd })} />
            {typeof label === "string" && label !== "" ? (
                <EdgeLabelRenderer>
                    <span className={STEP_LABEL} data-grammar-flow-edge-label="true" style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}>{label}</span>
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
export const FlowGraphBackEdge = memo(({ sourceX, sourceY, targetX, targetY, markerEnd, label, data }: EdgeProps) => {
    const route = data?.["route"] as StepsBackRoute | undefined
    const direction = (data?.["direction"] as FlowGraphDirection | undefined) ?? "TB"
    if (route === undefined) return null
    const points = stepsBackRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, route, direction)
    const from = points[2] ?? { x: sourceX, y: sourceY }
    const to = points[3] ?? { x: targetX, y: targetY }
    return (
        <>
            <BaseEdge path={roundedPath(points, BACK_RADIUS)} {...(markerEnd === undefined ? {} : { markerEnd })} />
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
        {items.map((item) => <LegendEntry key={item.kind} item={item} tone={kindTones[item.kind]} />)}
    </ul>
)

const LegendEntry = ({ item, tone }: { readonly item: FlowGraphLegendItem, readonly tone: FlowGraphTone }) => {
    const custom = useCustomTone(tone, STEP_BUILT_IN_TONES)
    return (
        <li className="starci-core-flow-graph-legend-item" ref={custom.ref as never} {...custom.attrs} data-kind={item.kind} data-tone={tone}>
            <span className="starci-core-flow-graph-legend-swatch" aria-hidden="true" />
            {item.label}
        </li>
    )
}
