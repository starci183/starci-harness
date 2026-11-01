import { Page } from "@starci/grammar/core"
import type { ReactNode } from "react"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Complete input of InboxPageBlockBase. */
export interface InboxPageBlockBaseProps {
    readonly props: {
        /** How many decisions wait. */
        readonly count: DataSlot<number>
        readonly labels: {
            readonly title: string
            readonly description: string
            readonly count: (waiting: number) => string
            readonly slot: SlotLabels
        }
    }
    readonly on: { readonly retry: () => void }
    /** The page body, below the header. */
    readonly children: ReactNode
}

/**
 * Pure half: the inbox Page, headed by the title, what lands here and how many decisions wait, around the page body. The title stays when the count read
 * fails; only the count line carries the notice and its retry.
 */
export const InboxPageBlockBase = (props: InboxPageBlockBaseProps) => {
    const { labels, count } = props.props
    return (
        <Page
            measure="full"
            isSkeleton={count.isLoading === true}
            header={{
                title: labels.title,
                description: labels.description,
                meta: (
                    <SlotView slot={count} placeholder={0} labels={labels.slot} forbidden="hide" onRetry={props.on.retry} isEmpty={() => false}>
                        {(waiting) => labels.count(waiting)}
                    </SlotView>
                ),
            }}
        >
            {props.children}
        </Page>
    )
}
