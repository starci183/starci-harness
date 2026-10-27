import { Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { defineVerb } from "../../shared/verb.js"
import { inOrder } from "../../harness/sequential.js"
import { runScenario } from "./runner.js"
import { loadScenarios, runnable } from "./scenario.js"
import { logResults, recordScoreboard, scoreboardPath } from "./scoreboard.js"

/**
 * `starci bench run <id>|--all`: runs stress scenarios of bench/scenarios, each in its own scratch repository and state base
 * under `<state base>/bench/<run>`, with the bench's Orca stand-in, and asserts their pass criteria from the ledger and git.
 * It writes nothing tracked unless `--record` asks it to rewrite the scoreboard of bench/README.md. Exit 1 when any ran red.
 */
export const benchRunVerb = defineVerb({
    path: ["bench", "run"],
    summary: "run stress scenarios (bench/scenarios) in scratch repositories with the Orca stand-in; --record rewrites the scoreboard",
    editions: [],
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/bench-run@1",
    flags: {
        id: { kind: "string", summary: "the scenario to run", positional: true },
        all: { kind: "boolean", summary: "run every automated scenario" },
        fault: { kind: "string", summary: "run the scenario's steps for this named fault instead of its default path" },
        record: { kind: "boolean", summary: "rewrite the scoreboard table of bench/README.md with these results" },
    },
    run: async (context, flags) => {
        const scenarios = loadScenarios()
        if (flags.all === (flags.id !== undefined)) throw new Refusal("CLI_USAGE", "name one scenario id or --all", 2)
        const chosen = flags.all ? scenarios.filter(runnable) : scenarios.filter((scenario) => scenario.id === flags.id)
        if (chosen.length === 0) throw new Refusal("SCENARIO_UNKNOWN", `no scenario ${flags.id ?? ""} in bench/scenarios (starci bench list)`)
        const fault = flags.fault ?? null
        const unknownFault = chosen.find((scenario) => fault !== null && !(scenario.faults ?? []).includes(fault))
        if (unknownFault !== undefined) throw new Refusal("FAULT_UNKNOWN", `${unknownFault.id} declares no fault ${fault ?? ""} (its faults: ${(unknownFault.faults ?? []).join(", ") || "none"})`)
        const faultTag = fault === null ? "" : " [" + fault + "]"
        const results = await inOrder(chosen, async (scenario) => {
            const result = await runScenario(scenario, fault)
            const failures = result.failures.map((failure) => "\n        " + failure).join("")
            context.progress(`${result.verdict.padEnd(7)} ${scenario.id}${faultTag} (${String(Math.round(result.ms / 1000))} s)${failures}`)
            return result
        })
        logResults(results)
        if (flags.record) recordScoreboard(scenarios, results)
        const red = results.filter((result) => result.verdict === "fail" || result.verdict === "error")
        const table = formatTable([["SCENARIO", "VERDICT", "SECONDS", "RUN"], ...results.map((result) => [result.id, result.verdict, String(Math.round(result.ms / 1000)), result.runDir ?? "-"])])
        const recorded = flags.record ? `\nscoreboard rewritten: ${scoreboardPath()}` : ""
        const message = `${table}\n${String(results.length - red.length)} of ${String(results.length)} green${recorded}`
        return { data: { results, recorded: flags.record }, message, ...(red.length > 0 ? { exitCode: 1 } : {}) }
    },
})
