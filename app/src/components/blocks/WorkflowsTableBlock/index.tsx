import type { Overview, WorkflowRow } from "@contract"
import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { progressPercent } from "../../../modules/format"
import { AWAITING_DECISION, COMMON, OVERVIEW, WORKFLOW_STATUS } from "../../../modules/i18n"
import { workflowPath } from "../../../modules/routes"
import { WorkflowsTableBlockBase, type WorkflowRowView } from "./component"

const toView = (row: WorkflowRow): WorkflowRowView => ({
    id: `${row.project}/${row.id}`,
    href: workflowPath(row.project, row.id),
    workflow: row.id,
    goalSummary: row.goalSummary,
    project: row.project,
    status: WORKFLOW_STATUS[row.status],
    awaiting: row.awaitingOwner ? AWAITING_DECISION : null,
    reason: row.reason,
    progressLabel: OVERVIEW.progressLabel(row.id),
    progress: progressPercent(row),
    progressText: OVERVIEW.progressValue(row.done, row.total),
    fraction: `${row.done}/${row.total}`,
    live: row.status === "defined" ? COMMON.dash : `${row.liveOps} / ${row.parallelCap}`,
    kernel: row.kernel === null ? COMMON.dash : row.kernel.model,
})

/** The workflows region of the overview. */
export const WorkflowsTableBlock = () => {
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    return (
        <WorkflowsTableBlockBase
            props={{
                rows: mapSlot(slotOfQuery(query), (overview: Overview) => overview.workflows.map(toView)),
                labels: {
                    title: OVERVIEW.workflowsTitle,
                    fact: OVERVIEW.workflowsFact,
                    columns: OVERVIEW.columns,
                    slot: slotLabels(OVERVIEW.noWorkflows, OVERVIEW.noWorkflowsHint),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
