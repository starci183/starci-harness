import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline"
import { PageContainer, WorkspaceShell } from "@starci/grammar/core"
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

/** Pure half: the fixed frame, the sidebar as a rail or a compact drawer, and the routed page in the Grammar page inset. */
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
                // Every routed page sits in the Grammar page inset; pages write their own vertical rhythm only.
                <PageContainer measure="full" className="app-page">
                    {props.children}
                </PageContainer>
            }
            primaryLabel={labels.content}
        />
    )
}
