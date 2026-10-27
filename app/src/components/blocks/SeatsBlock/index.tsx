import type { WorkflowDetail } from "@contract"
import { useWorkflowQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { memberText } from "../../../modules/format"
import { SEAT_LIVENESS, SEAT_ROLE, WORKFLOW } from "../../../modules/i18n"
import { taskPath } from "../../../modules/routes"
import { SeatsBlockBase, type SeatView } from "./component"

/** Input of SeatsBlock: the route's atoms. */
export interface SeatsBlockProps {
    readonly project: string
    readonly workflow: string
}

const toViews = (workflow: WorkflowDetail): readonly SeatView[] =>
    workflow.seats.map((seat) => ({
        id: seat.id,
        model: seat.member.model,
        title: `${SEAT_ROLE[seat.role]} · ${seat.title.replace(/^\[[^\]]+\]\s*/, "")}`,
        member: memberText(seat.member),
        liveness: SEAT_LIVENESS[seat.liveness],
        taskHref: seat.task === null ? null : taskPath(workflow.project, seat.task),
    }))

/** One workflow's seats. */
export const SeatsBlock = (props: SeatsBlockProps) => {
    const query = useWorkflowQuery(props.project, props.workflow)
    const slotLabels = useSlotLabels()
    return (
        <SeatsBlockBase
            props={{
                seats: mapSlot(slotOfQuery(query), toViews),
                labels: {
                    title: WORKFLOW.seatsTitle,
                    count: String(query.data?.seats.length ?? 0),
                    empty: WORKFLOW.noSeats,
                    openTask: WORKFLOW.openTask,
                    slot: slotLabels(WORKFLOW.notFound),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
