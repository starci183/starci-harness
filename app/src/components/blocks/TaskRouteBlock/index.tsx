import type { TaskDetail } from "@contract"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { COMMON, TASK } from "../../../modules/i18n"
import { TaskRouteBlockBase, type TaskRouteView } from "./component"

/** Input of TaskRouteBlock: the route's atoms. */
export interface TaskRouteBlockProps {
    readonly project: string
    readonly task: string
}

const toView = (task: TaskDetail): TaskRouteView => ({
    steps: task.route.steps.map((step, index) => ({ id: `${index}-${step.step}`, step: step.step, detail: step.detail })),
    model: `${task.route.chosen.agent} · ${task.route.chosen.model}`,
    effort: task.route.chosen.effort ?? COMMON.defaultEffort,
    by: task.route.by,
})

/** Why one task's model was chosen. */
export const TaskRouteBlock = (props: TaskRouteBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskRouteBlockBase
            props={{
                route: mapSlot(slotOfQuery(query), toView),
                fact: query.data === undefined ? "" : TASK.routeFact(query.data.route.tier),
                labels: {
                    title: TASK.route,
                    steps: TASK.routeSteps,
                    chosen: TASK.chosen,
                    model: TASK.model,
                    effort: TASK.effort,
                    by: TASK.by,
                    slot: slotLabels(TASK.notFound),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
