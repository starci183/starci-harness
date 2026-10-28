import type { GraphNode, WorkflowDetail } from "@contract"
import { layeredPositions, type FlowGraphEdge, type FlowGraphNode } from "@starci/grammar/core"
import { useMemo } from "react"
import { useWorkflowQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { elapsedText, memberText } from "../../../modules/format"
import { NODE_LEGEND, NODE_STATE, WORKFLOW } from "../../../modules/i18n"
import { taskPath } from "../../../modules/routes"
import { WorkflowGraphBlockBase, type WaveCellView, type WaveView, type WorkflowGraphView } from "./component"

/** Input of WorkflowGraphBlock: the route's atoms. */
export interface WorkflowGraphBlockProps {
    readonly project: string
    readonly workflow: string
}

const cellDescription = (node: GraphNode, now: number): string => {
    const parts = [node.label, NODE_STATE[node.state].label]
    if (node.member !== null) parts.push(memberText(node.member))
    if (node.startedAt !== null && (node.state === "running" || node.state === "verifying")) parts.push(elapsedText(node.startedAt, now))
    if (node.why !== null && node.state !== "done") parts.push(node.why)
    return parts.join(" · ")
}

const cellOf = (project: string, node: GraphNode, now: number): WaveCellView => {
    const state = NODE_STATE[node.state]
    return {
        id: node.key,
        title: node.title,
        description: cellDescription(node, now),
        state: { label: state.label, tone: state.tone },
        presentation: state.presentation,
        taskHref: node.task === null ? null : taskPath(project, node.task),
    }
}

/** The DAG in waves: a wave is a layer of the Grammar's layered layout, one more than the node's deepest dependency. */
const toView = (workflow: WorkflowDetail): WorkflowGraphView => {
    const now = Date.now()
    const keys = new Set(workflow.nodes.map((node) => node.key))
    const nodes: FlowGraphNode[] = workflow.nodes.map((node) => ({ id: node.key, label: node.title }))
    const edges: FlowGraphEdge[] = workflow.nodes.flatMap((node) =>
        node.dependsOn.filter((dep) => keys.has(dep)).map((dep) => ({ id: `${dep}->${node.key}`, source: dep, target: node.key })),
    )
    const layers = layeredPositions(nodes, edges, "TB").layers
    const cells: WaveCellView[][] = []
    for (const node of workflow.nodes) {
        const layer = layers.get(node.key) ?? 0
        const wave = cells[layer] ?? []
        wave.push(cellOf(workflow.project, node, now))
        cells[layer] = wave
    }
    const waves: WaveView[] = cells.flatMap((wave, layer) => (wave.length === 0 ? [] : [{ id: `wave-${layer}`, label: WORKFLOW.wave(layer + 1, wave.length), cells: wave }]))
    const done = workflow.nodes.filter((node) => node.state === "done").length
    return {
        stats: {
            live: String(workflow.parallel.live),
            cap: `/ ${workflow.parallel.cap}`,
            queued: String(workflow.parallel.queued),
            waves: String(waves.length),
            done: String(done),
            total: `/ ${workflow.nodes.length}`,
        },
        waves,
    }
}

/** One workflow's graph region: stats, legend and the waves of Op cells. */
export const WorkflowGraphBlock = (props: WorkflowGraphBlockProps) => {
    const query = useWorkflowQuery(props.project, props.workflow)
    const slotLabels = useSlotLabels()
    const { data, error, isLoading } = query
    // The layout pass is the costly part; it re-runs only when the answer changes.
    const graph = useMemo(() => mapSlot(slotOfQuery({ data, error, isLoading }), toView), [data, error, isLoading])
    return (
        <WorkflowGraphBlockBase
            props={{
                graph,
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
                    openTask: WORKFLOW.openTask,
                    slot: slotLabels(WORKFLOW.notFound, WORKFLOW.notFoundHint(props.project, props.workflow)),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
