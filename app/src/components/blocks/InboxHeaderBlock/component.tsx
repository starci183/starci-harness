import { PageHeader } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Complete input of InboxHeaderBlockBase. */
export interface InboxHeaderBlockBaseProps {
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
}

/**
 * Pure half: the inbox page header (title, what lands here, how many decisions wait). The title stays when the count read
 * fails; only the count line carries the notice and its retry.
 */
export const InboxHeaderBlockBase = (props: InboxHeaderBlockBaseProps) => {
    const { labels, count } = props.props
    return (
        <PageHeader
            title={labels.title}
            description={labels.description}
            measure="full"
            isSkeleton={count.isLoading === true}
            meta={
                <SlotView slot={count} placeholder={0} labels={labels.slot} forbidden="hide" onRetry={props.on.retry} isEmpty={() => false}>
                    {(waiting) => labels.count(waiting)}
                </SlotView>
            }
        />
    )
}
