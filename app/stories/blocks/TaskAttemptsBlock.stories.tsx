import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskAttemptsBlockBase } from "../../src/components/blocks/TaskAttemptsBlock/component"
import { TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskAttemptsBlock",
    component: TaskAttemptsBlockBase,
    args: {
        props: {
            attempts: ready([
                { id: "2", title: "#2 · claude-sonnet-5-5", outcome: "Đang chạy", at: "2026-10-27T12:38:00Z", timeLabel: "27/10/26 12:38", state: "informative" },
                { id: "1", title: "#1 · gpt-6-luna", outcome: "Bị trả lại", at: "2026-10-27T11:02:00Z", timeLabel: "27/10/26 11:02", state: "cautionary" },
            ]),
            labels: { title: TASK.attempts(2), list: TASK.attemptsList, slot: slotLabels(TASK.noAttempts) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskAttemptsBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskAttemptsBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, attempts: loading(), labels: { ...meta.args.props.labels, title: TASK.attemptsList } } },
    parameters: { dna: { pair: "TaskAttemptsBlock", phase: "loading" } },
}
