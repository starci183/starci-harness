import { Refusal } from "../../shared/errors.js"
import { runTool } from "../../shared/exec.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** The verdict of one commit's CI: every run green, any run red, or still running. */
type Verdict = "green" | "red" | "pending" | "none"

interface WorkflowRun {
    readonly name: string
    readonly status: string
    readonly conclusion: string
    readonly url: string
    readonly databaseId: number
}

interface CiStatusData {
    readonly sha: string
    readonly verdict: Verdict
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

const verdictOf = (runs: readonly WorkflowRun[]): Verdict => {
    if (runs.length === 0) return "none"
    if (runs.some((run) => run.status !== "completed")) return "pending"
    return runs.every((run) => run.conclusion === "success" || run.conclusion === "skipped") ? "green" : "red"
}

/** `starci release ci-status`: the GitHub Actions verdict of one pushed commit; CI is the critic after a light push. */
export const ciStatusVerb = defineVerb({
    path: ["release", "ci-status"],
    summary: "read the GitHub Actions verdict of a pushed commit (green, red, pending or none)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/release-ci-status@1",
    flags: {
        sha: { kind: "string", summary: "the commit to judge (default: HEAD of the working directory)" },
    },
    run: async (context, flags) => {
        const sha = flags.sha ?? (await runTool("git", ["rev-parse", "HEAD"], context.cwd)).stdout
        const listed = await runTool("gh", ["run", "list", "--commit", sha, "--json", "name,status,conclusion,url,databaseId", "--limit", "50"], context.cwd)
        const runs = parseRuns(listed.stdout)
        const verdict = verdictOf(runs)
        const data: CiStatusData = { sha, verdict, runs }
        const table = formatTable(runs.map((run) => [run.name, run.status, run.conclusion === "" ? "-" : run.conclusion]))
        const tableNote = runs.length === 0 ? "" : `\n${table}`
        return { data, message: `${sha.slice(0, 9)}: ${verdict}${tableNote}` }
    },
})
