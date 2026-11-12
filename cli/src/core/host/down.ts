import { hostDown, loadHost, selectServices } from "../../harness/host.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci host down <ids>`: stops the named host services and what requires them, dependents first; stops only, never removes a container or a volume. */
export const hostDownVerb = defineVerb({
    path: ["host", "down"],
    summary: "stop the named host services of ops/host.yaml (and what requires them) that declare a stop; data and volumes are never removed",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-down@1",
    flags: {
        ids: { kind: "rest", summary: "the services to stop (at least one, or a stack), with what requires them" },
        stack: { kind: "string", summary: "only the services of this stack of ops/host.yaml (starci: the shared SonarQube, its tunnel and the local npm registry)" },
    },
    run: async (context, flags) => {
        if (flags.ids.length === 0 && flags.stack === undefined) throw new Refusal("HOST_DOWN_NEEDS_SERVICE", "name the service or the stack to stop (host down never stops every service)")
        const config = loadHost()
        const outcomes = await hostDown(config, selectServices(config, flags.ids, flags.stack), context.cwd, context.progress)
        const red = outcomes.some((outcome) => outcome.outcome === "still up")
        return { data: { outcomes }, message: outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome} (${outcome.evidence})`).join("\n"), ...(red ? { exitCode: 1 } : {}) }
    },
})
