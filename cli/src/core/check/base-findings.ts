import { join, relative } from "node:path"
import { inCleanCheckout } from "../../harness/clean-verify.js"
import { linkInstall } from "../../harness/land.js"
import type { StepResult } from "./scope.js"

/** The steps whose output lists findings a base can already hold: a widened typecheck, lint or canon is judged against its base. */
const JUDGED_STEPS: ReadonlySet<StepResult["step"]> = new Set<StepResult["step"]>(["typecheck", "lint", "canon"])

/** The findings of one red step that were already at the base: judged there, never blamed on the change. */
export interface BaseFindings {
    readonly package: string
    readonly step: StepResult["step"]
    readonly findings: readonly string[]
}

/** What judging a widened run against its base found: the base, and per step the findings that were there already. */
export interface BaseJudgement {
    readonly base: string
    readonly steps: readonly BaseFindings[]
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
        const text = line
            .replace(/\(\d+,\d+\)/g, "")
            .replace(/\b\d+:\d+\b/g, "")
            .replace(/:\d+(?::\d+)?\b/g, "")
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

/** Whether a widened run has a red step a base can explain: a typecheck, lint or canon step with findings to compare. */
export const judgedAgainstBase = (steps: readonly StepResult[]): boolean => steps.some((step) => step.status === "red" && JUDGED_STEPS.has(step.step))

/**
 * Judges the red steps of a run that an app-wide configuration file widened to whole packages against the same run at its base
 * commit (`rerun`, called with the folder of a clean checkout of the base, the scope's install linked in): a red step whose every
 * finding the base holds already (the rule, file and message, line-insensitive) turns green, its findings kept as `baseline-findings`
 * evidence, so the change is blamed for none of them; a step with one new finding stays red and names the base's count. Any
 * other step is left as it ran.
 */
export const judgeAgainstBase = async (
    root: string,
    base: string,
    steps: readonly StepResult[],
    rerun: (dir: string) => Promise<readonly StepResult[]>,
): Promise<{ readonly steps: StepResult[]; readonly judgement: BaseJudgement }> => {
    const atBase = await inCleanCheckout(root, base, "baseline", async (dir) => {
        linkInstall(root, dir)
        const ran = await rerun(dir)
        return { dir, ran }
    })
    const roots = [root, atBase.dir]
    const found: BaseFindings[] = []
    const judged = steps.map((step): StepResult => {
        if (step.status !== "red" || !JUDGED_STEPS.has(step.step)) return step
        const mine = findingKeys(step.output, roots)
        const there = atBase.ran.find((other) => other.package === step.package && other.step === step.step)
        const theirs = there === undefined ? [] : findingKeys(there.output, roots)
        const fresh = newKeys(mine, theirs)
        const old = mine.length - fresh.length
        if (mine.length === 0 || old === 0) return step
        found.push({ package: step.package, step: step.step, findings: mine.filter((key) => !fresh.includes(key)) })
        if (fresh.length > 0) return { ...step, reason: `${step.reason}${step.reason === "" ? "" : "; "}${String(fresh.length)} new finding(s), ${String(old)} already at the base ${base.slice(0, 12)}` }
        return { ...step, status: "green", reason: `baseline-findings: ${String(old)} finding(s), every one already at the base ${base.slice(0, 12)}; none is this change's` }
    })
    return { steps: judged, judgement: { base, steps: found } }
}

/** The working folder of the base checkout matching `cwd` of the run at `root`. */
export const baseCwd = (root: string, cwd: string, dir: string): string => join(dir, relative(root, cwd))
