import type { ActionResult, WorkflowDetail, WorkflowStatus } from "@contract"
import { useState } from "react"
import { useActionCommand, useWorkflowQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import type { WorkflowAction } from "../../../modules/api"
import { COMMON, NAV, WORKFLOW, WORKFLOW_STATUS } from "../../../modules/i18n"
import { APP_ROUTES } from "../../../modules/routes"
import type { ResultNotice } from "../../../modules/types"
import { WorkflowHeaderBlockBase, type StopMode, type WorkflowHeaderShape, type WorkflowHeaderView } from "./component"

/** Input of WorkflowHeaderBlock: the route's atoms. */
export interface WorkflowHeaderBlockProps {
    readonly project: string
    readonly workflow: string
}

/** Which header a status draws: stopping, stopped and done all offer nothing but the record. */
const shapeOf = (status: WorkflowStatus): WorkflowHeaderShape => {
    switch (status) {
        case "paused":
            return "paused"
        case "stopping":
        case "stopped":
        case "done":
            return "stopped"
        case "defined":
        case "running":
        case "blocked":
            return "running"
    }
}

const toView = (workflow: WorkflowDetail): WorkflowHeaderView => {
    const done = workflow.nodes.filter((node) => node.state === "done").length
    return {
        title: workflow.id,
        status: WORKFLOW_STATUS[workflow.status],
        versions: WORKFLOW.versions(workflow.goal.version, workflow.graphVersion, done, workflow.nodes.length),
        goal: workflow.goal.text,
        reason: workflow.reason,
    }
}

const noticeOf = (n: number, result: ActionResult): ResultNotice => ({
    n,
    isOk: result.ok,
    title: result.ok ? WORKFLOW.sent : WORKFLOW.refused,
    description: result.code === null ? result.message : `${result.code}: ${result.message}`,
})

/** One workflow's header and the owner's verbs on it (goal, pause or resume, stop), each through a harness verb. */
export const WorkflowHeaderBlock = (props: WorkflowHeaderBlockProps) => {
    const query = useWorkflowQuery(props.project, props.workflow)
    const { send, isPending } = useActionCommand()
    const slotLabels = useSlotLabels()
    const [goalDraft, setGoalDraft] = useState<string | null>(null)
    const [stopMode, setStopMode] = useState<StopMode>("stop-graceful")
    const [result, setResult] = useState<ResultNotice | null>(null)
    const detail = query.data
    const currentGoal = detail?.goal.text ?? ""
    const goal = goalDraft ?? currentGoal
    const shape = shapeOf(detail?.status ?? "running")

    const report = async (request: Parameters<typeof send>[0]): Promise<ActionResult> => {
        const outcome = await send(request)
        setResult((previous) => noticeOf((previous?.n ?? 0) + 1, outcome))
        return outcome
    }
    const run = (action: WorkflowAction) => report({ kind: "workflow", project: props.project, workflow: props.workflow, action })

    return (
        <WorkflowHeaderBlockBase
            shape={shape}
            props={{
                header: mapSlot(slotOfQuery(query), toView),
                overviewHref: APP_ROUTES.overview,
                goalDraft: goal,
                canSaveGoal: goal.trim() !== "" && goal.trim() !== currentGoal,
                stopMode,
                isPending,
                result,
                labels: {
                    trail: { label: WORKFLOW.breadcrumbs, project: props.project, workflows: NAV.workflows },
                    reason: WORKFLOW.reason,
                    changeGoal: WORKFLOW.changeGoal,
                    changeGoalHint: WORKFLOW.changeGoalHint(detail?.goal.version ?? 0),
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
                    slot: slotLabels(WORKFLOW.notFound, WORKFLOW.notFoundHint(props.project, props.workflow)),
                },
            }}
            on={{
                retry: () => void query.refetch(),
                setGoal: setGoalDraft,
                saveGoal: async () => {
                    const outcome = await report({ kind: "goal", project: props.project, workflow: props.workflow, text: goal.trim() })
                    if (outcome.ok) setGoalDraft(null)
                    return outcome.ok
                },
                toggle: () => void run(shape === "paused" ? "resume" : "pause"),
                setStopMode,
                stop: async () => {
                    const outcome = await run(stopMode)
                    return outcome.ok ? null : outcome.message
                },
            }}
        />
    )
}
