import { PageContainer } from "@starci/grammar/core"
import { FlowCheckBlock } from "../../../components/blocks/FlowCheckBlock"
import { SeatsBlock } from "../../../components/blocks/SeatsBlock"
import { WorkflowGraphBlock } from "../../../components/blocks/WorkflowGraphBlock"
import { WorkflowHeaderBlock } from "../../../components/blocks/WorkflowHeaderBlock"

/** Complete input of WorkflowPageBase: the route's atoms. */
export interface WorkflowPageBaseProps {
    readonly props: { readonly project: string; readonly workflow: string }
}

/** Pure half: the page header flush at the top, then the DAG in waves and the flow check beside the seats. */
export const WorkflowPageBase = (props: WorkflowPageBaseProps) => {
    const { project, workflow } = props.props
    return (
        <>
            <WorkflowHeaderBlock project={project} workflow={workflow} />
            <PageContainer measure="full" className="app-page-body app-page-stack">
                <WorkflowGraphBlock project={project} workflow={workflow} />
                <div className="app-grid-2">
                    <FlowCheckBlock project={project} workflow={workflow} />
                    <SeatsBlock project={project} workflow={workflow} />
                </div>
            </PageContainer>
        </>
    )
}
