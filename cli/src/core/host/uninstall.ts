import { describeOutcomes, hostUninstall, loadHost, selectServices, targetPlatform } from "../../harness/host.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci host uninstall [ids]`: removes the schedules `host install` registered; a task no service declares is never touched. */
export const hostUninstallVerb = defineVerb({
    path: ["host", "uninstall"],
    summary: "remove the schedules and launchers of the host services; StarCi tasks ops/host.yaml does not declare are never touched",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-uninstall@1",
    flags: {
        ids: { kind: "rest", summary: "the services to uninstall (default every service with a schedule)" },
        dry: { kind: "boolean", summary: "print the exact scheduler argv; run nothing" },
        platform: { kind: "string", summary: "plan for another platform (win32, linux, darwin); only with --dry" },
    },
    run: async (context, flags) => {
        const platform = targetPlatform(flags.platform, flags.dry)
        const outcomes = await hostUninstall(selectServices(loadHost(), flags.ids), context.cwd, flags.dry, platform)
        return { data: { dry: flags.dry, platform, outcomes }, message: describeOutcomes(outcomes) }
    },
})
