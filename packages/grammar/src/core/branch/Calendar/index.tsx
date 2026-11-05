"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import { Calendar as HeroCalendar, type DateValue } from "@heroui/react"
import { I18nProvider } from "react-aria-components"
import type { NoChildren } from "../../tier.js"

export type CalendarProps = NoChildren & {
    /** Names the calendar, e.g. "Delivery date". */
    readonly label: string
    /** Controlled selected date. Omit for uncontrolled use with `defaultValue`. */
    readonly value?: DateValue | null
    readonly defaultValue?: DateValue
    readonly onChange?: (value: DateValue) => void
    readonly minValue?: DateValue
    readonly maxValue?: DateValue
    readonly isDateUnavailable?: (date: DateValue) => boolean
    /**
     * Why an unavailable date cannot be picked ("Fully booked"): given on hover and to a screen reader beside the number. Return
     * nothing for a date that is unavailable without a story (a closed day shows only the strike).
     */
    readonly unavailableReason?: (date: DateValue) => string | undefined
    /** The app's BCP 47 locale ("vi-VN"): month and weekday names, and the first day of the week it implies (Monday for Vietnamese). */
    readonly locale?: string
    /** Overrides the locale's first day of the week. */
    readonly firstDayOfWeek?: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
    /** The first read has no data yet (which days are open): the grid keeps its header and cells, the numbers draw as geometry and nothing takes focus. */
    readonly isLoading?: boolean
    readonly isDisabled?: boolean
    readonly isReadOnly?: boolean
    /**
     * `fit` (default): the month's natural width. `fill`: the month takes its container's whole width and the day cells grow with it
     * (a booking card, a drawer); the heading, the weekday row and the grid keep one rhythm.
     */
    readonly width?: "fit" | "fill"
    /** App-owned accessible names of the month navigation buttons. */
    readonly previousLabel: string
    readonly nextLabel: string
}

/*
 * Consumer hooks: `starci-core-calendar-heading`, `starci-core-calendar-weekday` name HeroUI parts
 * whose vendor paint Common leaves as it is. No shipped sheet paints them; the Grammar name lets a
 * consumer or family select those parts without reaching for vendor class names.
 */

/**
 * A standalone month calendar (not a date field). Arrow keys move by day/week, Page Up/Down by
 * month, Home/End to the week edges; today, the selected date and unavailable dates are exposed by
 * the vendor as `data-*` states on each cell, with `aria-selected` on the chosen day.
 * Contract: root STATE-1 (app-owned date), grid FOCUS-2, nav A11Y-2, day TRUTH-2.
 */
const CalendarInner = ({
    label,
    value,
    defaultValue,
    onChange,
    minValue,
    maxValue,
    isDateUnavailable,
    unavailableReason,
    locale,
    firstDayOfWeek,
    isLoading = false,
    isDisabled = false,
    isReadOnly = false,
    width = "fit",
    previousLabel,
    nextLabel,
}: CalendarProps) => {
    const ownsBusy = useRegionOwnsBusy()
    const calendar = (
    <HeroCalendar
        aria-label={label}
        className="starci-core-calendar"
        data-component="Calendar"
        data-contract="STATE-1"
        data-tier="branch"
        data-grammar-calendar-width={width}
        {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : {})}
        {...(firstDayOfWeek === undefined ? {} : { firstDayOfWeek })}
        isDisabled={isDisabled || isLoading}
        isReadOnly={isReadOnly}
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        {...(onChange === undefined ? {} : { onChange })}
        {...(minValue === undefined ? {} : { minValue })}
        {...(maxValue === undefined ? {} : { maxValue })}
        {...(isDateUnavailable === undefined ? {} : { isDateUnavailable })}
    >
        <HeroCalendar.Header className="starci-core-calendar-header">
            <HeroCalendar.NavButton aria-label={previousLabel} className="starci-core-calendar-nav" data-contract="A11Y-2" slot="previous" />
            <HeroCalendar.Heading className="starci-core-calendar-heading" />
            <HeroCalendar.NavButton aria-label={nextLabel} className="starci-core-calendar-nav" data-contract="A11Y-2" slot="next" />
        </HeroCalendar.Header>
        <HeroCalendar.Grid className="starci-core-calendar-month" data-contract="FOCUS-2">
            <HeroCalendar.GridHeader>
                {(day: string) => <HeroCalendar.HeaderCell className="starci-core-calendar-weekday">{day}</HeroCalendar.HeaderCell>}
            </HeroCalendar.GridHeader>
            <HeroCalendar.GridBody>
                {(date) => {
                    const reason = isLoading || unavailableReason === undefined || isDateUnavailable?.(date) !== true ? undefined : unavailableReason(date)
                    return reason === undefined
                        ? <HeroCalendar.Cell className="starci-core-calendar-day" data-contract="TRUTH-2" data-grammar-calendar-day="true" date={date} />
                        : (
                            <HeroCalendar.Cell className="starci-core-calendar-day" data-contract="TRUTH-2" data-grammar-calendar-day="true" data-grammar-calendar-reason="true" date={date}>
                                {({ formattedDate }) => (
                                    <span title={reason}>
                                        {formattedDate}
                                        <span className="starci-core-calendar-reason">{reason}</span>
                                    </span>
                                )}
                            </HeroCalendar.Cell>
                        )
                }}
            </HeroCalendar.GridBody>
        </HeroCalendar.Grid>
    </HeroCalendar>
    )
    return locale === undefined ? calendar : <I18nProvider locale={locale}>{calendar}</I18nProvider>
}

/**
 * A standalone month calendar (not a date field). Arrow keys move by day/week, Page Up/Down by
 * month, Home/End to the week edges; today, the selected date and unavailable dates are exposed by
 * the vendor as `data-*` states on each cell, with `aria-selected` on the chosen day.
 * Contract: root STATE-1 (app-owned date), grid FOCUS-2, nav A11Y-2, day TRUTH-2.
 */
export const Calendar = withRegionLoading(CalendarInner)
