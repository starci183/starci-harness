import { describeRoute, pickRoute, RouteRefusal, simulateRoute } from "../../harness/router.js"
import type { RouteInput, RouteMember, RoutePick, RouteRecord, RouteSimulation } from "../../harness/router.js"
import { loadRouting, parseDifficulty } from "../../harness/routing.js"
import type { CoordinatorRole } from "../../harness/routing.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** What route explain decided: the pick or the refusal with the whole record, or a simulation's tally. */
interface RouteExplainData {
    readonly chosen: Omit<RoutePick, "record"> | null
    readonly refusal: { readonly code: string; readonly message: string; readonly resetAt: string | null } | null
    readonly record: RouteRecord | null
    readonly simulation: RouteSimulation | null
}

const list = (value: string | undefined): string[] | undefined => {
    const names = value?.split(",").map((name) => name.trim()).filter((name) => name !== "")
    return names === undefined || names.length === 0 ? undefined : names
}

const members = (value: string | undefined): RouteMember[] | undefined =>
    list(value)?.map((entry) => {
        const [agent, model] = entry.split("/")
        if (agent === undefined || agent === "" || model === undefined || model === "") throw new Refusal("CLI_USAGE", `--red takes agent/model entries, not "${entry}"`, EXIT_USAGE)
        return { agent, model }
    })

const coordinatorRole = (value: string | undefined): CoordinatorRole | undefined => {
    if (value === undefined || value === "supervisor" || value === "kernel") return value
    throw new Refusal("CLI_USAGE", `--coordinator is supervisor or kernel, not "${value}"`, EXIT_USAGE)
}

const wholeNumber = (flag: string, value: string | undefined, fallback: number): number => {
    const number = value === undefined ? fallback : Number(value)
    if (!Number.isInteger(number) || number < 1) throw new Refusal("CLI_USAGE", `--${flag} is a whole number from 1, not "${String(value)}"`, EXIT_USAGE)
    return number
}

const percent = (part: number, whole: number): string => `${((part / whole) * 100).toFixed(1)}%`

/** The tally of a simulation as text. */
const simulationLines = (simulation: RouteSimulation): string[] => [
    `simulated ${String(simulation.picks)} picks (nothing recorded)`,
    ...Object.entries(simulation.byMember).map(([member, count]) => `  ${member}: ${String(count)} (${percent(count, simulation.picks)})`),
    ...Object.entries(simulation.byReason).map(([by, count]) => `  by ${by}: ${String(count)} (${percent(count, simulation.picks)})`),
    ...Object.entries(simulation.refused).map(([code, count]) => `  refused ${code}: ${String(count)}`),
]

/** `starci route explain`: dry-runs the router for a worker or coordinator and prints the whole decision path, or a run of simulated picks. */
export const routeExplainVerb = defineVerb({
    path: ["route", "explain"],
    summary: "dry-run worker or coordinator routing: tier, filters, qualification, quota, probe, scores, exploration and the chosen member; --simulate tallies n picks",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/route-explain@2",
    flags: {
        label: { kind: "string", summary: "the worker label, one op file ops/ops/<label>.md (choose this or --coordinator)" },
        coordinator: { kind: "string", summary: "the coordinator seat: supervisor or kernel (choose this or --label)" },
        difficulty: { kind: "string", summary: "the measured difficulty: easy, medium, hard, insane or 1..4 (the label's floor raises it)" },
        attempt: { kind: "string", summary: "the attempt number in the task's lineage (default 1)" },
        red: { kind: "string", summary: "the contract-red attempts so far, as agent/model,... (the second escalates the tier)" },
        risk: { kind: "string", summary: "the task's risk tags (comma list of routing.yaml qualification.riskTags); any makes it high-risk" },
        simulate: { kind: "string", summary: "run this many picks over one snapshot, each remembering the ones before, and tally them" },
    },
    run: (_context, flags) => {
        const routing = loadRouting()
        const coordinator = coordinatorRole(flags.coordinator)
        if ((flags.label === undefined) === (coordinator === undefined)) throw new Refusal("CLI_USAGE", "choose exactly one of --label or --coordinator", EXIT_USAGE)
        const label = coordinator ?? flags.label
        if (label === undefined) throw new Refusal("CLI_USAGE", "choose --label or --coordinator", EXIT_USAGE)
        const difficulty = flags.difficulty === undefined ? undefined : parseDifficulty(routing, flags.difficulty)
        const input: RouteInput = { label, coordinator, difficulty, attempt: wholeNumber("attempt", flags.attempt, 1), previousRed: members(flags.red), risk: list(flags.risk) }
        if (flags.simulate !== undefined) {
            const simulation = simulateRoute(input, wholeNumber("simulate", flags.simulate, 1))
            const data: RouteExplainData = { chosen: null, refusal: null, record: null, simulation }
            return Promise.resolve({ data, message: simulationLines(simulation).join("\n") })
        }
        const answer = pickRoute(input, { record: false })
        const lines = describeRoute(answer)
        if (answer instanceof RouteRefusal) {
            const data: RouteExplainData = { chosen: null, refusal: { code: answer.code, message: answer.message, resetAt: answer.resetAt }, record: answer.record, simulation: null }
            return Promise.resolve({ data, message: lines.join("\n"), exitCode: 1 })
        }
        const { record, ...chosen } = answer
        const data: RouteExplainData = { chosen, refusal: null, record, simulation: null }
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})
