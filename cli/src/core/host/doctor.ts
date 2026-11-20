import { alertOwner, describeDoctor, runDoctor, withDoctorLock } from "../../harness/host-doctor.js"
import { loadHost } from "../../harness/host.js"
import { defineVerb } from "../../shared/verb.js"

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
    },
    run: async (context, flags) => {
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
