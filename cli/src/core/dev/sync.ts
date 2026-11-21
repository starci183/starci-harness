import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import { captureGit, currentBranch, git, repositoryRoot, resolveSha, trackedChanges } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import type { DevSyncSettings } from "../../harness/local-settings.js"
import { installLocal, installRecordFile, parseRequested, readInstallRecord } from "../deps/install-local.js"
import type { InstallRecord } from "../deps/install-local.js"
import { PORT } from "../deps/local-registry.js"
import { appNpm, assertNpm } from "../deps/packages.js"

/** The two sides of a dev stack a sync may restart. */
export type Side = "be" | "fe"

const LOCKFILE = "package-lock.json"

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
export const overlayFiles = (record: InstallRecord | undefined): string[] => (record === undefined ? [] : [...new Set([...record.packages.flatMap((one) => one.pins.map((pin) => pin.file)), LOCKFILE])].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0)))

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

const gitOk = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

/** The app's own pinned CLI in the checkout: the stack restart runs with the hfs the app pins, never this CLI's. */
const appCli = (root: string): string => join(root, "node_modules", "starci-harness", "dist", "main.js")

/** The overlay line every sync prints. Pure. */
export const overlayLine = (overlay: readonly string[]): string =>
    overlay.length === 0 ? "local overlay: none (every @starci package resolves from npm)" : `local overlay in effect: ${overlay.join(", ")} from the local registry (a plain dev sync restores the registry versions)`

/**
 * One `dev sync` of an app's dev checkout: refuse any tracked change but a recorded overlay's; put a recorded overlay back to the committed
 * pins (the overlay never survives a sync that does not name it again); fast-forward the checkout to origin/dev; npm ci; install the `local`
 * packages from the local registry (deps install-local); and restart the changed side of the running dev stack (`app stack restart`, which
 * builds and serves the built artifact). Dry until `execute`: the dry run fetches and prints the plan.
 */
export const devSync = async (request: DevSyncRequest): Promise<{ readonly data: DevSyncData; readonly message: string; readonly exitCode?: number }> => {
    const root = await repositoryRoot(request.checkout)
    assertNpm(root)
    const lines: string[] = []
    const say = (line: string): void => {
        lines.push(line)
        request.say(line)
    }
    const record = readInstallRecord(root)
    const overlayBefore = overlayOf(record)
    const ownFiles = overlayFiles(record)
    const dirty = (await trackedChanges(root)).filter((file) => !ownFiles.includes(file))
    if (dirty.length > 0) throw new Refusal("DEV_SYNC_DIRTY", `${root} has tracked changes that are not a local overlay's: ${dirty.slice(0, 5).join(", ")}; the dev checkout only follows origin/dev, commit them on a lane instead`)
    const branch = await currentBranch(root)
    if (branch !== "dev") throw new Refusal("DEV_SYNC_NOT_DEV", `${root} is on ${branch ?? "a detached HEAD"}, not dev: dev sync moves the app's main dev checkout only (git switch dev there first)`)
    const fetched = await gitOk(root, ["fetch", "--quiet", "origin", "dev"])
    if (!fetched.ok) throw new Refusal("DEV_SYNC_FETCH", `git fetch origin dev in ${root}: ${fetched.err}`)
    const from = await resolveSha(root, "HEAD")
    const to = await resolveSha(root, "origin/dev")
    if (!(await gitOk(root, ["merge-base", "--is-ancestor", from, to])).ok) throw new Refusal("DEV_SYNC_DIVERGED", `${root} dev (${from.slice(0, 9)}) is not behind origin/dev (${to.slice(0, 9)}): the dev checkout holds commits dev does not; land them through a lane`)
    const commits = Number((await gitOk(root, ["rev-list", "--count", `${from}..${to}`])).out) || 0
    const files = from === to ? [] : (await git(root, ["diff", "--name-only", from, to])).split("\n").filter((file) => file !== "")
    const requested = request.local.map(parseRequested)
    const overlayChanged = overlayBefore.length > 0 || requested.length > 0
    const sides = changedSides([...files, ...(overlayChanged ? [LOCKFILE] : [])])
    const processes = processesFor(sides, request.processes)
    const lockChanged = files.includes(LOCKFILE)
    const needInstall = lockChanged || overlayBefore.length > 0 || !existsSync(join(root, "node_modules"))
    const restartArgs = ["app", "stack", "restart", "--env", request.env, "--process", processes.join(","), "--execute"]
    const base: Omit<DevSyncData, "overlay" | "installed" | "restarted" | "restart"> = { checkout: root, dryRun: !request.execute, from, to, commits, overlayBefore, sides }
    if (!request.execute) {
        say(`would fast-forward ${root} dev ${from.slice(0, 9)} -> ${to.slice(0, 9)} (${String(commits)} commit(s))`)
        if (overlayBefore.length > 0) say(`would restore the committed pins of ${ownFiles.join(", ")} (drop the overlay ${overlayBefore.join(", ")})`)
        say(needInstall ? "would run npm ci" : "npm ci: the lockfile did not change, skipped")
        if (requested.length > 0) say(`would install from the local registry: ${requested.map((one) => one.name + (one.version === undefined ? "" : `@${one.version}`)).join(", ")}`)
        say(processes.length === 0 ? "restart: nothing a running process reads changed" : request.restart ? `would rebuild and restart ${processes.join(", ")}: ${restartArgs.join(" ")}` : `restart skipped (--no-restart): ${processes.join(", ")} changed`)
        say(overlayLine(overlayBefore))
        say("dry run: nothing moved; add --execute")
        return { data: { ...base, overlay: overlayBefore, installed: false, restarted: [], restart: processes.length === 0 ? "none" : "planned" }, message: lines.join("\n") }
    }
    if (record !== undefined) {
        const restored = await gitOk(root, ["checkout", "--", ...ownFiles])
        if (!restored.ok) throw new Refusal("DEV_SYNC_RESTORE", `git checkout -- ${ownFiles.join(" ")} in ${root}: ${restored.err}`)
        rmSync(installRecordFile(root), { force: true })
        say(`restored the committed pins of ${ownFiles.join(", ")}: the overlay ${overlayBefore.join(", ")} is gone`)
    }
    const merged = await gitOk(root, ["merge", "--ff-only", "--quiet", to])
    if (!merged.ok) throw new Refusal("DEV_SYNC_DIVERGED", `git merge --ff-only origin/dev in ${root}: ${merged.err}`)
    say(from === to ? `${root} is at origin/dev ${to.slice(0, 9)}` : `fast-forwarded ${root} dev ${from.slice(0, 9)} -> ${to.slice(0, 9)} (${String(commits)} commit(s))`)
    if (needInstall) {
        await appNpm(root, ["ci", "--no-audit", "--no-fund"], "dev sync: npm ci")
        say("npm ci: done")
    } else say("npm ci: the lockfile did not change, skipped")
    if (requested.length > 0) {
        const installed = await installLocal(root, requested, PORT, true)
        say(installed.message.split("\n")[0] ?? "installed the local packages")
    }
    const overlay = overlayOf(readInstallRecord(root))
    const done = { ...base, overlay, installed: needInstall || requested.length > 0 }
    if (processes.length === 0) {
        say("restart: nothing a running process reads changed")
        say(overlayLine(overlay))
        return { data: { ...done, restarted: [], restart: "none" }, message: lines.join("\n") }
    }
    if (!request.restart) {
        say(`restart skipped (--no-restart): ${processes.join(", ")} changed`)
        say(overlayLine(overlay))
        return { data: { ...done, restarted: [], restart: "skipped" }, message: lines.join("\n") }
    }
    say(`rebuilding and restarting ${processes.join(", ")} (the database, storage and tunnel stay up)`)
    const run = await captureTool(process.execPath, [appCli(root), ...restartArgs], root)
    for (const line of `${run.stdout}\n${run.stderr}`.split("\n").map((one) => one.trimEnd()).filter((one) => one !== "")) say(`  ${line}`)
    say(overlayLine(overlay))
    if (run.exitCode !== 0) return { data: { ...done, restarted: [], restart: "failed" }, message: lines.join("\n"), exitCode: 1 }
    return { data: { ...done, restarted: processes, restart: "done" }, message: lines.join("\n") }
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
    summary: "fast-forward the app's dev checkout to origin/dev, npm ci, install each --local harness package from the local registry, then rebuild and restart only the changed api/web of the running dev stack; a plain sync drops any local overlay (dry until --execute)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/dev-sync@1",
    flags: {
        local: { kind: "list", summary: "a harness package to install from the local registry after the install (grammar, @starci/hfs@6.18.0-local.1; repeat); without it every @starci package comes from npm" },
        dir: { kind: "string", summary: "the app's dev checkout (default: the current one)" },
        env: { kind: "string", summary: "the dev environment of the running stack (default: the local settings' devSync.env, dev)" },
        "no-restart": { kind: "boolean", summary: "move the checkout and install, but leave the running stack as it is" },
        execute: { kind: "boolean", summary: "move, install and restart for real (default: a dry run that fetches and prints the plan)" },
    },
    run: async (context, flags) => {
        const settings = loadLocalSettings().devSync
        const result = await devSync({
            checkout: flags.dir ?? context.cwd, local: flags.local.flatMap((one) => one.split(",")).map((one) => one.trim()).filter((one) => one !== ""),
            env: flags.env ?? settings.env, execute: flags.execute, restart: !flags["no-restart"], processes: settings.processes, say: context.progress,
        })
        // Every step was printed as it happened; the message is the one line that says where the checkout and the stack stand.
        return { ...result, message: summaryLine(result.data) }
    },
})
