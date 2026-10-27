import { SectionHeader } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** Complete input of InboxHeaderBlockBase. */
export interface InboxHeaderBlockBaseProps {
    readonly props: {
        /** How many decisions wait. */
        readonly count: DataSlot<number>
        readonly labels: { readonly title: string; readonly description: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

/** Pure half: the inbox title, what lands here, and how many decisions wait. */
export const InboxHeaderBlockBase = (props: InboxHeaderBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SlotView slot={props.props.count} placeholder={0} labels={labels.slot} forbidden="hide" onRetry={props.on.retry} isEmpty={() => false}>
            {(count, isSkeleton) => (
                <SectionHeader level={1} title={labels.title} description={labels.description} count={count} isSkeleton={isSkeleton} />
            )}
        </SlotView>
    )
}
