import { BellAlertIcon } from "@heroicons/react/24/outline"
import { EmptyNotice, SurfaceCard, Timeline, type TimelineItem } from "@starci/grammar/core"
import type { EventRow } from "@contract"
import { OVERVIEW } from "../../app/labels"
import { clockTime } from "./format"

interface RecentEventsProps {
    readonly events: readonly EventRow[]
    readonly isLoading: boolean
}

const toItem = (event: EventRow, index: number): TimelineItem => ({
    id: `${event.at}-${index}`,
    title: event.text,
    dateTime: event.at,
    timeLabel: `${clockTime(event.at)} · ${event.project}`,
    // An attention event (an escalation, a red check) is a cautionary row on its tone's background.
    state: event.attention ? "cautionary" : "neutral",
    isAttention: event.attention,
})

/** The newest harness events across projects, attention rows highlighted. */
export const RecentEvents = ({ events, isLoading }: RecentEventsProps) => (
    <SurfaceCard label={OVERVIEW.eventsTitle} headingLevel={2}>
        {!isLoading && events.length === 0 ? (
            <EmptyNotice iconSource={BellAlertIcon} message={OVERVIEW.noEvents} description={OVERVIEW.noEventsHint} />
        ) : (
            <Timeline label={OVERVIEW.eventsTitle} items={events.map(toItem)} isLoading={isLoading} loadingRows={4} />
        )}
    </SurfaceCard>
)
