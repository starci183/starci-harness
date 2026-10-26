import { describeRoute, pickRoute, RouteRefusal } from "../../harness/router.js"
import type { RouteMember, RoutePick, RouteRecord } from "../../harness/router.js"
import { loadRouting, parseDifficulty } from "../../harness/routing.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** What route explain decided: the pick or the refusal, with the whole record. */
interface RouteExplainData {
    readonly chosen: Omit<RoutePick, "record"> | null
    readonly refusal: { readonly code: string; readonly message: string; readonly resetAt: string | null } | null
    readonly record: RouteRecord
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

/** `starci route explain`: dry-runs the router for a label and prints the whole decision path; nothing is recorded. */
export const routeExplainVerb = defineVerb({
    path: ["route", "explain"],
    summary: "dry-run the router for a label: the tier, the chain, every dropped member with its reason, and the chosen agent and model",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/route-explain@1",
    flags: {
        label: { kind: "string", summary: "the worker label, one op file ops/ops/<label>.md", required: true },
        difficulty: { kind: "string", summary: "the measured difficulty: easy, medium, hard, insane or 1..4 (the label's floor raises it)" },
        attempt: { kind: "string", summary: "the attempt number in the task's lineage (default 1)" },
        red: { kind: "string", summary: "the contract-red attempts so far, as agent/model,... (the second escalates the tier)" },
        only: { kind: "string", summary: "bias: only these agents, models or agent/model members (comma list)" },
        avoid: { kind: "string", summary: "bias: never these (comma list)" },
        prefer: { kind: "string", summary: "bias: these first (comma list)" },
    },
    run: (_context, flags) => {
        const routing = loadRouting()
        const difficulty = flags.difficulty === undefined ? undefined : parseDifficulty(routing, flags.difficulty)
        const attempt = flags.attempt === undefined ? 1 : Number(flags.attempt)
        if (!Number.isInteger(attempt) || attempt < 1) throw new Refusal("CLI_USAGE", `--attempt is a whole number from 1, not "${String(flags.attempt)}"`, EXIT_USAGE)
        const answer = pickRoute(
            { label: flags.label, difficulty, attempt, previousRed: members(flags.red), workflowBias: { only: list(flags.only), avoid: list(flags.avoid), prefer: list(flags.prefer) } },
            { record: false },
        )
        const lines = describeRoute(answer)
        if (answer instanceof RouteRefusal) {
            const data: RouteExplainData = { chosen: null, refusal: { code: answer.code, message: answer.message, resetAt: answer.resetAt }, record: answer.record }
            return Promise.resolve({ data, message: lines.join("\n"), exitCode: 1 })
        }
        const { record, ...chosen } = answer
        const data: RouteExplainData = { chosen, refusal: null, record }
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})
