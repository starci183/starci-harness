import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { pidAlive } from "../../shared/exec.js"
import { captureGitSync } from "../../shared/git.js"
import { prePushTarget } from "../deps/dev-local.js"

/**
 * The one sanctioned way past the pre-push gate (contexts/authority/lanes.md "Hotfix"; owner: "hotfix là sửa xong chạy lại luôn, không gate gì hết"): while
 * `starci hotfix land` pushes its one commit it writes a PASS beside the repository's git objects, and the fast-level check the pre-push hook runs
 * (`app check --level dev`, core/app/fast-check.ts) reads it. A pass lets exactly one push through: the push of that commit to dev alone, while the process that
 * wrote it is alive and for at most `PASS_MINUTES`. There is no flag, environment variable or setting that opens the gate for anything else.
 */
export interface HotfixPass {
    readonly sha: string
    readonly pid: number
    readonly at: string
}

/** How long a pass can stand: a push of one commit takes seconds. */
export const PASS_MINUTES = 10

const DEV_REF = "refs/heads/dev"

/** The file of the pass of the repository at `root`, in its git common dir (shared by its worktrees, never committed), or undefined when git cannot tell. */
export const passFile = (root: string): string | undefined => {
    const common = captureGitSync(["rev-parse", "--git-common-dir"], root)
    if (common.exitCode !== 0) return undefined
    const dir = common.stdout.trim()
    return join(isAbsolute(dir) ? dir : join(root, dir), "starci-hotfix", "pass.json")
}

/** Writes the pass of `sha` for this process; returns the function that removes it. */
export const grantPass = (root: string, sha: string, now: () => number = Date.now): (() => void) => {
    const file = passFile(root)
    if (file === undefined) return () => undefined
    mkdirSync(join(file, ".."), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ sha, pid: process.pid, at: new Date(now()).toISOString() } satisfies HotfixPass)}\n`)
    return () => {
        rmSync(file, { force: true })
    }
}

/**
 * The line to print when a standing pass covers the push `pushRefs` (git's pre-push stdin) of the repository at `root`, else undefined: the pass names a live
 * process, is not older than PASS_MINUTES, and the push is exactly one ref, `refs/heads/dev`, at the commit the pass names.
 */
export const passFor = (root: string, pushRefs: string | undefined, now: () => number = Date.now, alive: (pid: number) => boolean = pidAlive): string | undefined => {
    const file = passFile(root)
    if (file === undefined || pushRefs === undefined || !existsSync(file)) return undefined
    let pass: Partial<HotfixPass>
    try {
        pass = JSON.parse(readFileSync(file, "utf8")) as Partial<HotfixPass>
    } catch {
        return undefined
    }
    if (typeof pass.sha !== "string" || typeof pass.pid !== "number" || typeof pass.at !== "string") return undefined
    const age = now() - Date.parse(pass.at)
    if (!Number.isFinite(age) || age < 0 || age > PASS_MINUTES * 60_000 || !alive(pass.pid)) return undefined
    const lines = pushRefs.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 4)
    const refs = prePushTarget(pushRefs).refs
    if (lines.length !== 1 || refs.length !== 1 || refs[0] !== DEV_REF || lines[0]?.[1] !== pass.sha) return undefined
    return `hotfix: ${pass.sha.slice(0, 10)} is the one commit of the running starci hotfix land (pid ${String(pass.pid)}): the pre-push gate is skipped for this push; the CI watch judges it after the fact`
}
