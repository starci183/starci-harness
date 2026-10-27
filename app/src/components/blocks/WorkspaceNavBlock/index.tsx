import type { Overview } from "@contract"
import { useLocation, useNavigate } from "react-router"
import { useConnection } from "../../../hooks/connection"
import type { LiveState } from "../../../hooks/live"
import { useOverviewQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { logoSrc } from "../../../modules/brand"
import { clockTime } from "../../../modules/format"
import { CONNECTION, HOST, NAV, supervisorStatus, type FooterConnection } from "../../../modules/i18n"
import { APP_ROUTES, workflowPath } from "../../../modules/routes"
import { WorkspaceNavBlockBase, type ProjectNavView } from "./component"

/** Input of WorkspaceNavBlock: the wide rail or the compact drawer, and the live stream the layout keeps open. */
export interface WorkspaceNavBlockProps {
    readonly presentation: "rail" | "drawer"
    readonly stream: LiveState
}

/** The workflow a "Workflows" press opens: the first running one, else the first listed. */
const leadWorkflow = (overview: Overview | undefined, project?: string): string | null => {
    const rows = (overview?.workflows ?? []).filter((row) => project === undefined || row.project === project)
    const lead = rows.find((row) => row.status === "running") ?? rows[0]
    return lead === undefined ? null : workflowPath(lead.project, lead.id)
}

const selectedFor = (pathname: string): string => {
    if (pathname.startsWith("/w/") || pathname.startsWith("/t/")) return "workflows"
    if (pathname.startsWith(APP_ROUTES.inbox)) return "inbox"
    if (pathname.startsWith(APP_ROUTES.settings)) return "settings"
    return "overview"
}

const footerLine = (live: FooterConnection) => (overview: Overview): string => {
    const host = overview.host
    const parts = [CONNECTION[live]]
    if (!host.watch) parts.push(HOST.watchOff)
    parts.push(HOST.tick(host.tick, host.lastTickAt === null ? null : clockTime(host.lastTickAt)))
    return parts.join(" · ")
}

const projectsOf = (overview: Overview | undefined): readonly ProjectNavView[] =>
    (overview?.projects ?? []).map((project) => ({
        key: project.key,
        name: project.name,
        supervisor: supervisorStatus(project.supervisor?.liveness ?? null),
        isAlive: project.supervisor?.liveness === "alive",
    }))

/** The sidebar: destinations, each project's Supervisor, the open-decision badge and the host footer. */
export const WorkspaceNavBlock = (props: WorkspaceNavBlockProps) => {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { status } = useConnection()
    const query = useOverviewQuery()
    const slotLabels = useSlotLabels()
    const live: FooterConnection = status === "fixtures" ? "fixtures" : props.stream
    const overview = query.data
    const openDecisions = (overview?.projects ?? []).reduce((sum, project) => sum + project.openOwnerDecisions, 0)

    const select = (id: string) => {
        if (id.startsWith("project:")) {
            void navigate(leadWorkflow(overview, id.slice("project:".length)) ?? APP_ROUTES.overview)
            return
        }
        switch (id) {
            case "workflows":
                void navigate(leadWorkflow(overview) ?? APP_ROUTES.overview)
                return
            case "inbox":
                void navigate(APP_ROUTES.inbox)
                return
            case "settings":
                void navigate(APP_ROUTES.settings)
                return
            default:
                void navigate(APP_ROUTES.overview)
        }
    }

    return (
        <WorkspaceNavBlockBase
            props={{
                presentation: props.presentation,
                selectedKey: selectedFor(pathname),
                logoSrc,
                projects: projectsOf(overview),
                openDecisions,
                status: mapSlot(slotOfQuery(query), footerLine(live)),
                labels: {
                    landmark: NAV.landmark,
                    product: NAV.product,
                    edition: NAV.edition,
                    overview: NAV.overview,
                    workflows: NAV.workflows,
                    inbox: NAV.inbox,
                    inboxBadge: NAV.inboxBadge(openDecisions),
                    settings: NAV.settings,
                    projects: NAV.projects,
                    slot: slotLabels(CONNECTION[live]),
                },
            }}
            on={{ select, home: () => void navigate(APP_ROUTES.overview), retry: () => void query.refetch() }}
        />
    )
}
