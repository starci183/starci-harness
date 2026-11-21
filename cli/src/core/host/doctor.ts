import { alertOwner, describeDoctor, runDoctor, withDoctorLock } from "../../harness/host-doctor.js"
import { loadHost } from "../../harness/host.js"
import { UsageError } from "../../shared/errors.js"
import type { VerbResult } from "../../shared/verb.js"
import { defineVerb } from "../../shared/verb.js"
import { machineDoctor } from "./machine.js"
import type { MachineDoctor } from "./machine.js"

const describeMachineDoctor = (doctor: MachineDoctor): string => {
    const calls = doctor.calls.map((call) => `  ${call.ok === null ? "skip" : call.ok ? "ok  " : "RED "} ${call.id}: ${call.evidence}`)
    const parity = Object.entries(doctor.parity).map(([id, entry]) => `  parity ${id}: ${entry.verdict}${entry.code === null ? "" : ` (${entry.code})`}: ${entry.detail}`)
    return [`host doctor ${doctor.machine}: ${doctor.red ? "red" : "green"}`, ...calls, ...parity].join("\n")
}

/** `starci host doctor [--stack <name>] [--fix] [--execute]`: reads each network of the stack from inside and, with `--fix --execute`, repairs it and alerts the owner once per incident. */
export const hostDoctorVerb = defineVerb({
    path: ["host", "doctor"],
    summary: "judge the host stack's networks from inside (does each service name resolve, is each service answered, is each container healthy and attached); --fix repairs what stopped answering (reconnect, restart, recreate the network) and alerts the owner on Telegram once per incident",
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-doctor@1",
    flags: {
        stack: { kind: "string", summary: "the stack of ops/host.yaml to judge (default starci: the gate and the tunnel of the embedding model share its edge network)" },
        fix: { kind: "boolean", summary: "repair what is wrong, least disruptive first: reconnect, then restart, then recreate the network (a dry run that prints the plan and the alert text unless --execute is given)" },
        execute: { kind: "boolean", summary: "with --fix: perform the repair and send the alert (default: a dry run)" },
        host: { kind: "string", summary: "a machine of config.yaml: one real call per service its roles turn on (an embed vector of the pinned dimensions, the Grafana login page, a status API, a BuildKit ping hook, each Swarm service at its replicas), then the parity of every served model across the machines serving it (equal dimensions, cosine >= the catalog's minimum, else HOST_EMBED_MISMATCH)" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.host !== undefined) {
            if (flags.stack !== undefined || flags.fix || flags.execute) throw new UsageError("host doctor --host <name> reads the machine's role services; --stack, --fix and --execute belong to the host stack's network self-heal")
            const doctor = await machineDoctor(flags.host, context.cwd)
            return { data: doctor, message: describeMachineDoctor(doctor), ...(doctor.red ? { exitCode: 1 } : {}) }
        }
        const stack = flags.stack ?? "starci"
        const config = loadHost()
        const work = async (): Promise<{ readonly report: Awaited<ReturnType<typeof runDoctor>>; readonly alert: Awaited<ReturnType<typeof alertOwner>> }> => {
            const report = await runDoctor(config, stack, { fix: flags.fix, execute: flags.execute, cwd: context.cwd, progress: context.progress })
            // Only a run that repairs alerts; a plain read never messages the owner, and a dry run only shows what would go out.
            const alert = flags.fix ? await alertOwner(report, { execute: flags.execute }) : { state: "none" as const, text: null, evidence: "a read alerts nobody: --fix --execute does" }
            return { report, alert }
        }
        const { report, alert } = flags.fix && flags.execute ? await withDoctorLock(stack, work) : await work()
        const lines = [describeDoctor(report), `alert: ${alert.state} (${alert.evidence})`, ...(alert.text !== null && alert.state === "dry" ? ["--- text ---", alert.text] : [])]
        return { data: { report, alert }, message: lines.join("\n"), ...(report.fixed ? {} : { exitCode: 1 }) }
    },
})
