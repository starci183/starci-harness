import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Refusal } from "../../shared/errors.js"
import { captureNpm, captureTool } from "../../shared/exec.js"
import { captureGit, captureGitSync, currentBranch, repositoryRoot, trackedWorkChanges } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { assertPosixSh } from "../../shared/posix-sh.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { blockingFindings, isOutOfMemory, lanesDir } from "../../harness/lane-state.js"
import type { LaneFinding } from "../../harness/lane-state.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { cancelLaneGate } from "../../harness/supersede.js"
import { harnessProfile, profileNameFor } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { devSyncForRepo, loadLocalSettings } from "../../harness/local-settings.js"
import { cacheLaneInstall, followsBase, sharedInstall } from "../../harness/shared-install.js"
import { laneHolder, waitSeconds } from "../slot/holder.js"
import { PREPARE_SCRIPTS, prepareTree } from "../../harness/prepare-tree.js"
import { landLane } from "./land-direct.js"
import type { LaneLanded } from "./land-direct.js"
import { diskWarningLines } from "../../harness/disk-warning.js"
import { commitGenerated } from "../../harness/lane-generated.js"
import { findingLines } from "../release/gate.js"
import { cleanupLanded } from "../../harness/land-cleanup.js"
import type { LandCleanup } from "../../harness/land-cleanup.js"

/** The root of the starci-harness package this process runs (dist/core/lane/ is three levels below it). */
const runningCliRoot = (): string => fileURLToPath(new URL("../../..", import.meta.url))

/** The mark of the lockfile a lane's node_modules was installed from by this verb. */
const INSTALL_MARK = join("node_modules", ".starci-lane-gate-lock")
/** A file whose change in the merge means node_modules no longer matches the tree. */
const INSTALL_INPUT = /(?:^|\/)package(?:-lock)?\.json$/

/** The check of `lane gate` (no --push): the FAST level, since a lane lands on dev. */
export const LANE_CHECK_ARGS: readonly string[] = ["app", "check", "--env", "prod", "--level", "dev", "--json"]

/** How the gate ended: green, red with findings, out of memory (nobody's fault), or no readable verdict. */
export type GateVerdict = "green" | "red" | "oom" | "no-verdict"

/** What one `lane gate` did, step by step. */
export interface LaneGate {
    readonly lane: string
    readonly branch: string
    readonly merged: { readonly ref: string; readonly before: string; readonly after: string } | null
    readonly installed: boolean
    /** Where node_modules came from when it was installed: the shared install (hard links from the repository's install cache) or a full npm ci. */
    readonly installSource: "shared" | "npm ci" | "none"
    /** Seconds each phase took, in order. */
    readonly timings: readonly { readonly phase: string; readonly seconds: number }[]
    readonly prepared: readonly string[]
    readonly mode: "check" | "push"
    /** The repository's profile (harness/land-profile.ts): an app's pinned CLI and hook, or the harness FAST gate and a plain git push. */
    readonly profile: LandProfileName
    readonly exitCode: number
    readonly verdict: GateVerdict
    readonly findings: readonly LaneFinding[]
    readonly pushed: boolean
    /** --land: the dev commit the lane landed as, the re-check, the dev publish and the dev checkouts marked for their sync. */
    readonly landed: LaneLanded | null
    /** --land: what became of the lane's worktree after the landing (harness/land-cleanup.ts); null when nothing landed. */
    readonly cleanup: LandCleanup | null
}

const gitOut = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
}

/** The dev checkout this machine's local settings name for the repository of `root` (the dev sync's), when they name one. */
const devSyncCheckoutOf = (root: string): string | undefined => {
    try {
        const main = captureGitSync(["worktree", "list", "--porcelain"], root).stdout.split(/\r?\n/).find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim()
        return devSyncForRepo(loadLocalSettings().devSync, main ?? root).checkout
    } catch {
        return undefined
    }
}

/** The app's own pinned CLI: a lane is judged with the harness its app pins (contexts/authority/lanes.md), never a global one. */
const appCli = (root: string): string => join(root, "node_modules", "starci-harness", "dist", "main.js")

/** Merges `ref` into the lane's branch; a conflict is aborted and refused with its files. */
const mergeRef = async (root: string, ref: string, say: (line: string) => void): Promise<LaneGate["merged"]> => {
    const remote = ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : "origin"
    const fetched = await gitOut(root, ["fetch", "-q", remote])
    if (!fetched.ok) throw new Refusal("LANE_GATE_FETCH", `git fetch ${remote}: ${fetched.err}`)
    const before = (await gitOut(root, ["rev-parse", "HEAD"])).out
    const merge = await gitOut(root, ["merge", "--no-edit", ref])
    if (!merge.ok) {
        const files = (await gitOut(root, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter((file) => file !== "")
        await gitOut(root, ["merge", "--abort"])
        throw new Refusal("LANE_GATE_CONFLICT", files.length > 0 ? `merging ${ref} conflicts in ${files.join(", ")}: resolve it by hand, commit, then run lane gate again` : `git merge ${ref}: ${merge.err}`)
    }
    const after = (await gitOut(root, ["rev-parse", "HEAD"])).out
    say(before === after ? `${ref} is already merged` : `merged ${ref}: ${before.slice(0, 10)} -> ${after.slice(0, 10)}`)
    return { ref, before, after }
}

/** Whether node_modules is missing, forced, older than this verb's mark, or the merge changed a package manifest or lockfile. */
const needsInstall = async (root: string, merged: LaneGate["merged"], forced: boolean): Promise<boolean> => {
    if (forced || !existsSync(join(root, "node_modules")) || !existsSync(appCli(root))) return true
    const hash = (await gitOut(root, ["hash-object", "package-lock.json"])).out
    const mark = join(root, INSTALL_MARK)
    if (existsSync(mark) && readFileSync(mark, "utf8").trim() !== hash) return true
    if (merged === null || merged.before === merged.after) return false
    const changed = (await gitOut(root, ["diff", "--name-only", merged.before, merged.after])).out.split("\n")
    return changed.some((file) => INSTALL_INPUT.test(file))
}

/** The report lines of one gate. Pure. */
const gateLines = (data: LaneGate): string[] => [
    `${data.lane}: ${data.mode} ${data.verdict}${data.profile === "app" && data.mode === "check" && data.verdict === "green" ? " (the cache records it wrote are left in the tree; --push commits them)" : ""}`,
    ...data.findings.slice(0, 20).flatMap((finding) => findingLines(finding)),
    ...(data.landed === null ? [] : [`landed on dev as ${data.landed.sha.slice(0, 10)}${data.landed.rechecked ? " (re-checked: dev had moved)" : ""}${data.landed.publishNote === undefined ? "" : `; ${data.landed.publishNote}`}; dev sync ${data.landed.syncs.length === 0 ? "not requested" : `marked for ${data.landed.syncs.join(", ")}`}`]),
    ...(data.cleanup === null ? [] : [data.cleanup.line]),
    ...(data.timings.length === 0 ? [] : [`timings: ${data.timings.map((each) => `${each.phase} ${String(each.seconds)}s`).join(", ")}${data.installSource === "none" ? "" : ` (node_modules: ${data.installSource})`}`]),
]

/** What the harness profile of `lane gate` hands back. */
interface HarnessGated {
    readonly exitCode: number
    readonly verdict: GateVerdict
    readonly findings: LaneFinding[]
    readonly pushed: boolean
}

/**
 * How far the CLI that runs this gate is behind `base`, the harness dev it gates against: the commits of `base` its checkout lacks that change
 * the harness's own judge (cli/, ops/, policy/), or undefined when it lacks none or is no checkout of the same repository (an installed CLI).
 * A stale CLI judges a lane by rules dev no longer holds, so the gate says so loudly at its start and in its result.
 */
export const staleCli = async (root: string, cliRoot: string, base: string): Promise<string | undefined> => {
    const head = await gitOut(cliRoot, ["rev-parse", "HEAD"])
    if (!head.ok || head.out === base) return undefined
    const behind = await gitOut(root, ["rev-list", "--count", `${head.out}..${base}`, "--", "cli", "ops", "policy"])
    const count = Number(behind.out)
    if (!behind.ok || !Number.isFinite(count) || count === 0) return undefined
    const sha = head.out
    return `the CLI running this gate (${cliRoot}, at ${sha.slice(0, 10)}) lacks ${String(count)} commit(s) of ${base.slice(0, 10)} that change cli/, ops/ or policy/: it judges the lane by rules dev no longer holds; build a CLI from dev (git worktree add --detach <lanes>/_cli-<sha> origin/dev, npm ci and npm run build in its cli/) and gate with it`
}

/**
 * The gate of a harness lane: no root install, codegen or app hook. Under a gate slot the lane's own running CLI runs the harness FAST gate
 * (`starci check --level dev`) measured from where the lane forks from the dev commit it merged, and with --push a green gate is followed by
 * `git push origin HEAD:<branch>` (the harness has no pre-push hook that would run it again).
 */
const gateHarness = async (given: { readonly root: string; readonly lane: string; readonly branch: string; readonly ref: string; readonly merging: boolean; readonly push: boolean; readonly slots: string; readonly rules: ReturnType<typeof loadSlotRules>; readonly wait: number | undefined; readonly say: (line: string) => void }): Promise<HarnessGated> => {
    const { root, lane, branch, ref, push, slots, rules, wait, say } = given
    const base = (await gitOut(root, ["rev-parse", given.merging ? ref : "HEAD"])).out
    const fork = (await gitOut(root, ["merge-base", "HEAD", base])).out
    const profile = harnessProfile(join(runningCliRoot(), "dist", "main.js"))
    // The generated contexts files (the index, the slices, the section indexes) are regenerated on the lane's tree and committed with it, so the gate judges, and dev receives, a tree whose index is not stale.
    await commitGenerated(root, say)
    const stale = await staleCli(root, runningCliRoot(), base)
    if (stale !== undefined) say(`WARNING: ${stale}`)
    const command = profile.gate(root, fork === "" ? base : fork)
    const run = await withSlot(slots, rules, "gate", lane, { waitSeconds: wait, say }, (taken) => {
        say(`${profile.gateLabel} (gate slot ${String(taken.n)})`)
        return captureTool(command.file, command.args, root, { onSpawn: taken.spawned })
    })
    const all = blockingFindings(run.stdout)
    const findings = all ?? []
    const verdict: GateVerdict = isOutOfMemory(run.exitCode, run.stderr) ? "oom" : all === undefined || (run.exitCode !== 0 && all.length === 0) ? "no-verdict" : findings.length === 0 ? "green" : "red"
    if (!push || verdict !== "green") return { exitCode: run.exitCode, verdict, findings, pushed: false }
    const pushCommand = profile.push(root, branch)
    const pushed = await captureTool(pushCommand.file, pushCommand.args, root)
    if (pushed.exitCode === 0) return { exitCode: 0, verdict, findings, pushed: true }
    return { exitCode: pushed.exitCode, verdict: "red", findings: [{ code: "LANE_GATE_PUSH", path: "", message: `${pushed.stdout}\n${pushed.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600) }], pushed: false }
}

/**
 * `starci lane gate [lane]`: the local gate a lane runs before it lands (contexts/authority/lanes.md). It merges the base ref
 * (origin/dev), installs under an npm slot when the merge changed a manifest or lockfile, runs codegen (and build:modules after an
 * install), then, under a gate slot, the app's own `app check --env prod --level dev` (the fast level of a landing on dev) or, with --push, `app push origin
 * HEAD:<branch>`, whose pre-push hook runs the fast level once. A new gate of the same lane cancels the lane's running one (harness/supersede.ts). --land then lands the
 * lane on dev itself (core/lane/land-direct.ts).
 */
export const laneGateVerb = defineVerb({
    path: ["lane", "gate"],
    summary: "the local gate of a lane before it lands: merge origin/dev, npm ci under an npm slot when the merge changed a manifest or lockfile, codegen, then under a gate slot the app's own app check --env prod --level dev (the fast level of a landing on dev: deps, types, the lane's own tests, db; the full gate runs once at the main cut), or --push app push (its pre-push hook runs the fast level once), and --land land it on dev at once (under the dev lock: merge the newest origin/dev, a fast re-check only when dev moved since the gate, ONE squashed commit pushed to dev, never forced; a conflict stops for the lane to fix; then the harness dev publish and the debounced dev sync); a new gate of the same lane first cancels the lane's running gate (kills its process tree, releases its slot)",
    effect: "remote",
    roles: WRITERS,
    schema: "starci/lane-gate@1",
    flags: {
        lane: { kind: "string", summary: "the lane name (default: STARCI_LANE, else the branch lane/<lane>)", positional: true },
        ref: { kind: "string", summary: "the ref merged before the gate (default: origin/dev)" },
        "skip-merge": { kind: "boolean", summary: "gate the tree as it is, merging nothing" },
        install: { kind: "boolean", summary: "run npm ci whatever the merge changed" },
        push: { kind: "boolean", summary: "instead of the check, app push origin HEAD:<branch> under the gate slot: it runs the check, commits the cache records and pushes once" },
        land: { kind: "boolean", summary: "after a green push, land the lane on dev now: under the dev lock merge the newest origin/dev, re-check (codegen and typecheck) only when dev moved since the gate, squash into ONE commit on dev and push it (never forced); a conflict refuses LANE_LAND_CONFLICT with its files; then the harness publishes its dev line and the dev checkout is marked for its debounced sync" },
        keep: { kind: "boolean", summary: "with --land: keep the lane's worktree after the landing (default: once dev is pushed it is removed to save disk, the branch kept, local and remote; a worktree in use, with uncommitted non-cache work, or still busy after retries is kept and the one line says why)" },
        wait: { kind: "string", summary: "seconds to wait for each slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the slot root and lanes folder (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml)" },
        profile: { kind: "string", summary: "app or harness (default: harness in the harness checkout, else app): the harness gates with starci check --level dev and pushes with git push" },
    },
    run: async (context, flags) => {
        if (flags.land && !flags.push) throw new Refusal("CLI_USAGE", "--land lands a pushed, gated lane: give --push too")
        if (flags.keep && !flags.land) throw new Refusal("CLI_USAGE", "--keep keeps the worktree of a landed lane: give --land too")
        assertPosixSh("lane gate")
        const say = context.progress
        const root = await repositoryRoot(context.cwd)
        const lane = await laneHolder(root, flags.lane)
        const branch = await currentBranch(root)
        if (branch === undefined) throw new Refusal("LANE_GATE_DETACHED", "the worktree is on no branch")
        const merging = !flags["skip-merge"]
        if (merging || flags.push) {
            const dirty = await trackedWorkChanges(root)
            if (dirty.length > 0) throw new Refusal("LANE_GATE_DIRTY", `${String(dirty.length)} tracked path(s) are not committed (${dirty.slice(0, 3).join(", ")}): commit first; a merge and a push need a clean tree`)
        }
        const rules = loadSlotRules()
        const slots = slotRoot(flags.dir, rules)
        // An early warning while the drive still has room: the landed worktrees that can go are listed, never removed here.
        for (const line of await diskWarningLines(lanesDir(flags.dir), lane)) say(line)
        const wait = waitSeconds(flags.wait)
        // A new gate of the lane supersedes its running one: its process tree is killed and its slot released.
        const head = (await gitOut(root, ["rev-parse", "HEAD"])).out
        const cancelled = cancelLaneGate(slots, rules, lane)
        if (cancelled.length > 0) {
            say(`superseded by ${head.slice(0, 10)}: cancelled the running gate of ${lane} (${cancelled.map((run) => `pid ${String(run.pid)}`).join(", ")}) and released its slot`)
        }
        const ref = flags.ref ?? "origin/dev"
        const merged = merging ? await mergeRef(root, ref, say) : null
        // The dev commit the gate judged the lane on: --land re-checks only when dev moved past it.
        const gatedBase = merged === null ? undefined : (await gitOut(root, ["rev-parse", ref])).out
        const land = async (green: boolean): Promise<LaneLanded | null> => (flags.land && green ? landLane({ root, lane, branch, profile: profileName, dir: lanesDir(flags.dir), gatedBase, say }) : null)
        // After a landing the worktree is removed (harness/land-cleanup.ts) unless --keep; the command leaves it first, and the one line it prints says what happened.
        const tidy = async (landed: LaneLanded | null): Promise<LandCleanup | null> => (landed === null ? null : cleanupLanded({ root, lane, branch, laneSha: landed.laneSha, dir: lanesDir(flags.dir), keep: flags.keep }))
        const profileName = profileNameFor(root, flags.profile)
        if (profileName === "harness") {
            const harness = await gateHarness({ root, lane, branch, ref, merging, push: flags.push, slots, rules, wait, say })
                const landed = await land(harness.pushed)
            const cleanup = await tidy(landed)
            const data: LaneGate = { lane, branch, merged, installed: false, installSource: "none", timings: [], prepared: [], mode: flags.push ? "push" : "check", profile: profileName, exitCode: harness.exitCode, verdict: harness.verdict, findings: harness.findings, pushed: harness.pushed, landed, cleanup }
            return { data, message: gateLines(data).join("\n"), exitCode: harness.verdict === "green" ? 0 : 1 }
        }
        const timings: { phase: string; seconds: number }[] = []
        const timed = async <T>(phase: string, work: () => Promise<T>): Promise<T> => {
            const started = Date.now()
            try {
                return await work()
            } finally {
                timings.push({ phase, seconds: Math.round((Date.now() - started) / 100) / 10 })
            }
        }
        const installed = await needsInstall(root, merged, flags.install)
        let installSource: LaneGate["installSource"] = "none"
        if (installed) {
            await timed("install", () => withSlot(slots, rules, "npm", lane, { waitSeconds: wait, say }, async (taken) => {
                const runScript = async (script: string): Promise<boolean> => (await withHeavySlot("install", `lane gate ${lane}: npm run ${script}`, root, {}, (held) => captureNpm(["run", script, "--ignore-scripts", "--silent"], root, held.options))).exitCode === 0
                if (flags.install) say("--install: npm ci, no shared install")
                else {
                    const shared = await sharedInstall(root, { lanes: slots, say, runScript, devSyncCheckout: devSyncCheckoutOf(root) })
                    if (shared.status === "linked") {
                        installSource = "shared"
                        say(`node_modules from the shared install ${shared.key} (${String(shared.files)} files, ${String(shared.copied)} copied, ${String(Math.round(shared.ms / 100) / 10)}s), no npm ci; lifecycle: ${shared.scripts.join(", ") || "none"} (npm slot ${String(taken.n)})`)
                        return
                    }
                    say(`shared install not used (${shared.reason}); npm ci`)
                }
                say(`npm ci (npm slot ${String(taken.n)})`)
                installSource = "npm ci"
                const run = await withHeavySlot("install", `lane gate ${lane}: npm ci`, root, { onSpawn: taken.spawned }, (held) => captureNpm(["ci", "--no-audit", "--no-fund"], root, held.options))
                if (run.exitCode !== 0) throw new Refusal("LANE_GATE_INSTALL", `npm ci exited ${String(run.exitCode)}${isOutOfMemory(run.exitCode, run.stderr) ? " (out of memory: run it again once the host has RAM)" : ""}: ${run.stderr.split("\n").slice(-3).join(" ")}`)
                // A lane whose lockfiles equal the dev line's holds the install every next lane wants: cache it once.
                if (!flags.install && followsBase(root, ref)) say(await cacheLaneInstall(root, slots))
            }))
            writeFileSync(join(root, INSTALL_MARK), (await gitOut(root, ["hash-object", "package-lock.json"])).out)
        }
        // The workspace packages are built after an install only: a tree whose install did not move keeps the builds it already has.
        const preparing = await timed("prepare", () => prepareTree(root, `lane gate ${lane}`, installed ? PREPARE_SCRIPTS : PREPARE_SCRIPTS.filter((script) => script === "codegen")))
        if (preparing.failure !== undefined) throw new Refusal("LANE_GATE_PREPARE", `${preparing.failure.command} exited ${String(preparing.failure.exitCode)}: ${preparing.failure.output.split("\n").slice(-3).join(" ")}`)
        const prepared = [...preparing.ran]
        if (!existsSync(appCli(root))) throw new Refusal("LANE_GATE_NO_APP_CLI", `${appCli(root)} is missing: the app pins starci-harness; run lane gate --install`)
        const mode = flags.push ? "push" : "check"
        // A lane lands on dev: the check is the FAST level (app check --level dev), and a push of the lane branch runs it once, in its pre-push hook.
        const args = flags.push ? ["app", "push", "--json", "origin", `HEAD:${branch}`] : [...LANE_CHECK_ARGS]
        const run = await timed(mode === "push" ? "app push" : "app check", () => withSlot(slots, rules, "gate", lane, { waitSeconds: wait, say }, (taken) => {
            say(`${mode === "push" ? `app push origin HEAD:${branch}` : "app check --env prod --level dev"} (gate slot ${String(taken.n)})`)
            return captureTool(process.execPath, [appCli(root), ...args], root, { onSpawn: taken.spawned })
        }))
        const oom = isOutOfMemory(run.exitCode, run.stderr)
        let verdict: GateVerdict
        let findings: LaneFinding[] = []
        let pushed = false
        if (mode === "push") {
            pushed = run.exitCode === 0
            verdict = pushed ? "green" : oom ? "oom" : "red"
            if (!pushed) findings = [{ code: "LANE_GATE_PUSH", path: "", message: `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 600) }]
        } else {
            const all = blockingFindings(run.stdout)
            findings = all ?? []
            verdict = oom || findings.some((finding) => isOutOfMemory(undefined, finding.message)) ? "oom" : all === undefined || (run.exitCode !== 0 && all.length === 0) ? "no-verdict" : findings.length === 0 ? "green" : "red"
        }
        const landed = await land(pushed)
        const cleanup = await tidy(landed)
        const data: LaneGate = { lane, branch, merged, installed, installSource, timings, prepared, mode, profile: profileName, exitCode: run.exitCode, verdict, findings, pushed, landed, cleanup }
        return { data, message: gateLines(data).join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})
