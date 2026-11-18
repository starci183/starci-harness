import type { VpsFleet, VpsServerRow } from "@contract"
import { useVpsQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { COMMON, VPS } from "../../../modules/i18n"
import { VpsFleetBlockBase, type VpsFleetView, type VpsRowView } from "./component"

const decimal = (value: number, digits: number): string => value.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
const orDash = (value: number | null, show: (value: number) => string): string => (value === null ? COMMON.dash : show(value))
const percent = (value: number | null): string => orDash(value, (shown) => `${String(shown)}%`)

/** An alert of `starci vps list` (cli/src/harness/vps/probe.ts readHealth) in the app's words; an unknown one stays as it came. */
const alertText = (alert: string): string => {
    const failed = /^(\d+) failed ssh logins in (\d+)h$/.exec(alert)
    if (failed !== null) return VPS.failedLogins(Number(failed[1]), Number(failed[2]))
    const used = /^(disk|memory) (\d+)% used$/.exec(alert)
    if (used !== null) return `${used[1] === "disk" ? "đĩa" : "RAM"} ${used[2] ?? ""}%`
    return alert === "unreachable" ? VPS.unreachable : alert
}

const toRow = (server: VpsServerRow): VpsRowView => {
    const health = server.health
    const failedAlert = health?.alerts.some((alert) => alert.includes("failed ssh logins")) === true
    const status =
        health === null
            ? { label: VPS.notProbed, tone: "neutral" as const }
            : health.reachable
              ? { label: VPS.up(orDash(health.uptimeSeconds, (seconds) => decimal(seconds / 86_400, 1))), tone: "success" as const }
              : { label: VPS.unreachable, tone: "danger" as const }
    const swarm = health?.swarm ?? null
    return {
        id: server.id,
        serverLine: VPS.serverLine(server.provider, server.os, server.projects.length),
        status,
        statusDetail: health?.reachable === false ? (health.error ?? "") : "",
        cpu: health?.reachable === true ? VPS.cpu(orDash(health.cpuCount, String), orDash(health.load1, (load) => decimal(load, 1))) : COMMON.dash,
        usage: health?.reachable === true ? VPS.usage(percent(health.memoryPercent), percent(health.diskPercent)) : "",
        failed: orDash(health?.failedLogins ?? null, String),
        isFailedAlert: failedAlert,
        swarmRole: server.swarmRole === "none" ? "" : server.swarmRole,
        swarm: swarm === null || swarm.state !== "active" ? (health?.reachable === true ? VPS.noSwarm : COMMON.dash) : VPS.swarm(orDash(swarm.nodes, String), orDash(swarm.services, String)),
        uiUrl: server.uiUrl,
        uiLabel: server.uiUrl.replace(/^https:\/\//, ""),
        ingress: server.ingress,
        panelUrl: server.panelUrl,
    }
}

const toView = (fleet: VpsFleet): VpsFleetView => {
    const alerting = fleet.servers.filter((server) => (server.health?.alerts.length ?? 0) > 0)
    return {
        rows: fleet.servers.map(toRow),
        alert: alerting.length === 0 ? null : { title: VPS.alertTitle(alerting.length), lines: alerting.map((server) => VPS.alertLine(server.id, (server.health?.alerts ?? []).map(alertText).join(", "))) },
    }
}

/** The Managed VPS region: the fleet `starci vps list` reads, with the failed-login alert and each server's UI and panel. */
export const VpsFleetBlock = () => {
    const query = useVpsQuery()
    const slotLabels = useSlotLabels()
    return (
        <VpsFleetBlockBase
            props={{
                fleet: mapSlot(slotOfQuery(query), toView),
                labels: { title: VPS.tableTitle, fact: VPS.tableFact, panel: VPS.panel, columns: VPS.columns, slot: slotLabels(VPS.empty, VPS.emptyHint) },
            }}
            on={{ retry: () => void query.refetch() }}
        />
    )
}
