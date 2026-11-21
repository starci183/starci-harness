import { spawnSync } from "node:child_process"
import { captureGitSync } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec, VerbContext, VerbResult } from "../../shared/verb.js"
import { appRootOf } from "../../harness/memory-plan.js"

/** The committed cache folder of an app. */
const CACHE_DIR = ".starcistacks/cache"
/** The check runs a push may take to settle the cache: the run that writes it, the run that proves it (a record can move once the cache commit changes HEAD), one spare. */
const MAX_RUNS = 3

/** A tool run as the verb sees it: exit code and the text it printed (empty when it streamed to the terminal). */
export interface PushRun {
    readonly exitCode: number
    readonly stdout: string
}

/** What the verb touches, so a spec drives it without a repository: git, the check, and the push. */
export interface PushPorts {
    readonly git: (args: readonly string[]) => PushRun
    /** `app check --env prod --json` of the app: exit code and its json report. */
    readonly check: () => PushRun
    /** `git push <args>`, streaming its hook's output. */
    readonly push: (args: readonly string[]) => number
    readonly say: (line: string) => void
}

/** What one `app push` did. */
export interface PushOutcome {
    readonly pushed: boolean
    readonly exitCode: number
    /** The cache commits it made, oldest first (each a sha). */
    readonly commits: readonly string[]
    readonly runs: number
    readonly refusal?: string
}

interface Finding {
    readonly code?: unknown
    readonly level?: unknown
    readonly report?: unknown
    readonly path?: unknown
    readonly message?: unknown
}

/** The blocking findings of a check's json report (an error outside a report profile), whatever shape the envelope wraps them in. */
const blocking = (stdout: string): Finding[] | null => {
    try {
        const found: Finding[] = []
        const walk = (value: unknown, depth: number): void => {
            if (depth > 6 || typeof value !== "object" || value === null) return
            if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return }
            const record = value as Record<string, unknown>
            if (Array.isArray(record.findings)) found.push(...(record.findings as Finding[]))
            else for (const inner of Object.values(record)) walk(inner, depth + 1)
        }
        walk(JSON.parse(stdout) as unknown, 0)
        return found.filter((finding) => finding.level === "error" && finding.report !== true)
    } catch {
        return null
    }
}

/**
 * The path of one porcelain line. The git port trims the whole stdout, so the first line may have lost its leading space (" M path"
 * arrives as "M path"): the status code is read as its non-blank run, never as three fixed columns, which ate the dot of ".starcistacks".
 */
export const porcelainPath = (line: string): string => (/^ ?\S{1,2} +(.*)$/.exec(line.trimEnd())?.[1] ?? "").trim()

/** The paths git lists as changed or untracked outside the cache folder. */
const dirtyOutsideCache = (ports: PushPorts): string[] =>
    ports.git(["status", "--porcelain", "--untracked-files=all"]).stdout.split("\n").map(porcelainPath).filter((line) => line !== "" && !line.startsWith(`${CACHE_DIR}/`))

/** The cache paths git does not hold as committed. */
const dirtyCache = (ports: PushPorts): string[] =>
    ports.git(["status", "--porcelain", "--untracked-files=all", "--", CACHE_DIR]).stdout.split("\n").map(porcelainPath).filter((line) => line !== "")

/**
 * One round for a push that carries a warm cache. The pre-push hook refuses a push whose cache a real run on its tree changes
 * (its run alone makes HFS_CHECK_CACHE_UNWARMED an error), and it cannot add a commit to a push already under way. So the verb does the
 * run first: `app check --env prod` on the committed tree, where the unwarmed cache is info and the run is green on its own findings;
 * the records it wrote are committed as their own commit (never an amend, the commit hook runs), the run is repeated until it writes
 * nothing, and then `git push` runs, whose hook finds a warm cache and passes. A tree with uncommitted work outside the cache is
 * refused: the records would describe files the push does not carry. Any blocking finding stops the verb before the push, as the hook would.
 */
export const warmAndPush = (ports: PushPorts, pushArgs: readonly string[]): PushOutcome => {
    const commits: string[] = []
    const dirty = dirtyOutsideCache(ports)
    if (dirty.length > 0) {
        const refusal = `HFS_PUSH_DIRTY_TREE: ${String(dirty.length)} path(s) are not committed outside ${CACHE_DIR} (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", ..." : ""}): commit or stash them first; the cache records describe the tree that is pushed`
        ports.say(refusal)
        return { pushed: false, exitCode: 2, commits, runs: 0, refusal }
    }
    for (let runs = 1; runs <= MAX_RUNS; runs += 1) {
        ports.say(`app push: check run ${String(runs)} (app check --env prod)`)
        const run = ports.check()
        const findings = blocking(run.stdout)
        if (findings === null || findings.length > 0 || run.exitCode !== 0) {
            const listed = (findings ?? []).slice(0, 5).map((finding) => `${String(finding.code)} ${typeof finding.path === "string" ? finding.path : ""}`.trim())
            const refusal = `the check is red (${listed.join("; ") || `exit ${String(run.exitCode)}, no readable report`}): fix them, then push; nothing was committed or pushed`
            ports.say(`app push: ${refusal}`)
            return { pushed: false, exitCode: 1, commits, runs, refusal }
        }
        const changed = dirtyCache(ports)
        if (changed.length === 0) {
            ports.say(commits.length === 0 ? "app push: the committed cache is warm; pushing" : `app push: ${String(commits.length)} cache commit(s) made; pushing`)
            const exitCode = ports.push(pushArgs)
            return { pushed: exitCode === 0, exitCode, commits, runs }
        }
        const head = ports.git(["rev-parse", "--short", "HEAD"]).stdout.trim()
        const added = ports.git(["add", "-A", "--", CACHE_DIR])
        const made = added.exitCode === 0 ? ports.git(["commit", "-m", `chore(cache): warm the check cache for ${head}`, "-m", `The records a real run of app check --env prod writes on ${head} (${String(changed.length)} file(s)); pushed with it so CI reuses them.`]) : added
        if (made.exitCode !== 0) {
            const refusal = `the cache commit failed (exit ${String(made.exitCode)}): ${made.stdout.trim().split("\n").slice(-3).join(" ")}`
            ports.say(`app push: ${refusal}`)
            return { pushed: false, exitCode: 1, commits, runs, refusal }
        }
        commits.push(ports.git(["rev-parse", "--short", "HEAD"]).stdout.trim())
        ports.say(`app push: committed ${String(changed.length)} cache file(s) as ${commits.at(-1) ?? ""}`)
    }
    const refusal = `the cache is still not settled after ${String(MAX_RUNS)} runs: run starci app check --env prod --fresh, commit ${CACHE_DIR} and push`
    ports.say(`app push: ${refusal}`)
    return { pushed: false, exitCode: 1, commits, runs: MAX_RUNS, refusal }
}

const realPorts = (cwd: string, say: (line: string) => void): PushPorts => {
    const root = appRootOf(cwd)
    return {
        git: (args) => {
            const run = captureGitSync(args, root)
            return { exitCode: run.exitCode, stdout: run.exitCode === 0 ? run.stdout : `${run.stdout}\n${run.stderr}` }
        },
        check: () => {
            const run = spawnSync(process.execPath, [process.argv[1] ?? "", "app", "check", "--env", "prod", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] })
            return { exitCode: run.status ?? 1, stdout: run.stdout }
        },
        push: (args) => {
            const run = captureGitSync(["push", ...args], root)
            for (const text of [run.stdout, run.stderr]) if (text !== "") say(text)
            return run.exitCode
        },
        say,
    }
}

const FLAGS = {
    args: { kind: "rest", summary: "the arguments of git push (a remote, a refspec, -u), as git takes them" },
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app push`: run the push gate's check first, commit the cache records it writes, then `git push` once. */
export const appPushVerb = defineVerb({
    path: ["app", "push"],
    summary: "push once with a warm cache: run app check --env prod, commit the cache records a real run writes as their own commit, then git push (its pre-push hook finds nothing to refuse); refuses a tree with uncommitted work or a red check",
    effect: "remote",
    roles: WRITERS,
    schema: "starci/app-push@1",
    flags: FLAGS,
    run: (context: VerbContext, flags): Promise<VerbResult<PushOutcome>> => {
        const outcome = warmAndPush(realPorts(context.cwd, context.progress), flags.args)
        return Promise.resolve({ data: outcome, message: outcome.pushed ? "pushed" : (outcome.refusal ?? "not pushed"), exitCode: outcome.exitCode })
    },
})
