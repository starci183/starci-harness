import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkflowGraphBlockBase, type WorkflowGraphView } from "../../src/components/blocks/WorkflowGraphBlock/component"
import { NODE_LEGEND, NODE_STATE, WORKFLOW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const cell = (id: string, title: string, description: string, state: keyof typeof NODE_STATE, taskHref: string | null = null) => ({
    id,
    title,
    description,
    state: NODE_STATE[state],
    presentation: NODE_STATE[state].presentation,
    taskHref,
})

const GRAPH: WorkflowGraphView = {
    stats: { live: "1", cap: "/ 10", queued: "0", waves: "2", done: "1", total: "/ 3" },
    waves: [
        { id: "wave-0", label: WORKFLOW.wave(1, 1), cells: [cell("spec", "spec subscription", "docs · Hoàn tất", "done")] },
        {
            id: "wave-1",
            label: WORKFLOW.wave(2, 2),
            cells: [
                cell("b1", "B1 entity + migration", "code · Đang chạy", "running", "/t/starci-next/t-b1"),
                cell("f1", "F1 chọn gói", "code · Chờ phụ thuộc", "waiting"),
            ],
        },
    ],
}

const meta = {
    title: "WorkflowGraphBlock",
    component: WorkflowGraphBlockBase,
    args: {
        props: {
            graph: ready(GRAPH),
            labels: {
                title: WORKFLOW.graphTitle,
                statLive: WORKFLOW.statLive,
                statQueued: WORKFLOW.statQueued,
                statWaves: WORKFLOW.statWaves,
                statDone: WORKFLOW.statDone,
                legend: WORKFLOW.legend,
                legendEntries: NODE_LEGEND,
                legendSide: WORKFLOW.legendSide,
                empty: WORKFLOW.graphEmpty,
                openTask: WORKFLOW.openTask,
                slot: slotLabels(WORKFLOW.notFound),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof WorkflowGraphBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "WorkflowGraphBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, graph: loading() } },
    parameters: { dna: { pair: "WorkflowGraphBlock", phase: "loading" } },
}
