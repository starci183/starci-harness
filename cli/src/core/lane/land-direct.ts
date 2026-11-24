import { captureNpm, captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { captureGit, mainCheckout } from "../../shared/git.js"
import { Refusal } from "../../shared/errors.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { squashMessage, takeDevLock } from "../../harness/land-batch.js"
import { dropReady, landPaths, releaseLockFile, writeStatus } from "../../harness/land-queue.js"
import type { ReadyEntry } from "../../harness/land-queue.js"
import { MIGRATIONS_FOLDER, appCli, lockScope } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { devSyncForRepo, loadLocalSettings } from "../../harness/local-settings.js"
import { prepareTree } from "../../harness/prepare-tree.js"
import { publishDev } from "../deps/publish-dev.js"
import { requestDevSync } from "../dev/sync-runner.js"
import { startDevCiWatch } from "../../harness/dev-ci-watch.js"

/**
 * `lane gate --push --land`: the lane lands on dev itself, right after its own green gate (contexts/authority/lanes.md "Gate and land"; the owner: "cứ xong
 * là merge vô dev là được"). Under the repository's dev lock (the one the batch lander takes, so the two never push at once) it fetches and merges the newest
 * origin/dev into the lane; when dev moved since the gate's merge, it runs the fast re-check (the app's codegen and typecheck, the harness CLI's typecheck)
 * under the heavy governor, never the whole gate again; it squashes the lane into ONE commit on dev (the batch squash's message: the lane, its branch and
 * sha, its Landed-lane trailer) and pushes dev, never forced. A conflict stops with the files for the lane's agent to resolve. After the push: on the harness
 * the dev line is published (`deps publish-dev`) when the landing changed a published package, and the dev checkouts are marked for their debounced sync
 * (core/dev/sync-runner.ts), the app's own, or after a harness publish every app's.
 */

/** What a landing did. */
export interface LaneLanded {
    /** The dev commit the lane landed as. */
    readonly sha: string
    /** The lane's own sha at the landing (its tree is what dev holds); the worktree cleanup keeps a branch that moved past it. */
    readonly laneSha: string
    /** The dev commit it landed on. */
    readonly base: string
    /** Dev had moved since the gate's merge, so the fast re-check ran. */
    readonly rechecked: boolean
    readonly migrations: readonly string[]
    readonly published: readonly string[]
    readonly publishNote?: string
    /** The dev checkouts marked for their sync. */
    readonly syncs: readonly string[]
}

/** The seams of a landing, real by default; the specs hand in their own. */
export interface LandDeps {
    /** The fast re-check of the merged tree: undefined when green, else what failed. */
    readonly recheck: (root: string, profile: LandProfileName, lane: string) => Promise<string | undefined>
    /** The push of `sha` to dev. */
    readonly push: (root: string, profile: LandProfileName, sha: string) => Promise<ToolRun>
    readonly publish: (root: string, sha: string, say: (line: string) => void) => Promise<readonly string[]>
    readonly requestSync: (checkout: string, reason: string, say: (line: string) => void) => Promise<unknown>
    /** Starts the detached watch of the pushed sha's GitHub CI (harness/dev-ci-watch.ts); it never throws and never waits for the verdict. */
    readonly watchCi: (root: string, dir: string, sha: string, lanes: readonly string[], say: (line: string) => void) => Promise<void>
}

const gitOut = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

const tail = (run: ToolRun): string => `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600)

/** The fast re-check after dev moved: the app's codegen and its typecheck script, or the harness CLI's typecheck, each under the heavy governor. */
export const realRecheck = async (root: string, profile: LandProfileName, lane: string): Promise<string | undefined> => {
    if (profile === "harness") {
        const run = await withHeavySlot("tsc", `lane land ${lane}: cli typecheck`, root, {}, (held) => captureNpm(["run", "typecheck", "--prefix", "cli"], root, held.options))
        return run.exitCode === 0 ? undefined : `npm run typecheck (cli) exited ${String(run.exitCode)}: ${tail(run)}`
    }
    const codegen = await prepareTree(root, `lane land ${lane}`, ["codegen"])
    if (codegen.failure !== undefined) return `${codegen.failure.command} exited ${String(codegen.failure.exitCode)}: ${codegen.failure.output.split("\n").slice(-3).join(" ")}`
    const run = await withHeavySlot("tsc", `lane land ${lane}: typecheck`, root, {}, (held) => captureNpm(["run", "typecheck", "--silent", "--if-present"], root, held.options))
    return run.exitCode === 0 ? undefined : `npm run typecheck exited ${String(run.exitCode)}: ${tail(run)}`
}

export const realLandDeps: LandDeps = {
    recheck: realRecheck,
    push: (root, profile, sha) =>
        profile === "harness" ? captureTool("git", ["push", "origin", `${sha}:refs/heads/dev`], root) : captureTool(process.execPath, [appCli(root), "app", "push", "origin", `${sha}:refs/heads/dev`], root),
    publish: async (root, sha, say) => (await publishDev({ root, head: sha, execute: true, say })).published,
    requestSync: requestDevSync,
    watchCi: (root, dir, sha, lanes, say) => startDevCiWatch(root, dir, sha, lanes, say),
}

/**
 * Lands the gated lane at `root` on dev. `gatedBase` is the origin/dev commit the gate merged (undefined when it merged nothing). Refuses LANE_LAND_CONFLICT
 * (the files), LANE_LAND_RED (the re-check after dev moved) and LANE_LAND_PUSH; the dev lock is released in every case.
 */
export const landLane = async (given: { readonly root: string; readonly lane: string; readonly branch: string; readonly profile: LandProfileName; readonly dir: string; readonly gatedBase: string | undefined; readonly say: (line: string) => void }, deps: LandDeps = realLandDeps): Promise<LaneLanded> => {
    const { root, lane, branch, profile, dir, say } = given
    const scope = lockScope(profile)
    await takeDevLock(dir, say, scope)
    let landed: { readonly sha: string; readonly base: string; readonly rechecked: boolean; readonly migrations: readonly string[]; readonly laneSha: string }
    try {
        const fetched = await gitOut(root, ["fetch", "-q", "origin"])
        if (!fetched.ok) throw new Refusal("LANE_LAND_FETCH", `git fetch origin: ${fetched.err}`)
        const base = (await gitOut(root, ["rev-parse", "origin/dev"])).out
        const merge = await gitOut(root, ["merge", "--no-edit", "origin/dev"])
        if (!merge.ok) {
            const files = (await gitOut(root, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter((file) => file !== "")
            await gitOut(root, ["merge", "--abort"])
            throw new Refusal("LANE_LAND_CONFLICT", files.length > 0 ? `origin/dev (${base.slice(0, 10)}) conflicts with ${lane} in ${files.join(", ")}: merge origin/dev in the lane, resolve, commit, then run lane gate --push --land again` : `git merge origin/dev: ${merge.err}`)
        }
        const rechecked = given.gatedBase !== base
        if (rechecked) {
            say(`dev moved since the gate (${given.gatedBase?.slice(0, 10) ?? "no merge"} -> ${base.slice(0, 10)}): fast re-check of the merged tree`)
            const red = await deps.recheck(root, profile, lane)
            if (red !== undefined) throw new Refusal("LANE_LAND_RED", `the fast re-check after merging origin/dev ${base.slice(0, 10)} is red: ${red}; fix it in the lane and run lane gate --push --land again`)
        } else say(`dev is where the gate merged it (${base.slice(0, 10)}): no re-check`)
        const laneSha = (await gitOut(root, ["rev-parse", "HEAD"])).out
        const tree = (await gitOut(root, ["rev-parse", "HEAD^{tree}"])).out
        const baseTree = (await gitOut(root, ["rev-parse", `${base}^{tree}`])).out
        if (tree === baseTree) throw new Refusal("LANE_LAND_EMPTY", `${lane} adds nothing to origin/dev ${base.slice(0, 10)}: it is already on dev`)
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")
        const entry: ReadyEntry = { lane, branch, sha: laneSha, at: new Date().toISOString() }
        const committed = await captureGit(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", base, "-m", squashMessage(stamp, [entry])], root)
        if (committed.exitCode !== 0) throw new Refusal("LANE_LAND_SQUASH", `git commit-tree: ${committed.stderr.trim()}`)
        const sha = committed.stdout.trim()
        say(`squashed ${lane} into ${sha.slice(0, 10)} on origin/dev ${base.slice(0, 10)}; pushing dev`)
        const pushed = await deps.push(root, profile, sha)
        if (pushed.exitCode !== 0) throw new Refusal("LANE_LAND_PUSH", `the push of ${sha.slice(0, 10)} to dev failed (nothing forced; run lane gate --push --land again): ${tail(pushed)}`)
        const migrations = (await gitOut(root, ["diff", "--name-only", "--diff-filter=A", base, sha, "--", MIGRATIONS_FOLDER])).out.split("\n").filter((file) => file !== "")
        landed = { sha, base, rechecked, migrations, laneSha }
    } finally {
        releaseLockFile(landPaths(dir, scope).devLock, process.pid)
    }
    // The landing stands from here: what follows is said, never thrown.
    writeStatus(dir, { lane, state: "landed", sha: landed.sha, laneSha: landed.laneSha, branch, migrations: landed.migrations, reason: "landed by lane gate --land" })
    dropReady(dir, lane)
    let published: readonly string[] = []
    let publishNote: string | undefined
    if (profile === "harness") {
        try {
            published = await deps.publish(root, landed.sha, say)
            publishNote = published.length === 0 ? "the landing changed no published package" : `published ${published.join(", ")} to the local registry`
        } catch (error) {
            publishNote = `deps publish-dev failed (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}): run starci deps publish-dev --execute in the harness checkout`
        }
        say(`dev publish: ${publishNote}`)
    }
    const settings = loadLocalSettings().devSync
    const repo = await mainCheckout(root)
    const own = devSyncForRepo(settings, repo)
    const checkouts = profile === "harness"
        ? published.length === 0 ? [] : Object.entries(settings.repos).filter(([, entry]) => entry.afterLand).map(([key, entry]) => entry.checkout ?? key)
        : own.afterLand ? [own.checkout ?? repo] : []
    if (profile === "app" && checkouts.length === 0) say(`dev sync: off for ${repo} (devSync.afterLand / devSync.repos of the local settings): the dev checkout is NOT synced`)
    const syncs: string[] = []
    for (const checkout of checkouts) {
        try {
            await deps.requestSync(checkout, `${lane} landed as ${landed.sha.slice(0, 10)}${profile === "harness" ? " (harness dev line published)" : ""}`, say)
            syncs.push(checkout)
        } catch (error) {
            say(`dev sync of ${checkout}: NOT requested (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}); run starci dev sync-runner --request --dir ${checkout}`)
        }
    }
    // The watcher lives up to 45 minutes: it stands in the main checkout, never in the lane's worktree, which the cleanup removes right after.
    await deps.watchCi(repo, dir, landed.sha, [lane], say)
    return { sha: landed.sha, laneSha: landed.laneSha, base: landed.base, rechecked: landed.rechecked, migrations: landed.migrations, published, ...(publishNote === undefined ? {} : { publishNote }), syncs }
}
