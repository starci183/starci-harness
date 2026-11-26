import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { captureGit, gitOutcome, mainCheckout, repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import { appCli, lockScope, profileNameFor } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { landedLanesOf, landPaths, lanesDir, releaseLockFile, takeDevLock } from "../../harness/lane-state.js"
import type { LandedLane } from "../../harness/lane-state.js"
import { installWorktree } from "../../harness/lane-install.js"
import { devSyncForRepo, landBranchSchema, loadLocalSettings } from "../../harness/local-settings.js"
import { prepareTree } from "../../harness/prepare-tree.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { planRemoval, removeWorktree } from "../../harness/worktree-remove.js"
import { startDevCiWatch } from "../../harness/dev-ci-watch.js"
import { publishDev } from "../deps/publish-dev.js"
import { requestDevSync } from "./sync-runner.js"

/**
 * `starci dev promote`: dev takes the integration branch its lanes land into (contexts/project/branches.md PROJECT-BRANCH-4), only when the owner asks.
 * Under the repository's dev lock it fast-forwards dev to origin/<from>, or, when dev holds commits the branch lacks (a hotfix, a back-merge), makes ONE
 * merge commit of the two, never forced, pushes dev and marks the dev sync once; on the harness it then publishes the dev line as a landing does. Dry
 * until --execute: it prints the lanes (Landed-lane trailers) that would arrive on dev.
 */

/** How dev stands to the integration branch: holding it already, behind it only (a fast-forward), or apart (one merge commit). */
export type PromoteKind = "in-sync" | "fast-forward" | "merge"

/** What a promotion found and did. */
export interface Promotion {
    readonly repo: string
    readonly from: string
    readonly dev: string
    readonly tip: string
    readonly kind: PromoteKind
    /** The lanes the branch holds that dev lacks, oldest first. */
    readonly lanes: readonly LandedLane[]
    /** Commits of the branch that dev lacks, and of dev that the branch lacks. */
    readonly ahead: number
    readonly behind: number
    /** The dev commit pushed, when executed and needed. */
    readonly pushed?: string
    /** The dev checkouts marked for their sync. */
    readonly syncs: readonly string[]
    readonly dryRun: boolean
}

/** The seams of a promotion, real by default; the specs hand in their own. */
export interface PromoteDeps {
    /** The push of `sha` to dev: an app's through `app push` in a worktree at `sha` (its pre-push hook judges the tree it pushes), the harness's with git. */
    readonly push: (repo: string, profile: LandProfileName, sha: string, lanes: string, say: (line: string) => void) => Promise<ToolRun>
    readonly requestSync: (checkout: string, reason: string, say: (line: string) => void) => Promise<unknown>
    readonly publish: (repo: string, sha: string, say: (line: string) => void) => Promise<unknown>
    readonly watchCi: (repo: string, dir: string, sha: string, lanes: readonly string[], say: (line: string) => void) => Promise<void>
}

/** The message of a promotion's merge commit. Pure. */
export const promoteMessage = (from: string, tip: string, lanes: readonly LandedLane[]): string =>
    [`promote ${from} ${tip.slice(0, 10)} into dev`, "", ...(lanes.length === 0 ? [`- no lane trailers: the commits of ${from} that dev lacks`] : lanes.map((lane) => `- ${lane.lane} (${lane.sha})`))].join("\n")

/**
 * The push of an app's promoted commit: a detached worktree at `sha` under the lanes folder, installed as a lane is (the shared install, else npm ci),
 * prepared (codegen, build:modules), then `app push origin <sha>:refs/heads/dev` in it under a gate slot, so the pre-push hook judges the very tree dev
 * receives; the worktree is removed by the lane removal (links unlinked first) whatever happens.
 */
export const pushFromWorktree = async (repo: string, sha: string, lanes: string, say: (line: string) => void): Promise<ToolRun> => {
    const rules = loadSlotRules()
    const slots = slotRoot(lanes, rules)
    const holder = `promote-${sha.slice(0, 9)}`
    const tree = join(lanes, `_${holder}`)
    const added = await captureGit(["worktree", "add", "--detach", tree, sha], repo)
    if (added.exitCode !== 0) throw new Refusal("DEV_PROMOTE_WORKTREE", `git worktree add ${tree}: ${added.stderr.trim()}`)
    try {
        await installWorktree({ root: tree, holder, slots, rules, wait: undefined, ref: "origin/dev", force: false, devSyncCheckout: devSyncForRepo(loadLocalSettings().devSync, repo).checkout, say })
        const prepared = await prepareTree(tree, `dev promote ${sha.slice(0, 9)}`)
        if (prepared.failure !== undefined) throw new Refusal("DEV_PROMOTE_PREPARE", `${prepared.failure.command} exited ${String(prepared.failure.exitCode)} at ${sha.slice(0, 10)}: ${prepared.failure.output.split("\n").slice(-3).join(" ")}`)
        if (!existsSync(appCli(tree))) throw new Refusal("DEV_PROMOTE_NO_APP_CLI", `${appCli(tree)} is missing after the install: the app pins starci-harness`)
        return await withSlot(slots, rules, "gate", holder, { say }, (taken) => {
            say(`app push origin ${sha.slice(0, 10)}:refs/heads/dev from ${tree} (gate slot ${String(taken.n)}); its pre-push hook judges this tree`)
            return captureTool(process.execPath, [appCli(tree), "app", "push", "origin", `${sha}:refs/heads/dev`], tree, { onSpawn: taken.spawned })
        })
    } finally {
        try {
            await removeWorktree(await planRemoval(tree, repo, true), holder, () => undefined)
        } catch (error) {
            say(`the promote worktree ${tree} was kept (${error instanceof Error ? error.message : String(error)}): starci lane remove ${tree} --execute`)
        }
    }
}

export const realPromoteDeps: PromoteDeps = {
    push: (repo, profile, sha, lanes, say) => (profile === "harness" ? captureGit(["push", "origin", `${sha}:refs/heads/dev`], repo) : pushFromWorktree(repo, sha, lanes, say)),
    requestSync: requestDevSync,
    publish: (repo, sha, say) => publishDev({ root: repo, head: sha, execute: true, say }),
    watchCi: (repo, dir, sha, lanes, say) => startDevCiWatch(repo, dir, sha, lanes, say),
}

/** Where dev stands to origin/<from>, read after a fetch: the kind, the lanes the branch adds and the counts each way. */
const standing = async (repo: string, from: string): Promise<Omit<Promotion, "repo" | "from" | "syncs" | "dryRun">> => {
    const fetched = await gitOutcome(repo, ["fetch", "--quiet", "origin"])
    if (!fetched.ok) throw new Refusal("DEV_PROMOTE_FETCH", `git fetch origin: ${fetched.err}`)
    const rev = async (ref: string): Promise<string> => {
        const found = await gitOutcome(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])
        if (!found.ok || found.out === "") throw new Refusal("DEV_PROMOTE_NO_BRANCH", `origin has no branch ${ref.slice("origin/".length)}`)
        return found.out
    }
    const dev = await rev("origin/dev")
    const tip = await rev(`origin/${from}`)
    const count = async (range: string): Promise<number> => Number((await gitOutcome(repo, ["rev-list", "--count", range])).out)
    const ahead = await count(`${dev}..${tip}`)
    const behind = await count(`${tip}..${dev}`)
    const lanes = landedLanesOf((await gitOutcome(repo, ["log", "--format=%B", `${dev}..${tip}`])).out)
    const kind: PromoteKind = ahead === 0 ? "in-sync" : behind === 0 ? "fast-forward" : "merge"
    return { dev, tip, kind, lanes, ahead, behind }
}

/**
 * Promotes origin/<from> into dev for the repository at `root`. Dry unless `execute`. Executed, it holds the dev lock, reads the branches again, and pushes
 * the integration tip (a fast-forward) or one merge commit made by `git merge-tree` (no checkout moves; a conflict refuses DEV_PROMOTE_CONFLICT with its files
 * and pushes nothing). Refuses DEV_PROMOTE_PUSH when the push fails (nothing forced). After the push: the harness publishes its dev line, the dev checkout
 * is marked for its sync once, and the pushed sha's CI is watched.
 */
export const promote = async (given: { readonly root: string; readonly from: string; readonly execute: boolean; readonly dir: string | undefined; readonly say: (line: string) => void }, deps: PromoteDeps = realPromoteDeps): Promise<Promotion> => {
    const { from, execute, say } = given
    if (from === "dev") throw new Refusal("CLI_USAGE", "--from names the integration branch the lanes land into (dev2), not dev itself")
    const repo = await mainCheckout(await repositoryRoot(given.root))
    const profile = profileNameFor(repo, undefined)
    const seen = await standing(repo, from)
    if (!execute || seen.kind === "in-sync") return { repo, from, ...seen, syncs: [], dryRun: !execute }
    const dir = lanesDir(given.dir)
    const scope = lockScope(profile)
    await takeDevLock(dir, say, scope)
    let now: Awaited<ReturnType<typeof standing>>
    let pushed: string
    try {
        now = await standing(repo, from)
        if (now.kind === "in-sync") return { repo, from, ...now, syncs: [], dryRun: false }
        if (now.kind === "fast-forward") pushed = now.tip
        else {
            const merged = await captureGit(["merge-tree", "--write-tree", "--name-only", "--no-messages", now.dev, now.tip], repo)
            const [tree = "", ...files] = merged.stdout.trim().split(/\r?\n/).filter((line) => line !== "")
            if (merged.exitCode === 1) throw new Refusal("DEV_PROMOTE_CONFLICT", `merging origin/${from} ${now.tip.slice(0, 10)} into dev ${now.dev.slice(0, 10)} conflicts in ${files.join(", ")}: merge origin/dev into ${from} in a lane (lane gate --push --land --into ${from}), then promote again`)
            if (merged.exitCode !== 0 || !/^[0-9a-f]{40}$/u.test(tree)) throw new Refusal("DEV_PROMOTE_MERGE", `git merge-tree exited ${String(merged.exitCode)}: ${merged.stderr.trim()}`)
            const committed = await captureGit(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", now.dev, "-p", now.tip, "-m", promoteMessage(from, now.tip, now.lanes)], repo)
            if (committed.exitCode !== 0) throw new Refusal("DEV_PROMOTE_MERGE", `git commit-tree: ${committed.stderr.trim()}`)
            pushed = committed.stdout.trim()
            say(`dev holds ${String(now.behind)} commit(s) ${from} lacks: one merge commit ${pushed.slice(0, 10)} of dev ${now.dev.slice(0, 10)} and ${from} ${now.tip.slice(0, 10)}`)
        }
        say(`pushing dev ${now.dev.slice(0, 10)} -> ${pushed.slice(0, 10)} (${now.kind}, ${String(now.lanes.length)} lane(s) from ${from})`)
        const run = await deps.push(repo, profile, pushed, dir, say)
        if (run.exitCode !== 0) throw new Refusal("DEV_PROMOTE_PUSH", `the push of ${pushed.slice(0, 10)} to dev failed (nothing forced; run it again): ${`${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600)}`)
    } finally {
        releaseLockFile(landPaths(dir, scope).devLock, process.pid)
    }
    // Dev moved: what follows is said, never thrown, as after a landing on dev.
    const names = now.lanes.map((lane) => lane.lane)
    const reason = `promoted ${from} to dev as ${pushed.slice(0, 10)} (${names.length === 0 ? "no lane trailers" : names.join(", ")})`
    const settings = loadLocalSettings().devSync
    const syncs: string[] = []
    if (profile === "harness") {
        try {
            await deps.publish(repo, pushed, say)
        } catch (error) {
            say(`deps publish-dev failed (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}): run starci deps publish-dev --execute in the harness checkout`)
        }
    } else {
        const own = devSyncForRepo(settings, repo)
        if (!own.afterLand) say(`dev sync: off for ${repo} (devSync.afterLand / devSync.repos of the local settings): the dev checkout is NOT synced`)
        else {
            const checkout = own.checkout ?? repo
            try {
                await deps.requestSync(checkout, reason, say)
                syncs.push(checkout)
            } catch (error) {
                say(`dev sync of ${checkout}: NOT requested (${(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""}); run starci dev sync-runner --request --dir ${checkout}`)
            }
        }
    }
    await deps.watchCi(repo, dir, pushed, names, say)
    return { repo, from, ...now, pushed, syncs, dryRun: false }
}

/** `starci dev promote --dir <app> [--from <branch>] [--execute]`. */
export const devPromoteVerb = defineVerb({
    path: ["dev", "promote"],
    summary: "move dev to the integration branch the repository's lanes land into (landInto of the local settings, or --from), only when the owner asks: under the dev lock fast-forward dev to origin/<from>, or one merge commit when dev holds commits the branch lacks (never forced; a conflict refuses DEV_PROMOTE_CONFLICT and pushes nothing), push dev (an app's through app push from a worktree at the pushed commit, so its pre-push hook judges that tree), then mark the dev sync once (the harness publishes its dev line instead); dry until --execute, printing the lanes (Landed-lane trailers) that would arrive on dev",
    effect: "remote",
    roles: ["owner", "coordinator", "lead", "release"],
    schema: "starci/dev-promote@1",
    flags: {
        dir: { kind: "string", summary: "a checkout of the app (default: the current folder)" },
        from: { kind: "string", summary: "the integration branch (default: devSync.repos.<repo>.landInto of the local settings)" },
        lanes: { kind: "string", summary: "the lanes folder whose dev lock the push holds (default: STARCI_LANES_DIR, else slots.root)" },
        execute: { kind: "boolean", summary: "push dev (default: report what would arrive on dev only)" },
    },
    run: async (context, flags) => {
        const root = resolve(flags.dir ?? context.cwd)
        const repo = await mainCheckout(await repositoryRoot(root))
        const named = flags.from ?? devSyncForRepo(loadLocalSettings().devSync, repo).landInto
        const parsed = landBranchSchema.safeParse(named)
        if (!parsed.success) throw new Refusal("CLI_USAGE", `--from ${named}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`)
        if (parsed.data === "dev") throw new Refusal("DEV_PROMOTE_NO_INTEGRATION", `the lanes of ${repo} land on dev itself (no landInto in the local settings): name the integration branch with --from`)
        const data = await promote({ root, from: parsed.data, execute: flags.execute, dir: flags.lanes, say: context.progress })
        const head = data.kind === "in-sync"
            ? `dev ${data.dev.slice(0, 10)} already holds ${data.from} ${data.tip.slice(0, 10)}: nothing to promote`
            : `${data.from} ${data.tip.slice(0, 10)} is ${String(data.ahead)} commit(s) ahead of dev ${data.dev.slice(0, 10)}${data.behind > 0 ? ` and ${String(data.behind)} behind (one merge commit)` : " (a fast-forward)"}`
        const done = data.pushed === undefined ? (data.kind === "in-sync" ? "" : "; dry run, add --execute") : `; pushed dev ${data.pushed.slice(0, 10)}${data.syncs.length === 0 ? "" : `, dev sync marked for ${data.syncs.join(", ")}`}`
        const lanes = data.lanes.length === 0 ? [] : [`lanes arriving on dev (${String(data.lanes.length)}):`, ...data.lanes.map((lane) => `  ${lane.lane} ${lane.sha.slice(0, 10)}`)]
        return { data, message: [`${head}${done}`, ...lanes].join("\n") }
    },
})
