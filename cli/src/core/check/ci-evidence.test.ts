// `stack deploy --ci-run`: the CLI judges the GitHub run itself. GitHub is replaced by recorded answers shaped like the Actions REST API
// (actions/runs/<id> and actions/runs/<id>/jobs); nothing here reaches the network or a token. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { Refusal } from "../../shared/errors.js"
import { appStackVerb } from "../app/stack.js"
import { findCiRunGreen, requireCiRunGreen } from "./ci.js"
import { isDeployJob, jobsNamed, requiredJobsOf } from "./ci-evidence.js"
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

void test("a run not started yet is refused CI_NOT_GREEN; a finished run is judged by its jobs, never by its conclusion", async () => {
    await refused(judge(run({ status: "queued" }), GREEN_JOBS).result, "CI_NOT_GREEN", /queued, not running yet/u)
    await refused(judge(run({ status: "completed", conclusion: "failure" }), replacing("build", job("build", "failure"))).result, "CI_NOT_GREEN", /concluded failure\): required job build is not green/u)
})

// The managed CI as it runs: the verdict after every check, the images reusable workflow that pushes the digests, then the deploy jobs.
const PIPELINE: RequiredJobs = { required: ["plan", "fast", "lint", "test", "coverage", "build", "verdict"], optional: ["sonar"], pipeline: ["images"] }
const IMAGES: readonly RunJob[] = [job("images / image (api)"), job("images / image (web)"), job("images / collect")]
const CHECKS: readonly RunJob[] = [job("plan"), job("fast"), job("lint (be)"), job("test (1)"), job("coverage"), job("build"), ...IMAGES, job("verdict")]
const DEPLOY_FAILED: readonly RunJob[] = [...CHECKS, job("deploy-production / deploy", "failure"), job("deploy-production / rollback", "skipped")]
const pipelineJudge = (runAnswer: unknown, jobs: readonly unknown[]): Promise<unknown> => {
    const { read } = github(runAnswer, jobs)
    return requireCiRunGreen(".", SHA, "77", { read, standard: PIPELINE })
}

void test("a run red only because its auto-deploy failed is evidence: the verdict and the images passed, the deploy jobs are not read", async () => {
    const evidence = (await pipelineJudge(run({ status: "completed", conclusion: "failure" }), DEPLOY_FAILED)) as Awaited<ReturnType<typeof requireCiRunGreen>>
    assert.deepEqual(evidence.checked.map((check) => check.job), [...PIPELINE.required, "images"])
    assert.deepEqual(evidence.checked.find((check) => check.job === "images")?.names, IMAGES.map((image) => image.name))
    assert.ok(isDeployJob(job("deploy-production / deploy")) && isDeployJob(job("rollback")) && !isDeployJob(job("images / collect")))
})

void test("a run whose verdict is red is refused, whatever its deploy jobs did", async () => {
    const jobs = [...CHECKS.filter((candidate) => candidate.name !== "verdict"), job("verdict", "failure"), job("deploy-production / deploy", "skipped")]
    await refused(pipelineJudge(run({ status: "completed", conclusion: "failure" }), jobs), "CI_NOT_GREEN", /required job verdict is not green: verdict: failure/u)
})

void test("a run whose images failed or never ran is refused: no digest was pushed", async () => {
    const failed = CHECKS.map((candidate) => (candidate.name === "images / collect" ? job("images / collect", "failure") : candidate))
    await refused(pipelineJudge(run({ status: "completed", conclusion: "failure" }), failed), "CI_NOT_GREEN", /pipeline job images is not green: images \/ collect: failure/u)
    const skipped = [...CHECKS.filter((candidate) => !candidate.name.startsWith("images")), job("images", "skipped")]
    await refused(pipelineJudge(run({ status: "completed", conclusion: "success" }), skipped), "CI_NOT_GREEN", /pipeline job images is not green: images: skipped/u)
    await refused(pipelineJudge(run(), CHECKS.filter((candidate) => !candidate.name.startsWith("images"))), "CI_NOT_GREEN", /pipeline job images is not in the run/u)
})

void test("an empty --ci-run finds the newest run of the commit that is evidence, by the same judgement", async () => {
    const listed = { workflow_runs: [run({ id: 79, status: "completed", conclusion: "failure" }), run({ id: 78, event: "pull_request" }), run({ id: 77, status: "completed", conclusion: "failure" })] }
    const answers: Record<string, readonly RunJob[]> = { "79": [...CHECKS.filter((candidate) => candidate.name !== "verdict"), job("verdict", "failure")], "77": DEPLOY_FAILED }
    const asked: string[] = []
    const read: GithubReader = (path) => {
        asked.push(path)
        if (path === `actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=100`) return Promise.resolve(listed)
        const id = /^actions\/runs\/(\d+)\/jobs/u.exec(path)?.[1] ?? ""
        return id in answers ? Promise.resolve({ jobs: answers[id] }) : Promise.reject(new Error(`unrecorded ${path}`))
    }
    const evidence = await findCiRunGreen(".", SHA, { read, standard: PIPELINE })
    assert.equal(evidence.runId, 77)
    assert.ok(!asked.some((path) => path.startsWith("actions/runs/78")), "a pull_request run is never judged")
    const none: GithubReader = (path) => (path.startsWith("actions/workflows/") ? Promise.resolve({ workflow_runs: [] }) : Promise.reject(new Error(path)))
    await refused(findCiRunGreen(".", SHA, { read: none, standard: PIPELINE }), "CI_NOT_GREEN", /has no push or workflow_dispatch run/u)
    const onlyRed: GithubReader = (path) => (path.startsWith("actions/workflows/") ? Promise.resolve({ workflow_runs: [listed.workflow_runs[0]] }) : read(path))
    await refused(findCiRunGreen(".", SHA, { read: onlyRed, standard: PIPELINE }), "CI_NOT_GREEN", /no run of \.github\/workflows\/ci\.yml proves aaaaaaaaa: .*verdict: failure/u)
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

void test("the required jobs come from the CI standard of @starci/hfs", () => {
    const jobs = requiredJobsOf()
    assert.deepEqual(jobs.required, ["plan", "fast", "lint", "test", "coverage", "build", "verdict"])
    assert.deepEqual(jobs.pipeline, ["images"])
    assert.ok(jobs.optional.includes("sonar"))
    assert.ok(jobs.optional.includes("db-types"))
})

void test("stack: --ci-run is refused outside deploy, together with --urgent, and without --sha when executing, named or empty", async () => {
    const context = { cwd: ".", tree: "none" as const, treeRoot: undefined, verbs: [], json: false, progress: (): void => undefined }
    const stack = (args: string[]): Promise<unknown> => appStackVerb.run(context, { args })
    await refused(stack(["rollback", "--env", "production", "--ci-run", "77"]), "CI_RUN_USAGE", /belongs to `stack deploy`/u)
    await refused(stack(["deploy", "--ci-run", "--execute"]), "CI_RUN_USAGE", /add --sha/u)
    await refused(stack(["deploy", "--ci-run=77", "--urgent"]), "CI_RUN_USAGE", /exclude each other/u)
    await refused(stack(["deploy", "--ci-run", "77", "--execute"]), "CI_RUN_USAGE", /add --sha/u)
})
