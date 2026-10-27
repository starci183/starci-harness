import type { Decision } from "@contract"
import { useInboxQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { INBOX } from "../../../modules/i18n"
import { InboxHeaderBlockBase } from "./component"

/** The inbox page header with its count. */
export const InboxHeaderBlock = () => {
    const query = useInboxQuery()
    const slotLabels = useSlotLabels()
    return (
        <InboxHeaderBlockBase
            props={{
                count: mapSlot(slotOfQuery(query), (decisions: readonly Decision[]) => decisions.length),
                labels: { title: INBOX.title, description: INBOX.description, slot: slotLabels(INBOX.empty) },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
