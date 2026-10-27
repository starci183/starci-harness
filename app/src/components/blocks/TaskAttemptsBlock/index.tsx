import type { TaskDetail } from "@contract"
import type { PresentationState } from "@starci/grammar/core"
import { useTaskQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { stampTime } from "../../../modules/format"
import { NODE_STATE, TASK } from "../../../modules/i18n"
import { TaskAttemptsBlockBase, type AttemptView } from "./component"

/** Input of TaskAttemptsBlock: the route's atoms. */
export interface TaskAttemptsBlockProps {
    readonly project: string
    readonly task: string
}

const outcomeState = (outcome: string): PresentationState => {
    if (outcome === "running" || outcome === "verifying") return "informative"
    if (outcome === "done" || outcome === "accepted" || outcome === "green") return "affirmative"
    if (outcome === "failed" || outcome === "refused" || outcome === "lost" || outcome === "red") return "negative"
    if (outcome === "returned" || outcome === "blocked") return "cautionary"
    return "neutral"
}

/** An attempt outcome is a node state word when it names one; otherwise the server's own word. */
const outcomeLabel = (outcome: string): string => (outcome in NODE_STATE ? NODE_STATE[outcome as keyof typeof NODE_STATE].label : outcome)

const toViews = (task: TaskDetail): readonly AttemptView[] =>
    [...task.attempts].reverse().map((attempt) => ({
        id: String(attempt.n),
        title: `#${attempt.n} · ${attempt.member.model}`,
        outcome: outcomeLabel(attempt.outcome),
        at: attempt.at,
        timeLabel: stampTime(attempt.at),
        state: outcomeState(attempt.outcome),
    }))

/** One task's attempts. */
export const TaskAttemptsBlock = (props: TaskAttemptsBlockProps) => {
    const query = useTaskQuery(props.project, props.task)
    const slotLabels = useSlotLabels()
    return (
        <TaskAttemptsBlockBase
            props={{
                attempts: mapSlot(slotOfQuery(query), toViews),
                labels: {
                    title: query.data === undefined ? TASK.attemptsList : TASK.attempts(query.data.attempts.length),
                    list: TASK.attemptsList,
                    slot: slotLabels(TASK.noAttempts),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
