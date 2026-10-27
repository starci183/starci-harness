import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskHeaderBlockBase } from "../../src/components/blocks/TaskHeaderBlock/component"
import { NAV, NODE_STATE, TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskHeaderBlock",
    component: TaskHeaderBlockBase,
    args: {
        props: {
            task: "t-b2c41e07",
            header: ready({
                workflow: "next-subscription-sepay",
                workflowHref: "/w/starci-next/next-subscription-sepay",
                title: TASK.title("code", "B2 bảng giá tháng/năm"),
                state: NODE_STATE.running,
                elapsed: "11m",
            }),
            overviewHref: "/",
            labels: { trail: TASK.breadcrumbs, overview: NAV.overview, slot: slotLabels(TASK.notFound) },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskHeaderBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskHeaderBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, header: loading() } },
    parameters: { dna: { pair: "TaskHeaderBlock", phase: "loading" } },
}
