import { useParams } from "react-router"
import { TaskPageBase } from "./component"

/** Route `/t/:project/:task`: adapts the route params to atoms. */
export const TaskPage = () => {
    const params = useParams()
    return <TaskPageBase props={{ project: params["project"] ?? "", task: params["task"] ?? "" }} />
}
