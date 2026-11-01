import type { Meta, StoryObj } from "@storybook/react-vite"
import { parseDate } from "@internationalized/date"
import * as G from "../common/index.js"
import { CalendarDay } from "../core/leaf/CalendarDay/index.js"
import { Matrix, State } from "./fixtures.js"

const meta: Meta = { title: "Leaves/Calendar day" }
export default meta
type Story = StoryObj

/** A passive date heading alongside the region's own controls and content. */
export const DateStates: Story = {
    render: () => <Matrix>
        <State label="Ordinary date" direction="column"><CalendarDay value={parseDate("2026-11-01")} label="Sunday, 1 November 2026" /></State>
        <State label="Authoritative current date" direction="column"><CalendarDay value={parseDate("2026-11-02")} label="Today, Monday, 2 November 2026" isToday /></State>
        <State label="Calendar content keeps its own commands" direction="column">
            <G.Stack gap="identity">
                <CalendarDay value={parseDate("2026-11-02")} label="Hôm nay, Thứ Hai, ngày 2 tháng 11 năm 2026" isToday />
                <G.Text>Scheduled product update</G.Text>
                <G.Button intent="neutral">Pick this post to move</G.Button>
            </G.Stack>
        </State>
    </Matrix>,
}
