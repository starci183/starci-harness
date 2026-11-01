import type { ReactNode } from "react"
import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { overviewCounts } from "../../../modules/format"
import { OVERVIEW } from "../../../modules/i18n"
import { OverviewPageBlockBase } from "./component"

/** Input of OverviewPageBlock: the page body. */
export interface OverviewPageBlockProps {
    readonly body: ReactNode
}

/** The overview's Page: its header counts come from the overview read. */
export const OverviewPageBlock = (props: OverviewPageBlockProps) => {
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    return (
        <OverviewPageBlockBase
            props={{
                counts: mapSlot(slotOfQuery(query), overviewCounts),
                labels: {
                    title: OVERVIEW.title,
                    newWorkflow: OVERVIEW.newWorkflow,
                    newWorkflowReason: OVERVIEW.newWorkflowReason,
                    slot: slotLabels(OVERVIEW.loadError),
                },
            }}
            on={{ retry: () => void query.refetch() }} body={props.body} />
    )
}
