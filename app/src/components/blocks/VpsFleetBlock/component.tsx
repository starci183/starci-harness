import { Alert, Badge, DataTable, EmptyNotice, Link, SurfaceCard, Text, type DataTableColumn } from "@starci/grammar/core"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/** One managed server, resolved for drawing. */
export interface VpsRowView {
    readonly id: string
    readonly serverLine: string
    readonly status: ToneLabel
    readonly statusDetail: string
    readonly cpu: string
    readonly usage: string
    readonly failed: string
    readonly isFailedAlert: boolean
    readonly swarmRole: string
    readonly swarm: string
    readonly uiUrl: string
    readonly uiLabel: string
    readonly ingress: string
    readonly panelUrl: string | null
}

/** The fleet and its alert, one line per server that raises one. */
export interface VpsFleetView {
    readonly rows: readonly VpsRowView[]
    readonly alert: { readonly title: string; readonly lines: readonly string[] } | null
}

/** Copy the connected block resolves. */
export interface VpsFleetBlockLabels {
    readonly title: string
    readonly fact: string
    readonly panel: string
    readonly columns: { readonly server: string; readonly status: string; readonly resources: string; readonly failed: string; readonly swarm: string; readonly door: string }
    readonly slot: SlotLabels
}

/** Complete input of VpsFleetBlockBase. */
export interface VpsFleetBlockBaseProps {
    readonly props: {
        readonly fleet: DataSlot<VpsFleetView>
        readonly labels: VpsFleetBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

/** Below the width all six columns need, the `low` columns fold under the server cell. */
const COLLAPSE_BELOW = 900

const FLEET_PLACEHOLDER: VpsFleetView = {
    alert: null,
    rows: ["v0", "v1", "v2"].map((id) => ({
        id,
        serverLine: "",
        status: { label: "", tone: "neutral" },
        statusDetail: "",
        cpu: "",
        usage: "",
        failed: "",
        isFailedAlert: false,
        swarmRole: "",
        swarm: "",
        uiUrl: "",
        uiLabel: "",
        ingress: "",
        panelUrl: null,
    })),
}

const Cell = ({ row, columnId, panel }: { readonly row: VpsRowView; readonly columnId: string; readonly panel: string }) => {
    switch (columnId) {
        case "server":
            return (
                <div className="app-pair">
                    <Text size="sm" isStrong mono>
                        {row.id}
                    </Text>
                    <Text size="xs" tone="muted">
                        {row.serverLine}
                    </Text>
                </div>
            )
        case "status":
            return (
                <div className="app-pair">
                    <StatusWord status={row.status} />
                    <Text size="xs" tone="muted" overflow="truncate">
                        {row.statusDetail}
                    </Text>
                </div>
            )
        case "resources":
            return (
                <div className="app-pair">
                    <Text size="sm" tabular>
                        {row.cpu}
                    </Text>
                    <Text size="xs" tone="muted" tabular>
                        {row.usage}
                    </Text>
                </div>
            )
        case "failed":
            return row.isFailedAlert ? (
                <Badge tone="danger">{row.failed}</Badge>
            ) : (
                <Text size="sm" tabular>
                    {row.failed}
                </Text>
            )
        case "swarm":
            return (
                <span className="app-row">
                    {row.swarmRole === "" ? null : <Badge tone="neutral">{row.swarmRole}</Badge>}
                    <Text size="xs" tone="muted">
                        {row.swarm}
                    </Text>
                </span>
            )
        case "door":
            return (
                <div className="app-pair">
                    <Link href={row.uiUrl} kind="external">
                        {row.uiLabel}
                    </Link>
                    <span className="app-row">
                        {row.ingress === "" ? null : <Badge tone="neutral">{row.ingress}</Badge>}
                        {row.panelUrl === null ? null : (
                            <Link href={row.panelUrl} kind="external">
                                {panel}
                            </Link>
                        )}
                    </span>
                </div>
            )
        default:
            return null
    }
}

/** Pure half: the failed-login and health alert, then one row per managed server with its health and its doors. */
export const VpsFleetBlockBase = (props: VpsFleetBlockBaseProps) => {
    const { labels } = props.props
    const columns: readonly DataTableColumn<VpsRowView>[] = [
        { id: "server", label: labels.columns.server, isRowHeader: true },
        { id: "status", label: labels.columns.status },
        { id: "resources", label: labels.columns.resources, priority: "low" },
        { id: "failed", label: labels.columns.failed, align: "end" },
        { id: "swarm", label: labels.columns.swarm, priority: "low" },
        { id: "door", label: labels.columns.door },
    ]
    return (
        <SlotView
            slot={props.props.fleet}
            placeholder={FLEET_PLACEHOLDER}
            labels={labels.slot}
            onRetry={props.on.retry}
            isEmpty={(fleet) => fleet.rows.length === 0}
            render={(fleet, isLoading) => (
                <div className="app-stack">
                    {fleet.alert === null ? null : <Alert tone="negative" title={fleet.alert.title} description={fleet.alert.lines.join(" · ")} />}
                    <SurfaceCard label={labels.title} headingLevel={2} fact={labels.fact}>
                        <DataTable<VpsRowView>
                            label={labels.title}
                            columns={columns}
                            rows={fleet.rows}
                            renderCell={(row, columnId) => <Cell row={row} columnId={columnId} panel={labels.panel} />}
                            emptyContent={<EmptyNotice message={labels.slot.empty} />}
                            isLoading={isLoading}
                            collapseBelow={COLLAPSE_BELOW}
                        />
                    </SurfaceCard>
                </div>
            )}
        />
    )
}
