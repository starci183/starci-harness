import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureNpm, captureTool, EXIT_TIMEOUT, headline, pidAlive } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { captureGit, git, nulPaths, resolveSha } from "../shared/git.js"
import { evidenceTail } from "../shared/output.js"
import { locateTree } from "../shared/tree.js"
import { describeSecrets, scanSecrets } from "../core/check/secrets-scan.js"
import { describeLoosening, scanLoosening } from "../core/check/loosening-scan.js"
import { excludedSpec, notOwn } from "./baseline.js"
import { rebaseCandidate } from "./land.js"
import { readRecord, reapplyLocal } from "../core/deps/packages.js"
import { withHeavySlot } from "./heavy.js"
import { cachedInstall, isInstalled, unlinkCheckoutLinks } from "./install-cache.js"
import { cleanCheckoutsPath } from "./ledger.js"
import { underPaths } from "./contract.js"
import { loadPolicy, resolveProfile } from "./policy.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { olderNote, runCheck, strayFiles } from "./run-checks.js"
import { assertWorktreeHooks } from "./worktree.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "./run-checks.js"
import { inOrder } from "./sequential.js"

const LIST_SHOWN = 20

/** The folder name every clean-verify checkout starts with; the pid in it tells a live verifier's checkout from a leftover. */
const VERIFY_PREFIX = "starci-verify-"

/**
 * What a clean verify built and what its checks said about it; `paths` are the allowPaths added whole, `notes` what was skipped
 * and why, `foreign` the commits under allowPaths the harness did not make while the task ran.
 */
export interface CleanVerify {
    readonly candidate: string
    readonly tree: string
    readonly parent: string
    readonly base: string
    readonly changed: readonly string[]
    readonly foreign: readonly string[]
    readonly paths: readonly string[]
    readonly notes: readonly string[]
    readonly checks: readonly CheckOutcome[]
    readonly verdict: "green" | "red"
}

/**
 * What the caller hands a clean verify: the task's name for the temp folder and the message the candidate commit carries;
 * `taskId` and `since` scope the stray-files judgement, `result` feeds `@result` json checks, `timeoutMs` bounds npm ci and each check.
 */
export interface CleanVerifyInput {
    readonly root: string
    readonly contract: Contract
    readonly checks: readonly ResolvedCheck[]
    readonly name: string
    readonly message: string
    readonly taskId?: string
    readonly since?: string
    readonly result?: ResultSource
    readonly timeoutMs?: number
    /** The head the candidate lands on, when the task works in an Op worktree: the candidate is rebased onto it before any check, so what is verified is what lands. */
    readonly onto?: string
    /** The commit the Op worktree was cut at: only commits after it are the task's to judge. */
    readonly fork?: string
    /** False when none of the checks runs a tool from node_modules (a task whose heavy checks wait for the wave): no install, no setup. */
    readonly install?: boolean
}

interface Built {
    readonly facts: Omit<CleanVerify, "base" | "checks" | "verdict">
    readonly lands: CheckOutcome
}

const listed = (files: readonly string[]): string => {
    const shown = files.slice(0, LIST_SHOWN).join(", ")
    const more = files.length > LIST_SHOWN ? ` and ${String(files.length - LIST_SHOWN)} more` : ""
    return shown + more
}

const literal = (path: string): string => `:(top,literal)${path}`

// The temporary index lives only in GIT_INDEX_FILE of the child, so the user's index is never touched.
const gitIndexed = (cwd: string, index: string, args: readonly string[]): Promise<ToolRun> => captureGit(args, cwd, { env: { GIT_INDEX_FILE: index } })

const gitIndexedOk = async (cwd: string, index: string, args: readonly string[]): Promise<string> => {
    const run = await gitIndexed(cwd, index, args)
    if (run.exitCode !== 0) {
        const reason = headline(run.stderr) || `exit ${String(run.exitCode)}`
        throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${reason}`)
    }
    return run.stdout
}

interface Staged {
    readonly whole: readonly string[]
    readonly trackedOnly: readonly string[]
    readonly notes: readonly string[]
}

/**
 * Sorts the allowPaths for `git add`: one that names nothing is left out (git refuses a pathspec matching nothing), and one the
 * repository ignores lands only its tracked files (`git add` refuses an ignored path), with a note saying so.
 */
const stagePlan = async (root: string, index: string, allowPaths: readonly string[]): Promise<Staged> => {
    const whole: string[] = []
    const trackedOnly: string[] = []
    const notes: string[] = []
    const found = await inOrder(allowPaths, async (path) => {
        const tracked = (await gitIndexedOk(root, index, ["ls-files", "--", literal(path)])) !== ""
        if (!existsSync(join(root, path)) && !tracked) return undefined
        // --no-index: `git add` refuses a named path its ignore rules match even when files below it are tracked.
        const ignored = (await gitIndexed(root, index, ["check-ignore", "-q", "--no-index", "--", path])).exitCode === 0
        return { path, tracked, ignored }
    })
    for (const entry of found) {
        if (entry === undefined) continue
        const { path, tracked, ignored } = entry
        if (!ignored) whole.push(path)
        else if (tracked) {
            trackedOnly.push(path)
            notes.push(`${path} is gitignored: only its tracked files land`)
        } else notes.push(`${path} is gitignored and untracked: skipped, nothing of it lands`)
    }
    return { whole, trackedOnly, notes }
}

/**
 * The commits on `parent` since the task was created (`since`, to the second: git dates carry no more) that change its
 * `allowPaths` and carry no `Starci-Task:` trailer: work the harness did not land. None without a task to date it.
 */
const foreignCommits = async (root: string, since: string | undefined, parent: string, allowPaths: readonly string[], fork: string | undefined): Promise<string[]> => {
    if (since === undefined) return []
    const second = new Date(Math.floor(Date.parse(since) / 1000) * 1000).toISOString()
    const log = await git(root, ["log", `--since=${second}`, "--format=%H%x1f%B%x1e", fork === undefined ? parent : `${fork}..${parent}`, "--", ...allowPaths.map(literal)])
    return log
        .split("\x1e")
        .map((entry) => entry.split("\x1f"))
        .filter(([sha = "", body = ""]) => sha.trim() !== "" && !/^Starci-Task: /m.test(body))
        .map(([sha = ""]) => sha.trim())
}

const landsDetail =(changed: readonly string[], missing: readonly string[]): string => {
    if (missing.length > 0) return `changed under allowPaths but not in the candidate, so they would never land: ${listed(missing)}`
    if (changed.length === 0) return "nothing changed under allowPaths; nothing lands"
    return `${String(changed.length)} file(s) land: ${listed(changed)}`
}

/**
 * Commits HEAD plus the task's own work under its allowPaths through a temporary index; the user's index and work tree stay
 * as they are. A dirty file under allowPaths that is not the task's own (harness/baseline.ts notOwn) is left out and named in a note. The `lands` outcome is red when work under allowPaths would not land through the harness: a dirty or untracked
 * file missing from the candidate, or a commit made while the task ran (since its creation) that changed its allowPaths without the
 * harness trailer (a worker that committed itself). A task never settles "done, nothing landed" while its work sits in the
 * tree or in a commit nobody verified.
 */
const buildCandidate = async (input: CleanVerifyInput): Promise<Built> => {
    const { root, contract, message } = input
    const parent = await resolveSha(root, "HEAD")
    const index = join(tmpdir(), `starci-index-${randomBytes(6).toString("hex")}`)
    try {
        await gitIndexedOk(root, index, ["read-tree", "HEAD"])
        const plan = await stagePlan(root, index, contract.context.allowPaths)
        const others = input.taskId === undefined ? [] : await notOwn(root, input.taskId, contract.context.allowPaths)
        const leftOut = others.map(excludedSpec)
        if (plan.whole.length > 0) await gitIndexedOk(root, index, ["add", "-A", "--", ...plan.whole.map(literal), ...leftOut])
        if (plan.trackedOnly.length > 0) await gitIndexedOk(root, index, ["add", "-u", "--", ...plan.trackedOnly.map(literal), ...leftOut])
        const tree = await gitIndexedOk(root, index, ["write-tree"])
        // What the work tree holds under allowPaths that the staged snapshot does not: read against that same temporary index
        // (index to work tree, plus files it does not know), so a file is never judged against a second, later look at HEAD.
        const scope = ["--", ...contract.context.allowPaths.map(literal), ...leftOut]
        const unstaged = nulPaths(await gitIndexedOk(root, index, ["diff", "--name-only", "-z", ...scope]))
        const unknown = nulPaths(await gitIndexedOk(root, index, ["ls-files", "--others", "--exclude-standard", "-z", ...scope]))
        const candidate = await git(root, ["commit-tree", tree, "-p", parent, "-m", message])
        const changed = nulPaths(await git(root, ["diff", "--name-only", "-z", parent, candidate]))
        const missing = [...new Set([...unstaged, ...unknown])].filter((file) => underPaths(file, contract.context.allowPaths)).sort((left, right) => left.localeCompare(right))
        const foreign = await foreignCommits(root, input.since, parent, contract.context.allowPaths, input.fork)
        const lands: CheckOutcome = {
            name: "lands",
            kind: "files",
            status: missing.length === 0 && foreign.length === 0 ? "green" : "red",
            exitCode: null,
            detail: [
                landsDetail(changed, missing),
                ...(foreign.length === 0 ? [] : [`committed under allowPaths while the task ran, by someone other than the harness (no Starci-Task trailer), so the harness neither lands nor credits it: ${listed(foreign.map((sha) => sha.slice(0, 12)))}`]),
                ...plan.notes,
                ...(others.length === 0 ? [] : [`dirty under allowPaths before the task's work began, not its own, left out: ${listed(others)}`]),
            ].join("\n"),
        }
        return { facts: { candidate, tree, parent, changed, foreign, paths: [...plan.whole, ...plan.trackedOnly], notes: plan.notes }, lands }
    } finally {
        rmSync(index, { force: true })
    }
}


/**
 * The install where the candidate carries a lockfile (the contract's cwd first, then the root); undefined when there is none. It
 * comes from the shared install cache keyed by the lockfile, Node and npm (harness/install-cache.ts): a hit links the cached
 * node_modules into the checkout, a miss runs `npm ci` and caches it. When the repository is in local package mode (`starci deps
 * source --local`) the cached tree is copied, not linked, and the same local copies are applied after it, so the candidate runs
 * against the package the work tree runs against (`reapplyLocal`).
 */
const install = async (place: CheckPlace): Promise<CheckOutcome | undefined> => {
    const dir = [place.cwd, place.root].find((candidate) => existsSync(join(candidate, "package-lock.json")))
    // An install an earlier prepare of the same checkout made (a wave's other cwd) is not made twice.
    if (dir === undefined || isInstalled(dir)) return undefined
    const source = place.source ?? place.root
    const local = (readRecord(source)?.packages.length ?? 0) > 0
    const cached = await cachedInstall(dir, join(dir, "package-lock.json"), place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs }, local)
    const exitCode = cached.run?.exitCode ?? 0
    const tail = cached.run === null ? "" : `\n${evidenceTail(cached.run.stdout, cached.run.stderr)}`
    const installed: CheckOutcome = { name: "install", kind: "install", status: exitCode === 0 ? "green" : "red", exitCode, detail: `${cached.note}${tail}` }
    if (installed.status === "red" || !local) return installed
    const reapplied = await reapplyLocal(source, dir)
    if (reapplied === undefined) return installed
    return { ...installed, status: reapplied.status, detail: `${installed.detail}\nlocal package sources (starci deps source):\n${reapplied.detail}` }
}

/** The refusal of a verify or wave stopped by the harness's own step (an install or setup out of time): no verdict on the work. */
export const VERIFY_INFRA = "VERIFY_INFRA"

/**
 * Refuses with VERIFY_INFRA when a preparing step failed on the harness, not on the work: the install or a setup command ran
 * out of its budget (exit 124). The caller reaches no verdict: a task verify returns the task to reported with no try spent, a
 * wave fails no task, and the next step verifies again.
 */
export const assertNoInfraFailure = (prepared: readonly CheckOutcome[]): void => {
    const stuck = prepared.find((outcome) => outcome.status === "red" && outcome.exitCode === EXIT_TIMEOUT)
    if (stuck === undefined) return
    throw new Refusal(VERIFY_INFRA, `the ${stuck.name} step ran out of time (an infrastructure failure, not the task's): ${stuck.detail.split("\n")[0] ?? ""}`)
}

/**
 * Readies a clean checkout for the checks that run tools: the install, then every contract's setup commands in order; an outcome
 * per step that ran, and nothing after a red one.
 */
export const prepareCheckout = async (place: CheckPlace, setups: readonly (readonly (readonly string[])[])[]): Promise<CheckOutcome[]> => {
    const installed = await install(place)
    if (installed?.status === "red") return [installed]
    const prepared = await setUp(setups.flat(), place)
    return [...(installed === undefined ? [] : [installed]), ...(prepared === undefined ? [] : [prepared])]
}

/** Runs the contract's setup commands in cwd (npm through the running Node, each under a heavy-command slot), one outcome for all; undefined when none. */
const setUp = async (commands: readonly (readonly string[])[], place: CheckPlace): Promise<CheckOutcome | undefined> => {
    if (commands.length === 0) return undefined
    const options = place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs }
    for (const [tool = "", ...args] of commands) {
        const label = [tool, ...args].slice(0, 3).join(" ")
        const run = await withHeavySlot("build", label, place.cwd, options, (held) => (tool === "npm" ? captureNpm(args, place.cwd, held.options) : captureTool(tool, args, place.cwd, held.options)))
        if (run.exitCode !== 0) return { name: "setup", kind: "setup", status: "red", exitCode: run.exitCode, detail: `${[tool, ...args].join(" ")}\n${evidenceTail(run.stdout, run.stderr)}` }
    }
    return { name: "setup", kind: "setup", status: "green", exitCode: 0, detail: commands.map((command) => command.join(" ")).join("\n") }
}

/**
 * Runs one check against the candidate. The paths-only check judges two things: what would land (the candidate against its
 * parent, never against a pinned base that other settled tasks moved past), and what the task may have written outside its
 * allowPaths in the user's work tree, which never lands but must not pass unseen.
 */
const checkCandidate = async (check: ResolvedCheck, input: CleanVerifyInput, place: CheckPlace, built: Built): Promise<CheckOutcome> => {
    const primitive = check.check
    if (primitive.kind !== "files" || primitive.onlyAllowPaths !== true) return runCheck(check, input.contract, place)
    const problems: string[] = []
    const allowPaths = input.contract.context.allowPaths
    const landing = built.facts.changed.filter((file) => !underPaths(file, allowPaths))
    if (landing.length > 0) problems.push(`the candidate changes outside allowPaths: ${listed(landing)}`)
    const stray = await strayFiles(input.root, allowPaths, { ...(input.taskId === undefined ? {} : { taskId: input.taskId }), ...(input.since === undefined ? {} : { since: input.since }) })
    if (stray.written.length > 0) problems.push(`written outside allowPaths in the work tree (dirty or untracked): ${listed(stray.written)}`)
    if (primitive.mustExist !== undefined) {
        const rest = await runCheck({ ...check, check: { kind: "files", mustExist: primitive.mustExist } }, input.contract, place)
        if (rest.status === "red") problems.push(rest.detail)
    }
    const notes = stray.older.length > 0 ? [olderNote(stray.older)] : []
    return {
        name: check.name,
        kind: "files",
        status: problems.length === 0 ? "green" : "red",
        exitCode: null,
        detail: [...(problems.length === 0 ? ["the candidate touches only allowPaths and nothing else was written"] : problems), ...notes].join("\n"),
    }
}

const removeWorktree = async (root: string, dir: string): Promise<void> => {
    // Every link the checkout holds (the install's, and any a setup command made) is unlinked first, link only, so neither
    // git's removal nor the recursive delete below can reach the cache or any folder a link names.
    unlinkCheckoutLinks(dir)
    await captureGit(["worktree", "remove", "--force", dir], root)
    rmSync(dir, { recursive: true, force: true })
}

const verifierPid = (dir: string): number | undefined => {
    const pid = /-p(\d+)-[^-]*$/.exec(basename(dir))?.[1]
    return pid === undefined ? undefined : Number(pid)
}

/** Removes this repository's clean-verify checkouts whose verifier is gone (a killed verify leaves its worktree); returns them. */
export const pruneVerifyWorktrees = async (root: string): Promise<string[]> => {
    const listing = await captureGit(["worktree", "list", "--porcelain"], root)
    const dirs = [...listing.stdout.matchAll(/^worktree (.+)$/gm)].map((match) => (match[1] ?? "").trim()).filter((dir) => basename(dir).startsWith(VERIFY_PREFIX))
    const pruned = dirs.filter((dir) => {
        const pid = verifierPid(dir)
        return pid === undefined || (pid !== process.pid && !pidAlive(pid))
    })
    await inOrder(pruned, (dir) => removeWorktree(root, dir))
    await captureGit(["worktree", "prune"], root)
    return pruned
}

/**
 * The content gates every candidate meets whatever its contract says: the `secrets` and `loosening` gates of the project's
 * runtime tier (policy/quality.yaml, its profile resolved from the project's hfs.json), run by the scanners of core/check on the
 * candidate's checkout `dir` and judged on the files it changes. A finding, or a changed file too large to judge, is red.
 */
const policyGates = async (root: string, dir: string, changed: readonly string[]): Promise<CheckOutcome[]> => {
    const policy = loadPolicy(root)
    const profile = resolveProfile(policy, locateTree(root).root)
    const gates: CheckOutcome[] = []
    const outcome = (name: string, red: boolean, lines: readonly string[]): CheckOutcome => ({ name, kind: "gate", status: red ? "red" : "green", exitCode: null, detail: lines.join("\n") })
    if (profile.profile.runtime.includes("secrets")) {
        const report = scanSecrets(dir, changed, policy, profile.name, false)
        gates.push(outcome("secrets", report.verdict === "red", describeSecrets(report)))
    }
    if (profile.profile.runtime.includes("loosening")) {
        const touched = new Set(changed)
        const report = await scanLoosening(dir, policy)
        // Judged on the changed files only: a finding elsewhere, or an exception for a file this task never touched, is not its own.
        const findings = report.findings.filter((finding) => touched.has(finding.file))
        const unjudged = report.unjudged.filter((file) => touched.has(file))
        const red = findings.length + unjudged.length > 0
        gates.push(outcome("loosening", red, describeLoosening({ ...report, findings, unjudged, stale: [], verdict: red ? "red" : "green" })))
    }
    return gates
}

/**
 * The candidate rebased onto `onto` (harness/land.ts rebaseCandidate): its parent becomes that head and what it changes is
 * read against it. A textual conflict throws LandConflict before any check runs.
 */
const rebased = async (root: string, built: Built, onto: string | undefined): Promise<Built> => {
    if (onto === undefined || onto === built.facts.parent) return built
    const { commit, tree } = await rebaseCandidate(root, built.facts.candidate, built.facts.parent, onto)
    const changed = nulPaths(await git(root, ["diff", "--name-only", "-z", onto, commit]))
    return { ...built, facts: { ...built.facts, candidate: commit, tree, parent: onto, changed } }
}

/**
 * Verifies a task on a clean checkout of HEAD plus its allowPaths, so a dirty or lucky work tree can never turn a check green;
 * a task in an Op worktree is verified on that candidate rebased onto the head it lands on (`onto`).
 */
export const cleanVerify = async (input: CleanVerifyInput): Promise<CleanVerify> => {
    const { root, contract } = input
    // A declared hooks folder the task's checkout lacks means its commits skip the product's own gate: nothing verifies.
    await assertWorktreeHooks(root)
    const base = await resolveSha(root, contract.context.revision)
    const built = await rebased(root, await buildCandidate(input), input.onto)
    return inCleanCheckout(root, built.facts.candidate, input.name, async (dir) => {
        const resolved: Contract = { ...contract, context: { ...contract.context, revision: base } }
        // Scoped starci checks diff the candidate against its parent: in the detached checkout HEAD is the candidate itself.
        const place: CheckPlace = {
            root: dir,
            source: root,
            cwd: join(dir, contract.context.cwd ?? "."),
            diffBase: built.facts.parent,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
            ...(input.result === undefined ? {} : { result: input.result }),
        }
        const checks: CheckOutcome[] = [built.lands, ...(await policyGates(root, dir, built.facts.changed))]
        const prepared = input.install === false ? [] : await prepareCheckout(place, [contract.context.setup ?? []])
        assertNoInfraFailure(prepared)
        checks.push(...prepared)
        if (prepared.every((outcome) => outcome.status === "green")) {
            checks.push(...(await inOrder(input.checks, (check) => checkCandidate(check, { ...input, contract: resolved }, place, built))))
        }
        const verdict = checks.every((check) => check.status === "green") ? "green" : "red"
        return { ...built.facts, base, checks, verdict }
    })
}

/**
 * Runs `work` in a detached clean checkout of `commit` under the state base's checkouts folder (ledger.ts cleanCheckoutsPath;
 * named for the verifier's pid, so a leftover is pruned once it is gone), and removes the checkout when the work ends however it
 * ends (a verdict, a throw, a deadline), every link in it unlinked first. Git lists the checkout as a detached worktree of the
 * repository while it lives, so Orca shows it there: it lives only as long as its run.
 */
export const inCleanCheckout = async <T>(root: string, commit: string, name: string, work: (dir: string) => Promise<T>): Promise<T> => {
    const base = cleanCheckoutsPath()
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, `${VERIFY_PREFIX}${name}-p${String(process.pid)}-`))
    try {
        await git(root, ["worktree", "add", "--detach", dir, commit])
        return await work(dir)
    } finally {
        // A cleanup that fails (a file Windows still holds: EBUSY) must not replace the verdict; the next verify's
        // pruneVerifyWorktrees removes the folder once this pid is gone.
        await removeWorktree(root, dir).catch(() => undefined)
        await captureGit(["worktree", "prune"], root).catch(() => undefined)
    }
}
