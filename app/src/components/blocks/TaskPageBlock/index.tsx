import type { TaskDetail } from "@contract"
import type { ReactNode } from "react"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { elapsedText } from "../../../modules/format"
import { NODE_STATE, TASK } from "../../../modules/i18n"
import { workflowPath } from "../../../modules/routes"
import { TaskPageBlockBase, type TaskHeaderView } from "./component"

/** Input of a task block: the route's atoms. */
export interface TaskPageBlockProps {
    readonly project: string
    readonly task: string
    readonly body: ReactNode
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

/** One task's Page, its header read from the task. */
export const TaskPageBlock = (props: TaskPageBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskPageBlockBase
            props={{
                task: props.task,
                header: mapSlot(slotOfQuery(query), toView),
                labels: {
                    trail: TASK.breadcrumbs,
                    slot: slotLabels(TASK.notFound, TASK.notFoundHint(props.project, props.task)),
                },
            }}
            on={{ retry: () => void query.refetch() }} body={props.body} />
    )
}
