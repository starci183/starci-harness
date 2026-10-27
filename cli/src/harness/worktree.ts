import { cpSync, existsSync, readFileSync } from "node:fs"
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

/**
 * Gives a fresh worktree the hooks its product declares. A generated, gitignored hooks folder (`core.hooksPath=.husky/_`) is not
 * in a new `git worktree add`, so the product's commit gate would silently never run there. The product's own installer
 * (its `prepare` script) is preferred; failing that the folder is copied from the main checkout (real files, never a junction or
 * a symlink). Returns the hooks folder, or undefined when the repository declares none. Whether it now exists is judged by
 * assertWorktreeHooks, so a failed install never passes as a gate.
 */
export const materialiseHooks = async (root: string, worktree: string): Promise<string | undefined> => {
    const hooks = await declaredHooksPath(root)
    if (hooks === undefined || existsSync(join(worktree, hooks))) return hooks
    if (declaresPrepare(worktree)) await captureNpm(["run", "--silent", "prepare"], worktree, { timeoutMs: 120_000 }).catch(() => undefined)
    if (existsSync(join(worktree, hooks))) return hooks
    const source = join(await mainCheckout(root), hooks)
    if (existsSync(source)) cpSync(source, join(worktree, hooks), { recursive: true, dereference: true })
    return hooks
}

/** Refuses WORKTREE_HOOKS_MISSING when the repository declares a hooks folder the worktree lacks: its commits would skip the product's own gate. */
export const assertWorktreeHooks = async (worktree: string): Promise<void> => {
    const hooks = await declaredHooksPath(worktree)
    if (hooks === undefined || existsSync(join(worktree, hooks))) return
    throw new Refusal(
        "WORKTREE_HOOKS_MISSING",
        `core.hooksPath is ${hooks} but ${join(worktree, hooks)} does not exist, so commits in ${worktree} would skip the product's pre-commit gate; run the product's installer (its prepare script) there, or copy ${hooks} from the main checkout, then retry`,
    )
}
