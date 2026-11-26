import { existsSync, readFileSync } from "node:fs"
import { Refusal } from "../../shared/errors.js"
import { pidAlive } from "../../shared/exec.js"
import { currentBranch, mainCheckout, samePath, gitOutcome as git } from "../../shared/git.js"
import { listPackages } from "../../shared/workspace.js"
import { landPaths, releaseLockFile, takeDevLock } from "../../harness/lane-state.js"
import { lockScope } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import { devSync, summaryLine, syncLocal } from "../dev/sync.js"
import { readRunnerStatus, runnerPaths, settingsForCheckout } from "../dev/sync-runner.js"
import { syncLockFile } from "../dev/sync-lock.js"
import { consumedPackages, devNodes } from "../deps/publish-dev.js"
import { realLandDeps } from "../lane/land-direct.js"
import type { LandDeps } from "../lane/land-direct.js"
import { rebuildCliCopy } from "./cli-copy.js"
import type { CliCopy } from "./cli-copy.js"
import { grantPass } from "./pass.js"
import type { HotfixRules } from "./rules.js"
import { escalationOf, isNamed, overlayFiles, readChanges, scopeOf, tooBigMessage } from "./scope.js"
import type { Change, Changes, Scope } from "./scope.js"

/**
 * `starci hotfix land` (contexts/authority/lanes.md "Hotfix"): the coordinator edited the dev checkout in place, and
 * this lands that edit on dev and restarts dev at once. It judges NOTHING but the size: at most `maxFiles` files and `maxLines` changed lines (ops/hotfix.yaml), else it
 * refuses "quá lớn cho hotfix (N file / M dòng), mở lane". No typecheck, no hfs rule sweep, no secret scan, no spec; the push passes the pre-push gate by the pass
 * of core/hotfix/pass.ts, the one sanctioned way past it, and the CI watch (the same one every landing starts) judges the commit after the fact.
 *
 * Under the repository's dev lock (the one `lane gate --land` takes, so nothing else pushes dev or moves the checkout meanwhile) it refuses while a dev
 * sync of the checkout runs, makes ONE commit of the working tree (git plumbing, no commit hook) with a `Hotfix:` trailer, rebases it onto the newest origin/dev, and pushes
 * dev, never forced. Then the dev stack restarts through `dev sync` (core/dev/sync.ts) told where the checkout was before the hotfix: a light restart of the changed
 * api/web only, or the full sync steps (npm ci, build, migrate) when a lockfile, a migration, a schema or a workspace package changed, and it says which. On the harness the
 * changed packages are published to the dev line and every app's dev checkout syncs. After the lock is released it waits for the health url and starts the CI watch.
 */

/** What one restart of a dev checkout came to. */
export interface Restart {
    readonly checkout: string
    readonly state: "done" | "failed"
    readonly note: string
}

/** The seams of a hotfix, real by default; the specs hand in their own. */
export interface HotfixDeps {
    readonly push: LandDeps["push"]
    readonly publish: LandDeps["publish"]
    readonly watchCi: LandDeps["watchCi"]
    /** Restarts the dev stack of `checkout` on the code it holds: from `since` with the light or the full steps, or (no since) as a plain sync of origin/dev. Never throws. */
    readonly restart: (checkout: string, request: { readonly since?: string; readonly light: boolean }, say: (line: string) => void) => Promise<Restart>
    /** Why a dev sync of the checkout is running now (the sync lock or the runner mid-sync), or undefined. */
    readonly busy: (checkout: string) => Promise<string | undefined>
    /** The dev-line packages the apps consume that a harness hotfix's own files change (core/deps/publish-dev.ts consumedPackages): docs and contexts name none. */
    readonly consumed: (root: string, files: readonly string[]) => Promise<readonly string[]>
    /** The dev checkouts to sync after a harness hotfix published `published` packages: every app of devSync.repos. */
    readonly syncTargets: (root: string, published: readonly string[]) => Promise<readonly string[]>
    /** A harness hotfix: builds the CLI copy of the pushed commit and repoints `_cli-current` to it (core/hotfix/cli-copy.ts). Never throws. */
    readonly cliCopy: (root: string, dir: string, sha: string, files: readonly string[], say: (line: string) => void) => Promise<CliCopy>
    /** Waits until `url` answers 200 (undefined) or `seconds` pass (why not). */
    readonly health: (url: string, seconds: number) => Promise<string | undefined>
}

/** What a hotfix did. */
export interface HotfixLanded {
    readonly dryRun: boolean
    readonly sha: string
    /** The dev commit it landed on. */
    readonly base: string
    readonly files: readonly string[]
    readonly scope: Scope
    /** Why the restart ran the full sync steps; empty for the light restart. */
    readonly escalation: readonly string[]
    readonly published: readonly string[]
    /** A harness hotfix: the packages the apps consume that it changes; none for docs and contexts, which restart and sync nothing. */
    readonly consumed: readonly string[]
    /** A harness hotfix: the dev builds of those packages that were not published, each with why. */
    readonly publishFailed: readonly string[]
    readonly restarts: readonly Restart[]
    /** A harness hotfix: the rebuilt CLI copy and the junction repointed to it. */
    readonly cliCopy?: CliCopy
    readonly health: string
}


const firstLine = (text: string): string => (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").slice(0, 300)

/** Why a dev sync of `checkout` is running: its sync lock names a live process, or its runner is mid-sync. */
export const syncBusy = async (checkout: string): Promise<string | undefined> => {
    const lock = syncLockFile(checkout)
    if (existsSync(lock)) {
        const held = readFileSync(lock, "utf8")
        const pid = Number(/pid=(\d+)/.exec(held)?.[1] ?? "0")
        if (pid > 0 && pidAlive(pid)) return `a dev sync of ${checkout} holds ${lock} (${held.trim()})`
    }
    const paths = await runnerPaths(checkout)
    const status = readRunnerStatus(paths)
    if (status?.state === "syncing" && existsSync(paths.lock)) {
        const pid = Number(/pid=(\d+)/.exec(readFileSync(paths.lock, "utf8"))?.[1] ?? "0")
        if (pid > 0 && pidAlive(pid)) return `the dev sync runner (pid ${String(pid)}) is syncing ${checkout} (${status.reason})`
    }
    return undefined
}

const realRestart: HotfixDeps["restart"] = async (checkout, request, say) => {
    const settings = settingsForCheckout(loadLocalSettings().devSync, checkout)
    try {
        const done = await devSync({ checkout, local: syncLocal([], settings), env: settings.env, execute: true, restart: true, processes: settings.processes, say, ...(request.since === undefined ? {} : { since: request.since, light: request.light }) })
        return { checkout, state: done.exitCode === undefined || done.exitCode === 0 ? "done" : "failed", note: summaryLine(done.data) }
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? `${String(error.code)}: ` : ""
        return { checkout, state: "failed", note: `${code}${firstLine(error instanceof Error ? error.message : String(error))}` }
    }
}

const realHealth: HotfixDeps["health"] = async (url, seconds) => {
    const until = Date.now() + seconds * 1000
    let last = "no answer"
    while (Date.now() < until) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
            if (response.status === 200) return undefined
            last = `answered ${String(response.status)}`
        } catch (error) {
            last = `no answer (${firstLine(error instanceof Error ? error.message : String(error))})`
        }
        await new Promise((done) => setTimeout(done, 2000))
    }
    return `${url} ${last} after ${String(seconds)} s`
}

export const realHotfixDeps: HotfixDeps = {
    push: realLandDeps.push,
    publish: realLandDeps.publish,
    watchCi: realLandDeps.watchCi,
    restart: realRestart,
    busy: syncBusy,
    syncTargets: (_root, published) => {
        if (published.length === 0) return Promise.resolve([])
        const settings = loadLocalSettings().devSync
        return Promise.resolve(Object.entries(settings.repos).map(([key, entry]) => entry.checkout ?? key))
    },
    consumed: (root, files) => Promise.resolve(consumedPackages(devNodes(listPackages(root)), files)),
    cliCopy: (root, dir, sha, files, say) => rebuildCliCopy({ root, dir, sha, files, say }),
    health: realHealth,
}

/** What a harness hotfix does for the apps, from the packages they consume that it changes. Pure. */
export const harnessPlan = (consumed: readonly string[]): string =>
    consumed.length === 0
        ? "apps: no restart and no sync: the hotfix changes no package the apps consume (docs, contexts or a tree no app runs), so no dev publish runs"
        : `apps: the hotfix changes ${consumed.join(", ")}, which the apps consume: deps publish-dev, then every app of devSync.repos syncs at once`

/** The commit message of a hotfix: its subject, and the `Hotfix:` trailer naming its size. Pure. */
export const hotfixMessage = (message: string, scope: Scope): string => `hotfix: ${message.trim()}\n\nHotfix: ${String(scope.files)} file(s) / ${String(scope.lines)} line(s)\n`

/** The checkout a hotfix runs in: the repository's own dev checkout, never a lane worktree, on the branch dev. */
export const assertDevCheckout = async (root: string): Promise<void> => {
    const main = await mainCheckout(root)
    if (!samePath(main, root)) throw new Refusal("HOTFIX_NOT_CHECKOUT", `${root} is a worktree of ${main}, not its dev checkout: a hotfix edits the dev checkout in place; work in a lane worktree lands with lane gate --push --land`)
    const branch = await currentBranch(root)
    if (branch !== "dev") throw new Refusal("HOTFIX_NOT_DEV", `${root} is on ${branch ?? "a detached HEAD"}, not dev: a hotfix lands from the dev checkout (git switch dev there first)`)
}

/**
 * The changes of the dev checkout, judged against the owner's limits. `only` names the hotfix's paths (a folder ends with a slash; a new file must be named): the
 * harness checkout holds other work, so there `only` is required. Refuses HOTFIX_ONLY_REQUIRED, HOTFIX_FOREIGN (tracked changes outside `only`), HOTFIX_ONLY_UNCHANGED
 * (a named path with no change), HOTFIX_EMPTY and HOTFIX_SCOPE (over the limit).
 */
export const judgeScope = async (root: string, rules: Pick<HotfixRules, "maxFiles" | "maxLines">, only: readonly string[] = [], profile: LandProfileName = "app"): Promise<{ readonly changes: readonly Change[]; readonly scope: Scope; readonly found: Changes }> => {
    if (profile === "harness" && only.length === 0) throw new Refusal("HOTFIX_ONLY_REQUIRED", `${root} is the harness checkout, which holds other work: name the hotfix's files with --only <path> (repeat it; a new file must be named too)`)
    const found = await readChanges(root, only, overlayFiles(root))
    if (found.foreign.length > 0) throw new Refusal("HOTFIX_FOREIGN", `${root} has tracked uncommitted changes outside the hotfix (${found.foreign.slice(0, 5).join(", ")}${found.foreign.length > 5 ? ", ..." : ""}): commit or stash them, or name them in --only; nothing was committed`)
    const missing = only.filter((entry) => !entry.endsWith("/") && !found.changes.some((change) => isNamed(change.path, [entry])))
    if (missing.length > 0) throw new Refusal("HOTFIX_ONLY_UNCHANGED", `--only names ${missing.join(", ")}, which has no change in ${root} (a typo, or already committed)`)
    if (found.changes.length === 0) throw new Refusal("HOTFIX_EMPTY", `${root} has no uncommitted change to land: edit the files in the dev checkout first${found.untracked.length > 0 ? ` (a new file is landed only when --only names it: ${found.untracked.slice(0, 3).join(", ")})` : ""}`)
    const scope = scopeOf(found.changes, rules)
    if (!scope.ok) throw new Refusal("HOTFIX_SCOPE", tooBigMessage(scope, rules))
    return { changes: found.changes, scope, found }
}

/**
 * Lands the dev checkout's uncommitted edit as one hotfix commit on dev and restarts dev. Refuses HOTFIX_NOT_CHECKOUT, HOTFIX_NOT_DEV, HOTFIX_EMPTY, HOTFIX_SCOPE (over the limit),
 * HOTFIX_SYNC_BUSY, HOTFIX_FETCH, HOTFIX_CONFLICT (the rebase onto origin/dev; the edit is back in the working tree) and HOTFIX_PUSH (the commit is undone, the edit is back);
 * the dev lock is released in every case. A restart or health wait that fails does not undo the landing: it is reported and the exit is red.
 */
export const hotfixLand = async (given: { readonly root: string; readonly dir: string; readonly profile: LandProfileName; readonly message: string; readonly rules: HotfixRules; readonly only?: readonly string[]; readonly dryRun?: boolean; readonly healthUrl?: string | undefined; readonly say: (line: string) => void }, deps: HotfixDeps = realHotfixDeps): Promise<HotfixLanded> => {
    const { root, dir, profile, say, rules } = given
    await assertDevCheckout(root)
    const { changes, scope } = await judgeScope(root, rules, given.only ?? [], profile)
    const files = changes.map((change) => change.path)
    // The harness runs no dev server: its restart is the sync of the apps, and only for a package they consume (harnessPlan).
    const escalation = profile === "harness" ? [] : escalationOf(files)
    if (given.dryRun === true) {
        say(`hotfix dry run: ${String(scope.files)} file(s) / ${String(scope.lines)} line(s) within ${String(rules.maxFiles)} / ${String(rules.maxLines)}: ${files.join(", ")}`)
        const consumed = profile === "harness" ? await deps.consumed(root, files) : []
        say(profile === "harness" ? harnessPlan(consumed) : escalation.length === 0 ? "restart: light (the changed api/web only)" : `restart: the full sync steps (${escalation.join("; ")})`)
        return { dryRun: true, sha: "", base: "", files, scope, escalation, published: [], consumed, publishFailed: [], restarts: [], health: "not run" }
    }
    const lockScopeName = lockScope(profile)
    await takeDevLock(dir, say, lockScopeName)
    let published: readonly string[] = []
    let consumed: readonly string[] = []
    let publishFailed: readonly string[] = []
    const restarts: Restart[] = []
    try {
        const busy = await deps.busy(root)
        if (busy !== undefined) throw new Refusal("HOTFIX_SYNC_BUSY", `${busy}: nothing was committed; run starci hotfix land again once it ends`)
        const fetched = await git(root, ["fetch", "-q", "origin"])
        if (!fetched.ok) throw new Refusal("HOTFIX_FETCH", `git fetch origin: ${fetched.err}`)
        const before = (await git(root, ["rev-parse", "HEAD"])).out
        // Exactly the hotfix's paths: a stray file of the checkout is never swept in.
        const added = await git(root, ["add", "-A", "--", ...files])
        if (!added.ok) throw new Refusal("HOTFIX_COMMIT", `git add: ${added.err}`)
        const tree = (await git(root, ["write-tree"])).out
        // Plumbing, as a landing squashes: the commit hooks are a gate too, and a hotfix runs none.
        const made = await git(root, ["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", before, "-m", hotfixMessage(given.message, scope)])
        if (!made.ok || made.out === "") throw new Refusal("HOTFIX_COMMIT", `git commit-tree: ${made.err}`)
        const moved = await git(root, ["update-ref", "-m", "starci hotfix", "HEAD", made.out, before])
        if (!moved.ok) throw new Refusal("HOTFIX_COMMIT", `git update-ref HEAD: ${moved.err}`)
        const undo = async (): Promise<void> => {
            await git(root, ["reset", "--mixed", "-q", before])
        }
        const behind = !(await git(root, ["merge-base", "--is-ancestor", "origin/dev", "HEAD"])).ok
        if (behind) {
            const rebased = await git(root, ["-c", "commit.gpgsign=false", "rebase", "--autostash", "origin/dev"])
            if (!rebased.ok) {
                const conflicts = (await git(root, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter((file) => file !== "")
                await git(root, ["rebase", "--abort"])
                await undo()
                throw new Refusal("HOTFIX_CONFLICT", conflicts.length > 0 ? `the hotfix conflicts with origin/dev in ${conflicts.join(", ")}: your edit is back in the working tree; fetch, resolve it and run starci hotfix land again` : `git rebase origin/dev: ${firstLine(rebased.err)}; your edit is back in the working tree`)
            }
            say(`rebased the hotfix onto origin/dev ${(await git(root, ["rev-parse", "origin/dev"])).out.slice(0, 10)}`)
        }
        const sha = (await git(root, ["rev-parse", "HEAD"])).out
        const base = (await git(root, ["rev-parse", "HEAD~1"])).out
        say(`hotfix commit ${sha.slice(0, 10)} on origin/dev ${base.slice(0, 10)}: ${String(scope.files)} file(s) / ${String(scope.lines)} line(s); pushing dev (no check)`)
        const release = grantPass(root, sha)
        let pushed: Awaited<ReturnType<HotfixDeps["push"]>>
        try {
            pushed = await deps.push(root, profile, sha, "dev")
        } finally {
            release()
        }
        if (pushed.exitCode !== 0) {
            await git(root, ["reset", "--mixed", "-q", "HEAD~1"])
            throw new Refusal("HOTFIX_PUSH", `the push of ${sha.slice(0, 10)} to dev failed (nothing forced; the commit is undone and your edit is back in the working tree): ${`${pushed.stdout}\n${pushed.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600)}`)
        }
        const touched = (await git(root, ["diff", "--name-only", before, sha])).out.split("\n").filter((file) => file !== "")
        // The app checkout moved from `before` over every commit the rebase brought in, so all of them decide its restart; the harness restarts no checkout.
        const reasons = profile === "harness" ? [] : escalationOf(touched)
        let cliCopy: CliCopy | undefined
        if (profile === "harness") {
            // Nothing of the harness is a dev server: the machine runs a built copy of the CLI, so it is rebuilt and `_cli-current` repointed first.
            cliCopy = await deps.cliCopy(root, dir, sha, touched, say)
            say(`CLI copy: ${cliCopy.state}: ${cliCopy.note}`)
            // Decided by the hotfix's own files (the rebase may bring others' commits, which their own landing publishes), never by whether a publish ran.
            consumed = await deps.consumed(root, files)
            say(harnessPlan(consumed))
            if (consumed.length > 0) {
                try {
                    const done = await deps.publish(root, sha, say)
                    published = done.published
                    publishFailed = done.failed.map((failure) => `${failure.package}@${failure.version}: ${failure.reason}`)
                } catch (error) {
                    publishFailed = [`deps publish-dev: ${firstLine(error instanceof Error ? error.message : String(error))}`]
                    say(`deps publish-dev failed: ${error instanceof Error ? error.message : String(error)}`)
                }
                for (const failure of publishFailed) say(`dev publish FAILED ${failure}`)
                if (publishFailed.length > 0) say("run starci deps publish-dev --execute in the harness checkout once the failure is fixed: it publishes what this run did not")
                say(published.length === 0 ? "dev publish: nothing published, so no app syncs" : `dev publish: ${published.join(", ")} to the local registry; syncing every app dev checkout of devSync.repos now, no debounce (each one's devSync.local installs the new dev build; no committed pin changes)`)
                for (const checkout of await deps.syncTargets(root, published)) restarts.push(await deps.restart(checkout, { light: false }, say))
                if (published.length > 0 && restarts.length === 0) say("no app dev checkout to sync: devSync.repos of the local settings names none")
            }
        } else {
            say(reasons.length === 0 ? "restart: light, the changed api/web only (no lockfile, migration, schema or workspace package changed)" : `restart: the FULL sync steps, not the light restart (${reasons.join("; ")})`)
            restarts.push(await deps.restart(root, { since: before, light: reasons.length === 0 }, say))
        }
        for (const restart of restarts) say(`${restart.state === "done" ? "restarted" : "RESTART FAILED"} ${restart.checkout}: ${restart.note}`)
        return await afterLock({ ...given, sha, base, files, scope, escalation: reasons, published, consumed, publishFailed, restarts, ...(cliCopy === undefined ? {} : { cliCopy }), release: () => {
            releaseLockFile(landPaths(dir, lockScopeName).devLock, process.pid)
        } }, deps)
    } finally {
        releaseLockFile(landPaths(dir, lockScopeName).devLock, process.pid)
    }
}

/** What follows the restart: the lock is released first (the health wait and the CI watch hold nothing), then the health wait, then the CI watch. */
const afterLock = async (given: { readonly root: string; readonly dir: string; readonly rules: HotfixRules; readonly healthUrl?: string | undefined; readonly say: (line: string) => void; readonly sha: string; readonly base: string; readonly files: readonly string[]; readonly scope: Scope; readonly escalation: readonly string[]; readonly published: readonly string[]; readonly consumed: readonly string[]; readonly publishFailed: readonly string[]; readonly restarts: readonly Restart[]; readonly cliCopy?: CliCopy; readonly release: () => void }, deps: HotfixDeps): Promise<HotfixLanded> => {
    const { say } = given
    given.release()
    let health = "not asked: no --health-url; the restart (app stack restart) waited for the stack's own health"
    if (given.healthUrl !== undefined) {
        const failed = await deps.health(given.healthUrl, given.rules.healthWaitSeconds)
        health = failed === undefined ? `${given.healthUrl} answered 200` : `FAILED: ${failed}`
    }
    say(`health: ${health}`)
    // The watcher lives in the checkout, up to 45 minutes; a red CI is printed loudly and sent to the notify session, never reverted.
    await deps.watchCi(given.root, given.dir, given.sha, ["hotfix"], say)
    return { dryRun: false, sha: given.sha, base: given.base, files: given.files, scope: given.scope, escalation: given.escalation, published: given.published, consumed: given.consumed, publishFailed: given.publishFailed, restarts: given.restarts, ...(given.cliCopy === undefined ? {} : { cliCopy: given.cliCopy }), health }
}

/** Where a hotfix stands in the dev checkout: its size against the limits, whether it would restart light, and what would stop it. */
export interface HotfixStatus {
    readonly root: string
    readonly branch: string | null
    readonly files: readonly string[]
    readonly scope: Scope
    readonly escalation: readonly string[]
    readonly behind: number
    readonly devLock: string | null
    readonly syncBusy: string | null
    /** Tracked changes outside `only`: they stop a hotfix. */
    readonly foreign: readonly string[]
    /** Untracked files a hotfix leaves alone unless `only` names them. */
    readonly untracked: readonly string[]
    /** The files dev sync's local overlay rewrote: sync-owned, left alone (scope.ts overlayFiles). */
    readonly overlay: readonly string[]
}

/** `hotfix status`: reads only. */
export const hotfixStatus = async (given: { readonly root: string; readonly dir: string; readonly profile: LandProfileName; readonly rules: HotfixRules; readonly only?: readonly string[] }, deps: Pick<HotfixDeps, "busy"> = realHotfixDeps): Promise<HotfixStatus> => {
    const { root } = given
    const { changes, foreign, untracked, overlay } = await readChanges(root, given.only ?? [], overlayFiles(root))
    const lock = landPaths(given.dir, lockScope(given.profile)).devLock
    const behind = Number((await git(root, ["rev-list", "--count", "HEAD..origin/dev"])).out) || 0
    return { root, branch: (await currentBranch(root)) ?? null, files: changes.map((change) => change.path), scope: scopeOf(changes, given.rules), escalation: given.profile === "harness" ? [] : escalationOf(changes.map((change) => change.path)), behind, devLock: existsSync(lock) ? readFileSync(lock, "utf8").trim() : null, syncBusy: (await deps.busy(root)) ?? null, foreign, untracked, overlay }
}

/** `hotfix abort`: the paths it restores from HEAD (tracked) and deletes (new files); `execute` does it. */
export const hotfixAbort = async (given: { readonly root: string; readonly execute: boolean; readonly only?: readonly string[] }): Promise<{ readonly restore: readonly string[]; readonly remove: readonly string[] }> => {
    const { changes } = await readChanges(given.root, given.only ?? [], overlayFiles(given.root))
    const restore: string[] = []
    const remove: string[] = []
    for (const change of changes) {
        const tracked = (await git(given.root, ["cat-file", "-e", `HEAD:${change.path}`])).ok
        if (tracked) restore.push(change.path)
        else remove.push(change.path)
    }
    if (given.execute) {
        if (restore.length > 0) {
            const run = await git(given.root, ["checkout", "HEAD", "--", ...restore])
            if (!run.ok) throw new Refusal("HOTFIX_ABORT", `git checkout HEAD: ${run.err}`)
        }
        if (remove.length > 0) {
            const run = await git(given.root, ["clean", "-f", "-q", "--", ...remove])
            if (!run.ok) throw new Refusal("HOTFIX_ABORT", `git clean: ${run.err}`)
        }
    }
    return { restore, remove }
}

