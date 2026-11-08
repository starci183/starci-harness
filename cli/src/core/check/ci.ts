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
export interface WorkflowRun {
    readonly name: string
    readonly status: string
    readonly conclusion: string
    readonly url: string
    readonly databaseId: number
    /** The run's title: publish.yml names its runs `publish <sha>` (its `run-name`), the only link from a publish run to the commit it publishes. */
    readonly displayTitle?: string
}

/**
 * The CI verdict of one commit (green, red, pending, cancelled, none, or unreadable when GitHub could not be asked), its runs and its text.
 * The runs are those of the commit (`ci`, and any other workflow it started) and the `publish` runs that publish it (`publishRunsOf`).
 */
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
    typeof value.databaseId === "number" &&
    (!("displayTitle" in value) || typeof value.displayTitle === "string")

// Inside Actions the run asking the question is itself a run of the commit; it would keep the verdict pending forever.
const ownRunId = (): number | undefined => {
    const id = Number(process.env.GITHUB_RUN_ID)
    return Number.isInteger(id) && id > 0 ? id : undefined
}

/** The runs of a `gh run list --json` answer, the run asking the question left out. */
export const parseRuns = (stdout: string): WorkflowRun[] => {
    const parsed: unknown = JSON.parse(stdout === "" ? "[]" : stdout)
    if (!Array.isArray(parsed)) throw new Refusal("CI_STATUS_UNREADABLE", "gh run list did not return a json array")
    const own = ownRunId()
    return parsed.filter(isRun).filter((run) => run.databaseId !== own)
}

/**
 * The runs of publish.yml that publish `sha`. That workflow starts on `workflow_run` of `ci`, and GitHub gives such a run the head of
 * the default branch, not the commit the triggering run tested, so `gh run list --commit <sha>` never lists it; its `run-name` carries
 * the sha instead (`publish <sha>`), and this reads it from there.
 */
export const publishRunsOf = (runs: readonly WorkflowRun[], sha: string): WorkflowRun[] => runs.filter((run) => run.displayTitle?.split(" ").includes(sha) === true)

/**
 * The verdict of the runs of one commit. `pending` while any run is not completed; `red` when any concluded in anything but success,
 * skipped or cancelled (a failed `ci` and a failed `publish` alike); `cancelled` when the only blemish is a cancelled run (a `ci`
 * superseded by a newer push to main, or a `publish` replaced in its queue by a newer one): such a commit was never tested or published
 * whole, so it is never green, and it is no failure to fix either: judge the newer commit.
 */
export const verdictOf = (runs: readonly WorkflowRun[]): string => {
    if (runs.length === 0) return "none"
    if (runs.some((run) => run.status !== "completed")) return "pending"
    if (runs.some((run) => run.conclusion !== "success" && run.conclusion !== "skipped" && run.conclusion !== "cancelled")) return "red"
    return runs.some((run) => run.conclusion === "cancelled") ? "cancelled" : "green"
}

/** How `gh` is asked: tests hand recorded answers. */
export type GhRunner = (args: readonly string[], cwd: string) => Promise<{ readonly stdout: string }>

const ghRunner: GhRunner = (args, cwd) => runTool("gh", args, cwd)

const RUN_FIELDS = "name,status,conclusion,url,databaseId,displayTitle"

/** The publish runs of `sha`: the newest runs of publish.yml, filtered. A repository without that workflow (an app) has none. */
const readPublishRuns = async (gh: GhRunner, cwd: string, sha: string): Promise<WorkflowRun[]> => {
    try {
        const listed = await gh(["run", "list", "--workflow", "publish.yml", "--json", RUN_FIELDS, "--limit", "50"], cwd)
        return publishRunsOf(parseRuns(listed.stdout), sha)
    } catch (error: unknown) {
        if (/could not find any workflows|HTTP 404/u.test(asRefusal(error).message)) return []
        throw error
    }
}

/** Reads the GitHub Actions verdict of `sha` (`gh run list`); a verdict that cannot be read is `unreadable`, never green. */
export const readCi = async (cwd: string, sha: string, gh: GhRunner = ghRunner): Promise<CiReading> => {
    try {
        const listed = await gh(["run", "list", "--commit", sha, "--json", RUN_FIELDS, "--limit", "50"], cwd)
        const runs = [...parseRuns(listed.stdout), ...(await readPublishRuns(gh, cwd, sha))]
        const verdict = verdictOf(runs)
        const table = formatTable(runs.map((run) => [run.name, run.status, run.conclusion === "" ? "-" : run.conclusion]))
        const runsSuffix = runs.length === 0 ? "" : `\n${table}`
        return { sha, verdict, runs, detail: `${sha.slice(0, 9)}: ${verdict}${runsSuffix}` }
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
 * or, when the caller asked for the urgent path (`urgent`), unless the commit carries a pushed urgent record, which
 * stands in for CI (contexts/project/cicd.md "The urgent path"), whose full gate runs later as the record's back-fill. Returns the reading
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
 * `starci check ci`: the GitHub Actions verdict of one pushed commit (green, red, pending, cancelled, none or unreadable) with its
 * runs (the `ci` runs and the `publish` runs that publish it), the critic after a light push; it exits 0 only when that verdict is
 * green, so a contract waits on it for CI (preset ci-green).
 */
export const checkCiVerb = defineVerb({
    path: ["check", "ci"],
    summary: "read the GitHub Actions verdict of a commit (green, red, pending, cancelled, none or unreadable) and its runs, publish runs included; exit 0 only on green",
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
