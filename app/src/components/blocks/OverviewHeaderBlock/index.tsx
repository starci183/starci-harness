import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { overviewCounts } from "../../../modules/format"
import { OVERVIEW } from "../../../modules/i18n"
import { OverviewHeaderBlockBase } from "./component"

/** The overview's page header: its counts come from the overview read. */
export const OverviewHeaderBlock = () => {
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    return (
        <OverviewHeaderBlockBase
            props={{
                counts: mapSlot(slotOfQuery(query), overviewCounts),
                labels: {
                    title: OVERVIEW.title,
                    newWorkflow: OVERVIEW.newWorkflow,
                    newWorkflowReason: OVERVIEW.newWorkflowReason,
                    slot: slotLabels(OVERVIEW.loadError),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
