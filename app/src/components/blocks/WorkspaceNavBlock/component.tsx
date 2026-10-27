import {
    ChartBarSquareIcon,
    Cog6ToothIcon,
    FolderIcon,
    InboxIcon,
    RectangleGroupIcon,
} from "@heroicons/react/24/outline"
import { CoreGrammarRoot, IdentityLockup, Sidebar, StatusDot, Text, type SidebarGroup } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"

/** One project in the sidebar, its Supervisor as a dot. */
export interface ProjectNavView {
    readonly key: string
    readonly name: string
    readonly supervisor: ToneLabel
    /** The dot echoes while the Supervisor is alive. */
    readonly isAlive: boolean
}

/** Copy the connected nav resolves. */
export interface WorkspaceNavBlockLabels {
    readonly landmark: string
    readonly product: string
    readonly edition: string
    readonly overview: string
    readonly workflows: string
    readonly inbox: string
    readonly inboxBadge: string
    readonly settings: string
    readonly projects: string
    readonly slot: SlotLabels
}

/** Complete input of WorkspaceNavBlockBase. */
export interface WorkspaceNavBlockBaseProps {
    readonly props: {
        readonly presentation: "rail" | "drawer"
        readonly selectedKey: string
        readonly logoSrc: string
        /** Known once the overview answers; navigation itself never waits for it. */
        readonly projects: readonly ProjectNavView[]
        readonly openDecisions: number
        /** The footer line: where the data comes from, the host watch and the last tick. */
        readonly status: DataSlot<string>
        readonly labels: WorkspaceNavBlockLabels
    }
    readonly on: { readonly select: (id: string) => void; readonly home: () => void; readonly retry: () => void }
}

const STATUS_PLACEHOLDER = " "

/** Pure half: the light warm sidebar (logo, destinations, projects, the host footer). */
export const WorkspaceNavBlockBase = (props: WorkspaceNavBlockBaseProps) => {
    const { labels, openDecisions } = props.props
    const groups: SidebarGroup[] = [
        {
            id: "main",
            items: [
                { id: "overview", label: labels.overview, source: ChartBarSquareIcon },
                { id: "workflows", label: labels.workflows, source: RectangleGroupIcon },
                {
                    id: "inbox",
                    label: labels.inbox,
                    source: InboxIcon,
                    ...(openDecisions > 0 ? { badge: openDecisions, badgeLabel: labels.inboxBadge, badgeMax: 99 } : {}),
                },
                { id: "settings", label: labels.settings, source: Cog6ToothIcon },
            ],
        },
        {
            id: "projects",
            label: labels.projects,
            items: props.props.projects.map((project) => ({
                id: `project:${project.key}`,
                label: project.name,
                source: FolderIcon,
                // The Supervisor as a dot: its words are the dot's name and tooltip; it echoes while alive.
                trailing: <StatusDot tone={project.supervisor.tone} aria-label={project.supervisor.label} echo={project.isAlive} />,
            })),
        },
    ]
    return (
        // The sidebar is its own Grammar root in the page's theme, so the brand can give it its light warm tokens.
        <CoreGrammarRoot theme="system" className="app-sidebar-island">
            <Sidebar
                label={labels.landmark}
                presentation={props.props.presentation}
                groups={groups}
                selectedKey={props.props.selectedKey}
                header={<IdentityLockup title={labels.product} subtitle={labels.edition} logoSrc={props.props.logoSrc} onPress={props.on.home} />}
                footer={
                    <SlotView slot={props.props.status} placeholder={STATUS_PLACEHOLDER} labels={labels.slot} forbidden="hide" onRetry={props.on.retry}>
                        {(status, isSkeleton) => (
                            <Text size="xs" tone="muted" live="polite" isSkeleton={isSkeleton}>
                                {status}
                            </Text>
                        )}
                    </SlotView>
                }
                onAction={props.on.select}
            />
        </CoreGrammarRoot>
    )
}
