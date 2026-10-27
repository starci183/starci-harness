import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stateBase } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import type { ScenarioResult } from "./runner.js"
import { benchRoot, GROUPS, runnable } from "./scenario.js"
import type { Scenario } from "./scenario.js"

const START = "<!-- scoreboard:start -->"
const END = "<!-- scoreboard:end -->"

/** The scoreboard file: bench/README.md, whose table between the scoreboard markers `bench run --record` rewrites. */
export const scoreboardPath = (): string => join(benchRoot(), "README.md")

/** Appends each result to the host's bench log (`<state base>/bench/results.jsonl`), which nothing tracked reads. */
export const logResults = (results: readonly ScenarioResult[]): void => {
    const dir = join(stateBase(), "bench")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, "results.jsonl"), results.map((result) => `${JSON.stringify(result)}\n`).join(""))
}

const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ")

// The last recorded result of each scenario, read back from the table so a partial run keeps the other rows.
const previous = (text: string): Map<string, { readonly verdict: string; readonly date: string }> => {
    const rows = new Map<string, { readonly verdict: string; readonly date: string }>()
    const body = text.slice(text.indexOf(START), text.indexOf(END))
    for (const line of body.split("\n")) {
        const cells = line.split("|").map((part) => part.trim())
        const id = /^\[([a-z0-9-]+)\]/.exec(cells[1] ?? "")?.[1]
        if (id !== undefined) rows.set(id, { verdict: cells[5] ?? "", date: cells[6] ?? "" })
    }
    return rows
}

const verdictCell = (result: ScenarioResult | undefined, scenario: Scenario, kept: { readonly verdict: string } | undefined): string => {
    if (!runnable(scenario)) return "pending"
    if (result === undefined) return kept?.verdict ?? "not run"
    return result.verdict === "pass" ? "pass" : `**${result.verdict.toUpperCase()}**`
}

/** The scoreboard table: one row per scenario with its group, automation, last verdict and the day it was recorded. */
export const renderTable = (scenarios: readonly Scenario[], results: readonly ScenarioResult[], text: string): string => {
    const kept = previous(text)
    const latest = new Map(results.filter((result) => result.fault === null).map((result) => [result.id, result]))
    const rows = scenarios.map((scenario) => {
        const result = latest.get(scenario.id)
        const date = result === undefined ? (runnable(scenario) ? (kept.get(scenario.id)?.date ?? "") : "") : result.at.slice(0, 10)
        return `| [${scenario.id}](scenarios/${scenario.id}.yaml) | ${scenario.group} | ${cell(scenario.title)} | ${scenario.automation} | ${verdictCell(result, scenario, kept.get(scenario.id))} | ${date} |`
    })
    return ["| scenario | group | what | automation | result | recorded |", "|---|---|---|---|---|---|", ...rows].join("\n")
}

/** Rewrites the scoreboard table of bench/README.md in place; refuses a README without the scoreboard markers. */
export const recordScoreboard = (scenarios: readonly Scenario[], results: readonly ScenarioResult[]): void => {
    const file = scoreboardPath()
    const text = existsSync(file) ? readFileSync(file, "utf8") : ""
    if (!text.includes(START) || !text.includes(END)) throw new Refusal("BENCH_SCOREBOARD", `${file} has no ${START} ... ${END} block to rewrite`)
    const head = text.slice(0, text.indexOf(START) + START.length)
    const tail = text.slice(text.indexOf(END))
    writeFileSync(file, `${head}\n${renderTable(scenarios, results, text)}\n${tail}`)
}

/** Counts per group and automation status, for `bench list`. */
export const summary = (scenarios: readonly Scenario[]): string => {
    const rows = GROUPS.map((group) => {
        const of = scenarios.filter((scenario) => scenario.group === group)
        const count = (automation: string): string => String(of.filter((scenario) => scenario.automation === automation).length)
        return [group, String(of.length), count("automated"), String(of.filter(runnable).length), count("semi"), count("manual")]
    }).filter((row) => row[1] !== "0")
    return formatTable([["GROUP", "SCENARIOS", "AUTOMATED", "RUNNABLE NOW", "SEMI", "MANUAL"], ...rows])
}
