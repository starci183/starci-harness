import { hostUp, loadHost, selectServices } from "../../harness/host.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci host up [ids]`: starts every named service (and what it requires) that is down, in requires order; idempotent. */
export const hostUpVerb = defineVerb({
    path: ["host", "up"],
    summary: "start the host services of ops/host.yaml that are down, each after what it requires; one already up is left alone",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-up@1",
    flags: {
        ids: { kind: "rest", summary: "the services to bring up, with what they require (default every service)" },
    },
    run: async (context, flags) => {
        const config = loadHost()
        const outcomes = await hostUp(config, selectServices(config, flags.ids), context.cwd, context.progress)
        const red = outcomes.some((outcome) => outcome.outcome === "still down" || outcome.outcome === "blocked")
        return { data: { outcomes }, message: outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome} (${outcome.evidence})`).join("\n"), ...(red ? { exitCode: 1 } : {}) }
    },
})
