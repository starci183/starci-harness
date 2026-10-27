import type { Meta, StoryObj } from "@storybook/react-vite"
import { EventsBlockBase } from "../../src/components/blocks/EventsBlock/component"
import { OVERVIEW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "EventsBlock",
    component: EventsBlockBase,
    args: {
        props: {
            events: ready([
                { id: "e1", text: "Op t-55ca2c6b docs → green · 4 checks T0", at: "2026-10-27T12:41:00Z", timeLabel: "12:41 · starci-next", isAttention: false },
                { id: "e2", text: "d-c11 escalation owner: publish core cohort 0.12.15", at: "2026-10-27T12:34:00Z", timeLabel: "12:34 · nivo-lite", isAttention: true },
            ]),
            labels: { title: OVERVIEW.eventsTitle, slot: slotLabels(OVERVIEW.noEvents, OVERVIEW.noEventsHint) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof EventsBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "EventsBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, events: loading() } },
    parameters: { dna: { pair: "EventsBlock", phase: "loading" } },
}
