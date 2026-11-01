import type { Decision } from "@contract"
import type { ReactNode } from "react"
import { useInboxQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { INBOX } from "../../../modules/i18n"
import { InboxPageBlockBase } from "./component"

/** Input of InboxPageBlock: the page body. */
export interface InboxPageBlockProps {
    readonly body: ReactNode
}

/** The inbox Page, its header carrying the count. */
export const InboxPageBlock = (props: InboxPageBlockProps) => {
    const query = useInboxQuery()
    const slotLabels = useSlotLabels()
    return (
        <InboxPageBlockBase
            props={{
                count: mapSlot(slotOfQuery(query), (decisions: readonly Decision[]) => decisions.length),
                labels: { title: INBOX.title, description: INBOX.description, count: INBOX.count, slot: slotLabels(INBOX.empty) },
            }}
            on={{ retry: () => void query.refetch() }} body={props.body} />
    )
}
