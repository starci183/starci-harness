// `stack deploy --ci-run`: the CLI judges the GitHub run itself. GitHub is replaced by recorded answers shaped like the Actions REST API
// (actions/runs/<id> and actions/runs/<id>/jobs); nothing here reaches the network or a token. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { Refusal } from "../../shared/errors.js"
import { appStackVerb } from "../app/stack.js"
import { requireCiRunGreen } from "./ci.js"
import { editionOf, jobsNamed, requiredJobsOf } from "./ci-evidence.js"
import type { GithubReader, RequiredJobs, RunJob } from "./ci-evidence.js"

const SHA = "a".repeat(40)
const OTHER = "b".repeat(40)
const STANDARD: RequiredJobs = { required: ["fast", "lint", "test", "coverage", "build"], optional: ["sonar"] }

const job = (name: string, conclusion = "success", status = "completed"): RunJob => ({ name, status, conclusion: status === "completed" ? conclusion : "" })
const GREEN_JOBS: readonly RunJob[] = [job("fast"), job("lint (be)"), job("lint (fe)"), job("test (1)"), job("test (2)"), job("coverage"), job("build"), job("sonar"), job("verdict")]
const run = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 77,
    head_sha: SHA,
    status: "in_progress",
    conclusion: null,
    path: ".github/workflows/ci.yml",
    event: "push",
    html_url: "https://github.invalid/o/r/actions/runs/77",
    ...over,
})

/** A recorded GitHub: the run answer and the jobs answer of run 77; every path asked is kept. */
const github = (runAnswer: unknown, jobs: readonly unknown[]): { readonly read: GithubReader; readonly asked: string[] } => {
    const asked: string[] = []
    const read: GithubReader = (path) => {
        asked.push(path)
        if (path === "actions/runs/77") return Promise.resolve(runAnswer)
        if (path.startsWith("actions/runs/77/jobs?filter=latest")) return Promise.resolve({ total_count: jobs.length, jobs })
        return Promise.reject(new Error(`unrecorded ${path}`))
    }
    return { read, asked }
}
const judge = (runAnswer: unknown, jobs: readonly unknown[], sha = SHA): { asked: string[]; result: ReturnType<typeof requireCiRunGreen> } => {
    const { read, asked } = github(runAnswer, jobs)
    return { asked, result: requireCiRunGreen(".", sha, "77", { read, standard: STANDARD }) }
}
const refused = (promise: Promise<unknown>, code: string, text?: RegExp): Promise<void> =>
    assert.rejects(promise, (error: unknown) => error instanceof Refusal && error.code === code && (text === undefined || text.test(error.message)))
const without = (name: string): RunJob[] => GREEN_JOBS.filter((candidate) => !candidate.name.startsWith(name))
const replacing = (name: string, replacement: RunJob): RunJob[] => GREEN_JOBS.map((candidate) => (candidate.name === name ? replacement : candidate))

void test("a run still in progress whose required jobs all passed is accepted, matrix legs included", async () => {
    const { result, asked } = judge(run(), GREEN_JOBS)
    const evidence = await result
    assert.equal(evidence.runId, 77)
    assert.deepEqual(evidence.checked.map((check) => check.job), STANDARD.required)
    assert.deepEqual(evidence.checked.find((check) => check.job === "lint")?.names, ["lint (be)", "lint (fe)"])
    assert.ok(asked.every((path) => path.startsWith("actions/runs/77")), "only the named run is read")
})

void test("a finished green run of the same commit (the reused candidate verdict) is accepted", async () => {
    await judge(run({ status: "completed", conclusion: "success", head_branch: "release/candidate-1.2.3" }), GREEN_JOBS).result
})

void test("a required job that was skipped is refused CI_NOT_GREEN: a skipped job is not a green one", async () => {
    await refused(judge(run(), replacing("test (2)", job("test (2)", "skipped"))).result, "CI_NOT_GREEN", /required job test is not green: test \(2\): skipped/u)
})

void test("a required job that failed, was cancelled or is still running is refused CI_NOT_GREEN", async () => {
    await refused(judge(run(), replacing("build", job("build", "failure"))).result, "CI_NOT_GREEN", /build: failure/u)
    await refused(judge(run(), replacing("coverage", job("coverage", "cancelled"))).result, "CI_NOT_GREEN", /coverage: cancelled/u)
    await refused(judge(run(), replacing("fast", job("fast", "", "in_progress"))).result, "CI_NOT_GREEN", /fast: in_progress/u)
})

void test("a workflow edited to drop a required job gains nothing: the missing job is refused", async () => {
    await refused(judge(run(), without("coverage")).result, "CI_NOT_GREEN", /required job coverage is not in the run/u)
})

void test("a job whose id only starts like a required one does not stand for it", async () => {
    assert.deepEqual(
        jobsNamed([job("lint-extra"), job("lint (be)"), job("ci / lint (fe)"), job("lint")], "lint").map((candidate) => candidate.name),
        ["lint (be)", "ci / lint (fe)", "lint"],
    )
    await refused(judge(run(), [...without("build"), job("build-extra")]).result, "CI_NOT_GREEN", /required job build is not in the run/u)
})

void test("an optional job that is in the run must not be red; skipped is fine", async () => {
    await judge(run(), replacing("sonar", job("sonar", "skipped"))).result
    await refused(judge(run(), replacing("sonar", job("sonar", "failure"))).result, "CI_NOT_GREEN", /optional job sonar/u)
})

void test("a run of another commit (a reused candidate run of another sha) is refused before its jobs are read", async () => {
    const { result, asked } = judge(run({ head_sha: OTHER, status: "completed", conclusion: "success" }), GREEN_JOBS)
    await refused(result, "CI_RUN_SHA_MISMATCH", /bbbbbbbbb, not of the commit being deployed \(aaaaaaaaa\)/u)
    assert.deepEqual(asked, ["actions/runs/77"])
})

void test("a run of another workflow or started by a pull request is not evidence", async () => {
    await refused(judge(run({ path: ".github/workflows/evil.yml" }), GREEN_JOBS).result, "CI_RUN_WORKFLOW", /evil\.yml/u)
    await refused(judge(run({ event: "pull_request" }), GREEN_JOBS).result, "CI_RUN_WORKFLOW", /pull_request/u)
})

void test("a finished run that concluded red or cancelled, and a run not started yet, are refused CI_NOT_GREEN", async () => {
    await refused(judge(run({ status: "completed", conclusion: "failure" }), GREEN_JOBS).result, "CI_NOT_GREEN", /concluded failure/u)
    await refused(judge(run({ status: "queued" }), GREEN_JOBS).result, "CI_NOT_GREEN", /queued, not running yet/u)
})

void test("an unreadable or foreign answer from GitHub is never green", async () => {
    await refused(requireCiRunGreen(".", SHA, "77", { read: () => Promise.resolve({ id: 78 }), standard: STANDARD }), "CI_RUN_UNREADABLE")
    await assert.rejects(requireCiRunGreen(".", SHA, "77", { read: () => Promise.reject(new Error("offline")), standard: STANDARD }), { message: "offline" })
    const { read } = github(run(), [])
    const noJobList: GithubReader = (path) => (path.includes("/jobs") ? Promise.resolve({ total_count: 1 }) : read(path))
    await refused(requireCiRunGreen(".", SHA, "77", { read: noJobList, standard: STANDARD }), "CI_RUN_UNREADABLE", /not a job list/u)
})

void test("the run id and the commit are validated before GitHub is asked", async () => {
    const never: GithubReader = () => Promise.reject(new Error("GitHub must not be asked"))
    await refused(requireCiRunGreen(".", SHA, "77; rm", { read: never, standard: STANDARD }), "CI_RUN_USAGE", /numeric id/u)
    await refused(requireCiRunGreen(".", "main", "77", { read: never, standard: STANDARD }), "CI_RUN_USAGE", /40-hex/u)
})

void test("jobs are paged: a run with more than one page of jobs is read to its end", async () => {
    const filler = Array.from({ length: 100 }, (_unused, at) => job(`extra-${String(at)}`))
    const pages: readonly (readonly RunJob[])[] = [filler, GREEN_JOBS]
    const read: GithubReader = (path) => {
        if (path === "actions/runs/77") return Promise.resolve(run())
        const page = Number(/[&?]page=(\d+)/u.exec(path)?.[1])
        return Promise.resolve({ total_count: 109, jobs: pages[page - 1] ?? [] })
    }
    await requireCiRunGreen(".", SHA, "77", { read, standard: STANDARD })
})

void test("the required jobs come from the CI standard of @starci/hfs, per edition", () => {
    const full = requiredJobsOf("full")
    assert.deepEqual(full.required, ["plan", "fast", "lint", "test", "coverage", "build", "verdict"])
    assert.ok(full.optional.includes("sonar"))
    assert.ok(requiredJobsOf("lite").optional.includes("db-types"))
    assert.equal(editionOf("."), "full", "a folder with no hfs.json is judged as full")
})

void test("stack: --ci-run is refused outside deploy, together with --urgent, without a value, and without --sha when executing", async () => {
    const context = { cwd: ".", tree: "none" as const, treeRoot: undefined, verbs: [], json: false, progress: (): void => undefined }
    const stack = (args: string[]): Promise<unknown> => appStackVerb.run(context, { args })
    await refused(stack(["rollback", "--env", "production", "--ci-run", "77"]), "CI_RUN_USAGE", /belongs to `stack deploy`/u)
    await refused(stack(["deploy", "--ci-run"]), "CI_RUN_USAGE", /takes the id/u)
    await refused(stack(["deploy", "--ci-run=77", "--urgent"]), "CI_RUN_USAGE", /exclude each other/u)
    await refused(stack(["deploy", "--ci-run", "77", "--execute"]), "CI_RUN_USAGE", /add --sha/u)
})
