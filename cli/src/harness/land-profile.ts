import { join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { isHarnessCheckout } from "../core/release/harness-checkout.js"

/**
 * What the batch lander and `lane gate` run depends on the repository they land on. An app (the default) is judged with its own pinned CLI:
 * `npm ci`, codegen and `build:modules` at its root, `app check --env prod --level dev`, then `app push origin HEAD:dev`, whose pre-push hook
 * runs the fast level once. The harness repository itself (owner 2026-11-22: "bản thân .claude cũng tách thành dev main được không? dev code
 * xong merge nhanh để xài local") has no root install and no app hook: its gate is the harness FAST gate (`release gate --level dev`: the
 * build, typecheck and tests of the packages the batch changed and of their dependents) run by the lander's own CLI, and its push is a plain
 * `git push origin HEAD:dev`. The batch squash, the cancel on a newer registration and the status files are the same for both.
 */
export type LandProfileName = "app" | "harness"

/** One command a profile runs: the program and its arguments, in the lander's or the lane's worktree. */
export interface ProfileCommand {
    readonly file: string
    readonly args: readonly string[]
}

/** How one profile prepares, gates and pushes a tree that lands on dev. */
export interface LandProfile {
    readonly name: LandProfileName
    /** Whether the tree is installed and prepared at its root before the gate (`npm ci`, codegen, build:modules): an app's, never the harness's. */
    readonly prepares: boolean
    /** The gate of the tree at `wt`, measured from `base` (the dev commit the batch or the lane merged). */
    readonly gate: (wt: string, base: string) => ProfileCommand
    /** The push of the judged tree at `wt` to `ref` (the lander: dev; a lane: its own branch). */
    readonly push: (wt: string, ref: string) => ProfileCommand
    /** How the gate is named in progress lines. */
    readonly gateLabel: string
}

/** The batch gate's check of an app: the FAST level, since a batch lands on dev (the full gate runs once at the main cut). */
export const LANDER_GATE_ARGS: readonly string[] = ["app", "check", "--env", "prod", "--level", "dev", "--json"]

/** The app's own pinned CLI: an app is judged with the harness it pins, never the lander's. */
export const appCli = (wt: string): string => join(wt, "node_modules", "starci-harness", "dist", "main.js")

/** The profile of an app: its pinned CLI checks the fast level, and `app push` pushes through the managed pre-push hook. */
export const APP_PROFILE: LandProfile = {
    name: "app",
    prepares: true,
    gate: (wt) => ({ file: process.execPath, args: [appCli(wt), ...LANDER_GATE_ARGS] }),
    push: (wt, ref) => ({ file: process.execPath, args: [appCli(wt), "app", "push", "origin", `HEAD:${ref}`] }),
    gateLabel: "app check --env prod --level dev",
}

/** The harness FAST gate's arguments, measured from `base`. */
export const harnessGateArgs = (base: string): string[] => ["release", "gate", "--level", "dev", "--base", base, "--json"]

/**
 * The profile of the harness repository: `cliMain` (the lander's or the lane's own running CLI) runs the harness FAST gate in the tree, and a plain
 * `git push` lands it; there is no root install, codegen or app hook.
 */
export const harnessProfile = (cliMain: string): LandProfile => ({
    name: "harness",
    prepares: false,
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

/** The profile itself for a name; the harness's gate runs `cliMain`. */
export const landProfile = (name: LandProfileName, cliMain: string): LandProfile => (name === "harness" ? harnessProfile(cliMain) : APP_PROFILE)

/** A remote URL in one spelling, so two registrations of one repository compare equal (`git@host:o/r.git` and `https://host/o/r`). Pure. */
export const normalRemote = (url: string): string =>
    url
        .trim()
        .replace(/^[a-z+]+:\/\//i, "")
        .replace(/^[^@/]+@/, "")
        .replace(/^([^/:]+):(?!\d)/, "$1/")
        .replace(/\.git$/i, "")
        .replace(/\/+$/, "")
        .toLowerCase()

/**
 * Whether a lander of `profile` on the repository `ownRemote` takes a ready entry. The lanes of every repository of a machine share one lanes
 * folder (its slots bound the machine), so an entry names its repository (`repo`, the origin URL `lane ready` read) and each lander takes its own
 * repository's lanes only. An entry with no repository was written before entries named one: an app lander's, as every lane was then.
 */
export const takesEntry = (entry: { readonly repo?: string | undefined }, ownRemote: string | undefined, profile: LandProfileName): boolean => {
    if (entry.repo === undefined || entry.repo === "") return profile === "app"
    return ownRemote !== undefined && normalRemote(entry.repo) === normalRemote(ownRemote)
}

/** The lock-file scope of a profile in a shared lanes folder: the app lander keeps the plain names, the harness lander its own. */
export const lockScope = (profile: LandProfileName): string => (profile === "harness" ? "harness" : "")
