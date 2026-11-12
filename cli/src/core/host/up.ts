import { hostUp, loadHost, selectServices } from "../../harness/host.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci host up [ids] [--stack <name>]`: starts every named service, or every service of the stack (and what it requires), that is down, in requires order; idempotent. */
export const hostUpVerb = defineVerb({
    path: ["host", "up"],
    summary: "start the host services of ops/host.yaml that are down, each after what it requires; one already up is left alone",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-up@1",
    flags: {
        ids: { kind: "rest", summary: "the services to bring up, with what they require (default every service)" },
        stack: { kind: "string", summary: "only the services of this stack of ops/host.yaml (starci: the shared SonarQube, its tunnel and the local npm registry)" },
    },
    run: async (context, flags) => {
        const config = loadHost()
        const outcomes = await hostUp(config, selectServices(config, flags.ids, flags.stack), context.cwd, context.progress)
        const red = outcomes.some((outcome) => outcome.outcome === "still down" || outcome.outcome === "blocked")
        return { data: { outcomes }, message: outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome} (${outcome.evidence})`).join("\n"), ...(red ? { exitCode: 1 } : {}) }
    },
})
