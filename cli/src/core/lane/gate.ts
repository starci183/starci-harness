import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureNpm, captureTool } from "../../shared/exec.js"
import { captureGit, currentBranch, repositoryRoot, trackedChanges } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { blockingFindings, isOutOfMemory } from "../../harness/land-queue.js"
import type { LaneFinding } from "../../harness/land-queue.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { cancelLaneGate, markSuperseded } from "../../harness/supersede.js"
import { lanesDir } from "../../harness/land-queue.js"
import { landProfile, profileNameFor } from "../../harness/land-profile.js"
import type { LandProfileName } from "../../harness/land-profile.js"
import { runningCliRoot } from "../../harness/lander-install.js"
import { laneHolder, waitSeconds } from "../slot/holder.js"
import { registerReady } from "./ready.js"
import type { Registered } from "./ready.js"

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
    readonly prepared: readonly string[]
    readonly mode: "check" | "push"
    /** The repository's profile (harness/land-profile.ts): an app's pinned CLI and hook, or the harness FAST gate and a plain git push. */
    readonly profile: LandProfileName
    readonly exitCode: number
    readonly verdict: GateVerdict
    readonly findings: readonly LaneFinding[]
    readonly pushed: boolean
    readonly ready: Registered | null
}

const gitOut = async (cwd: string, args: readonly string[]): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> => {
    const run = await captureGit(args, cwd)
    return { ok: run.exitCode === 0, out: run.stdout.trim(), err: run.stderr.trim() }
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
    ...data.findings.slice(0, 20).map((finding) => `  ${finding.code} ${finding.path} ${finding.message.split("\n")[0] ?? ""}`.trimEnd()),
    ...(data.ready === null ? [] : [`ready: monitor ${data.ready.status}`]),
]

/** What the harness profile of `lane gate` hands back. */
interface HarnessGated {
    readonly exitCode: number
    readonly verdict: GateVerdict
    readonly findings: LaneFinding[]
    readonly pushed: boolean
}

/**
 * The gate of a harness lane: no root install, codegen or app hook. Under a gate slot the lane's own running CLI runs the harness FAST gate
 * (`release gate --level dev`) measured from where the lane forks from the dev commit it merged, and with --push a green gate is followed by
 * `git push origin HEAD:<branch>` (the harness has no pre-push hook that would run it again).
 */
const gateHarness = async (given: { readonly root: string; readonly lane: string; readonly branch: string; readonly ref: string; readonly merging: boolean; readonly push: boolean; readonly slots: string; readonly rules: ReturnType<typeof loadSlotRules>; readonly wait: number | undefined; readonly say: (line: string) => void }): Promise<HarnessGated> => {
    const { root, lane, branch, ref, push, slots, rules, wait, say } = given
    const base = (await gitOut(root, ["rev-parse", given.merging ? ref : "HEAD"])).out
    const fork = (await gitOut(root, ["merge-base", "HEAD", base])).out
    const profile = landProfile("harness", join(runningCliRoot(), "dist", "main.js"))
    const command = profile.gate(root, fork === "" ? base : fork)
    const run = await withSlot(slots, rules, "gate", lane, { waitSeconds: wait, say }, (taken) => {
        say(`${profile.gateLabel} (gate slot ${String(taken.n)})`)
        return captureTool(command.file, command.args, root)
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
 * HEAD:<branch>`, whose pre-push hook runs the fast level once. A new gate of the same lane cancels the lane's running one (harness/supersede.ts). --ready registers the pushed sha with the batch lander.
 */
export const laneGateVerb = defineVerb({
    path: ["lane", "gate"],
    summary: "the local gate of a lane before it lands: merge origin/dev, npm ci under an npm slot when the merge changed a manifest or lockfile, codegen, then under a gate slot the app's own app check --env prod --level dev (the fast level of a landing on dev: deps, types, the lane's own tests, db, the design approval; the full gate runs once at the main cut), or --push app push (its pre-push hook runs the fast level once), and --ready register with the batch lander; a new gate of the same lane first cancels the lane's running gate (kills its process tree, releases its slot, writes superseded by <sha> into its status)",
    effect: "remote",
    roles: WRITERS,
    schema: "starci/lane-gate@1",
    flags: {
        lane: { kind: "string", summary: "the lane name (default: STARCI_LANE, else the branch lane/<lane>)", positional: true },
        ref: { kind: "string", summary: "the ref merged before the gate (default: origin/dev)" },
        "skip-merge": { kind: "boolean", summary: "gate the tree as it is, merging nothing" },
        install: { kind: "boolean", summary: "run npm ci whatever the merge changed" },
        push: { kind: "boolean", summary: "instead of the check, app push origin HEAD:<branch> under the gate slot: it runs the check, commits the cache records and pushes once" },
        ready: { kind: "boolean", summary: "after a push, register the pushed sha with the batch lander (lane ready)" },
        wait: { kind: "string", summary: "seconds to wait for each slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the slot root and lanes folder (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml)" },
        profile: { kind: "string", summary: "app or harness (default: harness in the harness checkout, else app): the harness gates with release gate --level dev and pushes with git push" },
    },
    run: async (context, flags) => {
        if (flags.ready && !flags.push) throw new Refusal("CLI_USAGE", "--ready registers a pushed sha: give --push too")
        const say = context.progress
        const root = await repositoryRoot(context.cwd)
        const lane = await laneHolder(root, flags.lane)
        const branch = await currentBranch(root)
        if (branch === undefined) throw new Refusal("LANE_GATE_DETACHED", "the worktree is on no branch")
        const merging = !flags["skip-merge"]
        if (merging || flags.push) {
            const dirty = await trackedChanges(root)
            if (dirty.length > 0) throw new Refusal("LANE_GATE_DIRTY", `${String(dirty.length)} tracked path(s) are not committed (${dirty.slice(0, 3).join(", ")}): commit first; a merge and a push need a clean tree`)
        }
        const rules = loadSlotRules()
        const slots = slotRoot(flags.dir, rules)
        const wait = waitSeconds(flags.wait)
        // A new gate of the lane supersedes its running one (owner: "nếu push commit mới thì cancel lun commit cũ"): its process tree is killed and its slot released.
        const head = (await gitOut(root, ["rev-parse", "HEAD"])).out
        const cancelled = cancelLaneGate(slots, rules, lane)
        if (cancelled.length > 0) {
            say(`superseded by ${head.slice(0, 10)}: cancelled the running gate of ${lane} (${cancelled.map((run) => `pid ${String(run.pid)}`).join(", ")}) and released its slot`)
            try {
                markSuperseded(lanesDir(flags.dir), lane, head, `the running gate of ${lane} was cancelled by a newer push`)
            } catch {
                // the status file is the monitor's courtesy; the cancel itself happened
            }
        }
        const ref = flags.ref ?? "origin/dev"
        const merged = merging ? await mergeRef(root, ref, say) : null
        const profileName = profileNameFor(root, flags.profile)
        if (profileName === "harness") {
            const harness = await gateHarness({ root, lane, branch, ref, merging, push: flags.push, slots, rules, wait, say })
            const ready = flags.ready && harness.pushed ? (await registerReady(root, { lane, branch, dir: flags.dir })).data : null
            const data: LaneGate = { lane, branch, merged, installed: false, prepared: [], mode: flags.push ? "push" : "check", profile: profileName, exitCode: harness.exitCode, verdict: harness.verdict, findings: harness.findings, pushed: harness.pushed, ready }
            return { data, message: gateLines(data).join("\n"), exitCode: harness.verdict === "green" ? 0 : 1 }
        }
        const installed = await needsInstall(root, merged, flags.install)
        if (installed) {
            await withSlot(slots, rules, "npm", lane, { waitSeconds: wait, say }, async (taken) => {
                say(`npm ci (npm slot ${String(taken.n)})`)
                const run = await withHeavySlot("install", `lane gate ${lane}: npm ci`, root, {}, (held) => captureNpm(["ci", "--no-audit", "--no-fund"], root, held.options))
                if (run.exitCode !== 0) throw new Refusal("LANE_GATE_INSTALL", `npm ci exited ${String(run.exitCode)}${isOutOfMemory(run.exitCode, run.stderr) ? " (out of memory: run it again once the host has RAM)" : ""}: ${run.stderr.split("\n").slice(-3).join(" ")}`)
            })
            writeFileSync(join(root, INSTALL_MARK), (await gitOut(root, ["hash-object", "package-lock.json"])).out)
        }
        const prepared: string[] = []
        for (const script of installed ? ["codegen", "build:modules"] : ["codegen"]) {
            const run = await withHeavySlot("build", `lane gate ${lane}: npm run ${script}`, root, {}, (held) => captureNpm(["run", script, "--silent", "--if-present"], root, held.options))
            if (run.exitCode !== 0) throw new Refusal("LANE_GATE_PREPARE", `npm run ${script} exited ${String(run.exitCode)}: ${run.stderr.split("\n").slice(-3).join(" ")}`)
            prepared.push(script)
        }
        if (!existsSync(appCli(root))) throw new Refusal("LANE_GATE_NO_APP_CLI", `${appCli(root)} is missing: the app pins starci-harness; run lane gate --install`)
        const mode = flags.push ? "push" : "check"
        // A lane lands on dev: the check is the FAST level (app check --level dev), and a push of the lane branch runs it once, in its pre-push hook.
        const args = flags.push ? ["app", "push", "--json", "origin", `HEAD:${branch}`] : [...LANE_CHECK_ARGS]
        const run = await withSlot(slots, rules, "gate", lane, { waitSeconds: wait, say }, (taken) => {
            say(`${mode === "push" ? `app push origin HEAD:${branch}` : "app check --env prod --level dev"} (gate slot ${String(taken.n)})`)
            return captureTool(process.execPath, [appCli(root), ...args], root)
        })
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
        const ready = flags.ready && pushed ? (await registerReady(root, { lane, branch, dir: flags.dir })).data : null
        const data: LaneGate = { lane, branch, merged, installed, prepared, mode, profile: profileName, exitCode: run.exitCode, verdict, findings, pushed, ready }
        return { data, message: gateLines(data).join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})
