import { Divider, SectionHeader } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import "./styles.css"

/** Complete input of InboxHeaderBlockBase. */
export interface InboxHeaderBlockBaseProps {
    readonly props: {
        /** How many decisions wait. */
        readonly count: DataSlot<number>
        readonly labels: { readonly title: string; readonly description: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

/**
 * Pure half: the inbox page header band (title, what lands here, how many decisions wait, a separator at its bottom). It is built
 * from existing Grammar parts in this file alone, so Grammar's PageHeader replaces just this file.
 */
export const InboxHeaderBlockBase = (props: InboxHeaderBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SlotView slot={props.props.count} placeholder={0} labels={labels.slot} forbidden="hide" onRetry={props.on.retry} isEmpty={() => false}>
            {(count, isSkeleton) => (
                <header className="app-inbox-header" aria-label={labels.title}>
                    <div className="app-inbox-header-copy">
                        <SectionHeader level={1} title={labels.title} description={labels.description} count={count} isSkeleton={isSkeleton} />
                    </div>
                    <Divider />
                </header>
            )}
        </SlotView>
    )
}
