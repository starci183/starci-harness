import type { Meta, StoryObj } from "@storybook/react-vite"
import { WorkflowHeaderBlockBase } from "../../src/components/blocks/WorkflowHeaderBlock/component"
import { COMMON, NAV, WORKFLOW, WORKFLOW_STATUS } from "../../src/modules/i18n"
import { loading, noop, ready, slotLabels } from "../support"

const GOAL = "Gói Premium tháng và năm, thanh toán qua SePay và PayOS; BE và FE trong một workflow."

const header = (status: keyof typeof WORKFLOW_STATUS) =>
    ready({ title: "next-subscription-sepay", status: WORKFLOW_STATUS[status], versions: WORKFLOW.versions(27, 15, 4, 19), goal: GOAL, reason: null })

const meta = {
    title: "WorkflowHeaderBlock",
    component: WorkflowHeaderBlockBase,
    args: {
        shape: "running",
        props: {
            header: header("running"),
            overviewHref: "/",
            goalDraft: GOAL,
            canSaveGoal: false,
            stopMode: "stop-graceful",
            isPending: false,
            result: null,
            labels: {
                trail: { label: WORKFLOW.breadcrumbs, project: "starci-next", workflows: NAV.workflows },
                reason: WORKFLOW.reason,
                changeGoal: WORKFLOW.changeGoal,
                changeGoalHint: WORKFLOW.changeGoalHint(27),
                goalField: WORKFLOW.goalField,
                saveGoal: WORKFLOW.saveGoal,
                pause: WORKFLOW.pause,
                resume: WORKFLOW.resume,
                stop: WORKFLOW.stop,
                stopTitle: WORKFLOW.stopTitle,
                stopBody: WORKFLOW.stopBody,
                stopConfirm: WORKFLOW.stopConfirm,
                stopMode: WORKFLOW.stopMode,
                stopGraceful: WORKFLOW.stopGraceful,
                stopGracefulHint: WORKFLOW.stopGracefulHint,
                stopHard: WORKFLOW.stopHard,
                stopHardHint: WORKFLOW.stopHardHint,
                close: COMMON.close,
                cancel: COMMON.cancel,
                dismiss: COMMON.dismissNotice,
                slot: slotLabels(WORKFLOW.notFound),
            },
        },
        on: {
            retry: noop,
            setGoal: noop,
            saveGoal: () => Promise.resolve(true),
            toggle: noop,
            setStopMode: noop,
            stop: () => Promise.resolve(null),
        },
    },
} satisfies Meta<typeof WorkflowHeaderBlockBase>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = { args: { shape: "running" }, parameters: { dna: { pair: "WorkflowHeaderBlock", phase: "ready" } } }

export const Paused: Story = {
    args: { shape: "paused", props: { ...meta.args.props, header: header("paused") } },
    parameters: { dna: { pair: "WorkflowHeaderBlock", phase: "ready" } },
}

export const Stopped: Story = {
    args: { shape: "stopped", props: { ...meta.args.props, header: header("stopped") } },
    parameters: { dna: { pair: "WorkflowHeaderBlock", phase: "ready" } },
}

export const Loading: Story = {
    args: { shape: "running", props: { ...meta.args.props, header: loading() } },
    parameters: { dna: { pair: "WorkflowHeaderBlock", phase: "loading" } },
}
