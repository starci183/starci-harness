import { useParams } from "react-router"
import { WorkflowPageBase } from "./component"

/** Route `/w/:project/:workflow`: adapts the route params to atoms. */
export const WorkflowPage = () => {
    const params = useParams()
    return <WorkflowPageBase props={{ project: params["project"] ?? "", workflow: params["workflow"] ?? "" }} />
}
