import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadPolicy } from "../../harness/policy.js"
import type { CiGatedAction } from "../../harness/policy.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { runTool } from "../../shared/exec.js"
import { gitCommonDir, resolveSha } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { editionOf, ghReader, requireCiRun, requiredJobsOf } from "./ci-evidence.js"
import type { CiRunEvidence, GithubReader, RequiredJobs } from "./ci-evidence.js"

/** One GitHub Actions run of a commit, as `gh run list` reports it. */
interface WorkflowRun {
    readonly name: string
    readonly status: string
    readonly conclusion: string
    readonly url: string
    readonly databaseId: number
}

/** The CI verdict of one commit (green, red, pending, none, or unreadable when GitHub could not be asked), its runs and its text. */
export interface CiReading {
    readonly sha: string
    readonly verdict: string
    readonly detail: string
    readonly runs: readonly WorkflowRun[]
}

const isRun = (value: unknown): value is WorkflowRun =>
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    "conclusion" in value &&
    typeof value.conclusion === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "databaseId" in value &&
    typeof value.databaseId === "number"

// Inside Actions the run asking the question is itself a run of the commit; it would keep the verdict pending forever.
const ownRunId = (): number | undefined => {
    const id = Number(process.env.GITHUB_RUN_ID)
    return Number.isInteger(id) && id > 0 ? id : undefined
}

const parseRuns = (stdout: string): WorkflowRun[] => {
    const parsed: unknown = JSON.parse(stdout === "" ? "[]" : stdout)
    if (!Array.isArray(parsed)) throw new Refusal("CI_STATUS_UNREADABLE", "gh run list did not return a json array")
    const own = ownRunId()
    return parsed.filter(isRun).filter((run) => run.databaseId !== own)
}

const verdictOf = (runs: readonly WorkflowRun[]): string => {
    if (runs.length === 0) return "none"
    if (runs.some((run) => run.status !== "completed")) return "pending"
    return runs.every((run) => run.conclusion === "success" || run.conclusion === "skipped") ? "green" : "red"
}

/** Reads the GitHub Actions verdict of `sha` (`gh run list`); a verdict that cannot be read is `unreadable`, never green. */
const readCi = async (cwd: string, sha: string): Promise<CiReading> => {
    try {
        const listed = await runTool("gh", ["run", "list", "--commit", sha, "--json", "name,status,conclusion,url,databaseId", "--limit", "50"], cwd)
        const runs = parseRuns(listed.stdout)
        const verdict = verdictOf(runs)
        const table = formatTable(runs.map((run) => [run.name, run.status, run.conclusion === "" ? "-" : run.conclusion]))
        return { sha, verdict, runs, detail: `${sha.slice(0, 9)}: ${verdict}${runs.length === 0 ? "" : `\n${table}`}` }
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        return { sha, verdict: "unreadable", runs: [], detail: `${refusal.code}: ${refusal.message}` }
    }
}

/** What an urgent record says about its commit: the tag, who released it, why, and whether it reached the remote. */
interface UrgentRecord {
    readonly tag: string
    readonly role: string
    readonly reason: string
    readonly pushed: boolean
}

const URGENT_SCHEMA = "starci-app-urgent-record/1"

/**
 * The urgent record `starci app release push --urgent` wrote for `sha` (@starci/hfs release/records.mjs, in <git common dir>/starci-release),
 * or undefined when the commit has none.
 */
const urgentRecordOf = async (root: string, sha: string): Promise<UrgentRecord | undefined> => {
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(join(await gitCommonDir(root), "starci-release", `${sha}.urgent.json`), "utf8"))
    } catch {
        return undefined
    }
    if (typeof raw !== "object" || raw === null) return undefined
    const record = raw as Record<string, unknown>
    if (record.schema !== URGENT_SCHEMA || record.head !== sha) return undefined
    return { tag: String(record.tag), role: String(record.role), reason: String(record.reason), pushed: record.pushed === true }
}

/**
 * The require-ci gate of an action: when policy/quality.yaml lists it in requireCi, the action refuses CI_NOT_GREEN unless CI of `sha` is green,
 * or, when the caller asked for the urgent path (`urgent`), unless the commit carries a pushed urgent record: the owner's ruling of 2026-10-29
 * (contexts/harness/decisions.md) lets that record stand in for CI, whose full gate runs later as the record's back-fill. Returns the reading
 * (verdict `urgent` when the record stood in), or undefined when the policy does not make the action wait.
 */
export const requireCiGreen = async (context: VerbContext, root: string, action: CiGatedAction, sha: string, options: { readonly urgent?: boolean } = {}): Promise<CiReading | undefined> => {
    if (!loadPolicy(root).quality.requireCi.includes(action)) return undefined
    const reading = await readCi(root, sha)
    if (reading.verdict === "green") return reading
    if (options.urgent === true) {
        const record = await urgentRecordOf(root, sha)
        if (record === undefined) throw new Refusal("URGENT_RECORD_MISSING", `${action} --urgent stands on the urgent record of ${sha.slice(0, 9)}, and it has none: starci app release push --urgent --reason "<text>" --execute first (CI is ${reading.verdict})`)
        if (!record.pushed) throw new Refusal("URGENT_RECORD_MISSING", `the urgent release ${record.tag} of ${sha.slice(0, 9)} was never pushed`)
        return { sha, verdict: "urgent", runs: reading.runs, detail: `accepted: urgent record ${record.tag} of ${sha.slice(0, 9)} by ${record.role} (${record.reason}) stands in for CI (${reading.verdict}); the back-fill runs the full gate later` }
    }
    throw new Refusal("CI_NOT_GREEN", `${action} waits for a green CI (policy/quality.yaml requireCi); CI of ${sha.slice(0, 9)} is ${reading.verdict}: ${reading.detail.split("\n")[0] ?? ""}`)
}

/** The seams of the run-evidence check: where GitHub is read from and which jobs the CI standard requires; tests hand recorded answers. */
export interface CiRunDeps {
    readonly read?: GithubReader
    readonly standard?: RequiredJobs
}

/**
 * The in-run evidence gate of a deploy (`starci app stack deploy --ci-run <run>`, contexts/project/cicd.md WP3): accepts only when the GitHub run
 * `ciRun` is a run of the managed CI of exactly `sha` whose every required job (the CI standard of the installed @starci/hfs for the app's edition,
 * never the workflow file) concluded success. It does not look at policy/quality.yaml requireCi: a deploy that names its run is always judged.
 * Refuses CI_NOT_GREEN, CI_RUN_SHA_MISMATCH, CI_RUN_WORKFLOW, CI_RUN_UNREADABLE or CI_RUN_USAGE; nothing is read from or printed of the token.
 */
export const requireCiRunGreen = async (root: string, sha: string, ciRun: string, deps: CiRunDeps = {}): Promise<CiRunEvidence> =>
    requireCiRun(deps.read ?? ghReader(root), sha, ciRun, deps.standard ?? requiredJobsOf(editionOf(root)))

/**
 * `starci check ci`: the GitHub Actions verdict of one pushed commit (green, red, pending, none or unreadable) with its runs, the
 * critic after a light push; it exits 0 only when that verdict is green, so a contract waits on it for CI (preset ci-green).
 */
export const checkCiVerb = defineVerb({
    path: ["check", "ci"],
    summary: "read the GitHub Actions verdict of a commit (green, red, pending, none or unreadable) and its runs; exit 0 only on green",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-ci@1",
    flags: {
        sha: { kind: "string", summary: "the commit to judge (default: the commit of --ref)" },
        ref: { kind: "string", summary: "the ref whose commit is judged when no --sha is given (default HEAD)" },
    },
    run: async (context, flags) => {
        const sha = flags.sha ?? (await resolveSha(context.cwd, flags.ref ?? "HEAD"))
        const reading = await readCi(context.cwd, sha)
        const message = reading.verdict === "unreadable" ? `${sha.slice(0, 9)}: unreadable\n${reading.detail}` : reading.detail
        return { data: reading, message, exitCode: reading.verdict === "green" ? 0 : 1 }
    },
})
