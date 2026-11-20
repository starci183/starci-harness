import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureNpm, captureTool } from "../../shared/exec.js"
import { captureGit, currentBranch, repositoryRoot, trackedChanges } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { CACHE_RULE, blockingFindings, isOutOfMemory } from "../../harness/land-queue.js"
import type { LaneFinding } from "../../harness/land-queue.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { laneHolder, waitSeconds } from "../slot/holder.js"
import { registerReady } from "./ready.js"
import type { Registered } from "./ready.js"

/** The mark of the lockfile a lane's node_modules was installed from by this verb. */
const INSTALL_MARK = join("node_modules", ".starci-lane-gate-lock")
/** A file whose change in the merge means node_modules no longer matches the tree. */
const INSTALL_INPUT = /(?:^|\/)package(?:-lock)?\.json$/

/** How the gate ended: green except the cache, red with findings, out of memory (nobody's fault), or no readable verdict. */
export type GateVerdict = "green" | "red" | "oom" | "no-verdict"

/** What one `lane gate` did, step by step. */
export interface LaneGate {
    readonly lane: string
    readonly branch: string
    readonly merged: { readonly ref: string; readonly before: string; readonly after: string } | null
    readonly installed: boolean
    readonly prepared: readonly string[]
    readonly mode: "check" | "push"
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

/**
 * `starci lane gate [lane]`: the local gate a lane runs before it lands (contexts/authority/lanes.md). It merges the base ref
 * (origin/dev), installs under an npm slot when the merge changed a manifest or lockfile, runs codegen (and build:modules after an
 * install), then, under a gate slot, the app's own `app check --env prod` (green except the cache) or, with --push, `app push origin
 * HEAD:<branch>`, which commits the cache records and pushes once. --ready registers the pushed sha with the batch lander.
 */
export const laneGateVerb = defineVerb({
    path: ["lane", "gate"],
    summary: "the local gate of a lane before it lands: merge origin/dev, npm ci under an npm slot when the merge changed a manifest or lockfile, codegen, then under a gate slot the app's own app check --env prod (green except the cache), or --push app push, and --ready register with the batch lander",
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
        const merged = merging ? await mergeRef(root, flags.ref ?? "origin/dev", say) : null
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
        const args = flags.push ? ["app", "push", "--json", "origin", `HEAD:${branch}`] : ["app", "check", "--env", "prod", "--json"]
        const run = await withSlot(slots, rules, "gate", lane, { waitSeconds: wait, say }, (taken) => {
            say(`${mode === "push" ? `app push origin HEAD:${branch}` : "app check --env prod"} (gate slot ${String(taken.n)})`)
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
            findings = (all ?? []).filter((finding) => finding.code !== CACHE_RULE)
            verdict = oom || findings.some((finding) => isOutOfMemory(undefined, finding.message)) ? "oom" : all === undefined || (run.exitCode !== 0 && all.length === 0) ? "no-verdict" : findings.length === 0 ? "green" : "red"
        }
        const ready = flags.ready && pushed ? (await registerReady(root, { lane, branch, dir: flags.dir })).data : null
        const data: LaneGate = { lane, branch, merged, installed, prepared, mode, exitCode: run.exitCode, verdict, findings, pushed, ready }
        const lines = [
            `${lane}: ${mode} ${verdict}${mode === "check" && verdict === "green" ? " (except the cache: commit it as the run left it, or use --push)" : ""}`,
            ...findings.slice(0, 20).map((finding) => `  ${finding.code} ${finding.path} ${finding.message.split("\n")[0] ?? ""}`.trimEnd()),
            ...(ready === null ? [] : [`ready: monitor ${ready.status}`]),
        ]
        return { data, message: lines.join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})
