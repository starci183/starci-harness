import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskTerminalBlockBase } from "../../src/components/blocks/TaskTerminalBlock/component"
import { TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskTerminalBlock",
    component: TaskTerminalBlockBase,
    args: {
        props: {
            lines: ready(["Reading src/modules/subscription/plan/plan.entity.ts", "Running npm run typecheck … ok"]),
            fact: "claude · claude-sonnet-5-5 · effort medium · term_8a1f3c90",
            labels: { title: TASK.terminal, slot: slotLabels(TASK.noTerminal) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskTerminalBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskTerminalBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, lines: loading(), fact: "" } },
    parameters: { dna: { pair: "TaskTerminalBlock", phase: "loading" } },
}
