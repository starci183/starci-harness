import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { captureGitSync } from "../../shared/git.js"
import { Refusal } from "../../shared/errors.js"
import type { VerbResult } from "../../shared/verb.js"
import { landsOnDev, prePushTarget } from "../deps/dev-local.js"
import type { PushTarget } from "../deps/dev-local.js"

/**
 * THE TWO-LEVEL GATE.
 * `app check --level dev` is the FAST level of a landing on dev: the deps check here (local-registry pins accepted for an app that declares
 * hfs.json deps.devAllowsLocalRegistry), then @starci/hfs's fast families (types with its package builds and codegen, the lane's own tests,
 * db; packages/hfs/cache/fast-level.mts). `--level full` (the default) is every gate, run once at the main cut: a push
 * of main or a release tag, `release cut`, `release push`, `app release`. One pass per push: a green fast run on a clean tree is remembered by
 * the content of its tree (outside the cache folder), so the pre-push hook of the push that follows `lane gate` finds
 * the same tree judged and does not run it again.
 */
export const LEVEL_FLAG = "level"
export const PUSH_REFS_FLAG = "push-refs"

/** The levels `app check` takes. */
export type CheckLevel = "full" | "dev"

/** The path of one porcelain line, its status code read as its non-blank run (as push.ts porcelainPath). */
const porcelainPath = (line: string): string => (/^ ?\S{1,2} +(.*)$/.exec(line.trimEnd())?.[1] ?? "").trim()

/** The cache folder of an app: its records never change what the fast level judged. */
const CACHE_DIR = ".starcistacks/cache/"

/** The target a dev-level check judges for: the refs of the push (the hook's stdin), else dev itself. */
export const fastTarget = (pushRefs: string | undefined): PushTarget => {
    const given = pushRefs === undefined ? undefined : prePushTarget(pushRefs)
    return given !== undefined && given.refs.length > 0 ? given : { refs: ["refs/heads/dev"] }
}

/** The level a push of `target` is judged at: dev when every ref is dev or a lane branch (it lands on dev), else full. */
export const levelOfTarget = (target: PushTarget | undefined): CheckLevel => (landsOnDev(target) ? "dev" : "full")

/**
 * The remote refs `git push <args>` updates, as git would read them from the command line: each `src:dst` names dst, a bare `src` itself
 * (`HEAD` the current branch), none at all the current branch. Flags are skipped; the first operand is the remote.
 */
export const pushTargetOfArgs = (args: readonly string[], current: string | undefined): PushTarget => {
    const operands = args.filter((arg) => !arg.startsWith("-"))
    const specs = operands.slice(1)
    const named = (spec: string): string | undefined => {
        const destination = (spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec).replace(/^\+/, "")
        const branch = destination === "HEAD" || destination === "" ? current : destination
        if (branch === undefined) return undefined
        return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`
    }
    const refs = (specs.length === 0 ? [current === undefined ? undefined : `refs/heads/${current}`] : specs.map(named)).filter((ref): ref is string => ref !== undefined)
    return { refs }
}

/** What a fast check needs of the world, so a spec drives it without a repository. */
export interface FastPorts {
    /** The memo key of the tree as committed (its content outside the cache folder, the env, the harness version), undefined when tracked work is uncommitted. */
    readonly memoKey: () => string | undefined
    readonly readMemo: (key: string) => string | undefined
    readonly writeMemo: (key: string, text: string) => void
    /** Whether the app declares the deps gate off (`gates` of .starcistacks/application-stacks.yaml). */
    readonly depsOff: () => boolean
    /** `deps check` for the target: its note lines; a refusal throws. */
    readonly deps: (target: PushTarget) => Promise<readonly string[]>
    /** @starci/hfs's `check --level dev` with the forwarded args. */
    readonly hfs: (args: readonly string[]) => Promise<VerbResult<unknown>>
    readonly say: (line: string) => void
    readonly json: boolean
    /**
     * The line naming the standing hotfix pass that covers this push (core/hotfix/pass.ts: `starci hotfix land` writes it for its one commit to dev, alive only
     * with that process), else undefined. A covered push is the one push of the sanctioned hotfix path and is not judged (contexts/authority/lanes.md "Hotfix").
     */
    readonly hotfix?: (pushRefs: string | undefined) => string | undefined
}

/** The forwarded argv without `--push-refs` and its value: a flag the CLI resolves and @starci/hfs never sees. */
const withoutPushRefs = (args: readonly string[]): string[] => {
    const out: string[] = []
    for (let at = 0; at < args.length; at += 1) {
        const token = args[at] ?? ""
        if (token === `--${PUSH_REFS_FLAG}`) at += 1
        else if (!token.startsWith(`--${PUSH_REFS_FLAG}=`)) out.push(token)
    }
    return out
}

/** The value of `--push-refs` in a forwarded argv. */
export const pushRefsOf = (args: readonly string[]): string | undefined => {
    for (let at = args.length - 1; at >= 0; at -= 1) {
        const token = args[at] ?? ""
        if (token === `--${PUSH_REFS_FLAG}`) return args[at + 1]
        if (token.startsWith(`--${PUSH_REFS_FLAG}=`)) return token.slice(PUSH_REFS_FLAG.length + 3)
    }
    return undefined
}

/**
 * One fast check: a tree already judged green at this level is not judged again (one pass per push); else the deps check for the target,
 * then @starci/hfs's fast families, and a green run on a clean tree is remembered. A deps refusal is a finding of the report (DEPS_* on
 * package.json), so the gate blames the lane that changed the pins.
 */
export const runFastCheck = async (args: readonly string[], ports: FastPorts): Promise<VerbResult<unknown>> => {
    const target = fastTarget(pushRefsOf(args))
    const forwarded = withoutPushRefs(args)
    const hotfix = ports.hotfix?.(pushRefsOf(args))
    if (hotfix !== undefined) {
        ports.say(hotfix)
        return { data: { level: "dev", hotfix: true, findings: [], ok: true }, message: hotfix, exitCode: 0 }
    }
    const key = ports.memoKey()
    const memo = key === undefined ? undefined : ports.readMemo(key)
    if (key !== undefined && memo !== undefined) {
        const line = `check --level dev: this tree already passed the fast level (${memo.trim()}); one check pass per push, not run again`
        ports.say(line)
        return { data: { level: "dev", memo: { key, at: memo.trim() }, findings: [], ok: true }, message: line, exitCode: 0 }
    }
    let notes: readonly string[] = []
    if (ports.depsOff()) ports.say("deps: off by declaration (gates of .starcistacks/application-stacks.yaml), not run")
    else {
        try {
            notes = await ports.deps(target)
        } catch (error) {
            if (!(error instanceof Refusal)) throw error
            const finding = { code: error.code, level: "error", engine: "deps", path: "package.json", message: error.message }
            ports.say(`[ERROR] ${error.code} ${error.message}`)
            return { data: { level: "dev", findings: [finding], ok: false }, message: `check --level dev: deps check refused (${error.code})`, exitCode: 1 }
        }
        for (const note of notes) ports.say(note)
    }
    const run = await ports.hfs(forwarded)
    if (run.exitCode === 0 && key !== undefined) ports.writeMemo(key, `${new Date().toISOString()} green`)
    return notes.length === 0 || !isRecord(run.data) ? run : { ...run, data: { ...run.data, deps: { notes } } }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The folder of the fast-level memo: machine-local, beside the repository's git objects, shared by its worktrees and never committed. */
const memoDir = (root: string): string | undefined => {
    const common = captureGitSync(["rev-parse", "--git-common-dir"], root)
    if (common.exitCode !== 0) return undefined
    const dir = common.stdout.trim()
    return join(isAbsolute(dir) ? dir : join(root, dir), "starci-fast-gate")
}

/** The memo key of the committed tree at `root`, undefined when tracked work outside the cache folder is uncommitted (the run would judge another tree). */
export const treeMemoKey = (root: string, salt: string): string | undefined => {
    const status = captureGitSync(["status", "--porcelain", "--untracked-files=no"], root)
    if (status.exitCode !== 0) return undefined
    if (status.stdout.split("\n").map(porcelainPath).some((file) => file !== "" && !file.startsWith(CACHE_DIR))) return undefined
    const listed = captureGitSync(["ls-tree", "-r", "HEAD"], root)
    if (listed.exitCode !== 0) return undefined
    const content = listed.stdout.split(/\r?\n/).filter((line) => { const file = line.split("\t")[1]; return file !== undefined && !file.startsWith(CACHE_DIR) }).join("\n")
    return createHash("sha256").update(`${salt}\n${content}`).digest("hex")
}

/** The memo files of `root`'s repository. */
export const memoStore = (root: string): Pick<FastPorts, "readMemo" | "writeMemo"> => ({
    readMemo: (key) => {
        const dir = memoDir(root)
        const file = dir === undefined ? undefined : join(dir, `${key}.txt`)
        return file !== undefined && existsSync(file) ? readFileSync(file, "utf8") : undefined
    },
    writeMemo: (key, text) => {
        const dir = memoDir(root)
        if (dir === undefined) return
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${key}.txt`), text)
    },
})
