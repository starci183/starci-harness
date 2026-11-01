import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskPageBlockBase } from "../../src/components/blocks/TaskPageBlock/component"
import { NODE_STATE, TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskPageBlock",
    component: TaskPageBlockBase,
    args: {
        children: null,
        props: {
            task: "t-b2c41e07",
            header: ready({
                workflow: "next-subscription-sepay",
                workflowHref: "/w/starci-next/next-subscription-sepay",
                title: TASK.title("code", "B2 bảng giá tháng/năm"),
                state: NODE_STATE.running,
                elapsed: "11m",
            }),
            labels: { trail: TASK.breadcrumbs, slot: slotLabels(TASK.notFound) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskPageBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskPageBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, header: loading() } },
    parameters: { dna: { pair: "TaskPageBlock", phase: "loading" } },
}
