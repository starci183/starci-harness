import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { parse } from "yaml"
import { Refusal, asRefusal } from "../../shared/errors.js"
import { runTool } from "../../shared/exec.js"
import type { Edition } from "../../shared/verb.js"

/**
 * The CI evidence of a deploy (contexts/project/cicd.md, WP3): `starci app stack deploy --ci-run <run>` asks GitHub itself whether the
 * jobs that CI standard requires passed for the exact commit being deployed. The required jobs come from the CI standard of the
 * @starci/hfs this CLI runs with (knowledge/hfs/ci-standard.yaml `jobs`), never from the workflow file of the checkout, so a workflow
 * edited to skip a check gains nothing: the job is missing or skipped in the run, and a missing or skipped job is not a green one.
 */

/** Reads one GitHub REST path (relative to the API root) and returns its parsed json; a seam so the judgement runs on recorded answers. */
export type GithubReader = (path: string) => Promise<unknown>

/** The CI standard's jobs of one edition: the ones a green run must have passed, and the ones that may exist and must not be red. */
export interface RequiredJobs {
    readonly required: readonly string[]
    readonly optional: readonly string[]
}

/** One job of a workflow run, as the Actions API reports it. */
export interface RunJob {
    readonly name: string
    readonly status: string
    readonly conclusion: string
}

/** What the API says about the run: enough to judge it. */
export interface RunFacts {
    readonly id: number
    readonly sha: string
    readonly status: string
    readonly conclusion: string
    readonly path: string
    readonly event: string
    readonly url: string
}

/** What an accepted run proved. */
export interface CiRunEvidence {
    readonly runId: number
    readonly url: string
    readonly sha: string
    /** The required job ids that were checked, each with the names of the run's jobs that stand for it. */
    readonly checked: readonly { readonly job: string; readonly names: readonly string[] }[]
}

/** The workflow a deploy accepts evidence from: the managed CI (rendered by `starci app sync`). */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml"
/** The events whose runs are release evidence; a `pull_request` run judges a merge preview, never the commit that ships. */
const EVIDENCE_EVENTS: readonly string[] = ["push", "workflow_dispatch"]
const CI_STANDARD = "@starci/hfs/runtime/knowledge/hfs/ci-standard.yaml"
const PAGE_SIZE = 100
const MAX_PAGES = 10

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === "string" ? value : "")
const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

/** The edition of the app at `root` (its hfs.json); an app that does not say is judged as full. */
export const editionOf = (root: string): Edition => {
    try {
        const parsed: unknown = JSON.parse(readFileSync(join(root, "hfs.json"), "utf8"))
        return isRecord(parsed) && parsed.edition === "lite" ? "lite" : "full"
    } catch {
        return "full"
    }
}

/** The jobs the CI standard of the installed @starci/hfs requires for `edition`; refused when the standard cannot be read or names none. */
export const requiredJobsOf = (edition: Edition): RequiredJobs => {
    let file: string
    try {
        file = createRequire(import.meta.url).resolve(CI_STANDARD)
    } catch {
        throw new Refusal("HFS_NOT_INSTALLED", `${CI_STANDARD} does not resolve from the CLI; reinstall starci-harness`)
    }
    const parsed: unknown = parse(readFileSync(file, "utf8"))
    const jobs = isRecord(parsed) && isRecord(parsed.jobs) ? parsed.jobs : {}
    const entry = jobs[edition]
    const required = isRecord(entry) ? names(entry.required) : []
    if (required.length === 0) throw new Refusal("CI_RUN_UNREADABLE", `the CI standard of @starci/hfs names no required job for the ${edition} edition; it cannot be judged`)
    return { required, optional: isRecord(entry) ? names(entry.optional) : [] }
}

/** A message with anything shaped like a GitHub token removed: nothing this check prints may carry one. */
const scrubbed = (message: string): string => message.replaceAll(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}/gu, "[token]")

const repoPath = (): string => {
    const named = process.env.GITHUB_REPOSITORY ?? ""
    return /^[\w.-]+\/[\w.-]+$/u.test(named) ? named : "{owner}/{repo}"
}

/**
 * The reader over `gh api` (the GitHub CLI authenticates with GH_TOKEN or GITHUB_TOKEN from the environment; the token is never an argument).
 * Inside Actions the repository is GITHUB_REPOSITORY; elsewhere gh resolves `{owner}/{repo}` from the checkout's remote.
 */
export const ghReader =
    (cwd: string): GithubReader =>
    async (path) => {
        try {
            const { stdout } = await runTool("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${repoPath()}/${path}`], cwd, { timeoutMs: 60_000 })
            return JSON.parse(stdout) as unknown
        } catch (error: unknown) {
            const refusal = asRefusal(error)
            throw new Refusal("CI_RUN_UNREADABLE", scrubbed(`GitHub did not answer ${path}: ${refusal.code}: ${refusal.message}`))
        }
    }

const factsOf = (raw: unknown, runId: number): RunFacts => {
    if (!isRecord(raw) || raw.id !== runId) throw new Refusal("CI_RUN_UNREADABLE", `GitHub's answer for run ${String(runId)} is not that run`)
    return { id: runId, sha: text(raw.head_sha), status: text(raw.status), conclusion: text(raw.conclusion), path: text(raw.path), event: text(raw.event), url: text(raw.html_url) }
}

const jobsOf = async (read: GithubReader, runId: number): Promise<RunJob[]> => {
    const jobs: RunJob[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const raw = await read(`actions/runs/${String(runId)}/jobs?filter=latest&per_page=${String(PAGE_SIZE)}&page=${String(page)}`)
        if (!isRecord(raw) || !Array.isArray(raw.jobs)) throw new Refusal("CI_RUN_UNREADABLE", `GitHub's job list of run ${String(runId)} is not a job list`)
        const batch = raw.jobs.filter(isRecord).map((job) => ({ name: text(job.name), status: text(job.status), conclusion: text(job.conclusion) }))
        jobs.push(...batch)
        if (batch.length < PAGE_SIZE) return jobs
    }
    throw new Refusal("CI_RUN_UNREADABLE", `run ${String(runId)} has more than ${String(MAX_PAGES * PAGE_SIZE)} jobs; it cannot be judged`)
}

/**
 * The jobs of a run that stand for a job id of the workflow: the job itself or its matrix legs (`lint (be)`), also when a reusable
 * workflow prefixes the caller's name (`ci / lint (be)`). A job id that only starts with the same letters (`lint-extra`) is another job.
 */
export const jobsNamed = (jobs: readonly RunJob[], id: string): RunJob[] =>
    jobs.filter((job) => {
        const name = job.name.slice(job.name.lastIndexOf(" / ") + 1 === 0 ? 0 : job.name.lastIndexOf(" / ") + 3)
        return name === id || name.startsWith(`${id} (`)
    })

const describe = (job: RunJob): string => `${job.name}: ${job.status === "completed" ? job.conclusion : job.status}`

/**
 * Judges a run for `sha`: it is a run of the managed CI workflow, of a push (or a dispatch) event, of exactly this commit; it is not red or
 * cancelled; and every required job concluded `success` (a skipped, cancelled, failed or unfinished one is refused; a job the run never had
 * is refused), and an optional job the run has is not red. Returns what was checked, or refuses with the first reason. Pure: the run's facts and jobs are given.
 */
export const judgeRun = (sha: string, run: RunFacts, jobs: readonly RunJob[], standard: RequiredJobs): CiRunEvidence => {
    const here = `run ${String(run.id)}${run.url === "" ? "" : ` (${run.url})`}`
    if (run.sha !== sha) throw new Refusal("CI_RUN_SHA_MISMATCH", `${here} is a run of ${run.sha === "" ? "an unknown commit" : run.sha.slice(0, 9)}, not of the commit being deployed (${sha.slice(0, 9)}); only a run of that exact commit is evidence`)
    if (run.path !== CI_WORKFLOW_PATH) throw new Refusal("CI_RUN_WORKFLOW", `${here} is a run of ${run.path === "" ? "an unknown workflow" : run.path}; the evidence is a run of ${CI_WORKFLOW_PATH}`)
    if (!EVIDENCE_EVENTS.includes(run.event)) throw new Refusal("CI_RUN_WORKFLOW", `${here} was started by ${run.event === "" ? "an unknown event" : run.event}; only a ${EVIDENCE_EVENTS.join(" or ")} run is evidence`)
    if (run.status === "completed" && run.conclusion !== "success") throw new Refusal("CI_NOT_GREEN", `${here} of ${sha.slice(0, 9)} concluded ${run.conclusion === "" ? "without a verdict" : run.conclusion}`)
    if (run.status !== "completed" && run.status !== "in_progress") throw new Refusal("CI_NOT_GREEN", `${here} of ${sha.slice(0, 9)} is ${run.status === "" ? "in an unknown state" : run.status}, not running yet`)
    const checked: { job: string; names: string[] }[] = []
    const problems: string[] = []
    for (const id of standard.required) {
        const found = jobsNamed(jobs, id)
        if (found.length === 0) problems.push(`required job ${id} is not in the run (a job the run never had is not a green one)`)
        else if (found.some((job) => job.status !== "completed" || job.conclusion !== "success")) problems.push(`required job ${id} is not green: ${found.filter((job) => job.status !== "completed" || job.conclusion !== "success").map(describe).join(", ")}`)
        else checked.push({ job: id, names: found.map((job) => job.name) })
    }
    for (const id of standard.optional) {
        const red = jobsNamed(jobs, id).filter((job) => job.status !== "completed" || (job.conclusion !== "success" && job.conclusion !== "skipped"))
        if (red.length > 0) problems.push(`optional job ${id} is in the run and not green: ${red.map(describe).join(", ")}`)
    }
    if (problems.length > 0) throw new Refusal("CI_NOT_GREEN", `${here} of ${sha.slice(0, 9)} is not deployable: ${problems.join("; ")}`)
    return { runId: run.id, url: run.url, sha, checked }
}

/**
 * Accepts `ciRun` as the CI evidence of `sha`: reads the run and its jobs through GitHub's API (`read`) and judges them against `standard`.
 * Works inside the run that is still in progress (the deploy job sits after the verdict job in the same run) and on a finished run of the
 * same commit (the candidate run a `plan` job reused). Refuses CI_NOT_GREEN, CI_RUN_SHA_MISMATCH, CI_RUN_WORKFLOW or CI_RUN_UNREADABLE.
 */
export const requireCiRun = async (read: GithubReader, sha: string, ciRun: string, standard: RequiredJobs): Promise<CiRunEvidence> => {
    if (!/^[1-9]\d{0,15}$/u.test(ciRun)) throw new Refusal("CI_RUN_USAGE", `--ci-run takes the numeric id of a GitHub Actions run, not ${JSON.stringify(ciRun.slice(0, 40))}`)
    if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Refusal("CI_RUN_USAGE", "--ci-run judges one exact commit: --sha must be its full 40-hex sha")
    const runId = Number(ciRun)
    const run = factsOf(await read(`actions/runs/${ciRun}`), runId)
    if (run.sha !== sha) return judgeRun(sha, run, [], standard)
    return judgeRun(sha, run, await jobsOf(read, runId), standard)
}
