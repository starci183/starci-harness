import type { Meta, StoryObj } from "@storybook/react-vite"
import { FlowCheckBlockBase } from "../../src/components/blocks/FlowCheckBlock/component"
import { WORKFLOW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "FlowCheckBlock",
    component: FlowCheckBlockBase,
    args: {
        props: {
            check: ready({
                flow: ["impl.commerce.subscription [impl-be]: code · test · e2e · review", "impl.commerce.fe.subscription [impl-fe]: code · audit · uat"],
                problems: [],
                problemsTitle: WORKFLOW.flowProblems(0),
            }),
            labels: {
                title: WORKFLOW.flowTitle,
                code: WORKFLOW.flowCode,
                noLanes: WORKFLOW.noLanes,
                clean: WORKFLOW.flowClean,
                cleanHint: WORKFLOW.flowCleanHint,
                slot: slotLabels(WORKFLOW.notFound),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof FlowCheckBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "FlowCheckBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, check: loading() } },
    parameters: { dna: { pair: "FlowCheckBlock", phase: "loading" } },
}
