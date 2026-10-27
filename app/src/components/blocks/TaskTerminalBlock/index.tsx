import type { TaskDetail } from "@contract"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { memberText } from "../../../modules/format"
import { TASK } from "../../../modules/i18n"
import { TaskTerminalBlockBase } from "./component"

/** Input of TaskTerminalBlock: the route's atoms. */
export interface TaskTerminalBlockProps {
    readonly project: string
    readonly task: string
}

const factOf = (task: TaskDetail | undefined): string => {
    const latest = task?.attempts.at(-1)
    return [latest === undefined ? null : memberText(latest.member), task?.terminal ?? null].filter((part) => part !== null).join(" · ")
}

/** One task's terminal tail. */
export const TaskTerminalBlock = (props: TaskTerminalBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskTerminalBlockBase
            props={{
                lines: mapSlot(slotOfQuery(query), (task: TaskDetail) => task.terminalTail),
                fact: factOf(query.data),
                labels: { title: TASK.terminal, slot: slotLabels(TASK.noTerminal) },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
