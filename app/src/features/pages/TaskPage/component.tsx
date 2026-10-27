import { PrimaryRailLayout } from "@starci/grammar/core"
import { TaskAttemptsBlock } from "../../../components/blocks/TaskAttemptsBlock"
import { TaskChecksBlock } from "../../../components/blocks/TaskChecksBlock"
import { TaskContractBlock } from "../../../components/blocks/TaskContractBlock"
import { TaskHeaderBlock } from "../../../components/blocks/TaskHeaderBlock"
import { TaskRouteBlock } from "../../../components/blocks/TaskRouteBlock"
import { TaskTerminalBlock } from "../../../components/blocks/TaskTerminalBlock"

/** Complete input of TaskPageBase: the route's atoms. */
export interface TaskPageBaseProps {
    readonly props: { readonly project: string; readonly task: string }
}

/** Pure half: the header, then contract, checks and terminal beside the route explanation and the attempts. */
export const TaskPageBase = (props: TaskPageBaseProps) => {
    const { project, task } = props.props
    return (
        <div className="app-page-stack">
            <TaskHeaderBlock project={project} task={task} />
            <PrimaryRailLayout
                railWidth="wide"
                primary={
                    <div className="app-stack">
                        <TaskContractBlock project={project} task={task} />
                        <TaskChecksBlock project={project} task={task} />
                        <TaskTerminalBlock project={project} task={task} />
                    </div>
                }
                rail={
                    <div className="app-stack">
                        <TaskRouteBlock project={project} task={task} />
                        <TaskAttemptsBlock project={project} task={task} />
                    </div>
                }
            />
        </div>
    )
}
