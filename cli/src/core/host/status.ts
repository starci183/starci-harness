import { hostStatus, loadHost, selectServices } from "../../harness/host.js"
import { UsageError } from "../../shared/errors.js"
import type { VerbResult } from "../../shared/verb.js"
import { defineVerb, EVERYONE } from "../../shared/verb.js"
import { machineStatus } from "./machine.js"
import type { MachineStatus } from "./machine.js"

/** The human lines of a machine's status: each service, its state and evidence, its drift, the gaps, and the model endpoints. */
export const describeMachine = (status: MachineStatus): string => {
    const width = Math.max(0, ...status.services.map((service) => service.id.length))
    const lines = status.services.map((service) => `  ${service.id.padEnd(width)}  ${service.state}: ${service.evidence}${service.drift.map((line) => `\n  ${" ".repeat(width)}  drift: ${line}`).join("")}`)
    const endpoints = Object.entries(status.endpoints).flatMap(([id, list]) => (list.length === 0 ? [] : [`  endpoints of ${id} (in router order): ${list.map((endpoint) => `${endpoint.machine} ${endpoint.url}`).join(", ")}`]))
    return [
        `machine ${status.machine} (${status.site}), roles ${status.roles.join(", ")}${status.reached ? "" : `: NOT REACHED (${status.error ?? "no answer"})`}`,
        ...(status.engine === null ? [] : [`  ${status.engine}`]),
        ...lines,
        status.gaps.length === 0 ? "  no gap" : `  gaps: ${status.gaps.join(", ")} (starci host up --host ${status.machine} --execute brings up what is missing)`,
        ...endpoints,
    ].join("\n")
}

/** `starci host status [ids]`: every service of ops/host.yaml up, down or not installed, with its evidence; changes nothing. */
export const hostStatusVerb = defineVerb({
    path: ["host", "status"],
    summary: "report each host service of ops/host.yaml (up, down, not installed) with its evidence, and the StarCi tasks the harness does not own; with --host <name>, the services that machine's roles turn on, their gaps and the model endpoints",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/host-status@1",
    flags: {
        ids: { kind: "rest", summary: "the services to report (default every service)" },
        stack: { kind: "string", summary: "only the services of this stack of ops/host.yaml (starci: the shared SonarQube, its tunnel, the local npm registry and the embeddings gate and tunnel)" },
        host: { kind: "string", summary: "a machine of config.yaml: report each service its roles turn on (running, adopted, partial, missing, unsupported, unbuilt), its drift, the gaps, and the endpoints of every served model in router order (`--json` data.endpoints, what the apps' ai-router reads)" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.host !== undefined) {
            if (flags.ids.length > 0 || flags.stack !== undefined) throw new UsageError("host status --host <name> reports the machine's role services; it takes no service ids or --stack")
            const status = await machineStatus(flags.host, context.cwd)
            return { data: status, message: describeMachine(status), ...(status.gaps.length > 0 || !status.reached ? { exitCode: 1 } : {}) }
        }
        const config = loadHost()
        const data = await hostStatus(config, selectServices(config, flags.ids, flags.stack), context.cwd)
        const width = Math.max(...data.services.map((service) => service.id.length))
        const lines = data.services.map((service) => {
            // A service judged by its schedule alone already carries the schedule's evidence as its own.
            const judgedBySchedule = service.schedule !== undefined && service.evidence.startsWith(service.schedule.evidence)
            const schedule = service.schedule === undefined || judgedBySchedule ? "" : `\n${" ".repeat(width + 2)}schedule ${service.schedule.name}: ${service.schedule.state} (${service.schedule.evidence})`
            return `${service.id.padEnd(width)}  ${service.state}: ${service.evidence}${schedule}`
        })
        const others = data.others.map((task) => `${task.kind}: ${task.name} runs ${task.command} ${task.arguments}\n  ${task.hint}`)
        return { data, message: [`host ${data.platform}, scheduler ${data.scheduler}`, ...lines, ...others].join("\n") }
    },
})
