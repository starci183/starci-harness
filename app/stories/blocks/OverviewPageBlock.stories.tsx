import type { Meta, StoryObj } from "@storybook/react-vite"
import { OverviewPageBlockBase } from "../../src/components/blocks/OverviewPageBlock/component"
import { OVERVIEW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "OverviewPageBlock",
    component: OverviewPageBlockBase,
    args: {
        body: null,
        props: {
            counts: ready("3 dự án · 3 workflow đang hoạt động · 7 Op đang chạy"),
            labels: {
                title: OVERVIEW.title,
                newWorkflow: OVERVIEW.newWorkflow,
                newWorkflowReason: OVERVIEW.newWorkflowReason,
                slot: slotLabels(OVERVIEW.loadError),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof OverviewPageBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "OverviewPageBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, counts: loading() } },
    parameters: { dna: { pair: "OverviewPageBlock", phase: "loading" } },
}
