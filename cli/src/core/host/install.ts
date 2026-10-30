import { describeOutcomes, hostInstall, loadHost, selectServices, targetPlatform } from "../../harness/host.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci host install [ids]`: registers each service's schedule of ops/host.yaml; without `--execute` it prints the exact scheduler argv instead. */
export const hostInstallVerb = defineVerb({
    path: ["host", "install"],
    summary: "register the schedules of the host services (Windows: a hidden StarCi scheduled task running a launcher under the state base)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-install@1",
    flags: {
        ids: { kind: "rest", summary: "the services to install (default every service with a schedule)" },
        execute: { kind: "boolean", summary: "write the launcher and register the schedule (default: a dry run that prints the launcher and the exact scheduler argv)" },
        platform: { kind: "string", summary: "plan for another platform (win32, linux, darwin); only as a dry run (without --execute)" },
    },
    run: async (context, flags) => {
        const platform = targetPlatform(flags.platform, !flags.execute)
        const outcomes = await hostInstall(selectServices(loadHost(), flags.ids), context.cwd, !flags.execute, platform)
        return { data: { dry: !flags.execute, platform, outcomes }, message: describeOutcomes(outcomes) }
    },
})
