import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { IDLE_JOBS } from "@starci/hfs/runtime/scripts/lib/stack-declaration.mjs"
import { parse } from "yaml"
import { Refusal, asRefusal } from "../../shared/errors.js"
import { runTool } from "../../shared/exec.js"
import { git } from "../../shared/git.js"

/**
 * The CI evidence of a deploy (contexts/project/cicd.md, WP3): `starci app stack deploy --ci-run <run>` asks GitHub itself whether the
 * jobs that CI standard requires passed for the exact commit being deployed. The required jobs come from the CI standard of the
 * @starci/hfs this CLI runs with (knowledge/hfs/ci-standard.yaml `jobs`), never from the workflow file of the checkout, so a workflow
 * edited to skip a check gains nothing: the job is missing or skipped in the run, and a missing or skipped job is not a green one.
 *
 * The evidence of a commit is its verdict (and the required jobs it judged) plus the images jobs that pushed the digests, never the run's
 * own conclusion: the `deploy-<env>` jobs and their `rollback` come after the verdict in the same run, so an auto-deploy that failed turns the
 * run red without saying anything about the commit. Judging the conclusion would refuse every manual deploy after a failed auto-deploy.
 */

/** Reads one GitHub REST path (relative to the API root) and returns its parsed json; a seam so the judgement runs on recorded answers. */
export type GithubReader = (path: string) => Promise<unknown>

/** The CI standard's jobs: the ones a green run must have passed, and the ones that may exist and must not be red. */
export interface RequiredJobs {
    readonly required: readonly string[]
    readonly optional: readonly string[]
    /**
     * The pipeline jobs (`images`): reusable workflows whose every job must have passed (`images / image (api)`, `images / collect`, the
     * jobs that build and push the digests a deploy pins); one skipped or missing means no digest was pushed, so the commit is not deployable.
     */
    readonly pipeline?: readonly string[]
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
/** The jobs that follow the verdict in the same run (ci-standard.yaml `deployJobPrefix`, and stack-deploy.yml's `rollback`): never evidence of the commit. */
const DEPLOY_JOB_PREFIX = "deploy-"
const ROLLBACK_JOB = "rollback"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === "string" ? value : "")
const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

/** The jobs of the managed CI an app may idle, each with the gates that must ALL be declared off: the renderer's own table, so the CLI never drifts from it. */
export { IDLE_JOBS }

/**
 * The jobs a declaration idles (`IDLE_JOBS`: the job whose every gate the app declares off, `gates.<gate>: {run: off, reason}`).
 * A gate counts as off only with a non-empty reason, and only a gate the table names. Everything else (plan, fast, build, verdict, the images, and the harness's own gates hfs, secrets, db,
 * which an app never switches off) stays required: those are the floor.
 */
export const idleJobsOfDeclaration = (declaration: unknown, table: Readonly<Record<string, readonly string[]>>): string[] => {
    const gates = isRecord(declaration) && isRecord(declaration.gates) ? declaration.gates : {}
    const off = (gate: string): boolean => {
        const entry = gates[gate]
        return isRecord(entry) && entry.run === "off" && typeof entry.reason === "string" && entry.reason.trim() !== ""
    }
    return Object.entries(table).filter(([, needed]) => needed.length > 0 && needed.every(off)).map(([job]) => job)
}

/** The declaration of the app as committed at `sha` (the tree CI ran), or undefined when it holds none or cannot be read. */
const declarationAt = async (root: string, sha: string): Promise<unknown> => {
    try {
        return parse(await git(root, ["show", `${sha}:.starcistacks/application-stacks.yaml`])) as unknown
    } catch {
        return undefined
    }
}

/** The jobs the CI standard of the installed @starci/hfs requires, less the ones `declaration` idles; refused when the standard cannot be read or names none. */
export const requiredJobsOf = (declaration?: unknown): RequiredJobs => {
    let file: string
    try {
        file = createRequire(import.meta.url).resolve(CI_STANDARD)
    } catch {
        throw new Refusal("HFS_NOT_INSTALLED", `${CI_STANDARD} does not resolve from the CLI; reinstall starci-harness`)
    }
    const parsed: unknown = parse(readFileSync(file, "utf8"))
    const entry = isRecord(parsed) && isRecord(parsed.jobs) ? parsed.jobs : {}
    const required = names(entry.required)
    if (required.length === 0) throw new Refusal("CI_RUN_UNREADABLE", "the CI standard of @starci/hfs names no required job; it cannot be judged")
    const idle = new Set(idleJobsOfDeclaration(declaration, IDLE_JOBS))
    // A job the app idles is not required, but when the run has it, it may not be red (judgeJobs treats an optional job that ran red as a problem; skipped is fine).
    return { required: required.filter((job) => !idle.has(job)), optional: [...names(entry.optional), ...required.filter((job) => idle.has(job))], pipeline: names(entry.pipeline) }
}

/** The jobs required for the app at `root` deploying `sha`: the standard's, less the jobs the declaration of that commit idles (gates it declares off with a reason). */
export const requiredJobsAt = async (root: string, sha: string): Promise<RequiredJobs> => requiredJobsOf(await declarationAt(root, sha))

/** A message with anything shaped like a GitHub token removed: nothing this check prints may carry one. */
const scrubbed = (message: string): string => message.replaceAll(/\b(?:gh[pousr]_|github_pat_)\w{8,}/gu, "[token]")

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
const green = (job: RunJob): boolean => job.status === "completed" && job.conclusion === "success"

/** The calling job of a run's job: `deploy-production` of `deploy-production / deploy`, `images` of `images / image (api)`, else the job id itself. */
const callerOf = (job: RunJob): string => {
    const cut = job.name.indexOf(" / ")
    const head = cut < 0 ? job.name : job.name.slice(0, cut)
    const leg = head.indexOf(" (")
    return leg < 0 ? head : head.slice(0, leg)
}

/** Whether a job of the run is a deploy (`deploy-<env>` and every job its stack-deploy.yml call runs) or the rollback: what follows the verdict, never evidence. */
export const isDeployJob = (job: RunJob): boolean => {
    const caller = callerOf(job)
    return caller.startsWith(DEPLOY_JOB_PREFIX) || caller === ROLLBACK_JOB
}

/** The jobs of a run a pipeline job id stands for: the job itself, its matrix legs, or every job of the reusable workflow it calls (`images / collect`). */
export const pipelineJobsNamed = (jobs: readonly RunJob[], id: string): RunJob[] => jobs.filter((job) => callerOf(job) === id)

/** Every required job of the standard that is green in the run, and what is wrong with a required job that is not or an optional one that is red. */
const judgeJobs = (all: readonly RunJob[], standard: RequiredJobs): { readonly checked: { job: string; names: string[] }[]; readonly problems: string[] } => {
    const checked: { job: string; names: string[] }[] = []
    const problems: string[] = []
    // The deploy jobs and the rollback run after the verdict: a failed auto-deploy says nothing about the commit, so they are not read at all.
    const jobs = all.filter((job) => !isDeployJob(job))
    const judgeFound = (id: string, found: readonly RunJob[], kind: string): void => {
        if (found.length === 0) problems.push(`${kind} job ${id} is not in the run (a job the run never had is not a green one)`)
        else if (!found.every(green)) problems.push(`${kind} job ${id} is not green: ${found.filter((job) => !green(job)).map(describe).join(", ")}`)
        else checked.push({ job: id, names: found.map((job) => job.name) })
    }
    for (const id of standard.required) judgeFound(id, jobsNamed(jobs, id), "required")
    for (const id of standard.pipeline ?? []) judgeFound(id, pipelineJobsNamed(jobs, id), "pipeline")
    for (const id of standard.optional) {
        const red = jobsNamed(jobs, id).filter((job) => job.status !== "completed" || (job.conclusion !== "success" && job.conclusion !== "skipped"))
        if (red.length > 0) problems.push(`optional job ${id} is in the run and not green: ${red.map(describe).join(", ")}`)
    }
    return { checked, problems }
}

/**
 * Refuses a run that is not running yet. A finished run is not judged by its conclusion: a run whose verdict and images passed and whose
 * auto-deploy then failed concludes `failure`, and its jobs decide (judgeJobs), so a manual deploy after a failed auto-deploy is not refused.
 */
const assertRunState = (sha: string, run: RunFacts, here: string): void => {
    if (run.status !== "completed" && run.status !== "in_progress") throw new Refusal("CI_NOT_GREEN", `${here} of ${sha.slice(0, 9)} is ${run.status === "" ? "in an unknown state" : run.status}, not running yet`)
}

/** Refuses a run that is not the managed CI workflow's push run of exactly this commit, or that is not running yet. */
const assertEvidence = (sha: string, run: RunFacts, here: string): void => {
    if (run.sha !== sha) throw new Refusal("CI_RUN_SHA_MISMATCH", `${here} is a run of ${run.sha === "" ? "an unknown commit" : run.sha.slice(0, 9)}, not of the commit being deployed (${sha.slice(0, 9)}); only a run of that exact commit is evidence`)
    if (run.path !== CI_WORKFLOW_PATH) throw new Refusal("CI_RUN_WORKFLOW", `${here} is a run of ${run.path === "" ? "an unknown workflow" : run.path}; the evidence is a run of ${CI_WORKFLOW_PATH}`)
    if (!EVIDENCE_EVENTS.includes(run.event)) throw new Refusal("CI_RUN_WORKFLOW", `${here} was started by ${run.event === "" ? "an unknown event" : run.event}; only a ${EVIDENCE_EVENTS.join(" or ")} run is evidence`)
    assertRunState(sha, run, here)
}

/**
 * Judges a run for `sha`: it is a run of the managed CI workflow, of a push (or a dispatch) event, of exactly this commit, started; every
 * required job (the verdict among them) concluded `success` (a skipped, cancelled, failed or unfinished one is refused; a job the run never had
 * is refused), every job of each pipeline job (the images that pushed the digests) concluded `success`, and an optional job the run has is
 * not red. The deploy jobs and the rollback are never read, nor the run's own conclusion they turn red. Returns what was checked, or refuses
 * with every reason. Pure: the run's facts and jobs are given.
 */
export const judgeRun = (sha: string, run: RunFacts, jobs: readonly RunJob[], standard: RequiredJobs): CiRunEvidence => {
    const urlSuffix = run.url === "" ? "" : ` (${run.url})`
    const here = `run ${String(run.id)}${urlSuffix}`
    assertEvidence(sha, run, here)
    const { checked, problems } = judgeJobs(jobs, standard)
    const concluded = run.status === "completed" && run.conclusion !== "success" ? ` (the run concluded ${run.conclusion === "" ? "without a verdict" : run.conclusion})` : ""
    if (problems.length > 0) throw new Refusal("CI_NOT_GREEN", `${here} of ${sha.slice(0, 9)} is not deployable${concluded}: ${problems.join("; ")}`)
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

/**
 * Finds the CI evidence of `sha` when no run is named (`--ci-run` given empty): the runs of the managed CI workflow for exactly this commit,
 * newest first as GitHub lists them, each judged as a named run is (judgeRun: same sha, same workflow, verdict and images green, the deploy
 * jobs not read), and the first accepted one is the evidence. Refuses CI_NOT_GREEN with every run's reason when none is accepted, or when the
 * commit has no push or dispatch run of the workflow.
 */
export const findCiRun = async (read: GithubReader, sha: string, standard: RequiredJobs): Promise<CiRunEvidence> => {
    if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Refusal("CI_RUN_USAGE", "--ci-run judges one exact commit: --sha must be its full 40-hex sha")
    const workflow = CI_WORKFLOW_PATH.slice(CI_WORKFLOW_PATH.lastIndexOf("/") + 1)
    const raw = await read(`actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=${String(PAGE_SIZE)}`)
    if (!isRecord(raw) || !Array.isArray(raw.workflow_runs)) throw new Refusal("CI_RUN_UNREADABLE", `GitHub's run list of ${CI_WORKFLOW_PATH} for ${sha.slice(0, 9)} is not a run list`)
    const runs = raw.workflow_runs.filter(isRecord).flatMap((entry) => (typeof entry.id === "number" ? [factsOf(entry, entry.id)] : []))
    const reasons: string[] = []
    for (const candidate of runs.filter((each) => each.sha === sha && each.path === CI_WORKFLOW_PATH && EVIDENCE_EVENTS.includes(each.event))) {
        try {
            return judgeRun(sha, candidate, await jobsOf(read, candidate.id), standard)
        } catch (error: unknown) {
            if (!(error instanceof Refusal) || error.code !== "CI_NOT_GREEN") throw error
            reasons.push(error.message)
        }
    }
    if (reasons.length === 0) throw new Refusal("CI_NOT_GREEN", `${sha.slice(0, 9)} has no ${EVIDENCE_EVENTS.join(" or ")} run of ${CI_WORKFLOW_PATH}; push it, or wait for its run`)
    throw new Refusal("CI_NOT_GREEN", `no run of ${CI_WORKFLOW_PATH} proves ${sha.slice(0, 9)}: ${reasons.join(" | ")}`)
}
