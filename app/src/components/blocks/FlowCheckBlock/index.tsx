import type { WorkflowDetail } from "@contract"
import { useWorkflowQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { WORKFLOW } from "../../../modules/i18n"
import { FlowCheckBlockBase, type FlowCheckView } from "./component"

/** Input of FlowCheckBlock: the route's atoms. */
export interface FlowCheckBlockProps {
    readonly project: string
    readonly workflow: string
}

const toView = (workflow: WorkflowDetail): FlowCheckView => ({
    flow: workflow.flow,
    problems: workflow.flowProblems,
    problemsTitle: WORKFLOW.flowProblems(workflow.flowProblems.length),
})

/** One workflow's lanes and flow check. */
export const FlowCheckBlock = (props: FlowCheckBlockProps) => {
    const query = useWorkflowQuery(props.project, props.workflow)
    const slotLabels = useSlotLabels()
    return (
        <FlowCheckBlockBase
            props={{
                check: mapSlot(slotOfQuery(query), toView),
                labels: {
                    title: WORKFLOW.flowTitle,
                    code: WORKFLOW.flowCode,
                    noLanes: WORKFLOW.noLanes,
                    clean: WORKFLOW.flowClean,
                    cleanHint: WORKFLOW.flowCleanHint,
                    slot: slotLabels(WORKFLOW.notFound),
                },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
