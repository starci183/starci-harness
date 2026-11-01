import type { DateValue } from "@heroui/react"
import type { NoChildren } from "../../tier.js"

/** A calendar date without clock or timezone fields, compatible with the Calendar vendor's date value. */
export type CalendarDayValue = Exclude<DateValue, { readonly hour: number }>

/** The passive date heading of a calendar region; content and controls remain with that region. */
export type CalendarDayProps = NoChildren & {
    readonly value: CalendarDayValue
    /** The full localized date, including today's meaning when it is the current date. */
    readonly label: string
    /** Whether the app's authoritative current calendar date equals this date. */
    readonly isToday?: boolean
}

/** A named calendar day derived from one date, with current-date semantics and no date-selection behavior. */
export const CalendarDay = ({ value, label, isToday = false }: CalendarDayProps) => (
    <time dateTime={value.toString()} aria-label={label} aria-current={isToday ? "date" : undefined}
        className="starci-core-calendar-day-label" data-component="CalendarDay" data-tier="leaf"
        data-grammar-calendar-day-today={isToday ? "true" : "false"}>
        {value.day}
    </time>
)
