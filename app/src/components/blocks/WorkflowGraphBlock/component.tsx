import {
    Button,
    Code,
    DescriptionList,
    FlowGraph,
    StatusDot,
    SurfaceCard,
    Text,
    type FlowGraphEdge,
    type FlowGraphLayerHeader,
    type FlowGraphNode,
    type PresentationState,
} from "@starci/grammar/core"
import { useInlineSize } from "../../../hooks/ui"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { KeyList } from "../../leaves/KeyList"
import { StatusWord } from "../../leaves/StatusWord"

/** One Op of the graph as its detail card draws it. */
export interface NodeDetailView {
    readonly id: string
    readonly title: string
    readonly state: ToneLabel
    readonly presentation: PresentationState
    readonly member: string
    readonly side: string
    readonly dependsOn: readonly string[]
    readonly record: string | null
    readonly why: string | null
    readonly task: { readonly href: string; readonly label: string } | null
}

/** The graph in waves, resolved for drawing. */
export interface WorkflowGraphView {
    readonly label: string
    readonly stats: {
        readonly live: string
        readonly cap: string
        readonly queued: string
        readonly waves: string
        readonly done: string
        readonly total: string
    }
    readonly nodes: readonly FlowGraphNode[]
    readonly edges: readonly FlowGraphEdge[]
    readonly headers: readonly FlowGraphLayerHeader[]
    /** The span of the node centres, so the canvas can take the graph's own aspect. */
    readonly extent: { readonly across: number; readonly along: number }
    readonly details: readonly NodeDetailView[]
}

/** Copy the connected block resolves. */
export interface WorkflowGraphBlockLabels {
    readonly title: string
    readonly statLive: string
    readonly statQueued: string
    readonly statWaves: string
    readonly statDone: string
    readonly legend: string
    readonly legendEntries: readonly ToneLabel[]
    readonly legendSide: string
    readonly empty: string
    readonly selectHint: string
    readonly member: string
    readonly side: string
    readonly deps: string
    readonly record: string
    readonly why: string
    readonly none: string
    readonly noTask: string
    readonly slot: SlotLabels
}

/** Complete input of WorkflowGraphBlockBase. */
export interface WorkflowGraphBlockBaseProps {
    readonly props: {
        readonly graph: DataSlot<WorkflowGraphView>
        readonly selectedId: string | null
        readonly labels: WorkflowGraphBlockLabels
    }
    readonly on: { readonly retry: () => void; readonly select: (id: string | null) => void }
}

/** A typical graph's span: four waves of three, so the waiting canvas takes about the height the answer will. */
const GRAPH_PLACEHOLDER: WorkflowGraphView = {
    label: " ",
    stats: { live: "", cap: "", queued: "", waves: "", done: "", total: "" },
    nodes: [],
    edges: [],
    headers: [],
    extent: { across: 600, along: 480 },
    details: [],
}

/**
 * Graph units the layout's node centres leave out: half a node on each side across, plus the lane headers on the left
 * (about 440), and half a node above and below (about 80).
 */
const GRAPH_MARGIN = { across: 440, along: 80 } as const
const GRAPH_HEIGHT = { min: 320, max: 840 } as const

/** The canvas takes the graph's own aspect at the card's width, so the fitted graph fills it at either window size. */
const graphHeight = (width: number, extent: WorkflowGraphView["extent"]): number => {
    const height = (width * (extent.along + GRAPH_MARGIN.along)) / (extent.across + GRAPH_MARGIN.across)
    return Math.round(Math.min(GRAPH_HEIGHT.max, Math.max(GRAPH_HEIGHT.min, height)))
}

const NodeDetail = ({ node, labels }: { readonly node: NodeDetailView; readonly labels: WorkflowGraphBlockLabels }) => (
    <SurfaceCard label={node.title} headingLevel={3} state={node.presentation} labelEnd={<StatusWord status={node.state} />}>
        <div className="app-stack">
            <DescriptionList
                isDivided
                items={[
                    { id: "member", term: labels.member, description: node.member },
                    { id: "side", term: labels.side, description: node.side },
                    { id: "deps", term: labels.deps, description: <KeyList keys={node.dependsOn} noneLabel={labels.none} /> },
                    { id: "record", term: labels.record, description: node.record === null ? labels.none : <Code>{node.record}</Code> },
                    ...(node.why === null ? [] : [{ id: "why", term: labels.why, description: node.why }]),
                ]}
            />
            {node.task === null ? (
                <Text size="sm" tone="muted">
                    {labels.noTask}
                </Text>
            ) : (
                <span className="app-row">
                    <Button intent="alternative" href={node.task.href}>
                        {node.task.label}
                    </Button>
                </span>
            )}
        </div>
    </SurfaceCard>
)

/** Pure half: the parallel stats, the state legend, the DAG in waves top to bottom, and the selected Op's detail. */
export const WorkflowGraphBlockBase = (props: WorkflowGraphBlockBaseProps) => {
    const { labels, selectedId } = props.props
    const [frame, frameWidth] = useInlineSize()
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView
                slot={props.props.graph}
                placeholder={GRAPH_PLACEHOLDER}
                labels={labels.slot}
                onRetry={props.on.retry}
                isEmpty={() => false}
            >
                {(graph, isSkeleton) => {
                    const selected = graph.details.find((node) => node.id === selectedId) ?? null
                    return (
                        <div className="app-stack">
                            <DescriptionList
                                layout="stat-strip"
                                isDivided
                                isLoading={isSkeleton}
                                items={[
                                    { id: "live", term: labels.statLive, description: graph.stats.live, unit: graph.stats.cap },
                                    { id: "queued", term: labels.statQueued, description: graph.stats.queued },
                                    { id: "waves", term: labels.statWaves, description: graph.stats.waves },
                                    { id: "done", term: labels.statDone, description: graph.stats.done, unit: graph.stats.total },
                                ]}
                            />
                            <ul className="app-row app-plain-list" aria-label={labels.legend}>
                                {labels.legendEntries.map((entry) => (
                                    <li key={entry.label}>
                                        <StatusDot tone={entry.tone} size="sm">
                                            {entry.label}
                                        </StatusDot>
                                    </li>
                                ))}
                                <li>
                                    <Text as="span" size="xs" tone="muted">
                                        {labels.legendSide}
                                    </Text>
                                </li>
                            </ul>
                            <div ref={frame}>
                                <FlowGraph
                                    label={graph.label}
                                    nodes={[...graph.nodes]}
                                    edges={[...graph.edges]}
                                    layout="layered"
                                    direction="TB"
                                    headers={[...graph.headers]}
                                    height={graphHeight(frameWidth, graph.extent)}
                                    selectedId={selectedId}
                                    onSelect={props.on.select}
                                    emptyLabel={labels.empty}
                                    isLoading={isSkeleton}
                                />
                            </div>
                            {selected === null ? (
                                <Text size="sm" tone="muted" isSkeleton={isSkeleton}>
                                    {labels.selectHint}
                                </Text>
                            ) : (
                                <NodeDetail node={selected} labels={labels} />
                            )}
                        </div>
                    )
                }}
            </SlotView>
        </SurfaceCard>
    )
}
