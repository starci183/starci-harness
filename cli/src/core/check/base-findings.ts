import { join, relative } from "node:path"
import { inCleanCheckout } from "../../harness/clean-verify.js"
import { underPaths } from "../../harness/contract.js"
import { linkInstall } from "../../harness/land.js"
import type { StepResult } from "./scope.js"

/** The steps whose output lists findings a base can already hold: a widened typecheck, lint or canon is judged against its base. */
const JUDGED_STEPS: ReadonlySet<StepResult["step"]> = new Set<StepResult["step"]>(["typecheck", "lint", "canon"])

/** The findings of one red step that were already at a base (`at`): judged there, never blamed on the change. */
export interface BaseFindings {
    readonly package: string
    readonly step: StepResult["step"]
    readonly at: string
    readonly findings: readonly string[]
}

/** What judging a run against its bases found: the first base, and per step and base the findings that were there already. */
export interface BaseJudgement {
    readonly base: string
    readonly steps: readonly BaseFindings[]
}

/**
 * The same tier run at another commit in a clean checkout (`dir`): a widened run's base, or a relayed source's head
 * (relay-baseline.ts), whose findings answer only for the files under `paths` it relays and never for a rule of `except` (the
 * composition rules, which the relay's composer answers for).
 */
export interface BaseRun {
    readonly base: string
    readonly dir: string
    readonly steps: readonly StepResult[]
    readonly paths?: readonly string[] | undefined
    readonly except?: readonly string[] | undefined
}

/** A line that counts or labels findings and is none itself: a summary (`✖ 5 problems`, `Found 3 errors`) or a group label (`--- config ...`). */
const SUMMARY = /^\s*(?:--- |[✖×]\s|\d+ problems?\b|found \d+ errors?\b|\d+ errors?\b.*\bwarnings?\b)/i

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

/**
 * The findings of a step's output, each keyed line-insensitively: the rule, the file and the message, with the checkout root and
 * every line and column number dropped, so one finding at the base and after a change that moved it meets as one key. A line that
 * opens with no indent and holds no blank is a file header (ESLint's stylish report), whose path prefixes its indented findings.
 */
export const findingKeys = (output: string, roots: readonly string[]): string[] => {
    // Paths are compared with forward slashes: git names a root with them, a tool's report often with backslashes.
    const rootPattern = new RegExp(roots.map((root) => `${escaped(root.replaceAll("\\", "/"))}/?`).join("|"), "gi")
    let file = ""
    const keys: string[] = []
    for (const raw of output.split(/\r?\n/)) {
        const line = raw.replaceAll("\\", "/").replace(rootPattern, "")
        if (line.trim() === "" || SUMMARY.test(line)) continue
        const indented = /^\s/.test(line)
        if (!indented && !/\s/.test(line.trim())) {
            file = line.trim()
            continue
        }
        // A path's own colon (`file: error`, `file(1,2): error`) goes too, so one finding meets as one key in any report shape.
        const text = line
            .replace(/\(\d+,\d+\)/g, "")
            .replace(/\b\d+:\d+\b/g, "")
            .replace(/:\d+(?::\d+)?\b/g, "")
            .replace(/^(\s*\S+?):(?=\s)/, "$1")
            .replace(/\s+/g, " ")
            .trim()
        keys.push(indented && file !== "" ? `${file} ${text}` : text)
    }
    return keys
}

/** The keys of `candidate` that `base` does not hold, counted as a multiset: one base finding answers one finding of the change. */
const newKeys = (candidate: readonly string[], base: readonly string[]): string[] => {
    const left = new Map<string, number>()
    for (const key of base) left.set(key, (left.get(key) ?? 0) + 1)
    return candidate.filter((key) => {
        const count = left.get(key) ?? 0
        if (count === 0) return true
        left.set(key, count - 1)
        return false
    })
}

/** The repository file a finding key names first (findingKeys), when it names one. */
const fileOfKey = (key: string): string | undefined => /^[^\s(:]+/.exec(key)?.[0]

/** The rule name a lint finding key ends with (`<plugin>/<name>` or `<name>`). */
const ruleOfKey = (key: string): string => key.split(" ").at(-1)?.split("/").at(-1) ?? ""

/** Whether a base run answers for a finding: on a file under its paths, of a rule it does not except. */
const answers = (run: BaseRun, key: string): boolean => {
    const file = fileOfKey(key)
    return (run.paths === undefined || (file !== undefined && underPaths(file, run.paths))) && !(run.except ?? []).includes(ruleOfKey(key))
}

/**
 * Judges the red typecheck, lint and canon steps of a run against the same steps at other commits: a finding a base run holds
 * already (the rule, file and message, line-insensitive) and answers for (`answers`) is that base's, kept as `baseline-findings` evidence; a step whose every finding a base holds turns green, and a step with one new
 * finding stays red and names how many each base held. Any other step is left as it ran.
 */
export const judgeAgainstRuns = (root: string, steps: readonly StepResult[], runs: readonly BaseRun[]): { readonly steps: StepResult[]; readonly judgement: BaseJudgement } => {
    const roots = [root, ...runs.map((run) => run.dir)]
    const found: BaseFindings[] = []
    const judged = steps.map((step): StepResult => {
        if (step.status !== "red" || !JUDGED_STEPS.has(step.step)) return step
        const mine = findingKeys(step.output, roots)
        let fresh = mine
        const held: string[] = []
        for (const run of runs) {
            const there = run.steps.find((other) => other.package === step.package && other.step === step.step)
            const theirs = (there === undefined ? [] : findingKeys(there.output, roots)).filter((key) => answers(run, key))
            const left = newKeys(fresh, theirs)
            const old = fresh.filter((key) => !left.includes(key))
            if (old.length > 0) {
                found.push({ package: step.package, step: step.step, at: run.base, findings: old })
                held.push(`${String(old.length)} already at ${run.base.slice(0, 12)}`)
            }
            fresh = left
        }
        if (mine.length === 0 || held.length === 0) return step
        if (fresh.length > 0) return { ...step, reason: `${step.reason}${step.reason === "" ? "" : "; "}${String(fresh.length)} new finding(s), ${held.join(", ")}` }
        return { ...step, status: "green", reason: `${step.reason}${step.reason === "" ? "" : "; "}baseline-findings: ${String(mine.length)} finding(s), every one already at a base (${held.join(", ")}); none is this change's` }
    })
    return { steps: judged, judgement: { base: runs[0]?.base ?? "", steps: found } }
}

/** Whether a widened run has a red step a base can explain: a typecheck, lint or canon step with findings to compare. */
export const judgedAgainstBase = (steps: readonly StepResult[]): boolean => steps.some((step) => step.status === "red" && JUDGED_STEPS.has(step.step))

/**
 * The same run at `base` (`rerun`, called with the folder of a clean checkout of it, the scope's install linked in), as a base run
 * judgeAgainstRuns compares with: a widened run's base commit, or a relayed source's head answering for its relayed files.
 */
export const runAtBase = async (root: string, base: string, rerun: (dir: string) => Promise<readonly StepResult[]>, answering: Pick<BaseRun, "paths" | "except"> = {}): Promise<BaseRun> =>
    inCleanCheckout(root, base, "baseline", async (dir) => {
        linkInstall(root, dir)
        return { base, dir, steps: await rerun(dir), ...answering }
    })

/** The working folder of the base checkout matching `cwd` of the run at `root`. */
export const baseCwd = (root: string, cwd: string, dir: string): string => join(dir, relative(root, cwd))
