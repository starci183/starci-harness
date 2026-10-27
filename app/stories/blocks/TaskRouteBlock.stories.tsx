import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskRouteBlockBase } from "../../src/components/blocks/TaskRouteBlock/component"
import { TASK } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const meta = {
    title: "TaskRouteBlock",
    component: TaskRouteBlockBase,
    args: {
        props: {
            route: ready({
                steps: [
                    { id: "0-hard-filter", step: "hard-filter", detail: "5 member (cursor bị loại: hết quota)" },
                    { id: "1-score", step: "score", detail: "sonnet 8.67 · luna 1.73" },
                ],
                model: "claude · claude-sonnet-5-5",
                effort: "medium",
                by: "score",
            }),
            fact: TASK.routeFact("medium"),
            labels: {
                title: TASK.route,
                steps: TASK.routeSteps,
                chosen: TASK.chosen,
                model: TASK.model,
                effort: TASK.effort,
                by: TASK.by,
                slot: slotLabels(TASK.notFound),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof TaskRouteBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "TaskRouteBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, route: loading(), fact: "" } },
    parameters: { dna: { pair: "TaskRouteBlock", phase: "loading" } },
}
