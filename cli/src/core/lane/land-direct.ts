import { captureNpm, captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { captureGit, mainCheckout, gitOutcome as gitOut, mergeOrAbort } from "../../shared/git.js"
import { Refusal } from "../../shared/errors.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { intoLockScope, landPaths, releaseLockFile, squashMessage, takeDevLock, writeStatus } from "../../harness/lane-state.js"
import { MIGRATIONS_FOLDER, appCli, lockScope } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { devSyncForRepo, loadLocalSettings } from "../../harness/local-settings.js"
import { publishDev } from "../deps/publish-dev.js"
import type { DevPublishData } from "../deps/publish-dev.js"
import { requestDevSync } from "../dev/sync-runner.js"
import { startDevCiWatch } from "../../harness/dev-ci-watch.js"

/**
 * `lane gate --push --land`: the lane lands on dev itself, right after its own green gate (contexts/authority/lanes.md "Gate and land"). Under the repository's dev lock (the one a
 * hotfix and `release back-merge` take too, so no two push dev at once) it fetches and merges the newest
 * origin/dev into the lane; when dev moved since the gate's merge, it runs the fast re-check (the app's codegen and typecheck, the harness CLI's typecheck)
 * under the heavy governor, never the whole gate again; it squashes the lane into ONE commit on dev (its message: the lane, its branch and
 * sha, its Landed-lane trailer) and pushes dev, never forced. A conflict stops with the files for the lane's agent to resolve. After the push: on the harness
 * the dev line is published (`deps publish-dev`) when the landing changed a published package, and the dev checkouts are marked for their debounced sync
 * (core/dev/sync-runner.ts), the app's own, or after a harness publish every app's.
 *
 * A repository whose lanes land into an integration branch (`landInto` of the local settings, or `lane gate --land --into <branch>`;
 * contexts/project/branches.md PROJECT-BRANCH-4) lands the same way on that branch, under that branch's own lock: it merges origin/<into>, squashes onto it
 * and pushes it, writes the status and starts the CI watch, but marks no dev sync and publishes no harness dev line: only dev runs the app's dev stack,
 * and dev moves to the integration branch only by `starci dev promote`.
 */

/** What a landing did. */
export interface LaneLanded {
    /** The branch it landed on: dev, or the repository's integration branch. */
    readonly into: string
    /** The commit of `into` the lane landed as. */
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
    /** The push of `sha` to `into` (dev, or the integration branch). */
    readonly push: (root: string, profile: LandProfileName, sha: string, into: string) => Promise<ToolRun>
    /** The dev publish of the landed commit: the dev builds published, and those that failed (the rest are published anyway). */
    readonly publish: (root: string, sha: string, say: (line: string) => void) => Promise<Pick<DevPublishData, "published" | "failed">>
    readonly requestSync: (checkout: string, reason: string, say: (line: string) => void) => Promise<unknown>
    /** Starts the detached watch of the pushed sha's GitHub CI (harness/dev-ci-watch.ts); it never throws and never waits for the verdict. */
    readonly watchCi: (root: string, dir: string, sha: string, lanes: readonly string[], say: (line: string) => void) => Promise<void>
}


const tail = (run: ToolRun): string => `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600)

/** The re-check of an app's merged tree: the types family of its own `starci app check` (codegen, then the tsc programs), never a second typecheck of its own. */
export const APP_RECHECK_ARGS: readonly string[] = ["app", "check", "--gate", "types", "--env", "prod"]

/**
 * The fast re-check after dev moved: an app's `starci app check --gate types` (the one owner of checking, contexts/project/lint.md PROJECT-LINT-7),
 * or the harness CLI's typecheck under the heavy governor.
 */
export const realRecheck = async (root: string, profile: LandProfileName, lane: string): Promise<string | undefined> => {
    if (profile === "harness") {
        const run = await withHeavySlot("tsc", `lane gate --land ${lane}: cli typecheck`, root, {}, (held) => captureNpm(["run", "typecheck", "--prefix", "cli"], root, held.options))
        return run.exitCode === 0 ? undefined : `npm run typecheck (cli) exited ${String(run.exitCode)}: ${tail(run)}`
    }
    const run = await captureTool(process.execPath, [appCli(root), ...APP_RECHECK_ARGS], root)
    return run.exitCode === 0 ? undefined : `starci ${APP_RECHECK_ARGS.join(" ")} exited ${String(run.exitCode)}: ${tail(run)}`
}

export const realLandDeps: LandDeps = {
    recheck: realRecheck,
    push: (root, profile, sha, into) =>
        profile === "harness" ? captureGit(["push", "origin", `${sha}:refs/heads/${into}`], root) : captureTool(process.execPath, [appCli(root), "app", "push", "origin", `${sha}:refs/heads/${into}`], root),
    publish: (root, sha, say) => publishDev({ root, head: sha, execute: true, say }),
    requestSync: requestDevSync,
    watchCi: (root, dir, sha, lanes, say) => startDevCiWatch(root, dir, sha, lanes, say),
}

/**
 * Lands the gated lane at `root` on `into` (default dev). `gatedBase` is the origin/<into> commit the gate merged (undefined when it merged nothing).
 * Refuses LANE_LAND_NO_BRANCH (origin lacks `into`), LANE_LAND_CONFLICT (the files), LANE_LAND_RED (the re-check after the branch moved) and LANE_LAND_PUSH;
 * the lock is released in every case.
 */
export const landLane = async (given: { readonly root: string; readonly lane: string; readonly branch: string; readonly profile: LandProfileName; readonly dir: string; readonly gatedBase: string | undefined; readonly into?: string | undefined; readonly say: (line: string) => void }, deps: LandDeps = realLandDeps): Promise<LaneLanded> => {
    const { root, lane, branch, profile, dir, say } = given
    const into = given.into ?? "dev"
    const onDev = into === "dev"
    const remote = `origin/${into}`
    const scope = intoLockScope(lockScope(profile), into)
    await takeDevLock(dir, say, scope)
    let landed: { readonly sha: string; readonly base: string; readonly rechecked: boolean; readonly migrations: readonly string[]; readonly laneSha: string }
    try {
        const fetched = await gitOut(root, ["fetch", "-q", "origin"])
        if (!fetched.ok) throw new Refusal("LANE_LAND_FETCH", `git fetch origin: ${fetched.err}`)
        const based = await gitOut(root, ["rev-parse", "--verify", "-q", `${remote}^{commit}`])
        if (!based.ok || based.out === "") throw new Refusal("LANE_LAND_NO_BRANCH", `origin has no branch ${into}: create it from dev first (git push origin origin/dev:refs/heads/${into})`)
        const base = based.out
        const merge = await mergeOrAbort(root, remote)
        if (!merge.ok) throw new Refusal("LANE_LAND_CONFLICT", merge.files.length > 0 ? `${remote} (${base.slice(0, 10)}) conflicts with ${lane} in ${merge.files.join(", ")}: merge ${remote} in the lane, resolve, commit, then run lane gate --push --land again` : `git merge ${remote}: ${merge.err}`)
        const rechecked = given.gatedBase !== base
        if (rechecked) {
            say(`${into} moved since the gate (${given.gatedBase?.slice(0, 10) ?? "no merge"} -> ${base.slice(0, 10)}): fast re-check of the merged tree`)
            const red = await deps.recheck(root, profile, lane)
            if (red !== undefined) throw new Refusal("LANE_LAND_RED", `the fast re-check after merging ${remote} ${base.slice(0, 10)} is red: ${red}; fix it in the lane and run lane gate --push --land again`)
        } else say(`${into} is where the gate merged it (${base.slice(0, 10)}): no re-check`)
        const laneSha = (await gitOut(root, ["rev-parse", "HEAD"])).out
        const tree = (await gitOut(root, ["rev-parse", "HEAD^{tree}"])).out
        const baseTree = (await gitOut(root, ["rev-parse", `${base}^{tree}`])).out
        if (tree === baseTree) throw new Refusal("LANE_LAND_EMPTY", `${lane} adds nothing to ${remote} ${base.slice(0, 10)}: it is already on ${into}`)
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")
        const committed = await captureGit(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", base, "-m", squashMessage(stamp, { lane, branch, sha: laneSha }, into)], root)
        if (committed.exitCode !== 0) throw new Refusal("LANE_LAND_SQUASH", `git commit-tree: ${committed.stderr.trim()}`)
        const sha = committed.stdout.trim()
        say(`squashed ${lane} into ${sha.slice(0, 10)} on ${remote} ${base.slice(0, 10)}; pushing ${into}`)
        const pushed = await deps.push(root, profile, sha, into)
        if (pushed.exitCode !== 0) throw new Refusal("LANE_LAND_PUSH", `the push of ${sha.slice(0, 10)} to ${into} failed (nothing forced; run lane gate --push --land again): ${tail(pushed)}`)
        const migrations = (await gitOut(root, ["diff", "--name-only", "--diff-filter=A", base, sha, "--", MIGRATIONS_FOLDER])).out.split("\n").filter((file) => file !== "")
        landed = { sha, base, rechecked, migrations, laneSha }
    } finally {
        releaseLockFile(landPaths(dir, scope).devLock, process.pid)
    }
    // The landing stands from here: what follows is said, never thrown.
    writeStatus(dir, { lane, state: "landed", sha: landed.sha, laneSha: landed.laneSha, branch, ...(onDev ? {} : { into }), migrations: landed.migrations, reason: `landed by lane gate --land${onDev ? "" : ` --into ${into}`}` })
    const repo = await mainCheckout(root)
    if (!onDev) {
        // Only dev runs the app's dev stack and feeds the harness dev line: a landing on the integration branch marks no sync and publishes nothing.
        say(`landed on ${into}, not on dev: no dev sync marked${profile === "harness" ? " and no dev publish" : ""}; dev takes it with starci dev promote --dir ${repo} --from ${into} --execute`)
        await deps.watchCi(repo, dir, landed.sha, [lane], say)
        return { into, sha: landed.sha, laneSha: landed.laneSha, base: landed.base, rechecked: landed.rechecked, migrations: landed.migrations, published: [], syncs: [] }
    }
    let published: readonly string[] = []
    let publishNote: string | undefined
    if (profile === "harness") {
        try {
            const done = await deps.publish(root, landed.sha, say)
            published = done.published
            const failed = done.failed.map((failure) => `${failure.package}@${failure.version} (${failure.reason})`)
            publishNote = [
                published.length === 0 && failed.length === 0 ? "the landing changed no published package" : published.length === 0 ? "" : `published ${published.join(", ")} to the local registry`,
                failed.length === 0 ? "" : `FAILED ${failed.join("; ")}: run starci deps publish-dev --execute in the harness checkout once fixed`,
            ].filter((part) => part !== "").join("; ")
        } catch (error) {
            publishNote = `deps publish-dev failed (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}): run starci deps publish-dev --execute in the harness checkout`
        }
        say(`dev publish: ${publishNote}`)
    }
    const settings = loadLocalSettings().devSync
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
    return { into, sha: landed.sha, laneSha: landed.laneSha, base: landed.base, rechecked: landed.rechecked, migrations: landed.migrations, published, ...(publishNote === undefined ? {} : { publishNote }), syncs }
}
