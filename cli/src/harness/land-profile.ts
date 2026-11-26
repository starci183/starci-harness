import { join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { isHarnessCheckout } from "../core/release/harness-checkout.js"

/**
 * What `lane gate` runs depends on the repository it lands on. An app (the default) is judged with its own pinned CLI (`app check --env prod --level dev`,
 * then `app push origin HEAD:<branch>`, whose pre-push hook runs the fast level once). The harness repository itself has no root install and no app hook: its
 * gate is the harness FAST gate (`release gate --level dev`: the build and typecheck of the packages the lane changed and of their dependents and the publish
 * checks, and each affected package's own `npm test` as CI's package jobs run it, never the CLI's suite) run by the lane's own CLI, and its push is a plain `git push origin HEAD:<branch>`.
 */
export type LandProfileName = "app" | "harness"

/** One command a profile runs: the program and its arguments, in the lane's worktree. */
export interface ProfileCommand {
    readonly file: string
    readonly args: readonly string[]
}

/** How the harness profile gates and pushes a tree. */
export interface LandProfile {
    readonly name: LandProfileName
    /** The gate of the tree at `wt`, measured from `base` (the dev commit the lane merged). */
    readonly gate: (wt: string, base: string) => ProfileCommand
    /** The push of the judged tree at `wt` to `ref`. */
    readonly push: (wt: string, ref: string) => ProfileCommand
    /** How the gate is named in progress lines. */
    readonly gateLabel: string
}

/** The folder of an app's database migrations (the one its stack's migrate step applies and receipts): a landed lane is told the files it added there, and `dev sync` migrates when it moved. */
export const MIGRATIONS_FOLDER = "db/migrations/"

/** The app's own pinned CLI: an app is judged with the harness it pins. */
export const appCli = (wt: string): string => join(wt, "node_modules", "starci-harness", "dist", "main.js")

/** The harness FAST gate's arguments, measured from `base`. */
export const harnessGateArgs = (base: string): string[] => ["release", "gate", "--level", "dev", "--base", base, "--json"]

/** The profile of the harness repository: `cliMain` (the lane's own running CLI) runs the harness FAST gate in the tree, and a plain `git push` lands it. */
export const harnessProfile = (cliMain: string): LandProfile => ({
    name: "harness",
    gate: (_wt, base) => ({ file: process.execPath, args: [cliMain, ...harnessGateArgs(base)] }),
    push: (_wt, ref) => ({ file: "git", args: ["push", "origin", `HEAD:${ref}`] }),
    gateLabel: "release gate --level dev (the harness FAST gate)",
})

/**
 * The profile a repository lands with: the one `flag` names (`--profile app|harness`), else the harness when `root` is the harness checkout (the
 * marker `release push` and `deps publish-local` read: cli/, contexts/README.md and packages/), else an app.
 */
export const profileNameFor = (root: string, flag: string | undefined, isHarness: (root: string) => boolean = isHarnessCheckout): LandProfileName => {
    if (flag === "app" || flag === "harness") return flag
    if (flag !== undefined && flag !== "") throw new Refusal("CLI_USAGE", `--profile is app or harness, not "${flag}"`)
    return isHarness(root) ? "harness" : "app"
}

/** The lock-file scope of a profile in a shared lanes folder: an app keeps the plain names, the harness its own. */
export const lockScope = (profile: LandProfileName): string => (profile === "harness" ? "harness" : "")
