import {
    Alert,
    AlertDialog,
    Avatar,
    Breadcrumbs,
    Button,
    Code,
    DescriptionList,
    Dialog,
    EmptyNotice,
    FencedCodeBlock,
    FlowGraph,
    Icon,
    ListRow,
    RadioGroup,
    SectionHeader,
    StatusDot,
    SurfaceCard,
    SurfaceListCard,
    Text,
    Textarea,
    layeredPositions,
    type FlowGraphEdge,
    type FlowGraphLayerHeader,
    type FlowGraphNode,
} from "@starci/grammar/core"
import { ExclamationTriangleIcon, RectangleGroupIcon } from "@heroicons/react/24/outline"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router"
import { useAction, useWorkflow, type ActionRequest } from "../../api/client"
import type { ActionResult, GraphNode, WorkflowDetail } from "@contract"
import { COMMON, NAV, NODE_LEGEND, NODE_STATE, SEAT_LIVENESS, SEAT_ROLE, WORKFLOW, WORKFLOW_STATUS } from "../../app/labels"
import { KeyList } from "../../app/KeyList"
import { elapsedText, memberText, taskPath } from "./state"

/** Where this workflow sits: the overview, its project, the workflow. */
const Trail = ({ project, workflow }: { readonly project: string; readonly workflow: string }) => (
    <Breadcrumbs
        label={WORKFLOW.breadcrumbs}
        items={[
            { id: "overview", label: NAV.overview, href: "/" },
            { id: "project", label: project },
            { id: "workflow", label: workflow },
        ]}
    />
)

type WorkflowVerb = "pause" | "resume" | "stop-graceful" | "stop-hard"

/** Route `/w/:project/:workflow`: one workflow's header, its DAG in waves top to bottom, the flow check and the seats. */
export const WorkflowPage = () => {
    const params = useParams()
    const project = params["project"] ?? ""
    const id = params["workflow"] ?? ""
    const { data, isLoading, error } = useWorkflow(project, id)
    const trail = <Trail project={project} workflow={id} />

    if (error !== null) {
        return (
            <div className="app-page-stack">
                <div className="app-pair">
                    {trail}
                    <SectionHeader level={1} title={id} />
                </div>
                <Alert tone="negative" title={WORKFLOW.loadError} description={error.message} />
            </div>
        )
    }
    if (isLoading) {
        return (
            <div className="app-page-stack" aria-busy="true">
                <div className="app-pair">
                    {trail}
                    <SectionHeader level={1} title={id} description={COMMON.dash} isSkeleton />
                </div>
                <FlowGraph label={WORKFLOW.graphTitle} nodes={[]} edges={[]} direction="TB" height="lg" isLoading />
            </div>
        )
    }
    if (data === undefined) {
        return (
            <div className="app-page-stack">
                <div className="app-pair">
                    {trail}
                    <SectionHeader level={1} title={id} />
                </div>
                <EmptyNotice iconSource={RectangleGroupIcon} message={WORKFLOW.notFound} description={WORKFLOW.notFoundHint(project, id)} />
            </div>
        )
    }
    return <WorkflowView workflow={data} />
}

const WorkflowView = ({ workflow }: { readonly workflow: WorkflowDetail }) => {
    const done = workflow.nodes.filter((node) => node.state === "done").length
    const status = WORKFLOW_STATUS[workflow.status]
    const [result, setResult] = useState<{ readonly n: number; readonly value: ActionResult } | null>(null)
    const report = (value: ActionResult) => setResult((previous) => ({ n: (previous?.n ?? 0) + 1, value }))

    return (
        <div className="app-page-stack">
            <div className="app-pair">
                <Trail project={workflow.project} workflow={workflow.id} />
                <SectionHeader
                    level={1}
                    title={workflow.id}
                    description={
                        <span className="app-row">
                            <StatusDot tone={status.tone} size="sm">
                                {status.label}
                            </StatusDot>
                            <Text as="span" size="sm" tone="muted">
                                {WORKFLOW.versions(workflow.goal.version, workflow.graphVersion, done, workflow.nodes.length)}
                            </Text>
                        </span>
                    }
                    action={<WorkflowActions workflow={workflow} onResult={report} />}
                />
                <Text as="p">{workflow.goal.text}</Text>
            </div>
            {workflow.reason === null ? null : <Alert tone="cautionary" title={WORKFLOW.reason} description={workflow.reason} />}
            {result === null ? null : (
                <Alert
                    key={result.n}
                    tone={result.value.ok ? "affirmative" : "negative"}
                    title={result.value.ok ? WORKFLOW.sent : WORKFLOW.refused}
                    description={result.value.code === null ? result.value.message : `${result.value.code}: ${result.value.message}`}
                    dismissLabel={COMMON.dismissNotice}
                />
            )}
            <WaveGraph workflow={workflow} />
            <div className="app-grid-2">
                <FlowPanel workflow={workflow} />
                <SeatsPanel workflow={workflow} />
            </div>
        </div>
    )
}

const WorkflowActions = ({ workflow, onResult }: { readonly workflow: WorkflowDetail; readonly onResult: (result: ActionResult) => void }) => {
    const { mutateAsync, isPending } = useAction()
    const [stopMode, setStopMode] = useState<"stop-graceful" | "stop-hard">("stop-graceful")
    const [goal, setGoal] = useState(workflow.goal.text)
    /** A refused verb resolves `ok: false`; a transport failure is reported the same way, never thrown at the page. */
    const send = async (request: ActionRequest): Promise<ActionResult> => {
        const result = await mutateAsync(request).catch(
            (error: unknown): ActionResult => ({ ok: false, code: null, message: error instanceof Error ? error.message : String(error) }),
        )
        onResult(result)
        return result
    }
    const run = (verb: WorkflowVerb): Promise<ActionResult> =>
        send({ kind: "workflow", project: workflow.project, workflow: workflow.id, action: verb })
    const isFinished = workflow.status === "stopped" || workflow.status === "done" || workflow.status === "stopping"
    const isPaused = workflow.status === "paused"

    return (
        <span className="app-row">
            <Dialog
                title={WORKFLOW.changeGoal}
                description={WORKFLOW.changeGoalHint(workflow.goal.version)}
                closeLabel={COMMON.close}
                trigger={
                    <Button intent="neutral" isDisabled={isFinished}>
                        {WORKFLOW.changeGoal}
                    </Button>
                }
                footer={(close) => (
                    <Button
                        intent="commit"
                        isPending={isPending}
                        isDisabled={goal.trim() === "" || goal.trim() === workflow.goal.text}
                        onPress={() => {
                            void send({ kind: "goal", project: workflow.project, workflow: workflow.id, text: goal.trim() }).then((result) => {
                                if (result.ok) close()
                            })
                        }}
                    >
                        {WORKFLOW.saveGoal}
                    </Button>
                )}
            >
                <Textarea label={WORKFLOW.goalField} rows={5} value={goal} onValueChange={setGoal} isRequired />
            </Dialog>
            <Button intent="neutral" isPending={isPending} isDisabled={isFinished} onPress={() => void run(isPaused ? "resume" : "pause")}>
                {isPaused ? WORKFLOW.resume : WORKFLOW.pause}
            </Button>
            <AlertDialog
                title={WORKFLOW.stopTitle}
                description={WORKFLOW.stopBody}
                confirmLabel={WORKFLOW.stopConfirm}
                cancelLabel={COMMON.cancel}
                trigger={
                    <Button intent="destructive" step="entry" isDisabled={isFinished}>
                        {WORKFLOW.stop}
                    </Button>
                }
                onConfirm={async () => {
                    const result = await run(stopMode)
                    if (!result.ok) throw new Error(result.message)
                }}
            >
                <RadioGroup
                    label={WORKFLOW.stopMode}
                    value={stopMode}
                    onValueChange={(value) => setStopMode(value === "stop-hard" ? "stop-hard" : "stop-graceful")}
                    options={[
                        { value: "stop-graceful", label: WORKFLOW.stopGraceful, description: WORKFLOW.stopGracefulHint },
                        { value: "stop-hard", label: WORKFLOW.stopHard, description: WORKFLOW.stopHardHint },
                    ]}
                />
            </AlertDialog>
        </span>
    )
}

const nodeDescription = (node: GraphNode, now: number): string => {
    const state = NODE_STATE[node.state]
    const parts = [node.label, state.label]
    if (node.member !== null) parts.push(node.member.model)
    if (node.startedAt !== null && (node.state === "running" || node.state === "verifying")) parts.push(elapsedText(node.startedAt, now))
    if (node.why !== null && node.state !== "done") parts.push(node.why)
    return parts.join(" · ")
}

/**
 * Graph units the layout's node centres leave out: half a node on each side across, plus the lane headers on the left
 * (about 440), and half a node above and below (about 80).
 */
const GRAPH_MARGIN = { across: 440, along: 80 } as const
const GRAPH_HEIGHT = { min: 320, max: 840 } as const

/**
 * The canvas takes the graph's own aspect at the card's width, so the fitted graph fills it at either window size
 * instead of floating in empty space above and below.
 */
const graphHeight = (width: number, extent: { readonly across: number; readonly along: number }): number => {
    const height = (width * (extent.along + GRAPH_MARGIN.along)) / (extent.across + GRAPH_MARGIN.across)
    return Math.round(Math.min(GRAPH_HEIGHT.max, Math.max(GRAPH_HEIGHT.min, height)))
}

/** The inline size of an element, followed as it resizes. */
const useInlineSize = (): readonly [(element: HTMLDivElement | null) => void, number] => {
    const [size, setSize] = useState(0)
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    useEffect(() => {
        if (element === null) return
        const observer = new ResizeObserver(([entry]) => setSize(entry?.contentRect.width ?? 0))
        observer.observe(element)
        return () => observer.disconnect()
    }, [element])
    return [setElement, size]
}

const WaveGraph = ({ workflow }: { readonly workflow: WorkflowDetail }) => {
    const [selected, setSelected] = useState<string | null>(null)
    const [frame, frameWidth] = useInlineSize()
    const { headers, nodes, edges, extent } = useMemo(() => {
        const now = Date.now()
        const keys = new Set(workflow.nodes.map((node) => node.key))
        const graphNodes: FlowGraphNode[] = workflow.nodes.map((node) => {
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
        const graphEdges: FlowGraphEdge[] = workflow.nodes.flatMap((node) =>
            node.dependsOn
                .filter((dep) => keys.has(dep))
                .map((dep) => ({
                    id: `${dep}->${node.key}`,
                    source: dep,
                    target: node.key,
                    isPlaceholder: NODE_STATE[node.state].isPending,
                })),
        )
        // A wave is a layer of the Grammar's layered layout: one more than the node's deepest dependency.
        const layout = layeredPositions(graphNodes, graphEdges, "TB")
        const sizes: number[] = []
        for (const layer of layout.layers.values()) sizes[layer] = (sizes[layer] ?? 0) + 1
        const layerHeaders: FlowGraphLayerHeader[] = Array.from(sizes, (count, layer) => ({ at: layer, label: WORKFLOW.wave(layer + 1, count) }))
        const points = [...layout.positions.values()]
        const span = (values: readonly number[]) => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values))
        const graphExtent = { across: span(points.map((point) => point.x)), along: span(points.map((point) => point.y)) }
        return { headers: layerHeaders, nodes: graphNodes, edges: graphEdges, extent: graphExtent }
    }, [workflow.nodes, workflow.project])
    const selectedNode = workflow.nodes.find((node) => node.key === selected) ?? null
    const done = workflow.nodes.filter((node) => node.state === "done").length

    return (
        <SurfaceCard label={WORKFLOW.graphTitle} headingLevel={2}>
            <div className="app-stack">
                <DescriptionList
                    layout="stat-strip"
                    isDivided
                    items={[
                        { id: "live", term: WORKFLOW.statLive, description: String(workflow.parallel.live), unit: `/ ${workflow.parallel.cap}` },
                        { id: "queued", term: WORKFLOW.statQueued, description: String(workflow.parallel.queued) },
                        { id: "waves", term: WORKFLOW.statWaves, description: String(headers.length) },
                        { id: "done", term: WORKFLOW.statDone, description: String(done), unit: `/ ${workflow.nodes.length}` },
                    ]}
                />
                <ul className="app-row app-plain-list" aria-label={WORKFLOW.legend}>
                    {NODE_LEGEND.map((entry) => (
                        <li key={entry.label}>
                            <StatusDot tone={entry.tone} size="sm">
                                {entry.label}
                            </StatusDot>
                        </li>
                    ))}
                    <li>
                        <Text as="span" size="xs" tone="muted">
                            {WORKFLOW.legendSide}
                        </Text>
                    </li>
                </ul>
                <div ref={frame}>
                    <FlowGraph
                        label={WORKFLOW.graphLabel(workflow.id, headers.length)}
                        nodes={nodes}
                        edges={edges}
                        layout="layered"
                        direction="TB"
                        headers={headers}
                        height={graphHeight(frameWidth, extent)}
                        selectedId={selected}
                        onSelect={setSelected}
                        emptyLabel={WORKFLOW.graphEmpty}
                    />
                </div>
                {selectedNode === null ? (
                    <Text size="sm" tone="muted">
                        {WORKFLOW.selectHint}
                    </Text>
                ) : (
                    <NodeDetail node={selectedNode} project={workflow.project} />
                )}
            </div>
        </SurfaceCard>
    )
}

const NodeDetail = ({ node, project }: { readonly node: GraphNode; readonly project: string }) => {
    const state = NODE_STATE[node.state]
    const task = node.task
    return (
        <SurfaceCard
            label={WORKFLOW.nodeTitle(node.label, node.title)}
            headingLevel={3}
            state={state.presentation}
            labelEnd={
                <StatusDot tone={state.tone} size="sm">
                    {state.label}
                </StatusDot>
            }
        >
            <div className="app-stack">
                <DescriptionList
                    isDivided
                    items={[
                        { id: "member", term: WORKFLOW.member, description: node.member === null ? COMMON.unassigned : memberText(node.member) },
                        { id: "side", term: WORKFLOW.side, description: node.side === null ? COMMON.shared : node.side.toUpperCase() },
                        { id: "deps", term: WORKFLOW.deps, description: <KeyList keys={node.dependsOn} /> },
                        { id: "record", term: WORKFLOW.record, description: node.record === null ? COMMON.none : <Code>{node.record}</Code> },
                        ...(node.why === null ? [] : [{ id: "why", term: WORKFLOW.why, description: node.why }]),
                    ]}
                />
                {task === null ? (
                    <Text size="sm" tone="muted">
                        {WORKFLOW.noTask}
                    </Text>
                ) : (
                    <span className="app-row">
                        <Button intent="alternative" href={taskPath(project, task)}>
                            {`${WORKFLOW.openTask} ${task}`}
                        </Button>
                    </span>
                )}
            </div>
        </SurfaceCard>
    )
}

const FlowPanel = ({ workflow }: { readonly workflow: WorkflowDetail }) => (
    <SurfaceCard label={WORKFLOW.flowTitle} headingLevel={2}>
        <div className="app-stack">
            {workflow.flow.length === 0 ? (
                <Text size="sm" tone="muted">
                    {WORKFLOW.noLanes}
                </Text>
            ) : (
                <FencedCodeBlock label={WORKFLOW.flowCode} code={workflow.flow.join("\n")} />
            )}
            {workflow.flowProblems.length === 0 ? (
                <Alert tone="affirmative" appearance="soft" title={WORKFLOW.flowClean} description={WORKFLOW.flowCleanHint} />
            ) : (
                <SurfaceListCard label={WORKFLOW.flowProblems(workflow.flowProblems.length)} headingLevel={3} depth="nested">
                    {workflow.flowProblems.map((problem) => (
                        <ListRow key={problem} title={problem} state="negative" leading={<Icon source={ExclamationTriangleIcon} usage="leading" />} />
                    ))}
                </SurfaceListCard>
            )}
        </div>
    </SurfaceCard>
)

const SeatsPanel = ({ workflow }: { readonly workflow: WorkflowDetail }) => {
    return (
        <SurfaceListCard
            label={WORKFLOW.seatsTitle}
            headingLevel={2}
            labelEnd={
                <Text as="span" size="sm" tone="muted">
                    {String(workflow.seats.length)}
                </Text>
            }
            empty={<EmptyNotice message={WORKFLOW.noSeats} />}
        >
            {workflow.seats.map((seat) => {
                const liveness = SEAT_LIVENESS[seat.liveness]
                const task = seat.task
                return (
                    <ListRow
                        key={seat.id}
                        leading={<Avatar name={seat.member.model} seed={seat.member.model} kind="agent" size="sm" isDecorative />}
                        title={`${SEAT_ROLE[seat.role]} · ${seat.title.replace(/^\[[^\]]+\]\s*/, "")}`}
                        description={memberText(seat.member)}
                        badges={
                            <StatusDot tone={liveness.tone} size="sm">
                                {liveness.label}
                            </StatusDot>
                        }
                        actions={
                            task === null ? undefined : (
                                <Button intent="neutral" size="sm" href={taskPath(workflow.project, task)}>
                                    {WORKFLOW.openTask}
                                </Button>
                            )
                        }
                    />
                )
            })}
        </SurfaceListCard>
    )
}
