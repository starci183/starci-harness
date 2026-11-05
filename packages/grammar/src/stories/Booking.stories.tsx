import type { Meta, StoryObj } from "@storybook/react-vite"
import { parseDate, type DateValue } from "@internationalized/date"
import { useState } from "react"
import * as G from "../common/index.js"
import { Matrix, State } from "./fixtures.js"

/*
 * Booking date and time (ruling one-way-to-choose): a date is the Calendar, a time is ChoiceChips. The calendar is controlled,
 * starts the week on Monday through the Vietnamese locale, bounds the range, marks a closed day and a full day (with its reason)
 * as unavailable, and draws as geometry while the open days load. A taken time keeps its place, disabled with its reason.
 * Filter tabs (underline, count, +n fold) narrow a list under its search field. Shown at 390 and 1920 by the render proof.
 */

const meta: Meta = { title: "Forms/Booking date and time" }
export default meta
type Story = StoryObj

const FULL_DAYS = new Set(["2026-11-10", "2026-11-12"])
const CLOSED_WEEKDAY = 1 // Monday

const isoOf = (date: DateValue): string => date.toString()
const isFull = (date: DateValue): boolean => FULL_DAYS.has(isoOf(date))
const isUnavailable = (date: DateValue): boolean => isFull(date) || date.toDate("UTC").getUTCDay() === CLOSED_WEEKDAY

const slots: ReadonlyArray<G.ChoiceChip> = ["09:00", "09:30", "10:30", "14:00", "15:30", "16:00", "17:30"].map((time) => ({
    value: time,
    label: time,
    ...(time === "10:30" ? { isDisabled: true, disabledReason: "Already booked" } : {}),
}))

const Picker = ({ isLoading = false, noSlots = false }: { readonly isLoading?: boolean; readonly noSlots?: boolean }) => {
    const [date, setDate] = useState<DateValue>(parseDate("2026-11-05"))
    const [time, setTime] = useState("14:00")
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--grammar-section-gap, 1.5rem)", maxWidth: 360 }}>
            <G.Calendar
                label="Appointment date"
                previousLabel="Previous month"
                nextLabel="Next month"
                locale="vi-VN"
                value={date}
                onChange={setDate}
                minValue={parseDate("2026-11-04")}
                maxValue={parseDate("2026-12-31")}
                isDateUnavailable={isUnavailable}
                unavailableReason={(day) => (isFull(day) ? "Fully booked" : undefined)}
                isLoading={isLoading}
            />
            <G.ChoiceChips
                label="Time"
                options={noSlots ? [] : slots}
                value={time}
                onValueChange={setTime}
                isLoading={isLoading}
                empty={<G.EmptyNotice message="No free time that day" description="Pick another day." />}
            />
        </div>
    )
}

export const BookingDateAndTime: Story = {
    render: () => (
        <Matrix>
            <State label="Ready (week from Monday, closed and full days struck, a taken time disabled with its reason)" direction="column"><Picker /></State>
            <State label="Loading (calendar and times as geometry)" direction="column"><Picker isLoading /></State>
            <State label="No free time that day" direction="column"><Picker noSlots /></State>
        </Matrix>
    ),
}

const requests = [
    { id: "all", label: "All", count: 24 },
    { id: "review", label: "To approve", count: 3, isAttention: true },
    { id: "new", label: "New", count: 6 },
    { id: "qualified", label: "Qualified", count: 0 },
    { id: "won", label: "Won", count: 5 },
    { id: "lost", label: "Lost", count: 2 },
    { id: "archived", label: "Archived", count: 41 },
] as const

const FilterTabs = ({ initial, width }: { readonly initial: string; readonly width?: number }) => {
    const [selected, setSelected] = useState(initial)
    return (
        <div style={{ ...(width === undefined ? {} : { width }), display: "flex", flexDirection: "column", gap: "var(--grammar-row-gap, 0.75rem)" }}>
            <G.SearchField label="Search the list" isLabelHidden placeholder="Search" />
            <G.Tabs
                label="Status"
                kind="filter"
                selectedKey={selected}
                items={requests.map((tab) => ({ ...tab }))}
                onSelect={setSelected}
                panelId="filtered-list"
                moreLabel={(count) => `${count} more filters`}
            />
            <div id="filtered-list" role="tabpanel"><G.Text tone="muted">{`The list, filtered by ${selected}. Rows go here.`}</G.Text></div>
        </div>
    )
}

export const FilterTabsWithCounts: Story = {
    render: () => (
        <Matrix maxWidth={720}>
            <State label="Filter tabs in a list pane, under the search field: underline, counts, the attention count in the danger tone" direction="column"><FilterTabs initial="all" /></State>
            <State label="A narrow pane: what does not fit folds into +n, the selected tab stays visible" direction="column"><FilterTabs initial="archived" width={300} /></State>
        </Matrix>
    ),
}

const weekdays: ReadonlyArray<G.ChoiceChip> = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({ value: day, label: day }))

/** A booking card: the calendar fills the card (`width="fill"`), the weekday chips take any number of days, the submit fills a phone. */
export const BookingCardFill: Story = {
    render: () => (
        <Matrix maxWidth={560}>
            <State label="Calendar width=fill in a 520px card (the month spans the card), weekdays multiple, submit fill-narrow" direction="column">
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--grammar-section-gap, 1.5rem)", inlineSize: "100%" }}>
                    <G.Calendar label="Appointment date" previousLabel="Previous month" nextLabel="Next month" width="fill" defaultValue={parseDate("2026-11-05")} />
                    <G.ChoiceChips label="Repeat on" selectionMode="multiple" options={weekdays} defaultValues={["Mon", "Wed"]} empty={null} />
                    <G.Button intent="commit" width="fill-narrow">Book this time</G.Button>
                </div>
            </State>
            <State label="The same, loading" direction="column">
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--grammar-section-gap, 1.5rem)", inlineSize: "100%" }}>
                    <G.Calendar label="Appointment date" previousLabel="Previous month" nextLabel="Next month" width="fill" isLoading />
                    <G.ChoiceChips label="Repeat on" selectionMode="multiple" options={weekdays} isLoading empty={null} />
                    <G.Button intent="commit" width="fill-narrow" isLoading>Book this time</G.Button>
                </div>
            </State>
        </Matrix>
    ),
}
