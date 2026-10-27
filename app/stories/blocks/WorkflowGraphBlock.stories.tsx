import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkflowGraphBlockBase, type WorkflowGraphView } from "../../src/components/blocks/WorkflowGraphBlock/component"
import { COMMON, NODE_LEGEND, NODE_STATE, WORKFLOW } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const GRAPH: WorkflowGraphView = {
    label: WORKFLOW.graphLabel("next-subscription-sepay", 2),
    stats: { live: "1", cap: "/ 10", queued: "0", waves: "2", done: "1", total: "/ 3" },
    nodes: [
        { id: "spec", label: "spec subscription", description: "docs · Hoàn tất", tone: "success", size: "sm" },
        { id: "b1", label: "B1 entity + migration", description: "code · Đang chạy", tone: "accent", size: "sm", count: "BE" },
        { id: "f1", label: "F1 chọn gói", description: "code · Chờ phụ thuộc", tone: "neutral", size: "sm", count: "FE", isPlaceholder: true },
    ],
    edges: [
        { id: "spec->b1", source: "spec", target: "b1" },
        { id: "spec->f1", source: "spec", target: "f1", isPlaceholder: true },
    ],
    headers: [
        { at: 0, label: WORKFLOW.wave(1, 1) },
        { at: 1, label: WORKFLOW.wave(2, 2) },
    ],
    extent: { across: 300, along: 100 },
    details: [
        {
            id: "spec",
            title: WORKFLOW.nodeTitle("docs", "spec subscription"),
            state: NODE_STATE.done,
            presentation: NODE_STATE.done.presentation,
            member: "claude · claude-sonnet-5-5",
            side: COMMON.shared,
            dependsOn: [],
            record: null,
            why: null,
            task: null,
        },
    ],
}

const meta = {
    title: "WorkflowGraphBlock",
    component: WorkflowGraphBlockBase,
    args: {
        props: {
            graph: ready(GRAPH),
            selectedId: null,
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
                selectHint: WORKFLOW.selectHint,
                member: WORKFLOW.member,
                side: WORKFLOW.side,
                deps: WORKFLOW.deps,
                record: WORKFLOW.record,
                why: WORKFLOW.why,
                none: COMMON.none,
                noTask: WORKFLOW.noTask,
                slot: slotLabels(WORKFLOW.notFound),
            },
        },
        on: { retry: noop, select: noop },
    },
} satisfies Meta<typeof WorkflowGraphBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "WorkflowGraphBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, graph: loading() } },
    parameters: { dna: { pair: "WorkflowGraphBlock", phase: "loading" } },
}
