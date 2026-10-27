import type { TaskDetail } from "@contract"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { CHECK_STATE, COMMON, TASK } from "../../../modules/i18n"
import { TaskChecksBlockBase, type CheckView } from "./component"

/** Input of TaskChecksBlock: the route's atoms. */
export interface TaskChecksBlockProps {
    readonly project: string
    readonly task: string
}

const toViews = (task: TaskDetail): readonly CheckView[] =>
    task.checks.map((check, index) => ({
        id: `${index}-${check.name}`,
        name: check.name,
        tier: check.tier,
        state: CHECK_STATE[check.state],
        detail: check.detail ?? COMMON.dash,
    }))

/** One task's checks. */
export const TaskChecksBlock = (props: TaskChecksBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskChecksBlockBase
            props={{
                checks: mapSlot(slotOfQuery(query), toViews),
                labels: { title: TASK.checks, table: TASK.checksTable, columns: TASK.checkColumns, slot: slotLabels(TASK.noChecks) },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
