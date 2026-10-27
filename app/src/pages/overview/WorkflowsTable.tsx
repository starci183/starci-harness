import { QueueListIcon } from "@heroicons/react/24/outline"
import { Badge, DataTable, type DataTableColumn, EmptyNotice, Progress, StatusDot, SurfaceCard, Text } from "@starci/grammar/core"
import type { WorkflowRow } from "@contract"
import { AWAITING_DECISION, COMMON, OVERVIEW, WORKFLOW_STATUS } from "../../app/labels"
import { progressPercent, workflowPath } from "./format"

/** The table keys rows by `project/workflow`, since a workflow id is unique only inside its project; a row opens its workflow. */
interface TableRow {
    readonly id: string
    readonly href: string
    readonly workflow: WorkflowRow
}

/** Below the width all six columns need, the `low` columns fold under the workflow cell as stacked secondary lines. */
const COLLAPSE_BELOW = 900

const COLUMNS: readonly DataTableColumn<TableRow>[] = [
    { id: "workflow", label: OVERVIEW.columns.workflow, isRowHeader: true },
    { id: "project", label: OVERVIEW.columns.project, priority: "low" },
    { id: "status", label: OVERVIEW.columns.status },
    { id: "progress", label: OVERVIEW.columns.progress },
    { id: "live", label: OVERVIEW.columns.live, align: "end", priority: "low" },
    { id: "kernel", label: OVERVIEW.columns.kernel, priority: "low" },
]

const StatusCell = ({ row }: { readonly row: WorkflowRow }) => {
    const status = WORKFLOW_STATUS[row.status]
    return (
        <div className="app-pair">
            <span className="app-row">
                <StatusDot tone={status.tone} size="sm">
                    {status.label}
                </StatusDot>
                {row.awaitingOwner ? <Badge tone={AWAITING_DECISION.tone}>{AWAITING_DECISION.label}</Badge> : null}
            </span>
            {row.reason === null ? null : (
                <Text size="xs" tone="muted" overflow="truncate">
                    {row.reason}
                </Text>
            )}
        </div>
    )
}

const Cell = ({ row, columnId }: { readonly row: WorkflowRow; readonly columnId: string }) => {
    switch (columnId) {
        case "workflow":
            return (
                <div className="app-pair">
                    <Text size="sm" weight="medium" mono>
                        {row.id}
                    </Text>
                    <Text size="xs" tone="muted" overflow="truncate">
                        {row.goalSummary}
                    </Text>
                </div>
            )
        case "project":
            return <Text size="sm" mono>{row.project}</Text>
        case "status":
            return <StatusCell row={row} />
        case "progress":
            return (
                <span className="app-row">
                    <span className="app-cell-progress">
                        <Progress
                            label={OVERVIEW.progressLabel(row.id)}
                            value={progressPercent(row)}
                            valueText={OVERVIEW.progressValue(row.done, row.total)}
                        />
                    </span>
                    <Text size="xs" tone="muted" tabular>{`${row.done}/${row.total}`}</Text>
                </span>
            )
        case "live":
            return <Text size="sm" tabular>{row.status === "defined" ? COMMON.dash : `${row.liveOps} / ${row.parallelCap}`}</Text>
        case "kernel":
            return (
                <Text size="xs" tone="muted" mono>
                    {row.kernel === null ? COMMON.dash : row.kernel.model}
                </Text>
            )
        default:
            return null
    }
}

interface WorkflowsTableProps {
    readonly workflows: readonly WorkflowRow[]
    readonly isLoading: boolean
}

/** Every workflow of every project; a row opens its detail screen. */
export const WorkflowsTable = ({ workflows, isLoading }: WorkflowsTableProps) => {
    const rows: readonly TableRow[] = workflows.map(workflow => ({ id: `${workflow.project}/${workflow.id}`, href: workflowPath(workflow), workflow }))
    return (
        <SurfaceCard label={OVERVIEW.workflowsTitle} headingLevel={2} fact={OVERVIEW.workflowsFact}>
            <DataTable<TableRow>
                label={OVERVIEW.workflowsTitle}
                columns={COLUMNS}
                rows={rows}
                renderCell={(row, columnId) => <Cell row={row.workflow} columnId={columnId} />}
                isLoading={isLoading}
                loadingRows={4}
                collapseBelow={COLLAPSE_BELOW}
                emptyContent={<EmptyNotice iconSource={QueueListIcon} message={OVERVIEW.noWorkflows} description={OVERVIEW.noWorkflowsHint} />}
            />
        </SurfaceCard>
    )
}
