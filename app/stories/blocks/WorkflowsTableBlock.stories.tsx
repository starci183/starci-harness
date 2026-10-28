import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkflowsTableBlockBase, type WorkflowRowView } from "../../src/components/blocks/WorkflowsTableBlock/component"
import { AWAITING_DECISION, OVERVIEW, WORKFLOW_STATUS } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const row = (workflow: string, status: keyof typeof WORKFLOW_STATUS, done: number, total: number, awaiting = false): WorkflowRowView => ({
    id: `starci-next/${workflow}`,
    href: `/w/starci-next/${workflow}`,
    workflow,
    goalSummary: "Premium tháng/năm · SePay + PayOS",
    project: "starci-next",
    status: status === "blocked" ? { ...WORKFLOW_STATUS[status], label: `${WORKFLOW_STATUS[status].label} · Kernel sửa fixture-canon` } : WORKFLOW_STATUS[status],
    awaiting: awaiting ? AWAITING_DECISION : null,
    progressLabel: OVERVIEW.progressLabel(workflow),
    progress: Math.round((done / total) * 100),
    progressText: OVERVIEW.progressValue(done, total),
    fraction: `${done}/${total}`,
    live: "7 / 10",
    kernel: "claude-opus-5-5",
})

const meta = {
    title: "WorkflowsTableBlock",
    component: WorkflowsTableBlockBase,
    args: {
        props: {
            rows: ready([row("next-subscription-sepay", "running", 5, 22), row("w1-be", "blocked", 7, 8, true), row("next-uat-sign-in", "defined", 0, 1)]),
            labels: {
                title: OVERVIEW.workflowsTitle,
                fact: OVERVIEW.workflowsFact,
                columns: OVERVIEW.columns,
                slot: slotLabels(OVERVIEW.noWorkflows, OVERVIEW.noWorkflowsHint),
            },
        },
        on: { retry: noop },
    },
} satisfies Meta<typeof WorkflowsTableBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { parameters: { dna: { pair: "WorkflowsTableBlock", phase: "ready" } } }

export const Loading: Story = {
    args: { props: { ...meta.args.props, rows: loading() } },
    parameters: { dna: { pair: "WorkflowsTableBlock", phase: "loading" } },
}
