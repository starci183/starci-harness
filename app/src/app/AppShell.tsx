import {
    ChartBarSquareIcon,
    Cog6ToothIcon,
    EllipsisHorizontalIcon,
    FolderIcon,
    InboxIcon,
    RectangleGroupIcon,
} from "@heroicons/react/24/outline"
import {
    Badge,
    CoreGrammarRoot,
    IdentityLockup,
    PageContainer,
    Sidebar,
    Text,
    WorkspaceShell,
    type SidebarGroup,
} from "@starci/grammar/core"
import { useMemo } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { useOverview } from "../api/client"
import type { Overview } from "@contract"
import { useLiveEvents } from "../api/live"
import { useConnection } from "./connection"
import { CONNECTION, HOST, LOCALE, NAV, supervisorStatus, type FooterConnection } from "./labels"
import { logoSrc } from "./logo"

const clock = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" })

/** The workflow a "Workflows" press opens: the first running one, else the first listed. */
const leadWorkflow = (overview: Overview | undefined, project?: string): string | null => {
    const rows = (overview?.workflows ?? []).filter(row => project === undefined || row.project === project)
    const lead = rows.find(row => row.status === "running") ?? rows[0]
    return lead === undefined ? null : `/w/${encodeURIComponent(lead.project)}/${encodeURIComponent(lead.id)}`
}

const selectedFor = (pathname: string): string => {
    if (pathname.startsWith("/w/") || pathname.startsWith("/t/")) return "workflows"
    if (pathname.startsWith("/inbox")) return "inbox"
    if (pathname.startsWith("/settings")) return "settings"
    return "overview"
}

/** One quiet status line: where the data comes from, the host watch, and the last tick. */
const SidebarFooter = ({ overview, live }: { readonly overview: Overview | undefined; readonly live: FooterConnection }) => {
    const host = overview?.host
    const parts = [CONNECTION[live]]
    if (host !== undefined) {
        if (!host.watch) parts.push(HOST.watchOff)
        parts.push(HOST.tick(host.tick, host.lastTickAt === null ? null : clock.format(new Date(host.lastTickAt))))
    }
    return (
        <Text size="xs" tone="muted" live="polite">
            {parts.join(" · ")}
        </Text>
    )
}

/** The mockup's frame: dark sidebar (logo, destinations, projects, host footer) beside the routed page. */
export const AppShell = () => {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { status, connection } = useConnection()
    const overview = useOverview().data
    const streamState = useLiveEvents(connection)
    const live: FooterConnection = status === "fixtures" ? "fixtures" : streamState

    const openDecisions = (overview?.projects ?? []).reduce((sum, project) => sum + project.openOwnerDecisions, 0)

    const groups = useMemo<SidebarGroup[]>(
        () => [
            {
                id: "main",
                items: [
                    { id: "overview", label: NAV.overview, source: ChartBarSquareIcon },
                    { id: "workflows", label: NAV.workflows, source: RectangleGroupIcon },
                    {
                        id: "inbox",
                        label: NAV.inbox,
                        source: InboxIcon,
                        ...(openDecisions > 0
                            ? { badge: openDecisions, badgeLabel: NAV.inboxBadge(openDecisions), badgeMax: 99 }
                            : {}),
                    },
                    { id: "settings", label: NAV.settings, source: Cog6ToothIcon },
                ],
            },
            {
                id: "projects",
                label: NAV.projects,
                items: (overview?.projects ?? []).map(project => {
                    const supervisor = supervisorStatus(project.supervisor?.liveness ?? null)
                    return {
                        id: `project:${project.key}`,
                        label: project.name,
                        source: FolderIcon,
                        // A status dot only. Its words (tooltip and accessible name) wait on Grammar gap G1: a Sidebar
                        // item `status` slot; the item's name is fixed to its label today.
                        trailing: <Badge isDot tone={supervisor.tone} />,
                    }
                }),
            },
        ],
        [overview?.projects, openDecisions],
    )

    const onAction = (id: string) => {
        if (id.startsWith("project:")) {
            navigate(leadWorkflow(overview, id.slice("project:".length)) ?? "/")
            return
        }
        switch (id) {
            case "overview":
                navigate("/")
                return
            case "workflows":
                navigate(leadWorkflow(overview) ?? "/")
                return
            case "inbox":
                navigate("/inbox")
                return
            case "settings":
                navigate("/settings")
                return
        }
    }

    const header = <IdentityLockup title={NAV.product} subtitle={NAV.edition} logoSrc={logoSrc} onPress={() => navigate("/")} />
    const footer = <SidebarFooter overview={overview} live={live} />
    const sidebar = (presentation: "rail" | "drawer") => (
        // The mockup's dark sidebar: a dark Grammar island inside the page's own theme.
        <CoreGrammarRoot theme="dark" className="app-sidebar-island">
            <Sidebar
                label={NAV.landmark}
                presentation={presentation}
                groups={groups}
                selectedKey={selectedFor(pathname)}
                header={header}
                footer={footer}
                onAction={onAction}
            />
        </CoreGrammarRoot>
    )

    return (
        <WorkspaceShell
            viewport="fixed"
            navigation={sidebar("rail")}
            navigationLabel={NAV.landmark}
            navigationDrawer={{
                title: NAV.landmark,
                openLabel: NAV.openDrawer,
                closeLabel: NAV.closeDrawer,
                source: EllipsisHorizontalIcon,
                content: sidebar("drawer"),
            }}
            primary={
                // Every routed page sits in the Grammar page inset; pages write their own vertical rhythm only.
                <PageContainer measure="full" className="app-page">
                    <Outlet />
                </PageContainer>
            }
            primaryLabel={NAV.content}
        />
    )
}
