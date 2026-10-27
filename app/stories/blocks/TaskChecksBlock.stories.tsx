import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskChecksBlockBase } from "../../src/components/blocks/TaskChecksBlock/component"
import { CHECK_STATE, TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskChecksBlock",
    component: TaskChecksBlockBase,
    args: {
        props: {
            checks: ready([
                { id: "0-paths-only", name: "paths-only", tier: "T0", state: CHECK_STATE.green, detail: "–" },
                { id: "1-typecheck", name: "typecheck · lint · build", tier: "T0", state: CHECK_STATE.pending, detail: "chờ submit" },
                { id: "2-e2e", name: "e2e", tier: "T2", state: CHECK_STATE.red, detail: "1 spec đỏ" },
            ]),
            labels: { title: TASK.checks, table: TASK.checksTable, columns: TASK.checkColumns, slot: slotLabels(TASK.noChecks) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskChecksBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskChecksBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, checks: loading() } },
    parameters: { dna: { pair: "TaskChecksBlock", phase: "loading" } },
}
