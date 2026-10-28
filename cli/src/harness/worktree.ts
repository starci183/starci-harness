import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureNpm } from "../shared/exec.js"
import { captureGit, mainCheckout } from "../shared/git.js"

/**
 * The repository's own hooks folder, relative to the checkout, when `core.hooksPath` names one inside the repository
 * (a product that generates its hooks, such as husky's `.husky/_`, gitignored); undefined when none is set or it points outside.
 * The setting lives in the shared git config, so every worktree of the repository reads the same value.
 */
export const declaredHooksPath = async (checkout: string): Promise<string | undefined> => {
    const run = await captureGit(["config", "--get", "core.hooksPath"], checkout)
    const declared = run.exitCode === 0 ? run.stdout.trim() : ""
    if (declared === "") return undefined
    const inside = relative(checkout, resolve(checkout, declared))
    return inside === "" || inside.startsWith("..") || isAbsolute(inside) ? undefined : inside
}

/** True when the product's package.json declares a `prepare` script, the installer that generates its hooks. */
const declaresPrepare = (checkout: string): boolean => {
    try {
        const manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }
        return typeof manifest.scripts?.prepare === "string"
    } catch {
        return false
    }
}

/** The file names git runs as hooks (githooks(5)); any other file of a hooks folder is a helper a hook sources. */
const GIT_HOOKS: ReadonlySet<string> = new Set([
    "applypatch-msg", "pre-applypatch", "post-applypatch", "pre-commit", "pre-merge-commit", "prepare-commit-msg", "commit-msg",
    "post-commit", "pre-rebase", "post-checkout", "post-merge", "pre-push", "pre-receive", "update", "proc-receive", "post-receive",
    "post-update", "reference-transaction", "push-to-checkout", "pre-auto-gc", "post-rewrite", "sendemail-validate",
    "fsmonitor-watchman", "p4-changelist", "p4-prepare-changelist", "p4-post-changelist", "p4-pre-submit", "post-index-change",
])

/**
 * The hooks of a folder git skips on this host: a hook file without the owner's execute bit, which git on Linux and macOS
 * ignores with only a hint. Git for Windows runs a hook whatever its mode, so none is skipped there.
 */
const skippedHooks = (folder: string): string[] => {
    if (process.platform === "win32") return []
    return readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && GIT_HOOKS.has(entry.name) && (statSync(join(folder, entry.name)).mode & 0o100) === 0)
        .map((entry) => entry.name)
}

/**
 * Gives a fresh worktree the hooks its product declares, ready to run. A generated, gitignored hooks folder
 * (`core.hooksPath=.husky/_`) is not in a new `git worktree add`, so the product's commit gate would silently never run there.
 * The product's own installer (its `prepare` script) is preferred; failing that the folder is copied from the main checkout
 * (real files, never a junction or a symlink). A hook either way gets the execute bit git needs to run it (a hook written by a
 * script that set no mode is otherwise skipped). Returns the hooks folder, or undefined when the repository declares none.
 * Whether it now exists and runs is judged by assertWorktreeHooks, so a failed install never passes as a gate.
 */
export const materialiseHooks = async (root: string, worktree: string): Promise<string | undefined> => {
    const hooks = await declaredHooksPath(root)
    if (hooks === undefined) return hooks
    const folder = join(worktree, hooks)
    if (!existsSync(folder) && declaresPrepare(worktree)) await captureNpm(["run", "--silent", "prepare"], worktree, { timeoutMs: 120_000 }).catch(() => undefined)
    if (!existsSync(folder)) {
        const source = join(await mainCheckout(root), hooks)
        if (existsSync(source)) cpSync(source, folder, { recursive: true, dereference: true })
    }
    if (existsSync(folder)) for (const hook of skippedHooks(folder)) chmodSync(join(folder, hook), statSync(join(folder, hook)).mode | 0o111)
    return hooks
}

/**
 * Refuses WORKTREE_HOOKS_MISSING when the repository declares a hooks folder the worktree lacks, or holds a hook git would skip
 * there: either way its commits would skip the product's own gate.
 */
export const assertWorktreeHooks = async (worktree: string): Promise<void> => {
    const hooks = await declaredHooksPath(worktree)
    if (hooks === undefined) return
    const folder = join(worktree, hooks)
    const missing = existsSync(folder) ? skippedHooks(folder).map((hook) => `${join(folder, hook)} is not executable`) : [`${folder} does not exist`]
    if (missing.length === 0) return
    throw new Refusal(
        "WORKTREE_HOOKS_MISSING",
        `core.hooksPath is ${hooks} but ${missing.join(", ")}, so commits in ${worktree} would skip the product's pre-commit gate; run the product's installer (its prepare script) there, or copy ${hooks} from the main checkout with its modes, then retry`,
    )
}
