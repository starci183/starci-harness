import type { Meta, StoryObj } from "@storybook/react-vite"
import { SeatsBlockBase } from "../../src/components/blocks/SeatsBlock/component"
import { SEAT_LIVENESS, WORKFLOW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "SeatsBlock",
    component: SeatsBlockBase,
    args: {
        props: {
            seats: ready([
                { id: "sup", model: "claude-opus-5-5", title: "Supervisor · starci-next", member: "claude · claude-opus-5-5", liveness: SEAT_LIVENESS.alive, taskHref: null },
                { id: "op", model: "gpt-6-luna", title: "Op · code (t-b4a71c58)", member: "codex · gpt-6-luna", liveness: SEAT_LIVENESS.stalled, taskHref: "/t/starci-next/t-b4a71c58" },
            ]),
            labels: { title: WORKFLOW.seatsTitle, count: "2", empty: WORKFLOW.noSeats, openTask: WORKFLOW.openTask, slot: slotLabels(WORKFLOW.notFound) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof SeatsBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "SeatsBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, seats: loading() } },
    parameters: { dna: { pair: "SeatsBlock", phase: "loading" } },
}
