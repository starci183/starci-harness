import { Outlet } from "react-router"
import { useConnection } from "../../../hooks/connection"
import { useLiveEvents } from "../../../hooks/live"
import { NAV } from "../../../modules/i18n"
import { WorkspaceLayoutBase } from "./component"

/**
 * The connected frame of every signed-in route: it keeps the one live event stream open (each event invalidates only the
 * reads it names) and forwards the router's outlet as the page.
 */
export const WorkspaceLayout = () => {
    const { connection } = useConnection()
    const stream = useLiveEvents(connection)
    return (
        <WorkspaceLayoutBase
            props={{
                stream,
                labels: { landmark: NAV.landmark, content: NAV.content, openDrawer: NAV.openDrawer, closeDrawer: NAV.closeDrawer },
            }}
        >
            <Outlet />
        </WorkspaceLayoutBase>
    )
}
