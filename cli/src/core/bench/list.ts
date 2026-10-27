import { formatTable } from "../../shared/output.js"
import { defineVerb, EVERYONE } from "../../shared/verb.js"
import { loadScenarios, runnable } from "./scenario.js"
import { summary } from "./scoreboard.js"

/** `starci bench list`: the stress scenarios of bench/scenarios with their group, automation and whether `bench run` runs them today. */
export const benchListVerb = defineVerb({
    path: ["bench", "list"],
    summary: "list the stress scenarios of bench/scenarios: group, automation, runnable today, and the count per group",
    editions: [],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/bench-list@1",
    flags: {
        group: { kind: "string", summary: "only this group" },
    },
    run: async (_context, flags) => {
        const scenarios = loadScenarios().filter((scenario) => flags.group === undefined || scenario.group === flags.group)
        const rows = scenarios.map((scenario) => ({ id: scenario.id, group: scenario.group, title: scenario.title, automation: scenario.automation, runnable: runnable(scenario), pending: scenario.pending ?? null }))
        const table = formatTable([["SCENARIO", "GROUP", "AUTOMATION", "RUNS NOW", "TITLE"], ...rows.map((row) => [row.id, row.group, row.automation, row.runnable ? "yes" : "no", row.title])])
        return Promise.resolve({ data: { scenarios: rows }, message: `${table}\n\n${summary(scenarios)}` })
    },
})
