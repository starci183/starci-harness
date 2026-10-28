import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline"
import { WorkspaceShell } from "@starci/grammar/core"
import type { ReactNode } from "react"
import type { LiveState } from "../../../hooks/live"
import { WorkspaceNavBlock } from "../../../components/blocks/WorkspaceNavBlock"

/** Complete input of WorkspaceLayoutBase: the drawer's copy, the live stream state, and the routed page. */
export interface WorkspaceLayoutBaseProps {
    readonly props: {
        readonly stream: LiveState
        readonly labels: {
            readonly landmark: string
            readonly content: string
            readonly openDrawer: string
            readonly closeDrawer: string
        }
    }
    readonly children: ReactNode
}

/** Pure half: the fixed frame, the sidebar as a rail or a compact drawer, and the routed page as a full-width column. */
export const WorkspaceLayoutBase = (props: WorkspaceLayoutBaseProps) => {
    const { labels, stream } = props.props
    return (
        <WorkspaceShell
            viewport="fixed"
            navigation={<WorkspaceNavBlock presentation="rail" stream={stream} />}
            navigationLabel={labels.landmark}
            navigationDrawer={{
                title: labels.landmark,
                openLabel: labels.openDrawer,
                closeLabel: labels.closeDrawer,
                source: EllipsisHorizontalIcon,
                content: <WorkspaceNavBlock presentation="drawer" stream={stream} />,
            }}
            primary={
                // The routed page runs edge to edge: its header band is full width, and the page puts its content in the Grammar inset below.
                <div className="app-page">{props.children}</div>
            }
            primaryLabel={labels.content}
        />
    )
}
