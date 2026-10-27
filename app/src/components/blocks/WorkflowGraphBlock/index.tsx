import type { GraphNode, WorkflowDetail } from "@contract"
import { layeredPositions, type FlowGraphEdge, type FlowGraphLayerHeader, type FlowGraphNode } from "@starci/grammar/core"
import { useMemo, useState } from "react"
import { useWorkflowQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { elapsedText, memberText } from "../../../modules/format"
import { COMMON, NODE_LEGEND, NODE_STATE, WORKFLOW } from "../../../modules/i18n"
import { taskPath } from "../../../modules/routes"
import { WorkflowGraphBlockBase, type NodeDetailView, type WorkflowGraphView } from "./component"

/** Input of WorkflowGraphBlock: the route's atoms. */
export interface WorkflowGraphBlockProps {
    readonly project: string
    readonly workflow: string
}

const nodeDescription = (node: GraphNode, now: number): string => {
    const parts = [node.label, NODE_STATE[node.state].label]
    if (node.member !== null) parts.push(node.member.model)
    if (node.startedAt !== null && (node.state === "running" || node.state === "verifying")) parts.push(elapsedText(node.startedAt, now))
    if (node.why !== null && node.state !== "done") parts.push(node.why)
    return parts.join(" · ")
}

const detailOf = (project: string, node: GraphNode): NodeDetailView => {
    const state = NODE_STATE[node.state]
    return {
        id: node.key,
        title: WORKFLOW.nodeTitle(node.label, node.title),
        state: { label: state.label, tone: state.tone },
        presentation: state.presentation,
        member: node.member === null ? COMMON.unassigned : memberText(node.member),
        side: node.side === null ? COMMON.shared : node.side.toUpperCase(),
        dependsOn: node.dependsOn,
        record: node.record,
        why: node.why,
        task: node.task === null ? null : { href: taskPath(project, node.task), label: `${WORKFLOW.openTask} ${node.task}` },
    }
}

const span = (values: readonly number[]) => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values))

/** The DAG in waves: a wave is a layer of the Grammar's layered layout, one more than the node's deepest dependency. */
const toView = (workflow: WorkflowDetail): WorkflowGraphView => {
    const now = Date.now()
    const keys = new Set(workflow.nodes.map((node) => node.key))
    const nodes: FlowGraphNode[] = workflow.nodes.map((node) => {
        const state = NODE_STATE[node.state]
        return {
            id: node.key,
            label: node.title,
            description: nodeDescription(node, now),
            tone: state.graphTone,
            size: "sm",
            isPlaceholder: state.isPending,
            ...(node.side === null ? {} : { count: node.side.toUpperCase() }),
            ...(node.task === null ? {} : { href: taskPath(workflow.project, node.task) }),
        }
    })
    const edges: FlowGraphEdge[] = workflow.nodes.flatMap((node) =>
        node.dependsOn
            .filter((dep) => keys.has(dep))
            .map((dep) => ({ id: `${dep}->${node.key}`, source: dep, target: node.key, isPlaceholder: NODE_STATE[node.state].isPending })),
    )
    const layout = layeredPositions(nodes, edges, "TB")
    const sizes: number[] = []
    for (const layer of layout.layers.values()) sizes[layer] = (sizes[layer] ?? 0) + 1
    const headers: FlowGraphLayerHeader[] = Array.from(sizes, (count, layer) => ({ at: layer, label: WORKFLOW.wave(layer + 1, count) }))
    const points = [...layout.positions.values()]
    const done = workflow.nodes.filter((node) => node.state === "done").length
    return {
        label: WORKFLOW.graphLabel(workflow.id, headers.length),
        stats: {
            live: String(workflow.parallel.live),
            cap: `/ ${workflow.parallel.cap}`,
            queued: String(workflow.parallel.queued),
            waves: String(headers.length),
            done: String(done),
            total: `/ ${workflow.nodes.length}`,
        },
        nodes,
        edges,
        headers,
        extent: { across: span(points.map((point) => point.x)), along: span(points.map((point) => point.y)) },
        details: workflow.nodes.map((node) => detailOf(workflow.project, node)),
    }
}

/** One workflow's graph region: stats, legend, the DAG and the selected Op. */
export const WorkflowGraphBlock = (props: WorkflowGraphBlockProps) => {
    const query = useWorkflowQuery(props.project, props.workflow)
    const slotLabels = useSlotLabels()
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const { data, error, isLoading } = query
    // The layout pass is the costly part; it re-runs only when the answer changes.
    const graph = useMemo(() => mapSlot(slotOfQuery({ data, error, isLoading }), toView), [data, error, isLoading])
    return (
        <WorkflowGraphBlockBase
            props={{
                graph,
                selectedId,
                labels: {
                    title: WORKFLOW.graphTitle,
                    statLive: WORKFLOW.statLive,
                    statQueued: WORKFLOW.statQueued,
                    statWaves: WORKFLOW.statWaves,
                    statDone: WORKFLOW.statDone,
                    legend: WORKFLOW.legend,
                    legendEntries: NODE_LEGEND,
                    legendSide: WORKFLOW.legendSide,
                    empty: WORKFLOW.graphEmpty,
                    selectHint: WORKFLOW.selectHint,
                    member: WORKFLOW.member,
                    side: WORKFLOW.side,
                    deps: WORKFLOW.deps,
                    record: WORKFLOW.record,
                    why: WORKFLOW.why,
                    none: COMMON.none,
                    noTask: WORKFLOW.noTask,
                    slot: slotLabels(WORKFLOW.notFound, WORKFLOW.notFoundHint(props.project, props.workflow)),
                },
            }}
            on={{ retry: () => void query.refetch(), select: setSelectedId }}
        />
    )
}
