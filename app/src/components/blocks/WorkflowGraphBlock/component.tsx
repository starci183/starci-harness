import { Badge, EmptyNotice, Section, SurfaceCard, Text, type PresentationState } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One Op cell of a wave, resolved for drawing. */
export interface WaveCellView {
    readonly id: string
    readonly title: string
    readonly description: string
    readonly state: ToneLabel
    readonly presentation: PresentationState
    /** The Op's task page; null while the Op has no task yet. */
    readonly taskHref: string | null
}

/** One wave of the graph: the Ops that become ready once the previous waves are done. */
export interface WaveView {
    readonly id: string
    readonly label: string
    readonly cells: readonly WaveCellView[]
}

/** The graph in waves, resolved for drawing. */
export interface WorkflowGraphView {
    readonly stats: {
        readonly live: string
        readonly cap: string
        readonly queued: string
        readonly waves: string
        readonly done: string
        readonly total: string
    }
    readonly waves: readonly WaveView[]
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
    readonly openTask: string
    readonly slot: SlotLabels
}

/** Complete input of WorkflowGraphBlockBase. */
export interface WorkflowGraphBlockBaseProps {
    readonly props: {
        readonly graph: DataSlot<WorkflowGraphView>
        readonly labels: WorkflowGraphBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

/** A typical graph: three waves of three cells, so the waiting region takes about the height the answer will. */
const GRAPH_PLACEHOLDER: WorkflowGraphView = {
    stats: { live: "", cap: "", queued: "", waves: "", done: "", total: "" },
    waves: ["w0", "w1", "w2"].map((id) => ({
        id,
        label: " ",
        cells: ["c0", "c1", "c2"].map((cell) => ({
            id: `${id}-${cell}`,
            title: " ",
            description: " ",
            state: { label: " ", tone: "neutral" },
            presentation: "neutral",
            taskHref: null,
        })),
    })),
}

/** Pure half: the parallel stats, the state legend, then the DAG as wave columns of Op cells. */
export const WorkflowGraphBlockBase = (props: WorkflowGraphBlockBaseProps) => {
    const { labels } = props.props
    return (
        <Section title={labels.title}>
            <SlotView slot={props.props.graph} placeholder={GRAPH_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry} isEmpty={() => false} render={(graph, isSkeleton) => (
                    <div className="app-stack">
                        <SurfaceCard
                            kind="figures"
                            ariaLabel={labels.title}
                            isSkeleton={isSkeleton}
                            items={[
                                { id: "live", term: labels.statLive, value: graph.stats.live, unit: graph.stats.cap },
                                { id: "queued", term: labels.statQueued, value: graph.stats.queued },
                                { id: "waves", term: labels.statWaves, value: graph.stats.waves },
                                { id: "done", term: labels.statDone, value: graph.stats.done, unit: graph.stats.total },
                            ]}
                        />
                        <ul className="app-row app-plain-list" aria-label={labels.legend}>
                            {labels.legendEntries.map((entry) => (
                                <li key={entry.label}>
                                    <Badge isDot tone={entry.tone}>
                                        {entry.label}
                                    </Badge>
                                </li>
                            ))}
                            <li>
                                <Text as="span" size="xs" tone="muted">
                                    {labels.legendSide}
                                </Text>
                            </li>
                        </ul>
                        {graph.waves.length === 0 ? (
                            <EmptyNotice message={labels.empty} />
                        ) : (
                            <div className="app-stack">
                                {graph.waves.map((wave) => (
                                    <SurfaceCard
                                        key={wave.id}
                                        kind="list"
                                        label={wave.label}
                                        headingLevel={3}
                                        isSkeleton={isSkeleton}
                                        empty={<EmptyNotice message={labels.empty} />}
                                        items={wave.cells.map((cell) => ({
                                            id: cell.id,
                                            state: cell.presentation,
                                            title: cell.title,
                                            description: cell.description,
                                            badges: [{ label: cell.state.label, tone: cell.state.tone, isDot: true }],
                                            ...(cell.taskHref === null ? {} : { action: { label: labels.openTask, href: cell.taskHref } }),
                                        }))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )} />
        </Section>
    )
}
