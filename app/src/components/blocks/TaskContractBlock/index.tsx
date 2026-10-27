import type { TaskDetail } from "@contract"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { COMMON, TASK } from "../../../modules/i18n"
import { TaskContractBlockBase, type TaskContractView } from "./component"

/** Input of TaskContractBlock: the route's atoms. */
export interface TaskContractBlockProps {
    readonly project: string
    readonly task: string
}

const toView = (task: TaskDetail): TaskContractView => ({
    summary: task.contract.summary,
    allowPaths: task.contract.allowPaths,
    dependsOn: task.contract.dependsOn,
    record: task.contract.record === null ? [] : [task.contract.record],
    step: task.contract.step === null ? [] : [task.contract.step],
})

/** One task's contract. */
export const TaskContractBlock = (props: TaskContractBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskContractBlockBase
            props={{
                contract: mapSlot(slotOfQuery(query), toView),
                labels: {
                    title: TASK.contract,
                    allowPaths: TASK.allowPaths,
                    anyPath: TASK.anyPath,
                    deps: TASK.deps,
                    record: TASK.record,
                    step: TASK.step,
                    none: COMMON.none,
                    slot: slotLabels(TASK.notFound),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
