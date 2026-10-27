import { SurfaceCard, Timeline } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One harness event, resolved for drawing. */
export interface EventView {
    readonly id: string
    readonly text: string
    readonly at: string
    readonly timeLabel: string
    /** An escalation or a red check: a cautionary row on its tone's background. */
    readonly isAttention: boolean
}

/** Complete input of EventsBlockBase. */
export interface EventsBlockBaseProps {
    readonly props: {
        readonly events: DataSlot<readonly EventView[]>
        readonly labels: { readonly title: string; readonly slot: SlotLabels }
    }
    readonly on: { readonly retry: () => void }
}

const EVENTS_PLACEHOLDER: readonly EventView[] = ["e0", "e1", "e2", "e3"].map((id) => ({
    id,
    text: "",
    at: "",
    timeLabel: "",
    isAttention: false,
}))

/** Pure half: the newest harness events across projects, attention rows highlighted. */
export const EventsBlockBase = (props: EventsBlockBaseProps) => {
    const { labels } = props.props
    return (
        <SurfaceCard label={labels.title} headingLevel={2}>
            <SlotView slot={props.props.events} placeholder={EVENTS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                {(events, isSkeleton) => (
                    <Timeline
                        label={labels.title}
                        items={isSkeleton ? [] : events.map((event) => ({
                            id: event.id,
                            title: event.text,
                            dateTime: event.at,
                            timeLabel: event.timeLabel,
                            state: event.isAttention ? "cautionary" : "neutral",
                            isAttention: event.isAttention,
                        }))}
                        isLoading={isSkeleton}
                        loadingRows={events.length}
                    />
                )}
            </SlotView>
        </SurfaceCard>
    )
}
