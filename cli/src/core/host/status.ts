import { hostStatus, loadHost, selectServices } from "../../harness/host.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

/** `starci host status [ids]`: every service of ops/host.yaml up, down or not installed, with its evidence; changes nothing. */
export const hostStatusVerb = defineVerb({
    path: ["host", "status"],
    summary: "report each host service of ops/host.yaml (up, down, not installed) with its evidence, and the StarCi tasks the harness does not own",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/host-status@1",
    flags: {
        ids: { kind: "rest", summary: "the services to report (default every service)" },
    },
    run: async (context, flags) => {
        const config = loadHost()
        const data = await hostStatus(config, selectServices(config, flags.ids), context.cwd)
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
