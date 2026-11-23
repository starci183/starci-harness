import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { captureGit, currentBranch, git, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { installLocal, installRecordFile, installUnitOf, parseRequested, readInstallRecord, writeInstallRecord } from "../deps/install-local.js"
import { stageTree, stagedOutputs, stagedTrackedChanges, swapStaged } from "./stage.js"
import { declaredProcesses, processesOfApp } from "./declared.js"
import type { Swapped } from "./stage.js"
import type { InstallRecord } from "../deps/install-local.js"
import { PORT } from "../deps/local-registry.js"
import { appNpm, assertNpm, tail } from "../deps/packages.js"
import { syncLockFile, withSyncLock } from "./sync-lock.js"
import { installPlaces, installWithCopyAside, leftAside, realInstallFs, restoreLeftAside } from "./safe-install.js"
import type { InstallFs } from "./safe-install.js"
import { PREPARE_SCRIPTS, prepareTree } from "../../harness/prepare-tree.js"
import type { PrepareFailure } from "../../harness/prepare-tree.js"
import { MIGRATIONS_FOLDER } from "../../harness/land-profile.js"
import { appCli, readStackProcesses, stopStackProcesses } from "./stack-stop.js"
import type { StackProcesses, StackStop } from "./stack-stop.js"

/** The two sides of a dev stack a sync may restart. */
export type Side = "be" | "fe"

const LOCKFILE = "package-lock.json"

/** Written when a sync's build of the workspace packages failed, removed once one passes: the next sync builds and restarts both sides even if nothing moved. */
const UNPREPARED = join("node_modules", ".starci-dev-sync-unprepared")

/** Written in the git folder when a sync's migration failed, removed once one passes: the next sync migrates again even if nothing moved. */
const UNMIGRATED = "starci-dev-sync-unmigrated"

/** Files no running process reads: a change of these alone restarts nothing. */
const INERT = (file: string): boolean => file.endsWith(".md") || file.startsWith(".starciwork/") || file.startsWith(".github/") || file.startsWith("gallery/")

/** The sides a set of changed files touches: be/ is the api, fe/ the web, anything else a process reads (root manifests, packages/, db/, the stack declaration) both. Pure. */
export const changedSides = (files: readonly string[]): Side[] => {
    const sides = new Set<Side>()
    for (const file of files.map((one) => one.replaceAll("\\", "/"))) {
        if (INERT(file)) continue
        if (file.startsWith("be/")) sides.add("be")
        else if (file.startsWith("fe/")) sides.add("fe")
        else {
            sides.add("be")
            sides.add("fe")
        }
    }
    return (["be", "fe"] as const).filter((side) => sides.has(side))
}

/** The overlay of a record as `name@version` lines, sorted; empty when nothing is installed from the local registry. Pure. */
export const overlayOf = (record: InstallRecord | undefined): string[] => (record?.packages ?? []).map((one) => `${one.name}@${one.version}`).toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))

/** The stack processes to restart for the changed sides, in declaration order of the settings, each once. Pure. */
export const processesFor = (sides: readonly Side[], processes: DevSyncSettings["processes"]): string[] => [...new Set(sides.flatMap((side) => processes[side]))]

/** The files an install-local overlay changed: the manifests its pins live in and the lockfile. Pure. */
export const overlayFiles = (record: InstallRecord | undefined, unitOf: (file: string) => string = () => ""): string[] =>
    record === undefined
        ? []
        : [...new Set([...record.packages.flatMap((one) => one.pins.flatMap((pin) => [pin.file, unitLockfile(unitOf(pin.file))])), LOCKFILE])].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))

/** The lockfile of an install unit: the root's, or the one of a subfolder package with its own lockfile (an app's gallery/). Pure. */
const unitLockfile = (folder: string): string => (folder === "" ? LOCKFILE : `${folder}/${LOCKFILE}`)

/** What one `dev sync` did or would do. */
export interface DevSyncData {
    readonly checkout: string
    readonly dryRun: boolean
    readonly from: string
    readonly to: string
    readonly commits: number
    readonly overlayBefore: readonly string[]
    readonly overlay: readonly string[]
    readonly installed: boolean
    /** The stack's migrate step ran (`app stack up`): the sync brought migration files, or the last sync's migration failed. */
    readonly migrated: boolean
    /** The dev stack processes ended before the install, restarted after it. */
    readonly stopped: readonly string[]
    readonly sides: readonly Side[]
    readonly restarted: readonly string[]
    readonly restart: "done" | "skipped" | "failed" | "planned" | "none"
}

/** How one sync is asked for: by the verb, or by the batch lander from this machine's local settings. */
export interface DevSyncRequest {
    readonly checkout: string
    readonly local: readonly string[]
    readonly env: string
    readonly execute: boolean
    readonly restart: boolean
    readonly processes: DevSyncSettings["processes"]
    readonly say: (line: string) => void
}

/** How many times a sync runs `npm ci` when it dies on a file something holds. */
export const NPM_CI_TRIES = 4

/** An install error of a file something holds for a moment (an antivirus scanning a large file it just saw written). */
const HELD_FILE = /\b(?:ENOTEMPTY|EPERM|EBUSY|EACCES)\b/u

/**
 * `npm ci` at `root`, run again up to NPM_CI_TRIES times when it dies on a held file: before each new try every `node_modules` it wrote is removed
 * with retries and a pause lets the holder go. Any other failure, or the last one, is thrown as it is.
 */
export const npmCiRetried = async (root: string, ci: (root: string) => Promise<void>, pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)), tries: number = NPM_CI_TRIES): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            await ci(root)
            return
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error)
            if (attempt >= tries || !HELD_FILE.test(text)) throw error
            for (const place of installPlaces(root)) rmSync(place, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 })
            await pause(5000 * attempt)
        }
    }
}

/** The seams of a sync that touch processes and node_modules, real by default and replaced by the specs. */
export interface DevSyncDeps {
    /** The processes the checkout's dev environment recorded (stack-stop.ts readStackProcesses). */
    readonly stackProcesses: (root: string, env: string) => Promise<StackProcesses | string | undefined>
    /** Ends them and sees them gone. */
    readonly stop: (processes: StackProcesses) => Promise<StackStop>
    /** The clean install of the checkout. */
    readonly npmCi: (root: string) => Promise<void>
    /** The app's prepare scripts (harness/prepare-tree.ts: codegen, then build:modules, the build of its workspace packages): the failure, or undefined. */
    readonly prepare: (root: string) => Promise<PrepareFailure | undefined>
    /** The renames and removals of the install. */
    readonly fs: InstallFs
    readonly pause: (ms: number) => Promise<void>
    /** One run of the app's pinned CLI (`app stack up` to migrate, `app stack restart`). */
    readonly appRun: (root: string, args: readonly string[]) => Promise<ToolRun>
    /**
     * The build-first install (core/dev/stage.ts): a staging worktree at the new commit, its outputs and the tracked files its install changed, and the
     * swap into the checkout. Absent, the install runs in place after the stop (safe-install.ts).
     */
    readonly stage?: {
        readonly tree: (root: string, to: string) => Promise<string>
        readonly outputs: (staging: string) => Promise<readonly string[]>
        readonly tracked: (staging: string) => Promise<readonly string[]>
        readonly swap: (staging: string, root: string, outputs: readonly string[], tracked: readonly string[]) => Promise<Swapped>
    }
}

export const realDevSyncDeps: DevSyncDeps = {
    stackProcesses: readStackProcesses,
    stop: stopStackProcesses,
    npmCi: (root) => npmCiRetried(root, (at) => appNpm(at, ["ci", "--no-audit", "--no-fund"], "dev sync: npm ci")),
    prepare: async (root) => (await prepareTree(root, "dev sync")).failure,
    fs: realInstallFs,
    pause: (ms) => new Promise((done) => setTimeout(done, ms)),
    appRun: (root, args) => captureTool(process.execPath, [appCli(root), ...args], root),
    stage: { tree: stageTree, outputs: stagedOutputs, tracked: stagedTrackedChanges, swap: (staging, root, outputs, tracked) => swapStaged(staging, root, outputs, tracked) },
}

const gitOk = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

/** True when the packages a sync names are exactly the overlay already installed: each with its version, the same name@version set. Pure. */
export const sameOverlay = (named: readonly { readonly name: string; readonly version?: string | undefined }[], installed: readonly string[]): boolean => {
    if (named.length !== installed.length || named.some((one) => one.version === undefined)) return false
    const wanted = new Set(named.map((one) => `${one.name}@${String(one.version)}`))
    return wanted.size === installed.length && installed.every((line) => wanted.has(line))
}

/** The packages one sync installs from the local registry: the ones the verb names, else this machine's standing overlay (`devSync.local`). Pure. */
export const syncLocal = (named: readonly string[], settings: Pick<DevSyncSettings, "local">): readonly string[] => (named.length > 0 ? named : settings.local)

/** The overlay line every sync prints. Pure. */
export const overlayLine = (overlay: readonly string[]): string =>
    overlay.length === 0 ? "local overlay: none (every @starci package resolves from npm)" : `local overlay in effect: ${overlay.join(", ")} from the local registry (kept while devSync.local names it; clear the setting to restore the registry versions)`

/**
 * One `dev sync` of an app's dev checkout: refuse any tracked change but a recorded overlay's; put a recorded overlay back to the committed
 * pins (the overlay never survives a sync that does not name it again); fast-forward the checkout to origin/dev; npm ci; install the `local`
 * packages from the local registry (deps install-local); prepare the tree (harness/prepare-tree.ts: the app's codegen and build:modules, the build of
 * its workspace packages; a failure refuses DEV_SYNC_BUILD); migrate the database when files under db/migrations/ arrived (`app stack up`, the stack's
 * migrate step and its receipt; a failure refuses DEV_SYNC_MIGRATE and restarts nothing new); and restart the changed side of the running dev stack (`app stack restart`, which
 * builds and serves the built artifact). Before anything writes node_modules, the dev stack processes the checkout's local state records
 * are ended and seen gone (a process that loaded a file of node_modules makes npm fail halfway on Windows); a stop that fails refuses
 * DEV_SYNC_STOP before anything moved. The install runs with the old node_modules moved aside and put back on failure (safe-install.ts),
 * and the stopped processes are restarted after it with the changed ones, or alone when the install or the build failed. Dry until `execute`: the dry run fetches and prints the plan.
 */
export const devSync = async (request: DevSyncRequest, deps: DevSyncDeps = realDevSyncDeps): Promise<{ readonly data: DevSyncData; readonly message: string; readonly exitCode?: number }> => {
    const root = await repositoryRoot(request.checkout)
    // One sync of a checkout at a time, whoever asks (two landers, a hand run): a second one waits for the first. A dry run writes nothing and takes no lock.
    if (!request.execute) return devSyncLocked(request, deps, root)
    return withSyncLock(syncLockFile(root), request.say, () => devSyncLocked(request, deps, root), deps.pause)
}

const devSyncLocked = async (request: DevSyncRequest, deps: DevSyncDeps, root: string): Promise<{ readonly data: DevSyncData; readonly message: string; readonly exitCode?: number }> => {
    assertNpm(root)
    const lines: string[] = []
    const say = (line: string): void => {
        lines.push(line)
        request.say(line)
    }
    const record = readInstallRecord(root)
    const overlayBefore = overlayOf(record)
    const ownFiles = overlayFiles(record, (file) => installUnitOf(root, file))
    const dirty = (await trackedChanges(root)).filter((file) => !ownFiles.includes(file))
    if (dirty.length > 0) throw new Refusal("DEV_SYNC_DIRTY", `${root} has tracked changes that are not a local overlay's: ${dirty.slice(0, 5).join(", ")}; the dev checkout only follows origin/dev, commit them on a lane instead`)
    const branch = await currentBranch(root)
    // A detached HEAD is where the lander leaves the main checkout (at origin/dev): it is accepted once it is origin/dev or behind it.
    const detached = branch === undefined
    if (!detached && branch !== "dev") throw new Refusal("DEV_SYNC_NOT_DEV", `${root} is on ${branch}, not dev: dev sync moves the app's main dev checkout only (git switch dev there first)`)
    const fetched = await gitOk(root, ["fetch", "--quiet", "origin", "dev"])
    if (!fetched.ok) throw new Refusal("DEV_SYNC_FETCH", `git fetch origin dev in ${root}: ${fetched.err}`)
    const from = await resolveSha(root, "HEAD")
    const to = await resolveSha(root, "origin/dev")
    if (!(await gitOk(root, ["merge-base", "--is-ancestor", from, to])).ok) {
        if (detached) throw new Refusal("DEV_SYNC_NOT_DEV", `${root} is on a detached HEAD (${from.slice(0, 9)}) that is not origin/dev (${to.slice(0, 9)}) or behind it, not dev: dev sync moves the app's main dev checkout only (git switch dev there first)`)
        throw new Refusal("DEV_SYNC_DIVERGED", `${root} dev (${from.slice(0, 9)}) is not behind origin/dev (${to.slice(0, 9)}): the dev checkout holds commits dev does not; land them through a lane`)
    }
    const commits = Number((await gitOk(root, ["rev-list", "--count", `${from}..${to}`])).out) || 0
    const files = from === to ? [] : (await git(root, ["diff", "--name-only", from, to])).split("\n").filter((file) => file !== "")
    const named = request.local.map(parseRequested)
    const aside = leftAside(root, deps.fs)
    // The overlay this sync asks for is the one already installed (same name@version each, no committed pin or lockfile moved, a whole
    // node_modules in place): nothing is restored, reinstalled or restarted for it, so the web the owner has open keeps running.
    const keepsOverlay = overlayBefore.length > 0 && sameOverlay(named, overlayBefore) && !files.some((file) => ownFiles.includes(file)) && aside.length === 0 && existsSync(join(root, "node_modules"))
    const requested = keepsOverlay ? [] : named
    const overlayChanged = !keepsOverlay && (overlayBefore.length > 0 || requested.length > 0)
    // A tree the last sync could not build or migrate is built and restarted again whole, though the checkout has not moved since.
    const unprepared = existsSync(join(root, UNPREPARED))
    const unmigratedMark = (await gitOk(root, ["rev-parse", "--path-format=absolute", "--git-path", UNMIGRATED])).out
    const unmigrated = unmigratedMark !== "" && existsSync(unmigratedMark)
    const sides = changedSides([...files, ...(overlayChanged || unprepared || unmigrated ? [LOCKFILE] : [])])
    // The processes the app declares for this environment (core/dev/declared.ts), not names the settings assumed.
    const processes = processesFor(sides, processesOfApp(request.processes, declaredProcesses(root, request.env)))
    const lockChanged = files.includes(LOCKFILE)
    const needInstall = lockChanged || (overlayBefore.length > 0 && !keepsOverlay) || aside.length > 0 || !existsSync(join(root, "node_modules"))
    const writesModules = needInstall || requested.length > 0
    // The tree a restart builds from is prepared first, as the lane gate and the lander prepare theirs: a workspace package that moved or
    // arrived (its main is its dist) resolves only once built, so a web restarted on an unbuilt one answers "Module not found".
    const prepares = writesModules || processes.length > 0
    // New migration files are applied before the api restarts on code that needs them, by the stack's own migrate step and its receipt
    // (`app stack up`, idempotent: what runs is kept). A migration that failed last time is tried again though nothing moved.
    const newMigrations = files.filter((file) => file.startsWith(MIGRATIONS_FOLDER))
    const migrates = newMigrations.length > 0 || unmigrated
    const upArgs = ["app", "stack", "up", "--env", request.env, "--execute"]
    const restartArgs = (names: readonly string[]): string[] => ["app", "stack", "restart", "--env", request.env, "--process", names.join(","), "--execute"]
    const base: Omit<DevSyncData, "overlay" | "installed" | "migrated" | "stopped" | "restarted" | "restart"> = { checkout: root, dryRun: !request.execute, from, to, commits, overlayBefore, sides }
    if (!request.execute) {
        say(detached ? `would put ${root} back on dev at origin/dev ${to.slice(0, 9)} (detached at ${from.slice(0, 9)}, ${String(commits)} commit(s) behind)` : `would fast-forward ${root} dev ${from.slice(0, 9)} -> ${to.slice(0, 9)} (${String(commits)} commit(s))`)
        if (unprepared) say(`the last sync could not build the workspace packages (${UNPREPARED}): would build them and restart both sides`)
        if (keepsOverlay) say(`the local overlay is already installed (${overlayBefore.join(", ")}): nothing to restore or reinstall, and nothing restarts for it`)
        if (overlayBefore.length > 0 && !keepsOverlay) say(`would restore the committed pins of ${ownFiles.join(", ")} (drop the overlay ${overlayBefore.join(", ")})`)
        if (aside.length > 0) say(`would move back the copy an earlier sync left aside: ${aside.join(", ")}`)
        if (writesModules) say(`would stop the dev stack processes the ${request.env} environment records before node_modules is written, and restart them after`)
        say(needInstall ? "would run npm ci (the old node_modules moved aside until it passes)" : "npm ci: the lockfile did not change, skipped")
        if (requested.length > 0) say(`would install from the local registry: ${requested.map((one) => one.name + (one.version === undefined ? "" : `@${one.version}`)).join(", ")}`)
        if (prepares) say(`would run the app's ${PREPARE_SCRIPTS.join(" and ")} (each one it declares) before the restart`)
        if (migrates) say(`would migrate the ${request.env} database before the restart (${newMigrations.length > 0 ? `${String(newMigrations.length)} migration file(s) changed` : "the last sync's migration failed"}): ${upArgs.join(" ")}`)
        say(processes.length === 0 ? "restart: nothing a running process reads changed" : request.restart ? `would rebuild and restart ${processes.join(", ")}: ${restartArgs(processes).join(" ")}` : `restart skipped (--no-restart): ${processes.join(", ")} changed`)
        say(overlayLine(overlayBefore))
        say("dry run: nothing moved; add --execute")
        return { data: { ...base, overlay: overlayBefore, installed: false, migrated: false, stopped: [], restarted: [], restart: processes.length === 0 ? "none" : "planned" }, message: lines.join("\n") }
    }
    // Build first: with a staging seam, an install is done and the tree built in a worktree of the new commit while the stack keeps serving, and only the
    // swap and the restart happen after the stop. A copy an interrupted in-place sync left aside goes through the in-place path, which restores it.
    const stage = writesModules && aside.length === 0 ? deps.stage : undefined
    let staged: { readonly staging: string; readonly outputs: readonly string[]; readonly tracked: readonly string[] } | undefined
    if (stage !== undefined) {
        const staging = await stage.tree(root, to)
        say(`building the new tree in ${staging} first (npm ci${requested.length > 0 ? ", the local packages" : ""}, ${PREPARE_SCRIPTS.join(", ")}); the running api and web keep serving until the swap`)
        await deps.npmCi(staging)
        say("npm ci (staged): done")
        if (requested.length > 0) {
            const installed = await installLocal(staging, requested, PORT, true)
            say(`(staged) ${installed.message.split("\n")[0] ?? "installed the local packages"}`)
        }
        const failed = await deps.prepare(staging)
        if (failed !== undefined) throw new Refusal("DEV_SYNC_BUILD", `${failed.command} exited ${String(failed.exitCode)} in the staged tree of ${to.slice(0, 9)} (${staging}): nothing was stopped and nothing moved, the stack keeps serving the previous build; fix it on a lane and sync again:\n${failed.output}`)
        staged = { staging, outputs: await stage.outputs(staging), tracked: await stage.tracked(staging) }
        say(`staged build ready: ${String(staged.outputs.length)} built path(s) to swap in`)
    }
    const stopped = writesModules ? await stopBeforeInstall(root, request.env, deps, say) : []
    if (keepsOverlay) say(`the local overlay is already installed (${overlayBefore.join(", ")}): nothing restored, reinstalled or restarted for it`)
    else if (record !== undefined) {
        const restored = await gitOk(root, ["checkout", "--", ...ownFiles])
        if (!restored.ok) throw new Refusal("DEV_SYNC_RESTORE", `git checkout -- ${ownFiles.join(" ")} in ${root}: ${restored.err}`)
        rmSync(installRecordFile(root), { force: true })
        say(`restored the committed pins of ${ownFiles.join(", ")}: the overlay ${overlayBefore.join(", ")} is gone`)
    }
    if (detached) {
        // HEAD is origin/dev or an ancestor of it, so this only moves forward: the checkout ends on a local dev tracking origin/dev.
        const switched = await gitOk(root, ["checkout", "--quiet", "-B", "dev", "--track", "origin/dev"])
        if (!switched.ok) throw new Refusal("DEV_SYNC_DIVERGED", `git checkout -B dev origin/dev in ${root}: ${switched.err}`)
        say(`put ${root} back on dev at origin/dev ${to.slice(0, 9)} (was detached at ${from.slice(0, 9)})`)
    } else {
        const merged = await gitOk(root, ["merge", "--ff-only", "--quiet", to])
        if (!merged.ok) throw new Refusal("DEV_SYNC_DIVERGED", `git merge --ff-only origin/dev in ${root}: ${merged.err}`)
    }
    say(from === to ? `${root} is at origin/dev ${to.slice(0, 9)}` : `fast-forwarded ${root} dev ${from.slice(0, 9)} -> ${to.slice(0, 9)} (${String(commits)} commit(s))`)
    const restartNames = async (names: readonly string[], why: string): Promise<boolean> => {
        say(`${why} ${names.join(", ")} (the database, storage and tunnel stay up)`)
        const run = await deps.appRun(root, restartArgs(names))
        for (const line of `${run.stdout}\n${run.stderr}`.split("\n").map((one) => one.trimEnd()).filter((one) => one !== "")) say(`  ${line}`)
        return run.exitCode === 0
    }
    try {
        if (stage !== undefined && staged !== undefined) {
            const swapped = await stage.swap(staged.staging, root, staged.outputs, staged.tracked)
            if (requested.length > 0) {
                const record = readInstallRecord(staged.staging)
                if (record !== undefined) writeInstallRecord(root, record)
                rmSync(installRecordFile(staged.staging), { force: true })
            }
            rmSync(join(root, UNPREPARED), { force: true })
            say(`swapped the staged build in: ${String(swapped.moved.length)} path(s) moved, ${String(swapped.relinked)} workspace link(s) re-pointed${swapped.copied.length > 0 ? `, ${swapped.copied.join(", ")} copied` : ""}${swapped.leftover.length > 0 ? `; left for the next sync (held): ${swapped.leftover.join(", ")}` : ""}`)
        }
        const restored = stage === undefined ? restoreLeftAside(root, deps.fs) : []
        if (restored.length > 0) say(`moved back the copy an earlier sync left aside: ${restored.join(", ")}`)
        if (stage !== undefined) say("npm ci: done in the staged tree")
        else if (needInstall) {
            await installWithCopyAside(root, () => deps.npmCi(root), say, deps.fs, deps.pause)
            say("npm ci: done")
        } else say("npm ci: the lockfile did not change, skipped")
        if (requested.length > 0 && stage === undefined) {
            const installed = await installLocal(root, requested, PORT, true)
            say(installed.message.split("\n")[0] ?? "installed the local packages")
        }
        if (prepares && stage === undefined) {
            const failed = await deps.prepare(root)
            if (failed !== undefined) {
                writeFileSync(join(root, UNPREPARED), `${to}\n`)
                throw new Refusal("DEV_SYNC_BUILD", `${failed.command} exited ${String(failed.exitCode)} in ${root} after the sync to ${to.slice(0, 9)}: the workspace packages are not built, so the changed side was not rebuilt (only the processes stopped for the install come back); fix it on a lane (the lander's gate runs the same script) and sync again:\n${failed.output}`)
            }
            rmSync(join(root, UNPREPARED), { force: true })
            say(`prepared the tree: ${PREPARE_SCRIPTS.join(", ")} (each the app declares)`)
        }
        if (migrates) {
            say(`migrating the ${request.env} database before the restart (${newMigrations.length > 0 ? newMigrations.join(", ") : "the last sync's migration failed"}): ${upArgs.join(" ")}`)
            const up = await deps.appRun(root, upArgs)
            for (const line of `${up.stdout}\n${up.stderr}`.split("\n").map((one) => one.trimEnd()).filter((one) => one !== "")) say(`  ${line}`)
            if (up.exitCode !== 0) {
                if (unmigratedMark !== "") writeFileSync(unmigratedMark, `${to}\n`)
                throw new Refusal("DEV_SYNC_MIGRATE", `starci app stack up --env ${request.env} --execute exited ${String(up.exitCode)} in ${root} after the sync to ${to.slice(0, 9)}: the database is not migrated, so no process restarts on the new code (only the processes stopped for the install come back); fix the migration on a lane and sync again (the next sync migrates again):\n${tail(up.stdout, up.stderr)}`)
            }
            if (unmigrated) rmSync(unmigratedMark, { force: true })
        }
    } catch (error) {
        // The install, the build of the workspace packages or the migration failed: the stopped processes come back before the refusal is said
        // (after a failed install, on the previous node_modules put back in place); nothing else restarts on the new code.
        if (stopped.length > 0 && !(await restartNames(stopped, "the install, the build or the migration failed; restarting the stopped"))) say(`the stopped ${stopped.join(", ")} did not come back: starci app stack up --env ${request.env} --execute`)
        throw error
    }
    const overlay = overlayOf(readInstallRecord(root))
    const done = { ...base, overlay, installed: needInstall || requested.length > 0, migrated: migrates, stopped }
    // `stack up` started the stopped processes again on the new code (it starts what does not run): they are not restarted a second time.
    const restart = migrates ? (request.restart ? processes.filter((name) => !stopped.includes(name)) : []) : request.restart ? [...new Set([...stopped, ...processes])] : stopped
    if (restart.length === 0) {
        const started = migrates ? stopped : []
        say(started.length > 0 ? `restart: ${started.join(", ")} started again on the new code by stack up` : processes.length === 0 ? "restart: nothing a running process reads changed" : `restart skipped (--no-restart): ${processes.join(", ")} changed`)
        say(overlayLine(overlay))
        return { data: { ...done, restarted: started, restart: started.length > 0 ? "done" : processes.length === 0 ? "none" : "skipped" }, message: lines.join("\n") }
    }
    const ok = await restartNames(restart, request.restart ? "rebuilding and restarting" : "restarting the processes stopped for the install (--no-restart restarts nothing else):")
    say(overlayLine(overlay))
    if (!ok) return { data: { ...done, restarted: [], restart: "failed" }, message: lines.join("\n"), exitCode: 1 }
    return { data: { ...done, restarted: restart, restart: "done" }, message: lines.join("\n") }
}

/**
 * Ends the dev stack processes the environment records before node_modules is written, and says which; the names it ended. No pinned
 * CLI to read them from (no install, or a half-wiped one) ends nothing: the install's move aside then fails fast while a process still
 * holds a file. A record that cannot be read, or a process still alive after the stop, refuses DEV_SYNC_STOP before anything moved.
 */
const stopBeforeInstall = async (root: string, env: string, deps: DevSyncDeps, say: (line: string) => void): Promise<readonly string[]> => {
    const processes = await deps.stackProcesses(root, env)
    if (processes === undefined) {
        say(`no pinned CLI in ${root} to read the ${env} stack's processes from: nothing stopped; the install moves node_modules aside first, which fails while a process still holds a file in it`)
        return []
    }
    if (typeof processes === "string") throw new Refusal("DEV_SYNC_STOP", `the processes of the ${env} dev stack could not be read (starci app stack status --env ${env}: ${processes}): nothing was installed and nothing moved`)
    const stop = await deps.stop(processes)
    if (stop.alive.length > 0) {
        throw new Refusal("DEV_SYNC_STOP", `the ${env} dev stack could not be stopped before the install: still running ${stop.alive.join(", ")}${stop.stopped.length > 0 ? ` (ended ${stop.stopped.join(", ")})` : ""}. Nothing was installed and nothing moved; end them (starci app stack down --env ${env} --execute) and sync again`)
    }
    say(stop.stopped.length === 0 ? `the ${env} dev stack runs no recorded process: nothing to stop before the install` : `stopped ${stop.stopped.join(", ")} of the ${env} dev stack before the install (restarted after it)`)
    return stop.stopped
}

/** The closing line of a sync: where the checkout stands, what restarted, and the overlay. Pure. */
export const summaryLine = (data: DevSyncData): string => {
    const moved = data.from === data.to ? `at origin/dev ${data.to.slice(0, 9)}` : `${data.dryRun ? "would move" : "moved"} ${data.from.slice(0, 9)} -> ${data.to.slice(0, 9)}`
    const restart = { done: `restarted ${data.restarted.join(", ")}`, skipped: "restart skipped", failed: "restart FAILED", planned: "restart planned", none: "nothing to restart" }[data.restart]
    return `dev sync${data.dryRun ? " (dry run; add --execute)" : ""}: ${moved}; ${restart}; ${overlayLine(data.overlay)}`
}

/**
 * `starci dev sync`: brings an app's main dev checkout to the current origin/dev and its running dev stack onto that code, so the owner tests
 * dev the moment a batch lands (contexts/project/cicd.md "Dev and prod"). It never moves prod and never waits for it.
 */
export const devSyncVerb = defineVerb({
    path: ["dev", "sync"],
    summary: "fast-forward the app's dev checkout to origin/dev, npm ci, install each --local harness package from the local registry, run the app's codegen and build:modules (its workspace packages), migrate the dev database through app stack up when new migrations arrived, then rebuild and restart only the changed api/web of the running dev stack; a plain sync drops any local overlay (dry until --execute)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/dev-sync@1",
    flags: {
        local: { kind: "list", summary: "a harness package to install from the local registry after the install (grammar, @starci/hfs@6.18.0-local.1; repeat); without it the sync uses this machine's devSync.local, and with that empty every @starci package comes from npm" },
        dir: { kind: "string", summary: "the app's dev checkout (default: the current one)" },
        env: { kind: "string", summary: "the dev environment of the running stack (default: the local settings' devSync.env, dev)" },
        "no-restart": { kind: "boolean", summary: "move the checkout and install, but leave the running stack as it is" },
        execute: { kind: "boolean", summary: "move, install and restart for real (default: a dry run that fetches and prints the plan)" },
    },
    run: async (context, flags) => {
        const settings = loadLocalSettings().devSync
        const named = flags.local.flatMap((one) => one.split(",")).map((one) => one.trim()).filter((one) => one !== "")
        const result = await devSync({
            // With no --local, the sync keeps this machine's standing overlay (devSync.local), as the lander's auto-sync does: dev keeps running the
            // local harness builds until the setting is cleared, instead of losing them on every plain sync.
            checkout: flags.dir ?? context.cwd, local: syncLocal(named, settings),
            env: flags.env ?? settings.env, execute: flags.execute, restart: !flags["no-restart"], processes: settings.processes, say: context.progress,
        })
        // Every step was printed as it happened; the message is the one line that says where the checkout and the stack stand.
        return { ...result, message: summaryLine(result.data) }
    },
})
