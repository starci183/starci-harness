import { Badge, DataTable, EmptyNotice, Progress, SurfaceCard, Text, type DataTableColumn } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/** One workflow row, resolved for drawing; a row opens its workflow. */
export interface WorkflowRowView {
    /** `project/workflow`: a workflow id is unique only inside its project. */
    readonly id: string
    readonly href: string
    readonly workflow: string
    readonly goalSummary: string
    readonly project: string
    readonly status: ToneLabel
    /** The flag a workflow carries while an owner decision on it is open. */
    readonly awaiting: ToneLabel | null
    readonly progressLabel: string
    readonly progress: number
    readonly progressText: string
    readonly fraction: string
    readonly live: string
    readonly kernel: string
}

/** Copy the connected block resolves. */
export interface WorkflowsTableBlockLabels {
    readonly title: string
    readonly fact: string
    readonly columns: {
        readonly workflow: string
        readonly project: string
        readonly status: string
        readonly progress: string
        readonly live: string
        readonly kernel: string
    }
    readonly slot: SlotLabels
}

/** Complete input of WorkflowsTableBlockBase. */
export interface WorkflowsTableBlockBaseProps {
    readonly props: {
        readonly rows: DataSlot<readonly WorkflowRowView[]>
        readonly labels: WorkflowsTableBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

/** Below the width all six columns need, the `low` columns fold under the workflow cell as stacked secondary lines. */
const COLLAPSE_BELOW = 900

const ROWS_PLACEHOLDER: readonly WorkflowRowView[] = ["r0", "r1", "r2", "r3"].map((id) => ({
    id,
    href: "/",
    workflow: "",
    goalSummary: "",
    project: "",
    status: { label: "", tone: "neutral" },
    awaiting: null,
    progressLabel: id,
    progress: 0,
    progressText: "",
    fraction: "",
    live: "",
    kernel: "",
}))

const Cell = ({ row, columnId }: { readonly row: WorkflowRowView; readonly columnId: string }) => {
    switch (columnId) {
        case "workflow":
            return (
                <div className="app-pair">
                    <Text size="sm" weight="medium" mono>
                        {row.workflow}
                    </Text>
                    <Text size="xs" tone="muted" overflow="truncate">
                        {row.goalSummary}
                    </Text>
                </div>
            )
        case "project":
            return (
                <Text size="sm" mono>
                    {row.project}
                </Text>
            )
        case "status":
            return (
                <span className="app-row">
                    <StatusWord status={row.status} />
                    {row.awaiting === null ? null : <Badge tone={row.awaiting.tone}>{row.awaiting.label}</Badge>}
                </span>
            )
        case "progress":
            return (
                <span className="app-row">
                    <span className="app-cell-progress">
                        <Progress label={row.progressLabel} value={row.progress} valueText={row.progressText} />
                    </span>
                    <Text size="xs" tone="muted" tabular>
                        {row.fraction}
                    </Text>
                </span>
            )
        case "live":
            return (
                <Text size="sm" tabular>
                    {row.live}
                </Text>
            )
        case "kernel":
            return (
                <Text size="xs" tone="muted" mono>
                    {row.kernel}
                </Text>
            )
        default:
            return null
    }
}

/** Pure half: every workflow of every project; a row opens its detail screen. */
export const WorkflowsTableBlockBase = (props: WorkflowsTableBlockBaseProps) => {
    const { labels } = props.props
    const columns: readonly DataTableColumn<WorkflowRowView>[] = [
        { id: "workflow", label: labels.columns.workflow, isRowHeader: true },
        { id: "project", label: labels.columns.project, priority: "low" },
        { id: "status", label: labels.columns.status },
        { id: "progress", label: labels.columns.progress },
        { id: "live", label: labels.columns.live, align: "end", priority: "low" },
        { id: "kernel", label: labels.columns.kernel, priority: "low" },
    ]
    return (
        <SurfaceCard label={labels.title} headingLevel={2} fact={labels.fact}>
            <SlotView slot={props.props.rows} placeholder={ROWS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(rows, isSkeleton) => (
                    <DataTable<WorkflowRowView>
                        label={labels.title}
                        columns={columns}
                        rows={rows}
                        renderCell={(row, columnId) => <Cell row={row} columnId={columnId} />}
                        // The slot says empty before the table could; the table still names its own empty content.
                        emptyContent={<EmptyNotice message={labels.slot.empty} />}
                        isLoading={isSkeleton}
                        loadingRows={rows.length}
                        collapseBelow={COLLAPSE_BELOW}
                    />
                )}
            </SlotView>
        </SurfaceCard>
    )
}
