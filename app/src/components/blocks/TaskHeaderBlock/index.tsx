import type { TaskDetail } from "@contract"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { elapsedText } from "../../../modules/format"
import { NODE_STATE, TASK } from "../../../modules/i18n"
import { workflowPath } from "../../../modules/routes"
import { TaskHeaderBlockBase, type TaskHeaderView } from "./component"

/** Input of a task block: the route's atoms. */
export interface TaskHeaderBlockProps {
    readonly project: string
    readonly task: string
}

const toView = (task: TaskDetail): TaskHeaderView => {
    const latest = task.attempts.at(-1)
    const isLive = task.state === "running" || task.state === "verifying"
    return {
        workflow: task.workflow,
        workflowHref: workflowPath(task.project, task.workflow),
        title: TASK.title(task.label, task.title),
        state: NODE_STATE[task.state],
        elapsed: isLive && latest !== undefined ? elapsedText(latest.at) : null,
    }
}

/** One task's header. */
export const TaskHeaderBlock = (props: TaskHeaderBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskHeaderBlockBase
            props={{
                task: props.task,
                header: mapSlot(slotOfQuery(query), toView),
                labels: {
                    trail: TASK.breadcrumbs,
                    slot: slotLabels(TASK.notFound, TASK.notFoundHint(props.project, props.task)),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
