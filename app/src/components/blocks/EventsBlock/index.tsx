import type { Overview } from "@contract"
import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { clockTime } from "../../../modules/format"
import { OVERVIEW } from "../../../modules/i18n"
import { EventsBlockBase, type EventView } from "./component"

const toViews = (overview: Overview): readonly EventView[] =>
    overview.events.map((event, index) => ({
        id: `${event.at}-${index}`,
        text: event.text,
        at: event.at,
        timeLabel: `${clockTime(event.at)} · ${event.project}`,
        isAttention: event.attention,
    }))

/** The recent-events region of the overview. */
export const EventsBlock = () => {
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    return (
        <EventsBlockBase
            props={{
                events: mapSlot(slotOfQuery(query), toViews),
                labels: { title: OVERVIEW.eventsTitle, slot: slotLabels(OVERVIEW.noEvents, OVERVIEW.noEventsHint) },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
