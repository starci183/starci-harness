import { FlowCheckBlock } from "../../../components/blocks/FlowCheckBlock"
import { SeatsBlock } from "../../../components/blocks/SeatsBlock"
import { WorkflowGraphBlock } from "../../../components/blocks/WorkflowGraphBlock"
import { WorkflowHeaderBlock } from "../../../components/blocks/WorkflowHeaderBlock"

/** Complete input of WorkflowPageBase: the route's atoms. */
export interface WorkflowPageBaseProps {
    readonly props: { readonly project: string; readonly workflow: string }
}

/** Pure half: the header, the DAG in waves, then the flow check beside the seats. */
export const WorkflowPageBase = (props: WorkflowPageBaseProps) => {
    const { project, workflow } = props.props
    return (
        <div className="app-page-stack">
            <WorkflowHeaderBlock project={project} workflow={workflow} />
            <WorkflowGraphBlock project={project} workflow={workflow} />
            <div className="app-grid-2">
                <FlowCheckBlock project={project} workflow={workflow} />
                <SeatsBlock project={project} workflow={workflow} />
            </div>
        </div>
    )
}
